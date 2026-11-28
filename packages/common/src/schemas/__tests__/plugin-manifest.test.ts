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

describe('pluginManifestSchema app_settings', () => {
  const tailscale = {
    ...validManifest,
    settings: {
      global: [{ type: 'text', label: 'Network', env_variable: 'NETWORK_NAME', default: 'tailscale' }],
      per_app: [
        { type: 'boolean', label: 'Enabled', env_variable: 'ENABLED' },
        { type: 'text', label: 'Hostname', env_variable: 'HOSTNAME', visible_when: 'ENABLED' },
      ],
    },
    app_settings: {
      title: 'Tailscale',
      compose_patches: [
        { op: 'add_network', when: 'ENABLED', network: '{{plugin.NETWORK_NAME}}', aliases: ['{{ app.HOSTNAME }}'] },
        { op: 'add_labels', when: 'ENABLED', labels: { 'ts.name': '{{RUNTIPI_APP_ID}}' } },
      ],
    },
  };

  const parse = (manifest: unknown) => {
    const result = pluginManifestSchema(manifest);
    if (result instanceof type.errors) throw new Error(result.summary);
    return result;
  };

  it('accepts a section with compose patches and applies defaults', () => {
    const result = parse(tailscale);

    expect(result.app_settings).toMatchObject({
      title: 'Tailscale',
      description: '',
      applies_to: { exclude_network_mode: true, services: 'all' },
    });
    expect(result.app_settings?.compose_patches).toHaveLength(2);
    expect(result.settings.per_app[1]?.visible_when).toBe('ENABLED');
  });

  it('defaults compose_patches to an empty list', () => {
    expect(parse({ ...tailscale, app_settings: {} }).app_settings?.compose_patches).toEqual([]);
  });

  const withPatch = (patch: Record<string, unknown>) => ({ ...tailscale, app_settings: { compose_patches: [patch] } });

  it.each([
    ['an unknown patch op', withPatch({ op: 'run_script', when: 'ENABLED', script: 'rm -rf /' })],
    ['a patch without when', withPatch({ op: 'add_network', network: 'tailscale' })],
    ['a when that is not a per-app setting', withPatch({ op: 'add_network', when: 'NOPE', network: 'tailscale' })],
    ['a when that is not a boolean', withPatch({ op: 'add_network', when: 'HOSTNAME', network: 'tailscale' })],
    ['an unknown template scope', withPatch({ op: 'add_network', when: 'ENABLED', network: '{{env.HOME}}' })],
    ['an undeclared global template', withPatch({ op: 'add_network', when: 'ENABLED', network: '{{plugin.MISSING}}' })],
    ['an undeclared app template', withPatch({ op: 'add_labels', when: 'ENABLED', labels: { a: '{{app.MISSING}}' } })],
    ['a template in a label key', withPatch({ op: 'add_labels', when: 'ENABLED', labels: { '{{app.NOPE}}': 'x' } })],
    ['an unknown patch key', withPatch({ op: 'add_network', when: 'ENABLED', network: 'x', driver: 'host' })],
    ['an unknown app_settings key', { ...tailscale, app_settings: { hooks: [] } }],
    ['an unknown applies_to value', { ...tailscale, app_settings: { applies_to: { services: 'some' } } }],
    ['app_settings without the compose capability', { ...tailscale, capabilities: ['dashboard-widget'] }],
    [
      'a visible_when that is not a boolean',
      { ...tailscale, settings: { ...tailscale.settings, per_app: [{ type: 'text', label: 'A', env_variable: 'A', visible_when: 'A' }] } },
    ],
  ])('rejects %s', (_, manifest) => {
    expect(pluginManifestSchema(manifest)).toBeInstanceOf(type.errors);
  });
});
