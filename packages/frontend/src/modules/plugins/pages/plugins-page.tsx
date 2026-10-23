import { useAppContext } from '@/context/app-context';
import { IconCheck, IconDownload, IconPlug, IconSearch, IconShieldCheck } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { pluginKey, updatePlugin, usePlugins } from '../plugins-api';
import { pluginViews } from '../plugin-widgets';
import './plugins-page.css';

export default () => {
  const { data: plugins = [], isPending, isError, refetch } = usePlugins();
  const { user } = useAppContext();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('discover');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: updatePlugin,
    onSuccess: (data) => queryClient.setQueryData(pluginKey(user.id), data),
  });
  const installed = plugins.filter((plugin) => plugin.installed);
  const visible = plugins.filter(
    (plugin) =>
      (tab === 'discover' || plugin.installed) &&
      `${plugin.name} ${plugin.description} ${plugin.category}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="plugins-page">
      <section className="card plugins-intro mb-4">
        <div className="card-body p-4 p-md-5 d-flex align-items-center gap-4">
          <div className="plugins-hero-icon d-none d-sm-flex">
            <IconPlug size={44} stroke={1.4} />
          </div>
          <div>
            <div className="subheader text-primary mb-2">A little extra power</div>
            <h2 className="mb-2">Make Runtipi your own.</h2>
            <p className="text-secondary mb-0 plugins-lead">
              Plugins connect directly to your Runtipi instance, bringing useful tools and insights into one place.
            </p>
          </div>
        </div>
        <div className="card-footer d-flex flex-wrap gap-4">
          <span>
            <strong>{installed.length}</strong> installed
          </span>
          <span>
            <strong>{installed.filter((plugin) => plugin.enabled).length}</strong> active
          </span>
          <span className="text-secondary ms-sm-auto d-flex align-items-center gap-2">
            <IconShieldCheck size={17} /> Built-in plugins by Runtipi
          </span>
        </div>
      </section>
      <div className="d-flex flex-column flex-md-row justify-content-between gap-3 mb-4">
        <fieldset className="btn-group border-0 m-0 p-0" aria-label="Plugin filter">
          {(
            [
              ['discover', 'Discover'],
              ['installed', `Installed (${installed.length})`],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={`btn ${tab === value ? 'btn-primary' : 'btn-outline-secondary'}`}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </fieldset>
        <div className="input-icon plugins-search">
          <span className="input-icon-addon">
            <IconSearch size={18} />
          </span>
          <input
            type="search"
            className="form-control"
            aria-label="Search plugins"
            placeholder="Search plugins…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {mutation.isError && (
        <div role="alert" className="alert alert-danger">
          Could not update the plugin. Refresh to check its status, or try again.
        </div>
      )}
      {isPending ? (
        <div className="card card-body text-secondary" role="status">
          Loading plugins…
        </div>
      ) : isError ? (
        <div className="alert alert-danger" role="alert">
          Could not load plugins.{' '}
          <button type="button" className="btn btn-sm" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="d-flex justify-content-between mb-3">
            <h3 className="mb-0">{tab === 'discover' ? 'Explore plugins' : 'Your collection'}</h3>
            <span className="text-secondary">{visible.length} plugins</span>
          </div>
          <div className="row g-4">
            {visible.map((plugin) => {
              const view = pluginViews[plugin.id as keyof typeof pluginViews];
              const Icon = view?.icon ?? IconPlug;
              const Widget = view?.component;
              const pending = mutation.isPending;
              return (
                <div className="col-12 col-lg-6" key={plugin.id}>
                  <article className="card h-100 plugin-card">
                    <div className="card-body p-4">
                      <div className="d-flex justify-content-between align-items-start mb-4">
                        <div className={`plugin-icon plugin-icon-${plugin.id}`}>
                          <Icon size={30} stroke={1.5} />
                        </div>
                        <span className={`badge ${plugin.installed ? (plugin.enabled ? 'bg-green-lt' : 'bg-secondary-lt') : 'bg-blue-lt'}`}>
                          {plugin.installed ? (plugin.enabled ? 'Active' : 'Disabled') : plugin.category}
                        </span>
                      </div>
                      <h3 className="mb-1">{plugin.name}</h3>
                      <div className="text-secondary small mb-3 d-flex align-items-center gap-1">
                        Runtipi <IconCheck size={14} className="text-primary" /> <span className="ms-2">v{plugin.version}</span>
                      </div>
                      <p className="text-secondary plugin-description">{plugin.description}</p>
                      <div className="small text-secondary d-flex gap-2 align-items-center">
                        <IconShieldCheck size={17} />
                        {plugin.permission}
                      </div>
                    </div>
                    <div className="card-footer d-flex flex-wrap align-items-center gap-2">
                      {plugin.installed ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            disabled={pending}
                            onClick={() => mutation.mutate({ id: plugin.id, action: plugin.enabled ? 'disable' : 'enable' })}
                          >
                            {plugin.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost-danger btn-sm"
                            disabled={pending}
                            onClick={() => mutation.mutate({ id: plugin.id, action: 'uninstall' })}
                          >
                            Uninstall
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm gap-2"
                          disabled={pending}
                          onClick={() => mutation.mutate({ id: plugin.id, action: 'install' })}
                        >
                          <IconDownload size={16} />
                          {pending && mutation.variables.id === plugin.id ? 'Installing…' : 'Install plugin'}
                        </button>
                      )}
                      {plugin.installed && plugin.enabled && Widget && (
                        <button
                          type="button"
                          className="btn btn-ghost-primary btn-sm ms-auto"
                          aria-expanded={expanded === plugin.id}
                          onClick={() => setExpanded(expanded === plugin.id ? null : plugin.id)}
                        >
                          {expanded === plugin.id ? 'Hide insights' : 'Open plugin'}
                        </button>
                      )}
                    </div>
                    {expanded === plugin.id && plugin.installed && plugin.enabled && Widget && (
                      <div className="card-body border-top">
                        <Widget />
                      </div>
                    )}
                  </article>
                </div>
              );
            })}
          </div>
          {visible.length === 0 && (
            <div className="card card-body text-center p-5">
              <IconPlug className="mx-auto text-secondary mb-3" size={36} />
              <h3>{search ? 'No plugins found' : 'Your next upgrade starts here'}</h3>
              <p className="text-secondary">{search ? 'Try another name or category.' : 'Install a plugin to add new insights to your dashboard.'}</p>
              <button
                type="button"
                className="btn btn-primary align-self-center"
                onClick={() => {
                  setSearch('');
                  setTab('discover');
                }}
              >
                Explore plugins
              </button>
            </div>
          )}
        </>
      )}
      <div className="text-secondary small text-center mt-4 mb-3">
        Enabled plugins appear on your <Link to="/dashboard">dashboard</Link>. Plugin preferences are saved to your account.
      </div>
    </div>
  );
};
