import { type } from 'arktype';
import { arkAppUrn } from '../types/app-urn.js';
import { formFieldSchema } from './app-info.js';

export const PLUGIN_CAPABILITIES = ['compose', 'backup-backend', 'dashboard-widget'] as const;
export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

// Loose semver check (major.minor.patch with optional pre-release / build metadata).
const SEMVER_REGEX = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * A per-app plugin setting: a regular form field that can be shown only while a boolean per-app setting is on.
 * Hidden fields are neither validated nor stored.
 */
export const pluginAppFieldSchema = formFieldSchema.merge({
  /** `env_variable` of a boolean per-app field that has to be on for this field to show. */
  'visible_when?': 'string > 0',
});

export const pluginSettingsSchema = type({
  '+': 'reject',
  global: formFieldSchema.array().default(() => []),
  per_app: pluginAppFieldSchema.array().default(() => []),
});

/** Which services of an app a plugin section applies to, and which services its patches change. */
export const pluginAppliesToSchema = type({
  '+': 'reject',
  /** Skip services that use `network_mode`, they cannot join networks. */
  exclude_network_mode: 'boolean = true',
  /** `main` targets the service marked `is_main`, `all` targets every service. */
  services: "'main' | 'all' = 'all'",
});

const patchBase = {
  '+': 'reject',
  /** `env_variable` of a boolean per-app field. The patch only applies while it is on. */
  when: 'string > 0',
} as const;

/** Attach the targeted services to an existing external Docker network. */
export const addNetworkPatchSchema = type({
  ...patchBase,
  op: "'add_network'",
  /** Name of the existing Docker network. Templates are allowed. */
  network: 'string > 0',
  aliases: type('string > 0').array().optional(),
});

/** Add labels to the targeted services. Runtipi and Traefik labels cannot be overwritten. */
export const addLabelsPatchSchema = type({
  ...patchBase,
  op: "'add_labels'",
  labels: type({ '[string]': 'string' }),
});

/**
 * A declarative change to the generated Compose file. Strings can use `{{plugin.<global setting>}}`,
 * `{{app.<per-app setting>}}` and `{{RUNTIPI_APP_ID}}`. No code is ever run.
 */
export const composePatchSchema = type.or(addNetworkPatchSchema, addLabelsPatchSchema);

/** A section a plugin adds to the settings of every applicable app. Its fields are `settings.per_app`. */
export const pluginAppSettingsSchema = type({
  '+': 'reject',
  /** Section heading, defaults to the plugin name. */
  'title?': 'string > 0',
  description: 'string = ""',
  applies_to: pluginAppliesToSchema.default(() => ({ exclude_network_mode: true, services: 'all' as const })),
  compose_patches: composePatchSchema.array().default(() => []),
});

/** Shape of `plugin.json`, without the checks between its parts. Use `pluginManifestSchema` to parse a manifest. */
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
  app_settings: pluginAppSettingsSchema.optional(),
});

const TEMPLATE_REGEX = /\{\{\s*([^}]*?)\s*\}\}/g;

/** Every `{{...}}` reference used in a string. */
export const getTemplateReferences = (value: string) => [...value.matchAll(TEMPLATE_REGEX)].map((match) => match[1] ?? '');

const patchStrings = (patch: ComposePatch) =>
  patch.op === 'add_network' ? [patch.network, ...(patch.aliases ?? [])] : Object.entries(patch.labels).flat();

/**
 * Problems in the references between the parts of a manifest (template variables, `when` and `visible_when`).
 * The object schema cannot express these.
 */
export const getManifestReferenceErrors = (manifest: typeof pluginManifestObjectSchema.infer) => {
  const errors: string[] = [];
  const globalKeys = new Set(manifest.settings.global.map((field) => field.env_variable));
  const appFields = new Map(manifest.settings.per_app.map((field) => [field.env_variable, field]));
  const isBooleanAppField = (key: string) => appFields.get(key)?.type === 'boolean';

  for (const field of manifest.settings.per_app) {
    if (field.visible_when !== undefined && (field.visible_when === field.env_variable || !isBooleanAppField(field.visible_when))) {
      errors.push(`visible_when of ${field.env_variable} must name another boolean per-app setting`);
    }
  }

  if (!manifest.app_settings) return errors;

  if (!manifest.capabilities.includes('compose')) {
    errors.push('app_settings requires the compose capability');
  }

  for (const [index, patch] of manifest.app_settings.compose_patches.entries()) {
    if (!isBooleanAppField(patch.when)) {
      errors.push(`compose_patches[${index}].when must name a boolean per-app setting`);
    }

    for (const reference of patchStrings(patch).flatMap(getTemplateReferences)) {
      const [scope, key = ''] = reference.split(/\.(.*)/s);
      const known = reference === 'RUNTIPI_APP_ID' || (scope === 'plugin' && globalKeys.has(key)) || (scope === 'app' && appFields.has(key));

      if (!known) errors.push(`compose_patches[${index}] uses an unknown template {{${reference}}}`);
    }
  }

  return errors;
};

/**
 * Schema of `plugins/<id>/plugin.json` in an app store repository.
 *
 * Plugins are declarative only: the manifest can describe settings and capabilities, but no code
 * is ever loaded from a plugin. Unknown keys are rejected so a plugin cannot ship behaviour that
 * Runtipi does not support yet.
 */
export const pluginManifestSchema = pluginManifestObjectSchema.narrow((manifest, ctx) => {
  const errors = getManifestReferenceErrors(manifest);
  return errors.length === 0 ? true : ctx.reject({ expected: 'a manifest with valid references', actual: errors.join('; ') });
});

export type PluginManifestInput = typeof pluginManifestSchema.inferIn;
export type PluginManifest = typeof pluginManifestSchema.infer;
export type PluginSettings = typeof pluginSettingsSchema.infer;
export type PluginAppField = typeof pluginAppFieldSchema.infer;
export type PluginAppSettings = typeof pluginAppSettingsSchema.infer;
export type PluginAppliesTo = typeof pluginAppliesToSchema.infer;
export type ComposePatch = typeof composePatchSchema.infer;
