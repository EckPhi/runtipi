import type { Architecture } from '@/common/constants';
import { extractAppUrn } from '@/common/helpers/app-helpers';
import { notEmpty, pLimit } from '@/common/helpers/file-helpers';
import { ConfigurationService } from '@/core/config/configuration.service';
import type { AppStore } from '@/core/database/drizzle/types';
import { FilesystemService } from '@/core/filesystem/filesystem.service';
import { LoggerService } from '@/core/logger/logger.service';
import { Injectable } from '@nestjs/common';
import type { PluginCapability, PluginManifest } from '@runtipi/common/schemas';
import type { AppUrn } from '@runtipi/common/types';
import MiniSearch from 'minisearch';
import { AppStoreFilesManager } from '../app-stores/app-store-files-manager';
import { AppStoreService, RESERVED_APP_STORE_SLUGS } from '../app-stores/app-store.service';

type AppList = Awaited<ReturnType<InstanceType<typeof MarketplaceService>['getAllAppFromStores']>>;
type CatalogSnapshot = { apps: AppList; search: MiniSearch<AppList[number]>; createdAt: number };
type PluginCatalogSnapshot = { plugins: PluginManifest[]; search: MiniSearch<PluginManifest>; createdAt: number };

const sortApps = (a: AppList[number], b: AppList[number]) => a.urn.localeCompare(b.urn);
const filterApp =
  (architecture: Architecture) =>
  (app: AppList[number]): boolean => {
    if (app.deprecated) {
      return false;
    }

    if (!app.supported_architectures?.length) {
      return true;
    }

    return app.supported_architectures.includes(architecture);
  };

