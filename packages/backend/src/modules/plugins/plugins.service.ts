import { TranslatableError } from '@/common/error/translatable-error';
import { extractAppUrn } from '@/common/helpers/app-helpers';
import { isBelowMinTipiVersion } from '@/common/helpers/version-helpers';
import { ConfigurationService } from '@/core/config/configuration.service';
import type { Plugin } from '@/core/database/drizzle/types';
import { LoggerService } from '@/core/logger/logger.service';
import type { AsyncMutex } from '@/utils/mutex/async-mutex';
import { APP_ASYNC_MUTEX } from '@/utils/mutex/mutex.module';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { DynamicComposeSchemaYaml, PluginAppSettings, PluginCapability, PluginManifest } from '@runtipi/common/schemas';
import type { AppUrn } from '@runtipi/common/types';
import { type } from 'arktype';
import { type ComposePlugin, getApplicableServices } from '../docker/builders/plugin-patches';
import { MarketplaceService } from '../marketplace/marketplace.service';
import { type PluginConfig, validateAppPluginConfig, validatePluginConfig } from './plugin-config.helpers';
import { PluginsRepository } from './plugins.repository';

export type PluginIncompatibilityReason = 'min_tipi_version' | 'unavailable' | 'deprecated';
export type PluginCompatibility = { compatible: boolean; minTipiVersion: string | null; reason: PluginIncompatibilityReason | null };

/** Per-app plugin settings, stored in `app.config.plugins` and keyed by plugin urn. */
export type AppPluginsConfig = Record<string, PluginConfig>;

const appPluginsConfigSchema = type({ '[string]': type({ '[string]': 'string | number | boolean' }) });

const parseAppPluginsConfig = (value: unknown) => {
  const parsed = appPluginsConfigSchema(value ?? {});
  return parsed instanceof type.errors ? null : (parsed as AppPluginsConfig);
};

type AppSectionPlugin = { row: Plugin; manifest: PluginManifest & { app_settings: PluginAppSettings } };

@Injectable()
export class PluginsService {
  constructor(
    private readonly repository: PluginsRepository,
    private readonly marketplace: MarketplaceService,
    private readonly config: ConfigurationService,
    private readonly logger: LoggerService,
    @Inject(APP_ASYNC_MUTEX) private readonly mutex: AsyncMutex,
  ) {}

