import fs from 'node:fs';
import path from 'node:path';
import type { ConfigurationService } from '@/core/config/configuration.service';
import type { AppStore } from '@/core/database/drizzle/types';
import { FilesystemService } from '@/core/filesystem/filesystem.service';
import type { LoggerService } from '@/core/logger/logger.service';
import { commitStoreRepo } from '@/tests/utils/create-plugin-in-store';
import type { AppUrn } from '@runtipi/common/types';
import { fromPartial } from '@total-typescript/shoehorn';
import { expect, onTestFinished, test, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { AppStoreFilesManager } from '../app-store-files-manager';

vi.unmock('fs');
vi.unmock('node:fs');

const urn = 'demo:store' as AppUrn;

const manifest = (version: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'demo',
    name: 'Demo',
    version,
    tipi_version: Number(version[0]),
    short_desc: '',
    author: '',
    source: '',
    capabilities: ['compose'],
    ...extra,
  });

const setup = async () => {
  const dataDir = await fs.promises.mkdtemp('/tmp/runtipi-plugin-');
  onTestFinished(() => fs.promises.rm(dataDir, { recursive: true, force: true }));

  const configuration = mock<ConfigurationService>();
  configuration.getConfig.mockReturnValue(fromPartial({ directories: { dataDir, appDataDir: path.join(dataDir, 'app-data'), appDir: dataDir } }));
  const logger = mock<LoggerService>();
  const filesystem = new FilesystemService(logger);
  const manager = new AppStoreFilesManager(configuration, filesystem, logger, fromPartial<AppStore>({ slug: 'store' }));
  const repoDir = path.join(dataDir, 'repos', 'store');
  const { pluginRepoDir, pluginInstalledDir } = manager.getPluginPaths(urn);
  await fs.promises.mkdir(pluginRepoDir, { recursive: true });

  return { dataDir, manager, filesystem, repoDir, pluginRepoDir, pluginInstalledDir };
};

test('staged and installed plugin copies skip symlinks', async () => {
  const { dataDir, manager, repoDir, pluginRepoDir, pluginInstalledDir } = await setup();

  await fs.promises.mkdir(path.join(pluginRepoDir, 'assets'));
  await fs.promises.writeFile(path.join(pluginRepoDir, 'plugin.json'), manifest('1.0.0'));
  await fs.promises.writeFile(path.join(pluginRepoDir, 'assets', 'icon.svg'), '<svg/>');
  await fs.promises.writeFile(path.join(dataDir, 'secret'), 'secret');
  await fs.promises.symlink(path.join(dataDir, 'secret'), path.join(pluginRepoDir, 'assets', 'leak'));
  await commitStoreRepo(repoDir);

  const { stagingDir } = await manager.stagePlugin(urn);
  await (await manager.promoteStagedPlugin(urn, stagingDir)).commit();

  expect(await fs.promises.readFile(path.join(pluginInstalledDir, 'assets', 'icon.svg'), 'utf8')).toBe('<svg/>');
  expect(fs.existsSync(path.join(pluginInstalledDir, 'plugin.json'))).toBe(true);
  await expect(fs.promises.lstat(path.join(pluginInstalledDir, 'assets', 'leak'))).rejects.toThrow();
});

test('a store pull in the middle of staging cannot mix the files of two versions', async () => {
  const { manager, filesystem, repoDir, pluginRepoDir, pluginInstalledDir } = await setup();

  // `release.yml` sorts after `plugin.json`, so it is copied after the manifest.
  await fs.promises.writeFile(path.join(pluginRepoDir, 'plugin.json'), manifest('1.0.0'));
  await fs.promises.writeFile(path.join(pluginRepoDir, 'release.yml'), 'release: v1');
  await commitStoreRepo(repoDir, 'v1');

  const write = filesystem.writeBinaryFile.bind(filesystem);
  let pulled = false;
  vi.spyOn(filesystem, 'writeBinaryFile').mockImplementation(async (target, data) => {
    const result = await write(target, data);
    if (!pulled && target.endsWith('plugin.json')) {
      pulled = true;
      // Simulate `pullRepo`: the branch moves to v2 and the working tree is checked out, after the v1 manifest
      // was copied and before the payload is.
      await fs.promises.writeFile(path.join(pluginRepoDir, 'plugin.json'), manifest('2.0.0', { min_tipi_version: '9.0.0' }));
      await fs.promises.writeFile(path.join(pluginRepoDir, 'release.yml'), 'release: v2 (requires 9.0)');
      await commitStoreRepo(repoDir, 'v2');
    }
    return result;
  });

  const { stagingDir, manifest: staged } = await manager.stagePlugin(urn);
  await (await manager.promoteStagedPlugin(urn, stagingDir)).commit();

  expect(pulled).toBe(true);
  expect(staged).toMatchObject({ version: '1.0.0' });
  expect(staged?.min_tipi_version).toBeUndefined();
  expect(await fs.promises.readFile(path.join(pluginInstalledDir, 'release.yml'), 'utf8')).toBe('release: v1');

  // The next staging picks up v2 as a whole.
  vi.restoreAllMocks();
  const next = await manager.stagePlugin(urn);
  expect(next.manifest).toMatchObject({ version: '2.0.0', min_tipi_version: '9.0.0' });
  expect(await fs.promises.readFile(path.join(next.stagingDir, 'release.yml'), 'utf8')).toBe('release: v2 (requires 9.0)');
  await manager.discardStagedPlugin(next.stagingDir);
});

test('staging fails cleanly when the repository is not a Git clone', async () => {
  const { manager, pluginRepoDir, dataDir } = await setup();
  await fs.promises.writeFile(path.join(pluginRepoDir, 'plugin.json'), manifest('1.0.0'));

  await expect(manager.stagePlugin(urn)).rejects.toThrow('not found');
  expect(fs.existsSync(path.join(dataDir, 'plugins', '.staging')) ? fs.readdirSync(path.join(dataDir, 'plugins', '.staging')) : []).toEqual([]);
});
