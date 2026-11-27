import fs from 'node:fs';
import path from 'node:path';
import { ArchiveService } from '@/core/archive/archive.service';
import type { ConfigurationService } from '@/core/config/configuration.service';
import { FilesystemService } from '@/core/filesystem/filesystem.service';
import type { LoggerService } from '@/core/logger/logger.service';
import { AppFilesManager } from '@/modules/apps/app-files-manager';
import type { AppsRepository } from '@/modules/apps/apps.repository';
import type { DockerService } from '@/modules/docker/docker.service';
import type { AppUrn } from '@runtipi/common/types';
import { fromPartial } from '@total-typescript/shoehorn';
import { expect, onTestFinished, test, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { BackupManager } from '../backup.manager';

vi.unmock('fs');
vi.unmock('node:fs');
vi.mock('@/common/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/constants')>()),
  DATA_DIR: (await import('node:fs')).realpathSync('/tmp'),
}));

const appUrn = 'demo:store' as AppUrn;
const setup = async (backup?: unknown) => {
  const root = await fs.promises.realpath(await fs.promises.mkdtemp('/tmp/runtipi-hooks-'));
  onTestFinished(() => fs.promises.rm(root, { recursive: true, force: true }));
  const logger = mock<LoggerService>();
  const filesystem = new FilesystemService(logger);
  const archive = new ArchiveService(logger);
  const directories = { dataDir: root, appDataDir: path.join(root, 'app-data') };
  const config = fromPartial<ConfigurationService>({ get: () => directories, getConfig: () => ({ directories }) });
  const appFiles = new AppFilesManager(config, filesystem, logger);
  const { appDataDir, appInstalledDir } = appFiles.getAppPaths(appUrn);
  const userConfigDir = path.join(root, 'user-config/store/demo');
  for (const dir of [appDataDir, appInstalledDir, userConfigDir]) await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(appInstalledDir, 'config.json'), JSON.stringify({ backup }));
  await fs.promises.writeFile(path.join(userConfigDir, 'custom.env'), 'original env');
  await fs.promises.writeFile(path.join(appDataDir, 'dump.sql'), 'saved dump');
  await fs.promises.writeFile(path.join(appDataDir, 'live.db'), 'live database');
  const repository = mock<AppsRepository>();
  let journal: Awaited<ReturnType<AppsRepository['getRestoreJournal']>>;
  repository.getMigrationState.mockResolvedValue({ initialized: true, migrationIds: ['v1'] });
  repository.getRestoreJournal.mockImplementation(async () => journal);
  repository.createRestoreJournal.mockImplementation(async (_urn, previousState, targetState, directories) => {
    journal = fromPartial({ phase: 'prepared', previousState, targetState, directories });
  });
  repository.finishRestore.mockImplementation(async (_urn, _state, phase) => {
    if (journal) journal.phase = phase;
  });
  repository.clearRestoreJournal.mockImplementation(async () => {
    journal = undefined;
  });
  repository.replaceRestoreJournal.mockImplementation(async (_urn, previousState, targetState, directories) => {
    journal = fromPartial({ phase: 'prepared-hook-pending', previousState, targetState, directories });
  });
  const docker = mock<DockerService>();
  docker.getEffectiveMigrationServices.mockResolvedValue({ migration: { image: 'sqlite:latest' } });
  docker.stopAppMigrations.mockResolvedValue(undefined);
  const manager = new BackupManager(archive, logger, config, filesystem, appFiles, repository, docker);
  const hook = async (name: string) => {
    await fs.promises.mkdir(path.join(appInstalledDir, 'backup'), { recursive: true });
    await fs.promises.writeFile(path.join(appInstalledDir, 'backup', `${name}.yml`), 'services: {}');
  };
  const backupPath = (filename: string) => path.join(root, 'backups/store/demo', filename);
  return { manager, archive, appDataDir, appInstalledDir, userConfigDir, docker, repository, hook, backupPath, root };
};

