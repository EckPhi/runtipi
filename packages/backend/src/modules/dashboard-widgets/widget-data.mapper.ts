import type { PluginWidget } from '@runtipi/common/schemas';
import type { WidgetData, WidgetListRow, WidgetValueKind } from './dto/dashboard-widgets.dto';
import type { AppBackupsSnapshot, AppBackupState } from './sources/app-backups.source';
import type { AppResourcesSnapshot } from './sources/app-resources.source';
import type { AppStorageSnapshot } from './sources/app-storage.source';

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

const share = (value: number, max: number) => (max > 0 ? round((Math.max(value, 0) / max) * 100) : 0);

const limitRows = (rows: WidgetListRow[], limit: number) => ({ rows: rows.slice(0, limit), hiddenRows: Math.max(rows.length - limit, 0) });

export const mapResources = (widget: PluginWidget, snapshot: AppResourcesSnapshot): WidgetData => {
  const metric = widget.options.metric ?? 'memory';
  const totalCpu = round(
    snapshot.apps.reduce((total, app) => total + app.cpu, 0),
    2,
  );
  const totalMemory = snapshot.apps.reduce((total, app) => total + app.memory, 0);

  switch (widget.type) {
    case 'stat':
      return {
        type: 'stat',
        value: metric === 'cpu' ? { kind: 'cpu', value: totalCpu } : { kind: 'memory', value: totalMemory },
        secondary: { kind: 'apps', value: snapshot.apps.length },
      };
    case 'progress':
      if (metric === 'cpu') {
        return { type: 'progress', percent: Math.min(totalCpu, 100), value: { kind: 'cpu', value: totalCpu }, total: null };
      }

      return {
        type: 'progress',
        percent: snapshot.memoryTotal ? Math.min(round((totalMemory / snapshot.memoryTotal) * 100), 100) : 0,
        value: { kind: 'memory', value: totalMemory },
        total: { kind: 'memory', value: snapshot.memoryTotal },
      };
    default: {
      const sorted = [...snapshot.apps].sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name));
      const max = Math.max(0, ...sorted.map((app) => app[metric]));
      const rows = sorted.map((app) => {
        const cpu = { kind: 'cpu' as const, value: round(app.cpu, 2) };
        const memory = { kind: 'memory' as const, value: app.memory };

        return {
          urn: app.urn,
          name: app.name,
          values: metric === 'cpu' ? [cpu, memory] : [memory, cpu],
          status: null,
          error: null,
          share: share(app[metric], max),
        };
      });
      const columns: WidgetValueKind[] = metric === 'cpu' ? ['cpu', 'memory'] : ['memory', 'cpu'];

      return { type: 'list', columns, ...limitRows(rows, widget.options.limit) };
    }
  }
};

const BACKUP_STATE_ORDER: Record<AppBackupState, number> = { error: 0, none: 1, ok: 2 };

export const mapBackups = (widget: PluginWidget, snapshot: AppBackupsSnapshot): WidgetData => {
  if (widget.type === 'stat') {
    const lastBackups = snapshot.apps.map((app) => app.lastBackupAt).filter((value) => value !== null);

    return {
      type: 'stat',
      value: { kind: 'failures', value: snapshot.apps.filter((app) => app.status === 'error').length },
      secondary: { kind: 'last_backup', value: lastBackups.length > 0 ? Math.max(...lastBackups) : null },
    };
  }

  // Failing apps first, then apps never backed up, then the stalest backups.
  const sorted = [...snapshot.apps].sort(
    (a, b) =>
      BACKUP_STATE_ORDER[a.status] - BACKUP_STATE_ORDER[b.status] || (a.lastBackupAt ?? 0) - (b.lastBackupAt ?? 0) || a.name.localeCompare(b.name),
  );
  const rows = sorted.map((app) => ({
    urn: app.urn,
    name: app.name,
    values: [
      { kind: 'last_backup' as const, value: app.lastBackupAt },
      { kind: 'backup_count' as const, value: app.count },
      { kind: 'backup_size' as const, value: app.size },
    ],
    status: app.status,
    error: app.status === 'error' ? app.lastError : null,
    share: null,
  }));

  return { type: 'list', columns: ['last_backup', 'backup_count', 'backup_size'], ...limitRows(rows, widget.options.limit) };
};

export const mapStorage = (widget: PluginWidget, snapshot: AppStorageSnapshot): WidgetData => {
  const total = snapshot.apps.reduce((sum, app) => sum + app.bytes, 0);
  const growths = snapshot.apps.map((app) => app.growth).filter((value) => value !== null);

  switch (widget.type) {
    case 'stat':
      return {
        type: 'stat',
        value: { kind: 'size', value: total },
        secondary: { kind: 'growth', value: growths.length > 0 ? growths.reduce((sum, value) => sum + value, 0) : null },
      };
    case 'timeseries':
      return { type: 'timeseries', kind: 'size', points: snapshot.series };
    default: {
      const sorted = [...snapshot.apps].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
      const max = Math.max(0, ...sorted.map((app) => app.bytes));
      const rows = sorted.map((app) => ({
        urn: app.urn,
        name: app.name,
        values: [
          { kind: 'size' as const, value: app.bytes },
          { kind: 'growth' as const, value: app.growth },
        ],
        status: null,
        error: null,
        share: share(app.bytes, max),
      }));

      return { type: 'list', columns: ['size', 'growth'], ...limitRows(rows, widget.options.limit) };
    }
  }
};