@Injectable()
export class MarketplaceService {
  private stores: Map<string, AppStoreFilesManager> = new Map();
  private catalog: CatalogSnapshot | null = null;
  private catalogLoad: Promise<CatalogSnapshot> | null = null;
  private pluginCatalog: PluginCatalogSnapshot | null = null;
  private pluginCatalogLoad: Promise<PluginCatalogSnapshot> | null = null;
  private cacheTimeout = 1000 * 60 * 15; // 15 minutes
  private generation = 0;
  private publishedGeneration = 0;
  private cacheGeneration = 0;

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly filesystem: FilesystemService,
    private readonly logger: LoggerService,
    private readonly appStoreService: AppStoreService,
  ) {}

  async createAppStore(input: Parameters<AppStoreService['createAppStore']>[0]) {
    const result = await this.appStoreService.createAppStore(input);
    this.setStore(result);
    await this.refreshAfterMutation();
    return result;
  }

  async updateAppStore(id: string, input: Parameters<AppStoreService['updateAppStore']>[1]) {
    const result = await this.appStoreService.updateAppStore(id, input);
    this.setStore(result);
    await this.refreshAfterMutation();
  }

  async deleteAppStore(id: string) {
    await this.appStoreService.deleteAppStore(id);
    this.stores.delete(id);
    await this.refreshAfterMutation();
  }

  async pullAppStores() {
    await this.initialize();
    return { success: true };
  }

  private setStore(config: AppStore) {
    this.stores.set(config.slug, new AppStoreFilesManager(this.configuration, this.filesystem, this.logger, config));
  }

  private async refreshAfterMutation() {
    // A committed mutation must supersede older reads even if its follow-up reload fails.
    this.publishedGeneration = ++this.generation;
    this.invalidateCache();

    try {
      await this.initialize();
    } catch (error) {
      this.logger.warn('App store mutation succeeded, but marketplace refresh failed', error);
    }
  }

  private async reloadStores() {
    const generation = ++this.generation;
    const stores = await this.appStoreService.getAllAppStores();
    if (generation < this.publishedGeneration) return;

    const nextStores = new Map<string, AppStoreFilesManager>();
    for (const config of stores) {
      const store = new AppStoreFilesManager(this.configuration, this.filesystem, this.logger, config);
      nextStores.set(config.slug, store);
    }

    // TODO: This is a temporary fix to ensure that internal app stores are always present.
    for (const reservedSlug of RESERVED_APP_STORE_SLUGS) {
      if (!nextStores.has(reservedSlug)) {
        const store = new AppStoreFilesManager(this.configuration, this.filesystem, this.logger, {
          branch: 'main',
          createdAt: Math.floor(Date.now() / 1000),
          enabled: false,
          hash: reservedSlug,
          name: reservedSlug,
          slug: reservedSlug,
          url: 'https://example.com',
          updatedAt: Math.floor(Date.now() / 1000),
        });
        nextStores.set(reservedSlug, store);
      }
    }

    this.publishedGeneration = generation;
    this.stores = nextStores;
    this.invalidateCache();
  }

  async initialize() {
    await this.reloadStores();

    try {
      await this.appStoreService.pullRepositories();
    } finally {
      this.invalidateCache();
    }

    this.logger.debug('Marketplace service initialized with stores', Array.from(this.stores.keys()).join(', '));
  }

  private getStoreFromUrn(appUrn: AppUrn) {
    const { appStoreId } = extractAppUrn(appUrn);

    const store = this.stores.get(appStoreId);
    if (!store) {
      throw new Error(`Store ${appStoreId} not found`);
    }

    return { store };
  }

  async getAppInfoFromAppStore(appUrn: AppUrn) {
    const { store } = this.getStoreFromUrn(appUrn);

    return store.getAppInfoFromAppStore(appUrn);
  }

  async getAppInfoFromAppStoreOrInstalled(appUrn: AppUrn) {
    const { store } = this.getStoreFromUrn(appUrn);

    return store.getAppInfoFromAppStoreOrInstalled(appUrn);
  }

  async getAvailableAppUrns(): Promise<AppUrn[]> {
    const allUrns: AppUrn[] = [];
    for (const store of this.stores.values()) {
      if (store.storeConfig.enabled) {
        const urns = await store.getAvailableAppUrns();
        allUrns.push(...urns);
      }
    }
    return allUrns.sort((a, b) => a.localeCompare(b));
  }

  /**
   * Get all available apps from the catalog
   * @returns All available apps
   */
  private async getAllAppFromStores() {
    const stores = [...this.stores.values()].filter((store) => store.storeConfig.enabled);
    const limit = pLimit(10);
    const apps = await Promise.all(
      stores.map(async (store) => {
        const urns = await store.getAvailableAppUrns();
        return Promise.all(urns.map((urn) => limit(() => store.getAppInfoFromAppStore(urn))));
      }),
    );

    return apps.flat().filter(notEmpty);
  }

  /**
   * Filter the apps based on the architecture
   * @param apps - The apps to filter
   * @returns The filtered apps
   */
  private filterApps(apps: AppList): AppList {
    const { architecture } = this.configuration.getConfig();
    return apps.sort(sortApps).filter(filterApp(architecture));
  }

  /**
   * Invalidate the cache
   */
  private invalidateCache() {
    this.cacheGeneration++;
    this.catalog = null;
    this.pluginCatalog = null;
  }

  private async loadCatalog() {
    while (true) {
      const generation = this.cacheGeneration;
      const available = await this.getAllAppFromStores();
      if (generation !== this.cacheGeneration) continue;

      const apps = this.filterApps(available);
      const search = new MiniSearch<AppList[number]>({
        fields: ['name', 'short_desc', 'categories'],
        storeFields: ['urn'],
        idField: 'urn',
        searchOptions: {
          boost: { name: 2 },
          fuzzy: 0.2,
          prefix: true,
        },
      });
      search.addAll(apps);

      const snapshot: CatalogSnapshot = { apps, search, createdAt: Date.now() };
      this.catalog = snapshot;
      return snapshot;
    }
  }

  private async getCatalog() {
    while (true) {
      if (this.catalog && Date.now() - this.catalog.createdAt > this.cacheTimeout) this.invalidateCache();
      if (this.catalog) return this.catalog;

      const load = this.catalogLoad ?? this.loadCatalog();
      this.catalogLoad = load;
      try {
        await load;
      } finally {
        if (this.catalogLoad === load) this.catalogLoad = null;
      }
    }
  }

  public async getAvailableApps(): Promise<AppList> {
    return (await this.getCatalog()).apps;
  }

  /**
   * Search for apps in the catalog
   * @param params - The search parameters
   * @returns The search results
   */
  public async searchApps(params: { search?: string | null; category?: string | null; pageSize?: number; cursor?: string | null; storeId?: string }) {
    const { search, category, pageSize, cursor, storeId } = params;

    const catalog = await this.getCatalog();
    let filteredApps = catalog.apps;

    if (storeId) {
      filteredApps = filteredApps.filter((app) => {
        const { appStoreId } = extractAppUrn(app.urn);
        return appStoreId === storeId;
      });
    }

    if (category) {
      filteredApps = filteredApps.filter((app) => app.categories.some((c) => c === category));
    }

    if (search) {
      const result = catalog.search.search(search);
      const searchIds = result.map((app) => app.id);
      filteredApps = filteredApps.filter((app) => searchIds.includes(app.urn)).sort((a, b) => searchIds.indexOf(a.urn) - searchIds.indexOf(b.urn));
    }

    const start = cursor ? filteredApps.findIndex((app) => app.urn === cursor) : 0;
    const end = start + (pageSize ?? 24);
    const data = filteredApps.slice(start, end);

    return {
      data,
      total: filteredApps.length,
      nextCursor: filteredApps[end]?.urn ?? null,
    };
  }

  private async getAllPluginsFromStores() {
    const stores = [...this.stores.values()].filter((store) => store.storeConfig.enabled);
    const limit = pLimit(10);
    const plugins = await Promise.all(
      stores.map(async (store) => {
        const urns = await store.getAvailablePluginUrns();
        return Promise.all(urns.map((urn) => limit(() => store.getPluginInfoFromStore(urn))));
      }),
    );

    return plugins
      .flat()
      .filter(notEmpty)
      .filter((plugin) => plugin.available && !plugin.deprecated)
      .sort((a, b) => a.urn.localeCompare(b.urn));
  }

  private async loadPluginCatalog() {
    while (true) {
      const generation = this.cacheGeneration;
      const plugins = await this.getAllPluginsFromStores();
      if (generation !== this.cacheGeneration) continue;

      const search = new MiniSearch<PluginManifest>({
        fields: ['name', 'short_desc', 'capabilities'],
        storeFields: ['urn'],
        idField: 'urn',
        extractField: (document, fieldName) => {
          const value = document[fieldName as keyof PluginManifest];
          return Array.isArray(value) ? value.join(' ') : (value as string);
        },
        searchOptions: { boost: { name: 2 }, fuzzy: 0.2, prefix: true },
      });
      search.addAll(plugins);

      const snapshot: PluginCatalogSnapshot = { plugins, search, createdAt: Date.now() };
      this.pluginCatalog = snapshot;
      return snapshot;
    }
  }

  private async getPluginCatalog() {
    while (true) {
      if (this.pluginCatalog && Date.now() - this.pluginCatalog.createdAt > this.cacheTimeout) this.invalidateCache();
      if (this.pluginCatalog) return this.pluginCatalog;

      const load = this.pluginCatalogLoad ?? this.loadPluginCatalog();
      this.pluginCatalogLoad = load;
      try {
        await load;
      } finally {
        if (this.pluginCatalogLoad === load) this.pluginCatalogLoad = null;
      }
    }
  }

  /**
   * All installable plugins of the enabled stores. Deprecated or unavailable plugins are left out.
   */
  public async getAvailablePlugins(): Promise<PluginManifest[]> {
    return (await this.getPluginCatalog()).plugins;
  }

  public async searchPlugins(params: {
    search?: string | null;
    capability?: PluginCapability | null;
    storeId?: string | null;
    pageSize?: number;
    cursor?: string | null;
  }) {
    const { search, capability, storeId, pageSize, cursor } = params;

    const catalog = await this.getPluginCatalog();
    let filtered = catalog.plugins;

    if (storeId) {
      filtered = filtered.filter((plugin) => extractAppUrn(plugin.urn).appStoreId === storeId);
    }

    if (capability) {
      filtered = filtered.filter((plugin) => plugin.capabilities.includes(capability));
    }

    if (search) {
      const searchIds = catalog.search.search(search).map((result) => result.id);
      filtered = filtered.filter((plugin) => searchIds.includes(plugin.urn)).sort((a, b) => searchIds.indexOf(a.urn) - searchIds.indexOf(b.urn));
    }

    const start = cursor
      ? Math.max(
          filtered.findIndex((plugin) => plugin.urn === cursor),
          0,
        )
      : 0;
    const end = start + (pageSize ?? 24);

    return {
      data: filtered.slice(start, end),
      total: filtered.length,
      nextCursor: filtered[end]?.urn ?? null,
    };
  }

  /**
   * Get a plugin manifest straight from its store repository, regardless of whether the store is enabled.
   */
  public async getPluginInfoFromStore(pluginUrn: AppUrn) {
    const { store } = this.getStoreFromUrn(pluginUrn);
    return store.getPluginInfoFromStore(pluginUrn);
  }

  public async getInstalledPluginInfo(pluginUrn: AppUrn) {
    const { store } = this.getStoreFromUrn(pluginUrn);
    return store.getInstalledPluginInfo(pluginUrn);
  }

  public async stagePlugin(pluginUrn: AppUrn) {
    const { store } = this.getStoreFromUrn(pluginUrn);
    return store.stagePlugin(pluginUrn);
  }

  public async discardStagedPlugin(pluginUrn: AppUrn, stagingDir: string) {
    const { store } = this.getStoreFromUrn(pluginUrn);
    return store.discardStagedPlugin(stagingDir);
  }

  public async promoteStagedPlugin(pluginUrn: AppUrn, stagingDir: string) {
    const { store } = this.getStoreFromUrn(pluginUrn);
    return store.promoteStagedPlugin(pluginUrn, stagingDir);
  }

  public async removeInstalledPlugin(pluginUrn: AppUrn) {
    const { store } = this.getStoreFromUrn(pluginUrn);
    return store.removeInstalledPlugin(pluginUrn);
  }

  /**
   * Get the image of an app
   * @param appUrn - The ID of the app
   * @returns The image of the app
   */
  public async getAppImage(appUrn: AppUrn) {
    const { store } = this.getStoreFromUrn(appUrn);
    return store.getAppImage(appUrn);
  }

  public async getAppUpdateInfo(appUrn: AppUrn) {
    const { store } = this.getStoreFromUrn(appUrn);
    return store.getAppUpdateInfo(appUrn);
  }

  public async copyAppFromRepoToInstalled(appUrn: AppUrn) {
    const { store } = this.getStoreFromUrn(appUrn);
    return store.copyAppFromRepoToInstalled(appUrn);
  }

  public async copyDataDir(appUrn: AppUrn, envMap: Map<string, string>) {
    const { store } = this.getStoreFromUrn(appUrn);
    return store.copyDataDir(appUrn, envMap);
  }

  public async getSourceDockerComposeYaml(appUrn: AppUrn) {
    const { store } = this.getStoreFromUrn(appUrn);
    return store.getSourceDockerComposeYaml(appUrn);
  }

  public async getConfigJson(appUrn: AppUrn) {
    const { store } = this.getStoreFromUrn(appUrn);
    return store.getConfigJson(appUrn);
  }
}