test('backs up only selected files while running, then restores them before the restore hook', async () => {
  const { manager, archive, appDataDir, appInstalledDir, userConfigDir, docker, repository, hook, backupPath } = await setup({
    stop: false,
    include: ['dump.sql'],
  });
  await hook('backup');
  await hook('restore');
  docker.composeMigration.mockImplementation(async (_urn, hook, command) => {
    if (hook.id === 'backup' && command.startsWith('run')) await fs.promises.writeFile(path.join(appDataDir, 'dump.sql'), 'consistent hook dump');
    if (hook.id === 'restore' && command.startsWith('run')) {
      expect(await fs.promises.readFile(path.join(appDataDir, 'dump.sql'), 'utf8')).toBe('consistent hook dump');
      await fs.promises.writeFile(path.join(appDataDir, 'restored'), 'hook ran');
    }
    return { success: true, stdout: '', stderr: '' };
  });
  const filename = await manager.createBackup(appUrn, true);
  expect(docker.composeApp).not.toHaveBeenCalled();
  const entries = await archive.listTarGz(backupPath(filename));
  expect(entries.some((entry) => entry.path.endsWith('/dump.sql'))).toBe(true);
  expect(entries.some((entry) => entry.path.endsWith('/live.db'))).toBe(false);
  expect(entries.some((entry) => entry.path.includes('runtipi-backup.json'))).toBe(true);
  await fs.promises.writeFile(path.join(appDataDir, 'dump.sql'), 'later dump');
  await fs.promises.writeFile(path.join(appDataDir, 'live.db'), 'later database');
  await fs.promises.writeFile(path.join(appInstalledDir, 'config.json'), 'current app');
  await fs.promises.writeFile(path.join(userConfigDir, 'custom.env'), 'current env');
  await expect(manager.restoreApp(appUrn, filename)).rejects.toThrow(/partial/i);
  expect(await fs.promises.readFile(path.join(appDataDir, 'dump.sql'), 'utf8')).toBe('later dump');
  await manager.restoreApp(appUrn, filename, { allowPartial: true });
  expect(await fs.promises.readFile(path.join(appDataDir, 'live.db'), 'utf8')).toBe('later database');
  expect(await fs.promises.readFile(path.join(appInstalledDir, 'config.json'), 'utf8')).toBe('current app');
  expect(await fs.promises.readFile(path.join(userConfigDir, 'custom.env'), 'utf8')).toBe('current env');
  expect(await fs.promises.readFile(path.join(appDataDir, 'restored'), 'utf8')).toBe('hook ran');
  expect(repository.finishRestore).toHaveBeenCalledWith(appUrn, { initialized: true, migrationIds: ['v1'] }, 'committed');
});

test('hook failure aborts publication and recovers a running app', async () => {
  const { manager, hook, docker, root } = await setup({ stop: true });
  await hook('backup');
  docker.composeMigration.mockRejectedValue(new Error('dump failed'));
  await expect(manager.createBackup(appUrn, true)).rejects.toThrow('dump failed');
  expect(docker.composeApp).toHaveBeenCalledWith(appUrn, 'up --detach --remove-orphans');
  expect(docker.stopAppMigrations).toHaveBeenCalledWith(appUrn);
  expect(await fs.promises.readdir(path.join(root, 'backups'))).toEqual(['.staging']);
});

test('full migration snapshots ignore partial policy and hooks', async () => {
  const { manager, hook, docker, archive, backupPath } = await setup({ stop: false, include: [] });
  await hook('backup');
  await hook('restore');
  const filename = await manager.createBackup(appUrn, false, undefined, { mode: 'full' });
  const entries = await archive.listTarGz(backupPath(filename));
  expect(entries.some((entry) => entry.path.endsWith('/live.db'))).toBe(true);
  expect(entries.some((entry) => entry.path.includes('runtipi-backup.json'))).toBe(false);
  await manager.restoreApp(appUrn, filename);
  expect(docker.composeMigration).not.toHaveBeenCalled();
  expect(docker.composeApp).toHaveBeenCalledWith(appUrn, 'stop');
});

test.each(['../outside', '/etc/passwd', '', 'a/../dump.sql', 'backups/old', 'a\\b'])('rejects unsafe include path %j', async (include) => {
  const { manager } = await setup({ include: [include] });
  await expect(manager.createBackup(appUrn)).rejects.toThrow();
});

test('rejects selected paths with symlinked ancestors', async () => {
  const { manager, appDataDir, root } = await setup({ include: ['linked/file'] });
  await fs.promises.writeFile(path.join(root, 'file'), 'outside data');
  await fs.promises.symlink(root, path.join(appDataDir, 'linked'));
  await expect(manager.createBackup(appUrn)).rejects.toThrow();
});

