import fs from 'node:fs';
import path from 'node:path';
import type { ConfigurationService } from '@/core/config/configuration.service';
import type { AppStore } from '@/core/database/drizzle/types';
import { FilesystemService } from '@/core/filesystem/filesystem.service';
import type { LoggerService } from '@/core/logger/logger.service';
import type { AppUrn } from '@runtipi/common/types';
import { fromPartial } from '@total-typescript/shoehorn';
import { expect, onTestFinished, test, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { AppStoreFilesManager } from '../app-store-files-manager';

vi.unmock('fs');
vi.unmock('node:fs');

test('installed plugin copies skip symlinks', async () => {
  const dataDir = await fs.promises.mkdtemp('/tmp/runtipi-plugin-');
  onTestFinished(() => fs.promises.rm(dataDir, { recursive: true, force: true }));

  const configuration = mock<ConfigurationService>();
  configuration.getConfig.mockReturnValue(fromPartial({ directories: { dataDir, appDataDir: path.join(dataDir, 'app-data'), appDir: dataDir } }));
  const logger = mock<LoggerService>();
  const manager = new AppStoreFilesManager(configuration, new FilesystemService(logger), logger, fromPartial<AppStore>({ slug: 'store' }));
  const urn = 'demo:store' as AppUrn;
  const { pluginRepoDir, pluginInstalledDir } = manager.getPluginPaths(urn);

  await fs.promises.mkdir(path.join(pluginRepoDir, 'assets'), { recursive: true });
  await fs.promises.writeFile(path.join(pluginRepoDir, 'plugin.json'), '{}');
  await fs.promises.writeFile(path.join(pluginRepoDir, 'assets', 'icon.svg'), '<svg/>');
  await fs.promises.writeFile(path.join(dataDir, 'secret'), 'secret');
  await fs.promises.symlink(path.join(dataDir, 'secret'), path.join(pluginRepoDir, 'assets', 'leak'));

  await manager.copyPluginFromRepoToInstalled(urn);

  expect(await fs.promises.readFile(path.join(pluginInstalledDir, 'assets', 'icon.svg'), 'utf8')).toBe('<svg/>');
  expect(fs.existsSync(path.join(pluginInstalledDir, 'plugin.json'))).toBe(true);
  await expect(fs.promises.lstat(path.join(pluginInstalledDir, 'assets', 'leak'))).rejects.toThrow();
});
