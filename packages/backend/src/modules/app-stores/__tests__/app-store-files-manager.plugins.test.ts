import fs from 'node:fs';
import path from 'node:path';
import { APP_DATA_DIR, APP_DIR, DATA_DIR } from '@/common/constants';
import type { ConfigurationService } from '@/core/config/configuration.service';
import { FilesystemService } from '@/core/filesystem/filesystem.service';
import type { LoggerService } from '@/core/logger/logger.service';
import { createMockAppStore } from '@/tests/helpers/app-mocks';
import { createPluginInStore } from '@/tests/utils/create-plugin-in-store';
import type { AppUrn } from '@runtipi/common/types';
import { fromPartial } from '@total-typescript/shoehorn';
import { beforeEach, describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { AppStoreFilesManager } from '../app-store-files-manager';

describe('AppStoreFilesManager plugins', () => {
  let manager: AppStoreFilesManager;
  let logger: ReturnType<typeof mock<LoggerService>>;

  beforeEach(() => {
    logger = mock<LoggerService>();
    const configuration = mock<ConfigurationService>();
    configuration.getConfig.mockReturnValue(fromPartial({ directories: { dataDir: DATA_DIR, appDataDir: APP_DATA_DIR, appDir: APP_DIR } }));
    manager = new AppStoreFilesManager(configuration, new FilesystemService(logger), logger, createMockAppStore({ slug: 'store' }));
  });

  it('returns no plugins and logs nothing when the store has no plugins folder', async () => {
    await fs.promises.mkdir(path.join(DATA_DIR, 'repos', 'store', 'apps'), { recursive: true });

    expect(await manager.getAvailablePluginUrns()).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('lists plugin folders and parses their manifest', async () => {
    await createPluginInStore('store', { id: 'backup-s3', capabilities: ['backup-backend'] });
    await fs.promises.writeFile(path.join(DATA_DIR, 'repos', 'store', 'plugins', 'README.md'), 'not a plugin');

    expect(await manager.getAvailablePluginUrns()).toEqual(['backup-s3:store']);
    expect(await manager.getPluginInfoFromStore('backup-s3:store' as AppUrn)).toMatchObject({
      id: 'backup-s3',
      urn: 'backup-s3:store',
      capabilities: ['backup-backend'],
      settings: { global: [], per_app: [] },
    });
  });

  it.each([
    ['an invalid schema', { id: 'broken', capabilities: ['run-code'] } as never, undefined],
    ['invalid JSON', { id: 'broken' }, '{ not json'],
    [
      'an id that does not match its folder',
      { id: 'broken' },
      JSON.stringify({ id: 'other', name: 'x', version: '1', tipi_version: 1, short_desc: '', author: '', source: '', capabilities: ['compose'] }),
    ],
  ])('logs and skips a manifest with %s', async (_, manifest, raw) => {
    await createPluginInStore('store', manifest, raw);

    expect(await manager.getPluginInfoFromStore('broken:store' as AppUrn)).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('returns null for a plugin folder without a manifest', async () => {
    await fs.promises.mkdir(path.join(DATA_DIR, 'repos', 'store', 'plugins', 'empty'), { recursive: true });

    expect(await manager.getPluginInfoFromStore('empty:store' as AppUrn)).toBeNull();
  });

  it('stages a copy, promotes it and removes it', async () => {
    await createPluginInStore('store', { id: 'demo' });
    const urn = 'demo:store' as AppUrn;

    const { stagingDir, manifest } = await manager.stagePlugin(urn);
    expect(manifest).toMatchObject({ id: 'demo', version: '1.0.0' });
    expect(stagingDir.startsWith(path.join(DATA_DIR, 'plugins', '.staging'))).toBe(true);

    const promotion = await manager.promoteStagedPlugin(urn, stagingDir);
    await promotion.commit();

    expect(manager.getPluginPaths(urn).pluginInstalledDir).toBe(path.join(DATA_DIR, 'plugins', 'store', 'demo'));
    expect(await manager.getInstalledPluginInfo(urn)).toMatchObject({ id: 'demo', version: '1.0.0' });
    expect(fs.existsSync(stagingDir)).toBe(false);
    expect(fs.existsSync(`${stagingDir}.previous`)).toBe(false);

    await manager.removeInstalledPlugin(urn);

    expect(fs.existsSync(path.join(DATA_DIR, 'plugins', 'store', 'demo'))).toBe(false);
  });

  it('reads the staged manifest, not a later repository change', async () => {
    await createPluginInStore('store', { id: 'demo', version: '1.0.0' });
    const urn = 'demo:store' as AppUrn;

    const { stagingDir, manifest } = await manager.stagePlugin(urn);
    await createPluginInStore('store', { id: 'demo', version: '2.0.0', tipi_version: 2 });
    await (await manager.promoteStagedPlugin(urn, stagingDir)).commit();

    expect(manifest?.version).toBe('1.0.0');
    expect((await manager.getInstalledPluginInfo(urn))?.version).toBe('1.0.0');
  });

  it('restores the previous installed copy on rollback', async () => {
    const urn = 'demo:store' as AppUrn;
    await createPluginInStore('store', { id: 'demo', version: '1.0.0' });
    await (await manager.promoteStagedPlugin(urn, (await manager.stagePlugin(urn)).stagingDir)).commit();

    await createPluginInStore('store', { id: 'demo', version: '2.0.0', tipi_version: 2 });
    const promotion = await manager.promoteStagedPlugin(urn, (await manager.stagePlugin(urn)).stagingDir);
    expect((await manager.getInstalledPluginInfo(urn))?.version).toBe('2.0.0');

    await promotion.rollback();

    expect((await manager.getInstalledPluginInfo(urn))?.version).toBe('1.0.0');
  });

  it('refuses to stage a plugin that is not in the repository', async () => {
    await expect(manager.stagePlugin('missing:store' as AppUrn)).rejects.toThrow('not found');
  });
});
