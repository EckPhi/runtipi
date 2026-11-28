import { type } from 'arktype';
import { arkAppUrn } from '../types/app-urn.js';
import { formFieldSchema } from './app-info.js';
import { pluginWidgetSchema } from './plugin-widget.js';

export const PLUGIN_CAPABILITIES = ['compose', 'backup-backend', 'dashboard-widget'] as const;
export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

// Loose semver check (major.minor.patch with optional pre-release / build metadata).
const SEMVER_REGEX = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const pluginSettingsSchema = type({
  '+': 'reject',
  global: formFieldSchema.array().default(() => []),
  per_app: formFieldSchema.array().default(() => []),
});

/**
 * Shape of `plugins/<id>/plugin.json` in an app store repository, without the checks across fields. Use it to build
 * API schemas (`merge` does not accept a narrowed type) and `pluginManifestSchema` to validate a manifest.
 *
 * Plugins are declarative only: the manifest can describe settings and capabilities, but no code
 * is ever loaded from a plugin. Unknown keys are rejected so a plugin cannot ship behaviour that
 * Runtipi does not support yet.
 */
export const pluginManifestObjectSchema = type({
  '+': 'reject',
  id: type('string')
    .atLeastLength(1)
    .narrow((v, ctx) => (/^[a-z0-9][a-z0-9-]*$/.test(v) ? true : ctx.mustBe('lowercase letters, digits and hyphens only'))),
  urn: arkAppUrn,
  name: 'string > 0',
  version: 'string > 0',
  tipi_version: 'number.integer >= 1',
  min_tipi_version: type('string')
    .narrow((v, ctx) => (SEMVER_REGEX.test(v) ? true : ctx.mustBe('a valid semver version')))
    .optional(),
  short_desc: 'string',
  description: 'string = ""',
  author: 'string',
  source: 'string',
  website: 'string?',
  available: 'boolean = true',
  deprecated: 'boolean = false',
  capabilities: type
    .enumerated(...PLUGIN_CAPABILITIES)
    .array()
    .atLeastLength(1)
    .narrow((v, ctx) => (new Set(v).size === v.length ? true : ctx.mustBe('a list without duplicates'))),
  settings: pluginSettingsSchema.default(() => ({ global: [], per_app: [] })),
  /** Dashboard widgets, rendered by Runtipi from a fixed set of types and backend data sources. */
  widgets: pluginWidgetSchema.array().default(() => []),
});

/** Schema of `plugins/<id>/plugin.json`: the manifest shape plus the checks that span several fields. */
export const pluginManifestSchema = pluginManifestObjectSchema.narrow((manifest, ctx) => {
  if (manifest.widgets.length > 0 && !manifest.capabilities.includes('dashboard-widget')) {
    return ctx.reject({ path: ['widgets'], expected: 'declared only with the dashboard-widget capability', actual: 'widgets' });
  }

  const ids = manifest.widgets.map((widget) => widget.id);
  if (new Set(ids).size !== ids.length) {
    return ctx.reject({ path: ['widgets'], expected: 'widgets with unique ids', actual: ids.join(', ') });
  }

  return true;
});

export type PluginManifestInput = typeof pluginManifestSchema.inferIn;
export type PluginManifest = typeof pluginManifestSchema.infer;
export type PluginSettings = typeof pluginSettingsSchema.infer;
