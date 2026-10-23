import { getInstalledAppsOptions, systemLoadOptions } from '@/api-client/@tanstack/react-query.gen';
import { useAppContext } from '@/context/app-context';
import { IconActivity, IconArrowUpRight, IconChartBar } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { usePlugins } from './plugins-api';

export const SystemInsights = () => {
  const { data, isError } = useQuery({ ...systemLoadOptions(), refetchInterval: 5000 });
  if (!data)
    return (
      <p className="text-secondary mb-0" role="status">
        {isError ? 'System metrics are unavailable. Retrying…' : 'Reading system metrics…'}
      </p>
    );
  const metrics = [
    { label: 'CPU', value: data.cpuLoad },
    { label: 'Memory', value: data.percentUsedMemory },
    { label: 'Storage', value: data.percentUsed },
  ];
  const busiest = metrics.reduce((current, metric) => (metric.value > current.value ? metric : current));
  return (
    <div className="d-flex flex-column gap-3">
      <div className={`rounded p-3 ${busiest.value >= 85 ? 'bg-yellow-lt' : 'bg-green-lt'}`}>
        <strong>{busiest.value >= 85 ? `${busiest.label} usage is high` : 'Room to grow'}</strong>
        <div className="small mt-1">
          {busiest.value >= 85
            ? 'Consider freeing resources or reviewing running apps.'
            : `${busiest.label} is your busiest resource at ${busiest.value.toFixed(1)}%.`}
        </div>
      </div>
      {isError && (
        <div className="text-warning" role="status">
          Connection interrupted. Showing last received metrics.
        </div>
      )}
      {metrics.map(({ label, value }) => (
        <div key={label}>
          <div className="d-flex justify-content-between mb-1">
            <span>{label}</span>
            <strong>{value.toFixed(1)}%</strong>
          </div>
          <div className="progress progress-sm" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
            <div className={`progress-bar ${value >= 85 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
          </div>
        </div>
      ))}
      <small className="text-secondary">
        Updates every 5 seconds · {data.diskSize - data.diskUsed > 0 ? (data.diskSize - data.diskUsed).toFixed(1) : 0} GB storage available
      </small>
    </div>
  );
};

export const AppHealth = () => {
  const { data, isError } = useQuery({ ...getInstalledAppsOptions(), refetchInterval: 10000 });
  const { updatesAvailable } = useAppContext();
  if (!data)
    return (
      <p className="text-secondary mb-0" role="status">
        {isError ? 'App status is unavailable. Retrying…' : 'Checking your apps…'}
      </p>
    );
  const running = data.installed.filter(({ app }) => app.status === 'running').length;
  const stopped = data.installed.filter(({ app }) => app.status === 'stopped').length;
  return (
    <>
      {isError && (
        <div className="text-warning mb-2" role="status">
          Connection interrupted. Showing last received status.
        </div>
      )}
      <div className="row text-center mb-3">
        {[
          ['Running', running],
          ['Stopped', stopped],
          ['Updates', updatesAvailable],
        ].map(([label, value]) => (
          <div className="col" key={label}>
            <div className="h1 mb-1">{value}</div>
            <small className="text-secondary">{label}</small>
          </div>
        ))}
      </div>
      <p className="text-secondary">
        {data.installed.length === 0
          ? 'Install your first app to start monitoring its status.'
          : `${data.installed.length} installed apps · ${data.installed.length - running - stopped} in other states`}
      </p>
      <Link to="/apps" className="d-inline-flex align-items-center gap-1">
        Manage apps <IconArrowUpRight size={16} />
      </Link>
    </>
  );
};

export const pluginViews: Partial<Record<string, { icon: typeof IconChartBar; component: typeof SystemInsights }>> = {
  'system-insights': { icon: IconChartBar, component: SystemInsights },
  'app-health': { icon: IconActivity, component: AppHealth },
};

export const PluginWidgets = () => {
  const { data } = usePlugins();
  const active = data?.filter((plugin) => plugin.installed && plugin.enabled) ?? [];
  if (!active.length) return null;
  return (
    <div className="mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3 className="mb-0">Your plugins</h3>
        <Link to="/plugins">Manage plugins</Link>
      </div>
      <div className="row g-3">
        {active.map((plugin) => {
          const view = pluginViews[plugin.id as keyof typeof pluginViews];
          if (!view) return null;
          const Widget = view.component;
          return (
            <div className="col-12 col-lg-6" key={plugin.id}>
              <section className="card h-100">
                <div className="card-header gap-2">
                  <view.icon size={20} />
                  <h3 className="card-title">{plugin.name}</h3>
                </div>
                <div className="card-body">
                  <Widget />
                </div>
              </section>
            </div>
          );
        })}
      </div>
    </div>
  );
};