  private async withLock<T>(urn: AppUrn, fn: () => Promise<T>) {
    const release = await this.mutex.acquire(`plugin:${urn}`);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private assertCompatible(urn: AppUrn, manifest: PluginManifest) {
    if (isBelowMinTipiVersion(this.config.get('version'), manifest.min_tipi_version)) {
      throw new TranslatableError('PLUGIN_ERROR_MIN_TIPI_VERSION', { id: urn, minVersion: manifest.min_tipi_version }, HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Whether a manifest can be installed on this instance, and why not. Shown in the store so incompatible plugins are
   * listed with a reason instead of failing on install. The install and update checks stay authoritative.
   */
  public getCompatibility(manifest: PluginManifest): PluginCompatibility {
    const minTipiVersion = manifest.min_tipi_version ?? null;
    let reason: PluginIncompatibilityReason | null = null;

    if (isBelowMinTipiVersion(this.config.get('version'), manifest.min_tipi_version)) {
      reason = 'min_tipi_version';
    } else if (!manifest.available) {
      reason = 'unavailable';
    } else if (manifest.deprecated) {
      reason = 'deprecated';
    }

    return { compatible: reason === null, minTipiVersion, reason };
  }

  private validateGlobalConfig(urn: AppUrn, manifest: PluginManifest, input: PluginConfig) {
    const result = validatePluginConfig(manifest.settings.global, input);

    if (!result.success) {
      throw new TranslatableError('PLUGIN_ERROR_INVALID_CONFIG', { id: urn, reason: result.reason }, HttpStatus.BAD_REQUEST);
    }

    return result.config;
  }

  private async getStoreManifest(urn: AppUrn) {
    try {
      return await this.marketplace.getPluginInfoFromStore(urn);
    } catch {
      // The store the urn points to does not exist
      return null;
    }
  }

  private async getInstalledOrThrow(urn: AppUrn) {
    const installed = await this.repository.getPluginByUrn(urn);

    if (!installed) {
      throw new TranslatableError('PLUGIN_ERROR_NOT_INSTALLED', { id: urn }, HttpStatus.NOT_FOUND);
    }

    return installed;
  }

  private async toInstalledPlugin(row: Plugin) {
    const urn = row.urn as AppUrn;
    const [info, latest] = await Promise.all([this.marketplace.getInstalledPluginInfo(urn).catch(() => null), this.getStoreManifest(urn)]);

    return {
      ...row,
      info: info ?? null,
      latestVersion: latest?.version ?? null,
      latestTipiVersion: latest?.tipi_version ?? null,
      updateAvailable: latest ? latest.tipi_version > row.tipiVersion : false,
    };
  }

  public async searchCatalog(params: {
    search?: string | null;
    capability?: PluginCapability | null;
    storeId?: string | null;
    pageSize?: number;
    cursor?: string | null;
  }) {
    const rows = await this.repository.getPlugins();
    const installed = new Set(rows.map((row) => row.urn));
    const manifests = await Promise.all(rows.map((row) => this.marketplace.getInstalledPluginInfo(row.urn as AppUrn).catch(() => null)));
    const result = await this.marketplace.searchPlugins(
      params,
      manifests.filter((manifest): manifest is PluginManifest => manifest !== null),
    );

    return {
      ...result,
      data: result.data.map((plugin) => ({ ...plugin, installed: installed.has(plugin.urn), compatibility: this.getCompatibility(plugin) })),
    };
  }

  public async getCatalogPlugin(urn: AppUrn) {
    const catalogInfo = await this.getStoreManifest(urn);
    const row = await this.repository.getPluginByUrn(urn);
    const installed = row ? await this.toInstalledPlugin(row) : null;
    const info = catalogInfo ?? installed?.info;

    if (!info) {
      throw new TranslatableError('PLUGIN_ERROR_NOT_FOUND', { id: urn }, HttpStatus.NOT_FOUND);
    }

    return {
      info,
      compatibility: this.getCompatibility(info),
      installed,
      updateAvailable: row && catalogInfo ? catalogInfo.tipi_version > row.tipiVersion : false,
    };
  }

  public async getInstalledPlugins() {
    const rows = await this.repository.getPlugins();
    return Promise.all(rows.map((row) => this.toInstalledPlugin(row)));
  }

  public async getInstalledPlugin(urn: AppUrn) {
    return this.toInstalledPlugin(await this.getInstalledOrThrow(urn));
  }

  /**
   * Copy the plugin out of the (mutable) store repository. Every check runs against the manifest of this copy, so a
   * store pull between validation and installation cannot swap in different files.
   */
  private async stage(urn: AppUrn) {
    try {
      return await this.marketplace.stagePlugin(urn);
    } catch (error) {
      this.logger.error(`Failed to stage plugin ${urn}:`, error);
      throw new TranslatableError('PLUGIN_ERROR_INSTALL_FAILED', { id: urn }, HttpStatus.INTERNAL_SERVER_ERROR, { cause: error });
    }
  }

  /**
   * Validate a staged copy, swap it in as the installed copy and persist the result. If anything fails the staged copy
   * is discarded and the previously installed files are restored, so the files always match the recorded version.
   */
  private async installStaged<T>(
    urn: AppUrn,
    validate: (manifest: PluginManifest | null) => PluginManifest,
    persist: (manifest: PluginManifest) => Promise<T>,
  ) {
    const { stagingDir, manifest: stagedManifest } = await this.stage(urn);

    try {
      const manifest = validate(stagedManifest);

      let promotion: Awaited<ReturnType<MarketplaceService['promoteStagedPlugin']>>;
      try {
        promotion = await this.marketplace.promoteStagedPlugin(urn, stagingDir);
      } catch (error) {
        this.logger.error(`Failed to install the files of plugin ${urn}:`, error);
        throw new TranslatableError('PLUGIN_ERROR_INSTALL_FAILED', { id: urn }, HttpStatus.INTERNAL_SERVER_ERROR, { cause: error });
      }

      try {
        const result = await persist(manifest);
        await promotion.commit();
        return result;
      } catch (error) {
        await promotion.rollback();
        throw error;
      }
    } finally {
      // No-op once the staged copy has been promoted.
      await this.marketplace.discardStagedPlugin(urn, stagingDir);
    }
  }

  private assertInstallable(urn: AppUrn, manifest: PluginManifest | null) {
    if (!manifest || !manifest.available || manifest.deprecated) {
      throw new TranslatableError('PLUGIN_ERROR_NOT_AVAILABLE', { id: urn }, HttpStatus.BAD_REQUEST);
    }

    return manifest;
  }

  public async installPlugin(urn: AppUrn, globalConfig: PluginConfig = {}) {
    return this.withLock(urn, async () => {
      if (await this.repository.getPluginByUrn(urn)) {
        throw new TranslatableError('PLUGIN_ERROR_ALREADY_INSTALLED', { id: urn }, HttpStatus.CONFLICT);
      }

      // Only plugins listed in the catalog (enabled store, available, not deprecated) can be installed.
      const available = await this.marketplace.getAvailablePlugins();

      if (!available.some((plugin) => plugin.urn === urn)) {
        const exists = await this.getStoreManifest(urn);
        throw exists
          ? new TranslatableError('PLUGIN_ERROR_NOT_AVAILABLE', { id: urn }, HttpStatus.BAD_REQUEST)
          : new TranslatableError('PLUGIN_ERROR_NOT_FOUND', { id: urn }, HttpStatus.NOT_FOUND);
      }

      const { appName: pluginId, appStoreId } = extractAppUrn(urn);
      let config: PluginConfig = {};

      return this.installStaged(
        urn,
        (staged) => {
          const manifest = this.assertInstallable(urn, staged);
          this.assertCompatible(urn, manifest);
          config = this.validateGlobalConfig(urn, manifest, globalConfig);
          return manifest;
        },
        async (manifest) => {
          const row = await this.repository.createPlugin({
            urn,
            pluginId,
            pluginStoreSlug: appStoreId,
            installedVersion: manifest.version,
            tipiVersion: manifest.tipi_version,
            enabled: true,
            globalConfig: config,
          });

          this.logger.info(`Plugin ${urn} installed (version ${manifest.version})`);
          return row;
        },
      );
    });
  }

  /**
   * Update an installed plugin to the version in its store.
   * @param overrides - setting values to apply with the update, for example a setting the new version requires.
   */
  public async updatePlugin(urn: AppUrn, overrides: PluginConfig = {}) {
    return this.withLock(urn, async () => {
      const installed = await this.getInstalledOrThrow(urn);
      const current = await this.getStoreManifest(urn);

      if (!current) {
        throw new TranslatableError('PLUGIN_ERROR_NOT_FOUND', { id: urn }, HttpStatus.NOT_FOUND);
      }

      let config: PluginConfig = {};

      return this.installStaged(
        urn,
        (staged) => {
          if (!staged || !staged.available) {
            throw new TranslatableError('PLUGIN_ERROR_NOT_AVAILABLE', { id: urn }, HttpStatus.BAD_REQUEST);
          }

          if (staged.tipi_version <= installed.tipiVersion) {
            throw new TranslatableError('PLUGIN_ERROR_NO_UPDATE_AVAILABLE', { id: urn }, HttpStatus.BAD_REQUEST);
          }

          this.assertCompatible(urn, staged);

          // Settings removed by the new version are dropped, overrides are applied on top, and the result is checked
          // against the target version (unknown overrides are rejected, new defaults are filled in).
          const declared = new Set(staged.settings.global.map((field) => field.env_variable));
          const carried = Object.fromEntries(Object.entries(installed.globalConfig).filter(([key]) => declared.has(key)));
          config = this.validateGlobalConfig(urn, staged, { ...carried, ...overrides });

          return staged;
        },
        async (manifest) => {
          const row = await this.repository.updatePlugin(urn, {
            installedVersion: manifest.version,
            tipiVersion: manifest.tipi_version,
            globalConfig: config,
          });

          this.logger.info(`Plugin ${urn} updated to version ${manifest.version}`);
          return row;
        },
      );
    });
  }

  public async removePlugin(urn: AppUrn) {
    return this.withLock(urn, async () => {
      await this.getInstalledOrThrow(urn);
      await this.repository.deletePlugin(urn);

      try {
        await this.marketplace.removeInstalledPlugin(urn);
      } catch (error) {
        this.logger.warn(`Plugin ${urn} removed, but its installed files could not be deleted`, error);
      }

      this.logger.info(`Plugin ${urn} removed`);
    });
  }

  public async setPluginEnabled(urn: AppUrn, enabled: boolean) {
    return this.withLock(urn, async () => {
      await this.getInstalledOrThrow(urn);
      return this.repository.updatePlugin(urn, { enabled });
    });
  }

  public async updateGlobalConfig(urn: AppUrn, input: PluginConfig) {
    return this.withLock(urn, async () => {
      const installed = await this.getInstalledOrThrow(urn);
      const manifest = (await this.marketplace.getInstalledPluginInfo(urn).catch(() => null)) ?? (await this.getStoreManifest(urn));

      if (!manifest) {
        throw new TranslatableError('PLUGIN_ERROR_NOT_FOUND', { id: urn }, HttpStatus.NOT_FOUND);
      }

      const config = this.validateGlobalConfig(urn, manifest, { ...installed.globalConfig, ...input });
      return this.repository.updatePlugin(urn, { globalConfig: config });
    });
  }

  /**
   * Installed and enabled plugins that add a section to the settings of apps.
   * Disabled and uninstalled plugins are left out: their section is hidden and their patches stop applying.
   */
  private async getAppSectionPlugins(): Promise<AppSectionPlugin[]> {
    const rows = (await this.repository.getPlugins()).filter((row) => row.enabled);

    const plugins = await Promise.all(
      rows.map(async (row) => {
        const manifest = await this.marketplace.getInstalledPluginInfo(row.urn as AppUrn).catch(() => null);
        if (!manifest?.app_settings || !manifest.capabilities.includes('compose')) return null;
        return { row, manifest } as AppSectionPlugin;
      }),
    );

    return plugins.filter((plugin) => plugin !== null);
  }

  /**
   * The plugin sections to show in the settings of an app, with the services each one applies to.
   * @param compose - the source Compose file of the app, used for the applicability filter
   */
  public async getAppPluginSections(compose: Pick<DynamicComposeSchemaYaml, 'services'> | null) {
    if (!compose) return [];

    const plugins = await this.getAppSectionPlugins();

    return plugins
      .map(({ row, manifest }) => ({
        urn: row.urn,
        name: manifest.name,
        title: manifest.app_settings.title ?? manifest.name,
        description: manifest.app_settings.description,
        fields: manifest.settings.per_app,
        applicableServices: getApplicableServices(compose, manifest.app_settings.applies_to),
      }))
      .filter((section) => section.fields.length > 0 && section.applicableServices.length > 0);
  }

  /**
   * Validate the per-app plugin settings submitted with an app form.
   *
   * Values of installed plugins are checked against the fields they declare. Values of plugins that are not installed
   * (or disabled) are not editable: what is stored is kept, so reinstalling a plugin brings its settings back, and
   * anything else submitted for them is ignored.
   *
   * @returns the value to store in `app.config.plugins`, or `undefined` when there is nothing to store
   */
  public async resolveAppPluginConfig(input: unknown, stored: unknown): Promise<AppPluginsConfig | undefined> {
    const submitted = parseAppPluginsConfig(input);

    if (!submitted) {
      throw new TranslatableError('SYSTEM_ERROR_INVALID_BODY', undefined, HttpStatus.BAD_REQUEST);
    }

    const previous = parseAppPluginsConfig(stored) ?? {};
    const plugins = new Map((await this.getAppSectionPlugins()).map((plugin) => [plugin.row.urn, plugin]));
    const result: AppPluginsConfig = {};

    for (const [urn, values] of Object.entries(previous)) {
      if (!plugins.has(urn)) result[urn] = values;
    }

    for (const [urn, values] of Object.entries(submitted)) {
      const plugin = plugins.get(urn);

      if (!plugin) {
        this.logger.debug(`Ignoring settings for plugin ${urn}, it is not installed or not enabled`);
        continue;
      }

      const validated = validateAppPluginConfig(plugin.manifest.settings.per_app, values);

      if (!validated.success) {
        throw new TranslatableError('PLUGIN_ERROR_INVALID_CONFIG', { id: urn, reason: validated.reason }, HttpStatus.BAD_REQUEST);
      }

      result[urn] = validated.config;
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * The plugins whose Compose patches apply to an app, given its stored config.
   */
  public async getComposePlugins(appConfig: Record<string, unknown> | null | undefined): Promise<ComposePlugin[]> {
    const stored = parseAppPluginsConfig(appConfig?.plugins);
    if (!stored || Object.keys(stored).length === 0) return [];

    const plugins = await this.getAppSectionPlugins();

    return plugins.flatMap(({ row, manifest }) => {
      const config = stored[row.urn];
      if (!config) return [];

      return [{ urn: row.urn, appSettings: manifest.app_settings, globalConfig: row.globalConfig, appConfig: config }];
    });
  }
}
