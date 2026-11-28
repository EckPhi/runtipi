import { type PluginWidgetInput, pluginWidgetSchema } from '@runtipi/common/schemas';
import type { AppUrn } from '@runtipi/common/types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { getBackupState } from '../sources/app-backups.source';
import type { AppBackupsSnapshot } from '../sources/app-backups.source';
import { getComposeProject, getCpuShare, getMemoryUsage } from '../sources/app-resources.source';
import type { AppResourcesSnapshot } from '../sources/app-resources.source';
import { summariseStorageSamples } from '../sources/app-storage.source';
import { mapBackups, mapResources, mapStorage } from '../widget-data.mapper';
import { getRefreshSeconds } from '../widget-registry';

const widget = (input: Omit<PluginWidgetInput, 'id' | 'title'>) => {
  const result = pluginWidgetSchema({ id: 'w', title: 'Widget', ...input });
  if (result instanceof type.errors) throw new Error(result.summary);
  return result;
};

const GiB = 1024 ** 3;

describe('container stats', () => {
  it('computes the CPU share of the whole host between two samples', () => {
    const share = getCpuShare({
      cpu_stats: { cpu_usage: { total_usage: 3_000 }, system_cpu_usage: 20_000 },
      precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 10_000 },
    } as never);

    expect(share).toBe(20);
  });

  it('returns null without a previous sample', () => {
    expect(getCpuShare({ cpu_stats: { cpu_usage: { total_usage: 3_000 }, system_cpu_usage: 20_000 }, precpu_stats: {} } as never)).toBeNull();
  });

  it('excludes reclaimable page cache from memory usage', () => {
    expect(getMemoryUsage({ memory_stats: { usage: 1_000, stats: { inactive_file: 300 } } } as never)).toBe(700);
    expect(getMemoryUsage({ memory_stats: {} } as never)).toBeNull();
  });

  it('maps an app to its compose project name', () => {
    expect(getComposeProject('nextcloud:migrated' as AppUrn)).toBe('nextcloud_migrated');
  });
});

describe('getRefreshSeconds', () => {
  it('uses the source default and raises intervals below the source minimum', () => {
    expect(getRefreshSeconds(widget({ type: 'list', source: 'app-resources' }))).toBe(15);
    expect(getRefreshSeconds(widget({ type: 'list', source: 'app-resources', refresh_seconds: 5 }))).toBe(10);
    expect(getRefreshSeconds(widget({ type: 'list', source: 'app-storage', refresh_seconds: 60 }))).toBe(300);
    expect(getRefreshSeconds(widget({ type: 'list', source: 'app-backups', refresh_seconds: 120 }))).toBe(120);
  });
});

describe('mapResources', () => {
  const snapshot: AppResourcesSnapshot = {
    sampledAt: 1,
    memoryTotal: 8 * GiB,
    apps: [
      { urn: 'a:s' as AppUrn, name: 'Alpha', cpu: 1.234, memory: 1 * GiB, containers: 1 },
      { urn: 'b:s' as AppUrn, name: 'Beta', cpu: 10, memory: 3 * GiB, containers: 2 },
      { urn: 'c:s' as AppUrn, name: 'Gamma', cpu: 5, memory: 2 * GiB, containers: 1 },
    ],
  };

  it('lists apps by memory by default, limited and with a relative share', () => {
    const data = mapResources(widget({ type: 'list', source: 'app-resources', options: { limit: 2 } }), snapshot);

    expect(data).toMatchObject({ type: 'list', columns: ['memory', 'cpu'], hiddenRows: 1 });
    if (data.type !== 'list') throw new Error('expected a list');
    expect(data.rows.map((row) => [row.name, row.share])).toEqual([
      ['Beta', 100],
      ['Gamma', 66.7],
    ]);
    expect(data.rows[0]?.values).toEqual([
      { kind: 'memory', value: 3 * GiB },
      { kind: 'cpu', value: 10 },
    ]);
  });

  it('lists apps by CPU when asked', () => {
    const data = mapResources(widget({ type: 'list', source: 'app-resources', options: { metric: 'cpu' } }), snapshot);

    if (data.type !== 'list') throw new Error('expected a list');
    expect(data.columns).toEqual(['cpu', 'memory']);
    expect(data.rows.map((row) => row.name)).toEqual(['Beta', 'Gamma', 'Alpha']);
    expect(data.rows[2]?.values[0]).toEqual({ kind: 'cpu', value: 1.23 });
  });

  it('shows memory used by apps as a share of host memory', () => {
    expect(mapResources(widget({ type: 'progress', source: 'app-resources' }), snapshot)).toEqual({
      type: 'progress',
      percent: 75,
      value: { kind: 'memory', value: 6 * GiB },
      total: { kind: 'memory', value: 8 * GiB },
    });
  });

  it('sums the metric in a stat with the number of running apps', () => {
    expect(mapResources(widget({ type: 'stat', source: 'app-resources', options: { metric: 'cpu' } }), snapshot)).toEqual({
      type: 'stat',
      value: { kind: 'cpu', value: 16.23 },
      secondary: { kind: 'apps', value: 3 },
    });
  });
});