test('replaces selected directories and preserves unselected symlinks', async () => {
  const { manager, appDataDir } = await setup({ include: ['config', 'config/nested'] });
  await fs.promises.mkdir(path.join(appDataDir, 'config/nested'), { recursive: true });
  await fs.promises.writeFile(path.join(appDataDir, 'config/nested/value'), 'saved');
  const filename = await manager.createBackup(appUrn);
  await fs.promises.writeFile(path.join(appDataDir, 'config/later'), 'remove me');
  await fs.promises.symlink('/container/path', path.join(appDataDir, 'unselected-link'));
  await manager.restoreApp(appUrn, filename, { allowPartial: true });
  expect(await fs.promises.readFile(path.join(appDataDir, 'config/nested/value'), 'utf8')).toBe('saved');
  await expect(fs.promises.access(path.join(appDataDir, 'config/later'))).rejects.toThrow();
  expect(await fs.promises.readlink(path.join(appDataDir, 'unselected-link'))).toBe('/container/path');
});

test.each([{ include: [] }, { include: ['.'] }])('round trips an explicit include list $include', async ({ include }) => {
  const { manager, appDataDir } = await setup({ include });
  const filename = await manager.createBackup(appUrn);
  await fs.promises.writeFile(path.join(appDataDir, 'live.db'), 'later database');
  await manager.restoreApp(appUrn, filename, { allowPartial: true });
  expect(await fs.promises.readFile(path.join(appDataDir, 'live.db'), 'utf8')).toBe(include.length ? 'live database' : 'later database');
});

test('runs backup hooks before stopping and restore hooks after a full restore', async () => {
  const { manager, hook, docker, appDataDir } = await setup({});
  await hook('backup');
  await hook('restore');
  const events: string[] = [];
  docker.composeMigration.mockImplementation(async (_urn, hook, command) => {
    if (command.startsWith('run')) {
      events.push(hook.id);
      if (hook.id === 'restore') expect(await fs.promises.readFile(path.join(appDataDir, 'live.db'), 'utf8')).toBe('live database');
    }
    return { success: true, stdout: '', stderr: '' };
  });
  docker.composeApp.mockImplementation(async (_urn, command) => {
    events.push(command);
    return { success: true, stdout: '', stderr: '' };
  });
  const filename = await manager.createBackup(appUrn, true);
  expect(events).toEqual(['backup', 'stop', 'up --detach --remove-orphans']);
  await fs.promises.writeFile(path.join(appDataDir, 'live.db'), 'later database');
  await manager.restoreApp(appUrn, filename, { allowPartial: true });
  expect(events.at(-1)).toBe('restore');
});

test('a restore hook failure rejects the restore without starting the app', async () => {
  const { manager, hook, docker } = await setup({ include: ['dump.sql'] });
  await hook('restore');
  const filename = await manager.createBackup(appUrn);
  docker.composeApp.mockClear();
  docker.composeMigration.mockRejectedValue(new Error('restore hook failed'));
  await expect(manager.restoreApp(appUrn, filename, { allowPartial: true })).rejects.toThrow('restore hook failed');
  expect(docker.composeApp).not.toHaveBeenCalled();
});

test('rejects an invalid hook service before running it', async () => {
  const { manager, hook, docker } = await setup({});
  await hook('backup');
  docker.getEffectiveMigrationServices.mockResolvedValue({ other: { image: 'bad' } });
  await expect(manager.createBackup(appUrn)).rejects.toThrow(/exactly one service/);
  expect(docker.composeMigration).not.toHaveBeenCalled();
});

