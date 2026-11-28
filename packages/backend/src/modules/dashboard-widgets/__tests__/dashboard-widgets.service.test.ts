import fs from 'node:fs';
import path from 'node:path';
import type { LoggerService } from '@/core/logger/logger.service';
import type { AppFilesManager } from '@/modules/apps/app-files-manager';
import type { PluginsService } from '@/modules/plugins/plugins.service';
import { type PluginManifest, type PluginManifestInput, pluginManifestSchema } from '@runtipi/common/schemas';
import type { AppUrn } from '@runtipi/common/types';
import { type } from 'arktype';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { DashboardWidgetsRepository, StorageSample } from '../dashboard-widgets.repository';
import { DashboardWidgetsService } from '../dashboard-widgets.service';
import type { InstalledApp, InstalledAppsReader } from '../installed-apps.reader';
import type { AppBackupsSource } from '../sources/app-backups.source';
import type { AppResourcesSource } from '../sources/app-resources.source';
import { AppStorageSource } from '../sources/app-storage.source';
import { getDirectorySize } from '../sources/directory-size';
import { WidgetRegistry } from '../widget-registry';

const manifest = (input: Partial<PluginManifestInput> & { id: string }): PluginManifest => {
  const result = pluginManifestSchema({
    urn: `${input.id}:store`,
    name: input.id,
    version: '1.0.0',
    tipi_version: 1,
    short_desc: '',
    author: '',
    source: '',
    capabilities: ['dashboard-widget'],
    ...input,
  });
  if (result instanceof type.errors) throw new Error(result.summary);
  return result;
};

const insights = manifest({
  id: 'insights',
  name: 'Insights',
  widgets: [
    { id: 'backups', title: 'Backup status', type: 'list', source: 'app-backups' },
    { id: 'storage', title: 'Storage', type: 'stat', source: 'app-storage', refresh_seconds: 30 },
  ],
});

const installedApps: InstalledApp[] = [{ id: 7, urn: 'nextcloud:store' as AppUrn, name: 'Nextcloud', status: 'running' }];

class InMemoryRepository {
  hidden = new Map<number, string[]>();
  samples: StorageSample[] = [];

  async getHiddenWidgets(userId: number) {
    return this.hidden.get(userId) ?? [];
  }
  async setHiddenWidgets(userId: number, keys: string[]) {
    this.hidden.set(userId, keys);
  }
  async getStorageSamples(since: number) {
    return this.samples.filter((sample) => sample.sampledAt >= since);
  }
  async addStorageSamples(samples: StorageSample[]) {
    this.samples.push(...samples);
  }
  async deleteStorageSamplesBefore(before: number) {
    this.samples = this.samples.filter((sample) => sample.sampledAt >= before);
  }
}

const setup = (manifests: PluginManifest[] = [insights]) => {
  const plugins = mock<PluginsService>();
  plugins.getEnabledPluginManifests.mockResolvedValue(manifests);
  const registry = new WidgetRegistry(plugins);
  const repository = new InMemoryRepository();
  const apps = mock<InstalledAppsReader>();
  apps.getApps.mockResolvedValue(installedApps);
  const appFiles = mock<AppFilesManager>();
  appFiles.getAppPaths.mockImplementation((urn) => ({ appDataDir: `/app-data/store/${urn.split(':')[0]}`, appInstalledDir: '' }));
  const storage = new AppStorageSource(repository as unknown as DashboardWidgetsRepository, apps, appFiles, registry, mock<LoggerService>());
  const backups = mock<AppBackupsSource>();
  backups.getSnapshot.mockResolvedValue({ sampledAt: 42, apps: [] });
  const resources = mock<AppResourcesSource>();
  const service = new DashboardWidgetsService(registry, repository as unknown as DashboardWidgetsRepository, resources, backups, storage);

  return { service, repository, storage, plugins, backups, resources };
};