describe('backups', () => {
  it('reports an app as failing only when the latest attempt failed', () => {
    expect(getBackupState({ count: 2, lastBackupAt: 1_000, lastSuccessAt: 1_000, lastErrorAt: 2_000 })).toBe('error');
    expect(getBackupState({ count: 2, lastBackupAt: 3_000, lastSuccessAt: 1_000, lastErrorAt: 2_000 })).toBe('ok');
    expect(getBackupState({ count: 0, lastBackupAt: null, lastSuccessAt: null, lastErrorAt: null })).toBe('none');
    expect(getBackupState({ count: 0, lastBackupAt: null, lastSuccessAt: null, lastErrorAt: 5 })).toBe('error');
  });

  const snapshot: AppBackupsSnapshot = {
    sampledAt: 1,
    apps: [
      { urn: 'ok:s' as AppUrn, name: 'Healthy', count: 3, size: 300, lastBackupAt: 5_000, lastError: null, lastErrorAt: null, status: 'ok' },
      { urn: 'old:s' as AppUrn, name: 'Stale', count: 1, size: 100, lastBackupAt: 1_000, lastError: null, lastErrorAt: null, status: 'ok' },
      { urn: 'new:s' as AppUrn, name: 'Never', count: 0, size: 0, lastBackupAt: null, lastError: null, lastErrorAt: null, status: 'none' },
      {
        urn: 'bad:s' as AppUrn,
        name: 'Broken',
        count: 1,
        size: 50,
        lastBackupAt: 2_000,
        lastError: 'disk full',
        lastErrorAt: 9_000,
        status: 'error',
      },
    ],
  };

  it('lists failing apps first, then apps without backups, then the stalest', () => {
    const data = mapBackups(widget({ type: 'list', source: 'app-backups' }), snapshot);

    if (data.type !== 'list') throw new Error('expected a list');
    expect(data.columns).toEqual(['last_backup', 'backup_count', 'backup_size']);
    expect(data.rows.map((row) => [row.name, row.status, row.error])).toEqual([
      ['Broken', 'error', 'disk full'],
      ['Never', 'none', null],
      ['Stale', 'ok', null],
      ['Healthy', 'ok', null],
    ]);
    expect(data.rows[3]?.values).toEqual([
      { kind: 'last_backup', value: 5_000 },
      { kind: 'backup_count', value: 3 },
      { kind: 'backup_size', value: 300 },
    ]);
  });

  it('counts failing apps and shows the latest backup in a stat', () => {
    expect(mapBackups(widget({ type: 'stat', source: 'app-backups' }), snapshot)).toEqual({
      type: 'stat',
      value: { kind: 'failures', value: 1 },
      secondary: { kind: 'last_backup', value: 5_000 },
    });
  });
});

describe('storage', () => {
  const apps = [
    { id: 1, urn: 'a:s' as AppUrn, name: 'Alpha' },
    { id: 2, urn: 'b:s' as AppUrn, name: 'Beta' },
    { id: 3, urn: 'c:s' as AppUrn, name: 'Removed since' },
  ];
  const samples = [
    { appId: 1, sampledAt: 100, bytes: 1_000 },
    { appId: 3, sampledAt: 100, bytes: 50 },
    { appId: 1, sampledAt: 200, bytes: 1_500 },
    { appId: 2, sampledAt: 200, bytes: 4_000 },
  ];

  it('summarises the latest size, the growth over the period and the total series', () => {
    expect(summariseStorageSamples(samples, apps)).toEqual({
      sampledAt: 200_000,
      apps: [
        { urn: 'a:s', name: 'Alpha', bytes: 1_500, growth: 500 },
        { urn: 'b:s', name: 'Beta', bytes: 4_000, growth: null },
      ],
      series: [
        { t: 100_000, value: 1_050 },
        { t: 200_000, value: 5_500 },
      ],
    });
  });

  it('has no data before the first sample', () => {
    expect(summariseStorageSamples([], apps)).toEqual({ sampledAt: null, apps: [], series: [] });
  });

  it('maps the summary to each widget type', () => {
    const snapshot = summariseStorageSamples(samples, apps);

    expect(mapStorage(widget({ type: 'stat', source: 'app-storage' }), snapshot)).toEqual({
      type: 'stat',
      value: { kind: 'size', value: 5_500 },
      secondary: { kind: 'growth', value: 500 },
    });
    expect(mapStorage(widget({ type: 'timeseries', source: 'app-storage' }), snapshot)).toEqual({
      type: 'timeseries',
      kind: 'size',
      points: snapshot.series,
    });

    const list = mapStorage(widget({ type: 'list', source: 'app-storage' }), snapshot);
    if (list.type !== 'list') throw new Error('expected a list');
    expect(list.rows.map((row) => [row.name, row.share])).toEqual([
      ['Beta', 100],
      ['Alpha', 37.5],
    ]);
  });
});