test.each([
  { version: 2, partial: true, include: ['dump.sql'], migrationIds: ['v1'] },
  { version: 1, partial: false, include: ['dump.sql'], migrationIds: ['v1'] },
  { version: 1, partial: true, include: ['../outside'], migrationIds: ['v1'] },
  { version: 1, partial: true, include: ['missing'], migrationIds: ['v1'] },
  { version: 1, partial: true, include: [], migrationIds: ['v1'] },
  { version: 1, partial: true, include: ['dump.sql'] },
  { version: 1, partial: true, include: ['dump.sql'], migrationIds: [42] },
])('rejects malformed or inconsistent partial manifest %j before changing data', async (manifest) => {
  const { manager, root, archive, backupPath, appDataDir } = await setup();
  const source = path.join(root, 'malformed');
  await fs.promises.mkdir(path.join(source, 'app-data'), { recursive: true });
  await fs.promises.writeFile(path.join(source, 'app-data/dump.sql'), 'untrusted dump');
  await fs.promises.writeFile(path.join(source, 'runtipi-backup.json'), JSON.stringify(manifest));
  await fs.promises.mkdir(path.dirname(backupPath('malformed.tar.gz')), { recursive: true });
  await archive.createTarGz(source, backupPath('malformed.tar.gz'));
  await expect(manager.restoreApp(appUrn, 'malformed.tar.gz', { allowPartial: true })).rejects.toThrow();
  expect(await fs.promises.readFile(path.join(appDataDir, 'dump.sql'), 'utf8')).toBe('saved dump');
});

test('leaves unselected permissions and hardlinks untouched', async () => {
  const { manager, appDataDir } = await setup({ include: ['dump.sql'] });
  await fs.promises.mkdir(path.join(appDataDir, 'private'), { mode: 0o700 });
  await fs.promises.writeFile(path.join(appDataDir, 'private/state'), 'private data');
  await fs.promises.link(path.join(appDataDir, 'private/state'), path.join(appDataDir, 'hardlink'));
  const before = await fs.promises.stat(path.join(appDataDir, 'private'));
  const filename = await manager.createBackup(appUrn);
  await manager.restoreApp(appUrn, filename, { allowPartial: true });
  const after = await fs.promises.stat(path.join(appDataDir, 'private'));
  expect(after.ino).toBe(before.ino);
  expect(after.mode & 0o777).toBe(0o700);
  expect((await fs.promises.stat(path.join(appDataDir, 'hardlink'))).nlink).toBe(2);
});

test('retains a failed restore hook for reconciliation before a later lifecycle operation', async () => {
  const { manager, hook, docker, appDataDir } = await setup({ include: ['dump.sql'] });
  await hook('restore');
  const filename = await manager.createBackup(appUrn);
  docker.composeMigration.mockRejectedValue(new Error('interrupted restore hook'));
  await expect(manager.restoreApp(appUrn, filename, { allowPartial: true })).rejects.toThrow();
  docker.composeMigration.mockImplementation(async (_urn, _hook, command) => {
    if (command.startsWith('run')) await fs.promises.writeFile(path.join(appDataDir, 'recovered'), 'imported');
    return { success: true, stdout: '', stderr: '' };
  });
  await manager.reconcileRestore(appUrn);
  expect(await fs.promises.readFile(path.join(appDataDir, 'recovered'), 'utf8')).toBe('imported');
});

test('does not leave missing parent directories behind when a partial restore rolls back', async () => {
  const { manager, appDataDir } = await setup({ include: ['db/dump.sql'] });
  await fs.promises.mkdir(path.join(appDataDir, 'db'));
  await fs.promises.writeFile(path.join(appDataDir, 'db/dump.sql'), 'nested dump');
  const filename = await manager.createBackup(appUrn);
  await fs.promises.rm(path.join(appDataDir, 'db'), { recursive: true });
  const rename = fs.promises.rename;
  vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
    if (String(from).includes('.restore-')) throw new Error('simulated swap failure');
    return rename(from, to);
  });
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  await expect(manager.restoreApp(appUrn, filename, { allowPartial: true })).rejects.toThrow('simulated swap failure');
  expect(fs.existsSync(path.join(appDataDir, 'db'))).toBe(false);
  vi.restoreAllMocks();
  await manager.restoreApp(appUrn, filename, { allowPartial: true });
  expect(await fs.promises.readFile(path.join(appDataDir, 'db/dump.sql'), 'utf8')).toBe('nested dump');
});

test('rejects a partial backup taken with a different migration history', async () => {
  const { manager, appDataDir, repository } = await setup({ include: ['dump.sql'] });
  const filename = await manager.createBackup(appUrn);
  await fs.promises.writeFile(path.join(appDataDir, 'dump.sql'), 'migrated dump');
  repository.getMigrationState.mockResolvedValue({ initialized: true, migrationIds: ['v1', 'v2'] });
  await expect(manager.restoreApp(appUrn, filename, { allowPartial: true })).rejects.toThrow(/migration/i);
  expect(await fs.promises.readFile(path.join(appDataDir, 'dump.sql'), 'utf8')).toBe('migrated dump');
  expect(repository.createRestoreJournal).not.toHaveBeenCalled();
  repository.getMigrationState.mockResolvedValue({ initialized: true, migrationIds: ['v1'] });
  await manager.restoreApp(appUrn, filename, { allowPartial: true });
  expect(await fs.promises.readFile(path.join(appDataDir, 'dump.sql'), 'utf8')).toBe('saved dump');
});