describe('DashboardWidgetsService', () => {
  it('lists the widgets of enabled plugins with the hidden flag of the user', async () => {
    const { service, repository } = setup();
    await repository.setHiddenWidgets(1, ['insights:store/storage']);

    expect(await service.getWidgets(1)).toEqual([
      {
        key: 'insights:store/backups',
        pluginUrn: 'insights:store',
        pluginName: 'Insights',
        widgetId: 'backups',
        title: 'Backup status',
        type: 'list',
        source: 'app-backups',
        refreshSeconds: 60,
        hidden: false,
      },
      expect.objectContaining({ key: 'insights:store/storage', refreshSeconds: 300, hidden: true }),
    ]);
    expect(await service.getWidgets(2)).toEqual([expect.objectContaining({ hidden: false }), expect.objectContaining({ hidden: false })]);
  });

  it('has no widgets when no enabled plugin declares any', async () => {
    const { service } = setup([manifest({ id: 'tailscale', capabilities: ['compose'] })]);

    expect(await service.getWidgets(1)).toEqual([]);
  });

  it('returns data from the widget source', async () => {
    const { service } = setup();

    expect(await service.getWidgetData('insights:store/backups')).toEqual({
      key: 'insights:store/backups',
      status: 'ok',
      sampledAt: 42,
      data: { type: 'list', columns: ['last_backup', 'backup_count', 'backup_size'], rows: [], hiddenRows: 0 },
    });
  });

  it('rejects keys of widgets that are not installed', async () => {
    const { service } = setup();

    await expect(service.getWidgetData('other:store/backups')).rejects.toMatchObject({
      status: 404,
      response: { message: 'DASHBOARD_WIDGET_ERROR_NOT_FOUND' },
    });
  });

  it('reports storage as pending and takes a first sample when there is none', async () => {
    const { service, repository } = setup();
    await fs.promises.mkdir('/app-data/store/nextcloud', { recursive: true });
    await fs.promises.writeFile('/app-data/store/nextcloud/data.bin', 'x'.repeat(2048));

    expect(await service.getWidgetData('insights:store/storage')).toMatchObject({ status: 'pending', data: null });

    await vi.waitFor(() => expect(repository.samples).toHaveLength(1));
    expect(repository.samples[0]).toMatchObject({ appId: 7 });
    expect(repository.samples[0]?.bytes).toBeGreaterThan(0);

    expect(await service.getWidgetData('insights:store/storage')).toMatchObject({
      status: 'ok',
      data: { type: 'stat', value: { kind: 'size', value: repository.samples[0]?.bytes } },
    });
  });

  it('deduplicates and bounds the hidden widget keys', async () => {
    const { service, repository } = setup();
    await service.setHiddenWidgets(1, ['a/b', 'a/b', '', 'x'.repeat(301), 'c/d']);

    expect(repository.hidden.get(1)).toEqual(['a/b', 'c/d']);
  });
});

describe('AppStorageSource', () => {
  beforeEach(async () => {
    await fs.promises.mkdir('/app-data/store/nextcloud', { recursive: true });
  });

  it('does not walk app data when no widget uses the source', async () => {
    const { storage, repository } = setup([
      manifest({ id: 'only-backups', widgets: [{ id: 'b', title: 'B', type: 'stat', source: 'app-backups' }] }),
    ]);

    await storage.sampleIfUsed();

    expect(repository.samples).toEqual([]);
  });

  it('samples every app when a widget uses the source and drops samples past the retention', async () => {
    const { storage, repository } = setup();
    repository.samples.push({ appId: 7, sampledAt: 1, bytes: 1 });

    await storage.sampleIfUsed();

    expect(repository.samples).toHaveLength(1);
    expect(repository.samples[0]?.sampledAt).toBeGreaterThan(1);
  });
});

describe('getDirectorySize', () => {
  it('sums the files of a tree, counts hard links once and does not follow symlinks', async () => {
    const root = '/app-data/store/sized';
    await fs.promises.mkdir(path.join(root, 'nested'), { recursive: true });
    await fs.promises.writeFile(path.join(root, 'a.bin'), 'a'.repeat(1000));
    await fs.promises.writeFile(path.join(root, 'nested', 'b.bin'), 'b'.repeat(3000));
    const base = await getDirectorySize(root);
    expect(base).toBeGreaterThan(0);

    await fs.promises.link(path.join(root, 'a.bin'), path.join(root, 'nested', 'a-link.bin'));
    expect(await getDirectorySize(root)).toBe(base);

    await fs.promises.mkdir('/outside', { recursive: true });
    await fs.promises.writeFile('/outside/huge.bin', 'h'.repeat(100_000));
    await fs.promises.symlink('/outside', path.join(root, 'outside-link'));
    const readdir = vi.spyOn(fs.promises, 'readdir');

    expect(await getDirectorySize(root)).toBeGreaterThan(base);
    expect(readdir.mock.calls.map(([directory]) => directory)).not.toContain(path.join(root, 'outside-link'));
    readdir.mockRestore();
  });

  it('is 0 for a missing folder', async () => {
    expect(await getDirectorySize('/does/not/exist')).toBe(0);
  });
});
