import fs from 'node:fs';
import path from 'node:path';
import { APP_DATA_DIR, APP_DIR, DATA_DIR } from '@/common/constants';
import type { ConfigurationService } from '@/core/config/configuration.service';
import type { AppStore, NewPlugin, Plugin } from '@/core/database/drizzle/types';
import { FilesystemService } from '@/core/filesystem/filesystem.service';
import type { LoggerService } from '@/core/logger/logger.service';
import type { AppStoreService } from '@/modules/app-stores/app-store.service';
import { MarketplaceService } from '@/modules/marketplace/marketplace.service';
import { createMockAppStore } from '@/tests/helpers/app-mocks';
import { createPluginInStore } from '@/tests/utils/create-plugin-in-store';
import { AsyncMutex } from '@/utils/mutex/async-mutex';
import type { AppUrn } from '@runtipi/common/types';
import { fromPartial } from '@total-typescript/shoehorn';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { PluginsRepository } from '../plugins.repository';
import { PluginsService } from '../plugins.service';

class InMemoryPluginsRepository {
  rows = new Map<string, Plugin>();
  private nextId = 1;

  async getPlugins() {
    return [...this.rows.values()].sort((a, b) => a.urn.localeCompare(b.urn));
  }

  async getPluginByUrn(urn: string) {
    return this.rows.get(urn);
  }

  async createPlugin(data: NewPlugin) {
    const now = Math.floor(Date.now() / 1000);
    const row: Plugin = { id: this.nextId++, enabled: true, globalConfig: {}, createdAt: now, updatedAt: now, ...data };
    this.rows.set(row.urn, row);
    return row;
  }

  async updatePlugin(urn: string, data: Partial<Plugin>) {
    const row = this.rows.get(urn);
    if (!row) return undefined;
    const updated = { ...row, ...data };
    this.rows.set(urn, updated);
    return updated;
  }

  async deletePlugin(urn: string) {
    this.rows.delete(urn);
  }
}

const URN = 'demo:store' as AppUrn;

const setup = async (options: { version?: string; stores?: AppStore[] } = {}) => {
  const config = mock<ConfigurationService>();
  config.getConfig.mockReturnValue(
    fromPartial({ architecture: 'amd64', directories: { dataDir: DATA_DIR, appDataDir: APP_DATA_DIR, appDir: APP_DIR } }),
  );
  config.get.mockImplementation(((key: string) => (key === 'version' ? (options.version ?? '4.1.0') : undefined)) as never);
  const logger = mock<LoggerService>();
  const appStores = mock<AppStoreService>();
  appStores.getAllAppStores.mockResolvedValue(options.stores ?? [createMockAppStore({ slug: 'store', enabled: true })]);

  const marketplace = new MarketplaceService(config, new FilesystemService(logger), logger, appStores);
  await marketplace.initialize();

  const repository = new InMemoryPluginsRepository();
  const service = new PluginsService(repository as unknown as PluginsRepository, marketplace, config, logger, new AsyncMutex());

  return { service, repository, marketplace, logger };
};

const installedDir = path.join(DATA_DIR, 'plugins', 'store', 'demo');

const settings = {
  global: [
    { type: 'text' as const, label: 'Endpoint', env_variable: 'ENDPOINT', required: true },
    { type: 'number' as const, label: 'Retention', env_variable: 'RETENTION', default: 7, min: 1, max: 30 },
  ],
  per_app: [],
};

