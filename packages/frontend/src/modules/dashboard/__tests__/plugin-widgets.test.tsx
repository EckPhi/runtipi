import { getDashboardWidgetDataOptions, getDashboardWidgetsOptions, systemLoadOptions } from '@/api-client/@tanstack/react-query.gen';
import { client } from '@/api-client/client.gen';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../plugins/__tests__/plugin-test-utils';
import { PluginWidgets } from '../containers/plugin-widgets/plugin-widgets';
import type { DashboardWidget, WidgetData } from '../helpers/widget-helpers';
import { formatRelativeTime, formatWidgetValue } from '../helpers/widget-helpers';
import Dashboard from '../pages/dashboard';
import { getChartPoints } from '../components/widgets/timeseries-widget';

const originalConfig = client.getConfig();
afterEach(() => {
  client.setConfig(originalConfig);
  vi.unstubAllGlobals();
});

const GiB = 1024 ** 3;

const widget = (overrides: Partial<DashboardWidget> & Pick<DashboardWidget, 'widgetId' | 'type' | 'source'>): DashboardWidget => ({
  key: `dashboard-insights:store/${overrides.widgetId}`,
  pluginUrn: 'dashboard-insights:store',
  pluginName: 'Dashboard insights',
  title: overrides.widgetId,
  refreshSeconds: 60,
  hidden: false,
  ...overrides,
});

const backups = widget({ widgetId: 'backup-status', title: 'Backup status', type: 'list', source: 'app-backups' });
const resources = widget({ widgetId: 'app-resources', title: 'Per-app resource usage', type: 'list', source: 'app-resources' });
const failures = widget({ widgetId: 'failures', title: 'Failing backups', type: 'stat', source: 'app-backups' });
const memory = widget({ widgetId: 'memory', title: 'App memory', type: 'progress', source: 'app-resources' });
const growth = widget({ widgetId: 'growth', title: 'Storage growth', type: 'timeseries', source: 'app-storage' });
const storage = widget({ widgetId: 'storage', title: 'Storage', type: 'list', source: 'app-storage' });

const now = Date.now();

const DATA: Record<string, WidgetData | null> = {
  [backups.key]: {
    type: 'list',
    columns: ['last_backup', 'backup_count', 'backup_size'],
    hiddenRows: 2,
    rows: [
      {
        urn: 'nextcloud:store',
        name: 'Nextcloud',
        status: 'error',
        error: 'No space left on device',
        share: null,
        values: [
          { kind: 'last_backup', value: now - 3 * 24 * 60 * 60 * 1000 },
          { kind: 'backup_count', value: 2 },
          { kind: 'backup_size', value: 2 * GiB },
        ],
      },
      {
        urn: 'vaultwarden:store',
        name: 'Vaultwarden',
        status: 'none',
        error: null,
        share: null,
        values: [
          { kind: 'last_backup', value: null },
          { kind: 'backup_count', value: 0 },
          { kind: 'backup_size', value: 0 },
        ],
      },
    ],
  },
  [resources.key]: {
    type: 'list',
    columns: ['memory', 'cpu'],
    hiddenRows: 0,
    rows: [
      {
        urn: 'immich:store',
        name: 'Immich',
        status: null,
        error: null,
        share: 100,
        values: [
          { kind: 'memory', value: 1.5 * GiB },
          { kind: 'cpu', value: 12.5 },
        ],
      },
    ],
  },
  [failures.key]: { type: 'stat', value: { kind: 'failures', value: 1 }, secondary: { kind: 'last_backup', value: now - 60 * 60 * 1000 } },
  [memory.key]: { type: 'progress', percent: 37.5, value: { kind: 'memory', value: 3 * GiB }, total: { kind: 'memory', value: 8 * GiB } },
  [growth.key]: {
    type: 'timeseries',
    kind: 'size',
    points: [
      { t: now - 2 * 24 * 60 * 60 * 1000, value: 10 * GiB },
      { t: now, value: 12 * GiB },
    ],
  },
  [storage.key]: null,
};

const renderWidgets = (widgets: DashboardWidget[], ui = <PluginWidgets />) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
  queryClient.setQueryData(getDashboardWidgetsOptions().queryKey, { widgets });

  for (const entry of widgets) {
    const data = DATA[entry.key] ?? null;
    queryClient.setQueryData(getDashboardWidgetDataOptions({ query: { key: entry.key } }).queryKey, {
      key: entry.key,
      status: data ? 'ok' : 'pending',
      sampledAt: data ? now : null,
      data,
    });
  }

  queryClient.setQueryData(systemLoadOptions().queryKey, {
    diskUsed: 10,
    diskSize: 100,
    percentUsed: 10,
    cpuLoad: 5,
    memoryTotal: 8,
    percentUsedMemory: 40,
    memorySource: 'host',
  });

  return { ...renderWithProviders(ui, { queryClient }), queryClient };
};