test('a pending restore hook blocks lifecycle work but can be replaced by another restore', async () => {
  const { manager, hook, docker, appDataDir, repository, root, archive, backupPath } = await setup({ include: ['dump.sql'] });
  await hook('restore');
  const filename = await manager.createBackup(appUrn);
  docker.composeMigration.mockRejectedValue(new Error('broken restore hook'));
  await expect(manager.restoreApp(appUrn, filename, { allowPartial: true })).rejects.toThrow('broken restore hook');

  // Starting, updating or backing up still runs the hook first and refuses while it fails.
  await expect(manager.reconcileRestore(appUrn)).rejects.toThrow('broken restore hook');
  await expect(manager.createBackup(appUrn)).rejects.toThrow('broken restore hook');
  // Work that does not touch app data can defer it.
  docker.composeMigration.mockClear();
  await manager.reconcileRestore(appUrn, { pendingHook: 'defer' });
  expect(docker.composeMigration).not.toHaveBeenCalled();
  expect((await repository.getRestoreJournal(appUrn))?.phase).toBe('hooks-pending');

  // A rejected archive leaves the pending hook in place.
  const invalid = path.join(root, 'invalid');
  await fs.promises.mkdir(path.join(invalid, 'app-data'), { recursive: true });
  await fs.promises.writeFile(path.join(invalid, 'runtipi-backup.json'), '{}');
  await archive.createTarGz(invalid, backupPath('invalid.tar.gz'));
  await expect(manager.restoreApp(appUrn, 'invalid.tar.gz', { allowPartial: true })).rejects.toThrow();
  expect((await repository.getRestoreJournal(appUrn))?.phase).toBe('hooks-pending');

  // Restoring again replaces the pending hook and runs the hook for the new restore.
  docker.composeMigration.mockImplementation(async (_urn, _hook, command) => {
    if (command.startsWith('run')) await fs.promises.writeFile(path.join(appDataDir, 'recovered'), 'imported');
    return { success: true, stdout: '', stderr: '' };
  });
  await manager.restoreApp(appUrn, filename, { allowPartial: true });
  expect(await fs.promises.readFile(path.join(appDataDir, 'recovered'), 'utf8')).toBe('imported');
  expect(await repository.getRestoreJournal(appUrn)).toBeUndefined();
  expect((await fs.promises.readdir(appDataDir)).filter((name) => name.includes('.restore-'))).toEqual([]);
});

test('keeps the previous hook pending when replacement file installation fails', async () => {
  const { manager, hook, docker, appDataDir, repository } = await setup({ include: ['dump.sql'] });
  await hook('restore');
  const filename = await manager.createBackup(appUrn);
  docker.composeMigration.mockRejectedValue(new Error('hook still required'));
  await expect(manager.restoreApp(appUrn, filename, { allowPartial: true })).rejects.toThrow();
  await fs.promises.writeFile(path.join(appDataDir, 'dump.sql'), 'previous pending data');
  const rename = fs.promises.rename.bind(fs.promises);
  let failed = false;
  const spy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (source, destination) => {
    if (!failed && String(source).includes('.dump.sql.restore-') && !String(source).endsWith('.previous')) {
      failed = true;
      throw new Error('replacement install failed');
    }
    return rename(source, destination);
  });
  try {
    await expect(manager.restoreApp(appUrn, filename, { allowPartial: true })).rejects.toThrow('replacement install failed');
  } finally {
    spy.mockRestore();
  }
  expect(failed).toBe(true);
  expect(await fs.promises.readFile(path.join(appDataDir, 'dump.sql'), 'utf8')).toBe('previous pending data');
  expect((await repository.getRestoreJournal(appUrn))?.phase).toBe('hooks-pending');
  await expect(manager.reconcileRestore(appUrn)).rejects.toThrow('hook still required');
});
