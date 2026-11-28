import { describe, expect, it } from 'vitest';
import { type } from 'arktype';
import { pluginManifestSchema } from '../plugin-manifest.js';

const validManifest = {
  id: 'my-plugin',
  urn: 'my-plugin:store',
  name: 'My plugin',
  version: '1.0.0',
  tipi_version: 1,
  short_desc: 'A plugin',
  author: 'someone',
  source: 'https://example.com',
  capabilities: ['compose'],
};

describe('pluginManifestSchema', () => {
  it('accepts a minimal manifest and applies defaults', () => {
    const result = pluginManifestSchema(validManifest);

    if (result instanceof type.errors) throw new Error(result.summary);
    expect(result).toMatchObject({
      available: true,
      deprecated: false,
      description: '',
      settings: { global: [], per_app: [] },
    });
  });

  it('accepts global and per-app settings in form field format', () => {
    const result = pluginManifestSchema({
      ...validManifest,
      min_tipi_version: '4.2.0',
      capabilities: ['compose', 'dashboard-widget'],
      settings: {
        global: [{ type: 'text', label: 'Token', env_variable: 'TOKEN', required: true }],
        per_app: [{ type: 'boolean', label: 'Enabled', env_variable: 'ENABLED' }],
      },
    });

    if (result instanceof type.errors) throw new Error(result.summary);
    expect(result.settings.global[0]?.required).toBe(true);
    expect(result.settings.per_app[0]?.required).toBe(false);
  });

  it.each([
    ['an unknown capability', { capabilities: ['run-code'] }],
    ['no capabilities', { capabilities: [] }],
    ['duplicate capabilities', { capabilities: ['compose', 'compose'] }],
    ['an invalid min_tipi_version', { min_tipi_version: 'latest' }],
    ['an id with a colon', { id: 'a:b' }],
    ['an id with path characters', { id: '../evil' }],
    ['an id with uppercase letters', { id: 'MyPlugin' }],
    ['an unknown key', { entrypoint: 'index.js' }],
    ['an unknown settings key', { settings: { global: [], hooks: [] } }],
    ['a missing tipi_version', { tipi_version: undefined }],
  ])('rejects %s', (_, override) => {
    const manifest: Record<string, unknown> = { ...validManifest, ...override };
    for (const key of Object.keys(manifest)) if (manifest[key] === undefined) delete manifest[key];

    expect(pluginManifestSchema(manifest)).toBeInstanceOf(type.errors);
  });
});

describe('pluginManifestSchema widgets', () => {
  const widgetManifest = { ...validManifest, capabilities: ['dashboard-widget'] };

  it('defaults to no widgets', () => {
    const result = pluginManifestSchema(validManifest);

    if (result instanceof type.errors) throw new Error(result.summary);
    expect(result.widgets).toEqual([]);
  });

  it('accepts widgets bound to a data source and applies option defaults', () => {
    const result = pluginManifestSchema({
      ...widgetManifest,
      widgets: [
        { id: 'backup-status', title: 'Backup status', type: 'list', source: 'app-backups' },
        {
          id: 'resources',
          title: 'Resource usage',
          type: 'list',
          source: 'app-resources',
          refresh_seconds: 30,
          options: { metric: 'cpu', limit: 5 },
        },
        { id: 'storage', title: 'Storage growth', type: 'timeseries', source: 'app-storage', options: { period: '30d' } },
      ],
    });

    if (result instanceof type.errors) throw new Error(result.summary);
    expect(result.widgets[0]?.options).toEqual({ limit: 10 });
    expect(result.widgets[1]?.options).toEqual({ metric: 'cpu', limit: 5 });
    expect(result.widgets[2]?.options).toEqual({ period: '30d', limit: 10 });
  });

  const widget = { id: 'w', title: 'Widget', type: 'list', source: 'app-backups' };

  it.each([
    ['widgets without the dashboard-widget capability', { capabilities: ['compose'], widgets: [widget] }],
    ['duplicate widget ids', { widgets: [widget, widget] }],
    ['an unknown widget type', { widgets: [{ ...widget, type: 'chart' }] }],
    ['an unknown data source', { widgets: [{ ...widget, source: 'plugin-container' }] }],
    ['a type the source cannot produce', { widgets: [{ ...widget, type: 'timeseries' }] }],
    ['a metric on a source other than app-resources', { widgets: [{ ...widget, options: { metric: 'cpu' } }] }],
    ['a period on a source other than app-storage', { widgets: [{ ...widget, options: { period: '7d' } }] }],
    ['an unknown widget key', { widgets: [{ ...widget, script: 'index.js' }] }],
    ['an unknown option', { widgets: [{ ...widget, options: { query: 'select 1' } }] }],
    ['a list limit above 50', { widgets: [{ ...widget, options: { limit: 51 } }] }],
    ['a refresh interval below 5 seconds', { widgets: [{ ...widget, refresh_seconds: 1 }] }],
    ['an invalid widget id', { widgets: [{ ...widget, id: 'My Widget' }] }],
  ])('rejects %s', (_, override) => {
    expect(pluginManifestSchema({ ...widgetManifest, ...override })).toBeInstanceOf(type.errors);
  });
});