describe('PluginWidgets', () => {
  it('leaves the dashboard unchanged without widget plugins', () => {
    const { container } = renderWidgets([], <Dashboard />);

    expect(screen.queryByTestId('plugin-widgets')).toBeNull();
    expect(screen.queryByTestId('plugin-widgets-menu')).toBeNull();
    expect(container.querySelectorAll('.card')).toHaveLength(3);
    expect(screen.getByText('Disk space')).toBeTruthy();
  });

  it('renders plugin widgets after the system stats', () => {
    const { container } = renderWidgets([backups], <Dashboard />);

    const cards = [...container.querySelectorAll('.card')];
    expect(cards).toHaveLength(4);
    expect(cards[3]?.textContent).toContain('Backup status');
  });

  it('shows backup status with failures first and the error', () => {
    renderWidgets([backups]);

    const card = screen.getByTestId(`dashboard-widget-${backups.key}`);
    expect(card.textContent).toContain('From the Dashboard insights plugin');
    const rows = within(card).getAllByTestId('widget-list-row');
    expect(rows[0]?.textContent).toContain('Nextcloud');
    expect(rows[0]?.textContent).toContain('No space left on device');
    expect(rows[0]?.textContent).toContain('3 days ago');
    expect(rows[0]?.textContent).toContain('2 GB');
    expect(within(rows[0] as HTMLElement).getByTitle('Last backup failed')).toBeTruthy();
    expect(rows[1]?.textContent).toContain('Never');
    expect(card.textContent).toContain('and 2 more');
  });

  it('shows per-app resource usage', () => {
    renderWidgets([resources]);

    const card = screen.getByTestId(`dashboard-widget-${resources.key}`);
    expect(
      within(card)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['App', 'Memory', 'CPU']);
    expect(within(card).getByTestId('widget-list-row').textContent).toContain('1.5 GB');
    expect(within(card).getByTestId('widget-list-row').textContent).toContain('12.5%');
  });

  it('renders stat, progress and time series widgets', () => {
    renderWidgets([failures, memory, growth]);

    expect(screen.getByTestId('widget-stat-value').textContent).toBe('1');
    expect(screen.getByTestId('widget-stat-value').className).toContain('text-danger');
    expect(screen.getByTestId('widget-progress-value').textContent).toBe('38%');
    expect((screen.getByTestId('widget-progress-bar') as HTMLElement).style.width).toBe('38%');
    expect(screen.getByTestId('widget-timeseries-value').textContent).toBe('12 GB');
    expect(screen.getByTestId(`dashboard-widget-${growth.key}`).textContent).toContain('+2 GB');
  });

  it('says when a sampled source has no data yet', () => {
    renderWidgets([storage]);

    expect(screen.getByTestId(`dashboard-widget-${storage.key}`).textContent).toContain('Collecting data');
  });

  it('does not render hidden widgets but keeps them in the menu', () => {
    renderWidgets([backups, { ...resources, hidden: true }]);

    expect(screen.getByTestId(`dashboard-widget-${backups.key}`)).toBeTruthy();
    expect(screen.queryByTestId(`dashboard-widget-${resources.key}`)).toBeNull();
    expect(screen.getByTestId('plugin-widgets-menu')).toBeTruthy();
  });

  it('saves the hidden widgets when one is toggled from the menu', async () => {
    const requests: { method: string; url: string; body: unknown }[] = [];
    client.setConfig({ baseUrl: 'http://localhost' });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const request = new Request(input);
      const body = request.method === 'PUT' ? await request.json() : null;
      requests.push({ method: request.method, url: request.url, body });
      const hidden = new Set((body as { hidden?: string[] } | null)?.hidden ?? []);
      return new Response(JSON.stringify({ widgets: [backups, resources].map((entry) => ({ ...entry, hidden: hidden.has(entry.key) })) }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    renderWidgets([backups, resources]);

    fireEvent.keyDown(screen.getByTestId('plugin-widgets-menu'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Per-app resource usage/ }));

    await waitFor(() => expect(screen.queryByTestId(`dashboard-widget-${resources.key}`)).toBeNull());
    expect(requests.find((request) => request.method === 'PUT')).toEqual({
      method: 'PUT',
      url: 'http://localhost/api/dashboard/widgets/preferences',
      body: { hidden: [resources.key] },
    });
    expect(screen.getByTestId(`dashboard-widget-${backups.key}`)).toBeTruthy();
  });
});

describe('widget helpers', () => {
  const t = ((key: string) => key) as never;

  it('formats values by kind', () => {
    expect(formatWidgetValue(t, 'en', { kind: 'cpu', value: 3.14159 })).toBe('3.14%');
    expect(formatWidgetValue(t, 'en', { kind: 'memory', value: 512 * 1024 ** 2 })).toBe('512 MB');
    expect(formatWidgetValue(t, 'en', { kind: 'growth', value: -1.5 * GiB })).toBe('−1.5 GB');
    expect(formatWidgetValue(t, 'en', { kind: 'growth', value: 0 })).toBe('0 Bytes');
    expect(formatWidgetValue(t, 'en', { kind: 'backup_count', value: 1200 })).toBe('1,200');
    expect(formatWidgetValue(t, 'en', { kind: 'last_backup', value: null })).toBe('DASHBOARD_WIDGET_NEVER');
    expect(formatWidgetValue(t, 'en', { kind: 'size', value: null })).toBe('—');
  });

  it('formats relative times coarsely', () => {
    expect(formatRelativeTime(1_000_000, 'en', 1_000_000)).toBe('now');
    expect(formatRelativeTime(0, 'en', 2 * 60 * 60 * 1000)).toBe('2 hours ago');
    expect(formatRelativeTime(0, 'en', 24 * 60 * 60 * 1000)).toBe('yesterday');
  });

  it('scales chart points into the drawing box', () => {
    expect(
      getChartPoints([
        { t: 0, value: 0 },
        { t: 10, value: 5 },
        { t: 20, value: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 80 },
      { x: 150, y: 40 },
      { x: 300, y: 0 },
    ]);
    expect(getChartPoints([{ t: 5, value: 5 }])).toEqual([{ x: 150, y: 40 }]);
  });
});
