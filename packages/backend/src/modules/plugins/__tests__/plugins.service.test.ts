import { FilesystemService } from '@/core/filesystem/filesystem.service';
import { beforeEach, describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { PluginsService } from '../plugins.service';

describe('PluginsService', () => {
  const filesystem = mock<FilesystemService>();
  let service: PluginsService;
  let files: Map<string, object>;

  beforeEach(() => {
    service = new PluginsService(filesystem);
    files = new Map();
    filesystem.pathExists.mockImplementation(async (file) => files.has(file));
    filesystem.readJsonFile.mockImplementation(async (file) => structuredClone(files.get(file) ?? null));
    filesystem.createDirectory.mockResolvedValue(true);
    filesystem.writeJsonFileAtomic.mockImplementation(async (file, data) => {
      files.set(file, structuredClone(data) as object);
      return true;
    });
  });

  it('persists installation across service restarts and isolates accounts', async () => {
    expect((await service.list(1)).every((plugin) => !plugin.installed)).toBe(true);
    await service.update(1, 'system-insights', 'install');
    const restarted = new PluginsService(filesystem);
    expect((await restarted.list(1))[0]).toMatchObject({ installed: true, enabled: true });
    expect((await restarted.list(2))[0]).toMatchObject({ installed: false, enabled: false });
  });

  it('supports disable, re-enable and uninstall without affecting another plugin', async () => {
    await Promise.all([service.update(1, 'system-insights', 'install'), service.update(1, 'app-health', 'install')]);
    await service.update(1, 'system-insights', 'disable');
    expect((await service.list(1))[0]).toMatchObject({ installed: true, enabled: false });
    await service.update(1, 'system-insights', 'install');
    expect((await service.list(1))[0]?.enabled).toBe(false);
    await service.update(1, 'system-insights', 'enable');
    expect((await service.list(1))[0]?.enabled).toBe(true);
    await service.update(1, 'system-insights', 'uninstall');
    const state = await service.list(1);
    expect(state[0]).toMatchObject({ installed: false, enabled: false });
    expect(state[1]).toMatchObject({ installed: true, enabled: true });
  });

  it('rejects unsupported IDs, actions and enabling uninstalled plugins', async () => {
    await expect(service.update(1, '../settings', 'install')).rejects.toThrow('Plugin not found');
    await expect(service.update(1, 'app-health', 'execute')).rejects.toThrow('Unknown plugin action');
    await expect(service.update(1, 'app-health', 'enable')).rejects.toThrow('Install the plugin first');
    expect(files.size).toBe(0);
  });

  it('reports failed writes and corrupted settings without silently resetting them', async () => {
    filesystem.writeJsonFileAtomic.mockResolvedValueOnce(false);
    await expect(service.update(1, 'app-health', 'install')).rejects.toThrow('Unable to save');
    files.set('/data/state/plugins/1.json', {});
    filesystem.readJsonFile.mockResolvedValueOnce(null);
    await expect(service.update(1, 'app-health', 'install')).rejects.toThrow('Unable to read');
  });
});
