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