describe('PluginsService', () => {
  beforeEach(async () => {
    await createPluginInStore('store', { id: 'demo', settings });
  });

  describe('catalog', () => {
    it('lists valid plugins, skips invalid manifests and flags installed ones', async () => {
      await createPluginInStore('store', { id: 'widget', name: 'Weather widget', capabilities: ['dashboard-widget'] });
      await createPluginInStore('store', { id: 'broken' }, '{"id":"broken"}');
      const { service, logger } = await setup();

      const all = await service.searchCatalog({});
      expect(all.data.map((plugin) => plugin.urn)).toEqual(['demo:store', 'widget:store']);
      expect(logger.error).toHaveBeenCalled();

      await service.installPlugin(URN, { ENDPOINT: 'https://s3.example.com' });

      const byCapability = await service.searchCatalog({ capability: 'dashboard-widget' });
      expect(byCapability.data).toMatchObject([{ urn: 'widget:store', installed: false }]);
      expect((await service.searchCatalog({ search: 'Plugin demo' })).data[0]).toMatchObject({ urn: URN, installed: true });
    });

    it('hides plugins of disabled stores and deprecated plugins', async () => {
      await createPluginInStore('other', { id: 'hidden' });
      await createPluginInStore('store', { id: 'old', deprecated: true });
      const { service } = await setup({ stores: [createMockAppStore({ slug: 'store' }), createMockAppStore({ slug: 'other', enabled: false })] });

      expect((await service.searchCatalog({})).data.map((plugin) => plugin.urn)).toEqual(['demo:store']);
    });

    it('lists incompatible plugins with the reason they cannot be installed', async () => {
      await createPluginInStore('store', { id: 'future', min_tipi_version: '9.0.0' });
      const { service } = await setup({ version: '4.1.0' });

      const FUTURE = 'future:store' as AppUrn;
      const { data } = await service.searchCatalog({});
      expect(data.find((plugin) => plugin.urn === FUTURE)?.compatibility).toEqual({
        compatible: false,
        minTipiVersion: '9.0.0',
        reason: 'min_tipi_version',
      });
      expect(data.find((plugin) => plugin.urn === URN)?.compatibility).toEqual({ compatible: true, minTipiVersion: null, reason: null });
      expect((await service.getCatalogPlugin(FUTURE)).compatibility).toMatchObject({ compatible: false, reason: 'min_tipi_version' });
    });

    it('reports deprecated and unavailable manifests as incompatible', async () => {
      const { service } = await setup();
      const base = (await service.getCatalogPlugin(URN)).info;

      expect(service.getCompatibility({ ...base, deprecated: true }).reason).toBe('deprecated');
      expect(service.getCompatibility({ ...base, available: false }).reason).toBe('unavailable');
    });

    it('returns details of a catalog plugin and 404s for an unknown one', async () => {
      const { service } = await setup();

      expect(await service.getCatalogPlugin(URN)).toMatchObject({ info: { id: 'demo' }, installed: null, updateAvailable: false });
      await expect(service.getCatalogPlugin('nope:store' as AppUrn)).rejects.toMatchObject({ response: { message: 'PLUGIN_ERROR_NOT_FOUND' } });
      await expect(service.getCatalogPlugin('nope:unknown-store' as AppUrn)).rejects.toMatchObject({
        response: { message: 'PLUGIN_ERROR_NOT_FOUND' },
      });
    });
  });

  describe('install', () => {
    it('persists state, copies files and applies setting defaults', async () => {
      const { service, repository } = await setup();

      await service.installPlugin(URN, { ENDPOINT: 'https://s3.example.com' });

      expect(repository.rows.get(URN)).toMatchObject({
        pluginId: 'demo',
        pluginStoreSlug: 'store',
        installedVersion: '1.0.0',
        tipiVersion: 1,
        enabled: true,
        globalConfig: { ENDPOINT: 'https://s3.example.com', RETENTION: 7 },
      });
      expect(fs.existsSync(path.join(installedDir, 'plugin.json'))).toBe(true);
      expect(await service.getInstalledPlugins()).toMatchObject([{ urn: URN, info: { id: 'demo' }, updateAvailable: false }]);
    });

    it('rejects a plugin whose min_tipi_version is higher than the running version', async () => {
      await createPluginInStore('store', { id: 'demo', min_tipi_version: '9.0.0', settings });
      const { service, repository } = await setup({ version: '4.1.0' });

      await expect(service.installPlugin(URN, { ENDPOINT: 'x' })).rejects.toMatchObject({
        response: { message: 'PLUGIN_ERROR_MIN_TIPI_VERSION', intlParams: { minVersion: '9.0.0' } },
      });
      expect(repository.rows.size).toBe(0);
      expect(fs.existsSync(installedDir)).toBe(false);
    });

    it('validates the copied files, not a catalog entry the repository replaced in the meantime', async () => {
      const { service, repository, marketplace } = await setup({ version: '4.1.0' });
      const stage = marketplace.stagePlugin.bind(marketplace);
      vi.spyOn(marketplace, 'stagePlugin').mockImplementationOnce(async (urn) => {
        // A store pull lands between the catalog lookup and the copy.
        await createPluginInStore('store', { id: 'demo', version: '2.0.0', tipi_version: 2, min_tipi_version: '9.0.0', settings });
        return stage(urn);
      });

      await expect(service.installPlugin(URN, { ENDPOINT: 'x' })).rejects.toMatchObject({ response: { message: 'PLUGIN_ERROR_MIN_TIPI_VERSION' } });
      expect(repository.rows.size).toBe(0);
      expect(fs.existsSync(installedDir)).toBe(false);
    });

    it('records the version of the files it copied', async () => {
      const { service, repository, marketplace } = await setup();
      const stage = marketplace.stagePlugin.bind(marketplace);
      vi.spyOn(marketplace, 'stagePlugin').mockImplementationOnce(async (urn) => {
        await createPluginInStore('store', { id: 'demo', version: '2.0.0', tipi_version: 2, settings });
        return stage(urn);
      });

      await service.installPlugin(URN, { ENDPOINT: 'x' });

      expect(repository.rows.get(URN)).toMatchObject({ installedVersion: '2.0.0', tipiVersion: 2 });
      expect((await service.getInstalledPlugin(URN)).info).toMatchObject({ version: '2.0.0' });
    });

    it('allows a compatible min_tipi_version', async () => {
      await createPluginInStore('store', { id: 'demo', min_tipi_version: '4.0.0', settings });
      const { service, repository } = await setup({ version: '4.1.0' });

      await service.installPlugin(URN, { ENDPOINT: 'x' });

      expect(repository.rows.has(URN)).toBe(true);
    });

    it.each([
      ['a missing required setting', {}],
      ['an out of range number', { ENDPOINT: 'x', RETENTION: 99 }],
      ['a wrongly typed value', { ENDPOINT: 'x', RETENTION: 'seven' }],
      ['an unknown setting', { ENDPOINT: 'x', OTHER: 'y' }],
    ])('rejects %s', async (_, globalConfig) => {
      const { service, repository } = await setup();

      await expect(service.installPlugin(URN, globalConfig)).rejects.toMatchObject({ response: { message: 'PLUGIN_ERROR_INVALID_CONFIG' } });
      expect(repository.rows.size).toBe(0);
    });

    it('rejects installing twice', async () => {
      const { service } = await setup();
      await service.installPlugin(URN, { ENDPOINT: 'x' });

      await expect(service.installPlugin(URN, { ENDPOINT: 'x' })).rejects.toMatchObject({ response: { message: 'PLUGIN_ERROR_ALREADY_INSTALLED' } });
    });

    it('serializes concurrent installs of the same plugin', async () => {
      const { service, repository } = await setup();

      const results = await Promise.allSettled([service.installPlugin(URN, { ENDPOINT: 'x' }), service.installPlugin(URN, { ENDPOINT: 'x' })]);

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(repository.rows.size).toBe(1);
    });

    it('rejects unknown and deprecated plugins', async () => {
      await createPluginInStore('store', { id: 'old', deprecated: true });
      const { service } = await setup();

      await expect(service.installPlugin('missing:store' as AppUrn)).rejects.toMatchObject({ response: { message: 'PLUGIN_ERROR_NOT_FOUND' } });
      await expect(service.installPlugin('old:store' as AppUrn)).rejects.toMatchObject({ response: { message: 'PLUGIN_ERROR_NOT_AVAILABLE' } });
    });
  });

  describe('update', () => {
    it('updates to a newer tipi_version, keeping config and filling new defaults', async () => {
      const { service, repository, marketplace } = await setup();
      await service.installPlugin(URN, { ENDPOINT: 'https://s3.example.com', RETENTION: 14 });

      await expect(service.updatePlugin(URN)).rejects.toMatchObject({ response: { message: 'PLUGIN_ERROR_NO_UPDATE_AVAILABLE' } });

      await createPluginInStore('store', {
        id: 'demo',
        version: '2.0.0',
        tipi_version: 2,
        settings: { global: [settings.global[0]!, { type: 'boolean', label: 'Compress', env_variable: 'COMPRESS', default: true }], per_app: [] },
      });
      await marketplace.pullAppStores();

      expect(await service.getInstalledPlugin(URN)).toMatchObject({ updateAvailable: true, latestVersion: '2.0.0', latestTipiVersion: 2 });

      await service.updatePlugin(URN);

      expect(repository.rows.get(URN)).toMatchObject({
        installedVersion: '2.0.0',
        tipiVersion: 2,
        globalConfig: { ENDPOINT: 'https://s3.example.com', COMPRESS: true },
      });
      expect((await service.getInstalledPlugin(URN)).info).toMatchObject({ version: '2.0.0' });
    });

    it('rejects an update that needs a newer Runtipi', async () => {
      const { service, repository } = await setup({ version: '4.1.0' });
      await service.installPlugin(URN, { ENDPOINT: 'x' });
      await createPluginInStore('store', { id: 'demo', version: '2.0.0', tipi_version: 2, min_tipi_version: '5.0.0', settings });

      await expect(service.updatePlugin(URN)).rejects.toMatchObject({ response: { message: 'PLUGIN_ERROR_MIN_TIPI_VERSION' } });
      expect(repository.rows.get(URN)).toMatchObject({ tipiVersion: 1 });
    });

    it('rejects an update that adds a required setting without a value', async () => {
      const { service } = await setup();
      await service.installPlugin(URN, { ENDPOINT: 'x' });
      await createPluginInStore('store', {
        id: 'demo',
        tipi_version: 2,
        settings: { global: [...settings.global, { type: 'text', label: 'Bucket', env_variable: 'BUCKET', required: true }], per_app: [] },
      });

      await expect(service.updatePlugin(URN)).rejects.toMatchObject({ response: { message: 'PLUGIN_ERROR_INVALID_CONFIG' } });
    });

    it('accepts values for settings a new version requires', async () => {
      const { service, repository } = await setup();
      await service.installPlugin(URN, { ENDPOINT: 'x' });
      await createPluginInStore('store', {
        id: 'demo',
        version: '2.0.0',
        tipi_version: 2,
        settings: { global: [...settings.global, { type: 'text', label: 'Bucket', env_variable: 'BUCKET', required: true }], per_app: [] },
      });

      await expect(service.updatePlugin(URN, { BUCKET: 'backups', OTHER: 'x' })).rejects.toMatchObject({
        response: { message: 'PLUGIN_ERROR_INVALID_CONFIG' },
      });

      await service.updatePlugin(URN, { BUCKET: 'backups' });

      expect(repository.rows.get(URN)).toMatchObject({ tipiVersion: 2, globalConfig: { ENDPOINT: 'x', RETENTION: 7, BUCKET: 'backups' } });
      expect((await service.getInstalledPlugin(URN)).info).toMatchObject({ version: '2.0.0' });
    });

    it('keeps the installed copy when copying the new version fails', async () => {
      const { service, repository } = await setup();
      await service.installPlugin(URN, { ENDPOINT: 'x' });
      await createPluginInStore('store', { id: 'demo', version: '2.0.0', tipi_version: 2, settings });
      const copy = vi.spyOn(FilesystemService.prototype, 'writeBinaryFile').mockResolvedValueOnce(false);
      onTestFinished(() => copy.mockRestore());

      await expect(service.updatePlugin(URN)).rejects.toMatchObject({ response: { message: 'PLUGIN_ERROR_INSTALL_FAILED' } });

      expect(repository.rows.get(URN)).toMatchObject({ tipiVersion: 1, installedVersion: '1.0.0' });
      expect((await service.getInstalledPlugin(URN)).info).toMatchObject({ version: '1.0.0' });
      expect(fs.readdirSync(path.join(DATA_DIR, 'plugins', '.staging'))).toEqual([]);
    });

    it('restores the installed copy when saving the update fails', async () => {
      const { service, repository } = await setup();
      await service.installPlugin(URN, { ENDPOINT: 'x' });
      await createPluginInStore('store', { id: 'demo', version: '2.0.0', tipi_version: 2, settings });
      vi.spyOn(repository, 'updatePlugin').mockRejectedValueOnce(new Error('db down'));

      await expect(service.updatePlugin(URN)).rejects.toThrow('db down');

      expect(repository.rows.get(URN)).toMatchObject({ tipiVersion: 1 });
      expect((await service.getInstalledPlugin(URN)).info).toMatchObject({ version: '1.0.0' });
      expect(fs.readdirSync(path.join(DATA_DIR, 'plugins', '.staging'))).toEqual([]);
    });

    it('rejects updating a plugin that is not installed', async () => {
      const { service } = await setup();

      await expect(service.updatePlugin(URN)).rejects.toMatchObject({ response: { message: 'PLUGIN_ERROR_NOT_INSTALLED' } });
    });
  });

  describe('remove, enable, disable and config', () => {
    it('removes the row and installed files', async () => {
      const { service, repository } = await setup();
      await service.installPlugin(URN, { ENDPOINT: 'x' });

      await service.removePlugin(URN);

      expect(repository.rows.size).toBe(0);
      expect(fs.existsSync(installedDir)).toBe(false);
      expect(await service.getInstalledPlugins()).toEqual([]);
      await expect(service.removePlugin(URN)).rejects.toMatchObject({ response: { message: 'PLUGIN_ERROR_NOT_INSTALLED' } });
    });

    it('enables and disables a plugin', async () => {
      const { service, repository } = await setup();
      await service.installPlugin(URN, { ENDPOINT: 'x' });

      await service.setPluginEnabled(URN, false);
      expect(repository.rows.get(URN)?.enabled).toBe(false);

      await service.setPluginEnabled(URN, true);
      expect(repository.rows.get(URN)?.enabled).toBe(true);
    });

    it('merges and validates a global config update', async () => {
      const { service, repository } = await setup();
      await service.installPlugin(URN, { ENDPOINT: 'x' });

      await service.updateGlobalConfig(URN, { RETENTION: 3 });
      expect(repository.rows.get(URN)?.globalConfig).toEqual({ ENDPOINT: 'x', RETENTION: 3 });

      await expect(service.updateGlobalConfig(URN, { ENDPOINT: '' })).rejects.toMatchObject({ response: { message: 'PLUGIN_ERROR_INVALID_CONFIG' } });
      expect(repository.rows.get(URN)?.globalConfig).toEqual({ ENDPOINT: 'x', RETENTION: 3 });
    });
  });
});
