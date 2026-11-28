import type { ComposePatch, DynamicComposeSchemaYaml, PluginAppSettings, PluginAppliesTo } from '@runtipi/common/schemas';

export type PluginConfigValues = Record<string, string | number | boolean>;

/** A plugin whose patches apply to the Compose file of one app. */
export type ComposePlugin = {
  urn: string;
  appSettings: Pick<PluginAppSettings, 'applies_to' | 'compose_patches'>;
  globalConfig: PluginConfigValues;
  appConfig: PluginConfigValues;
};

type SourceService = DynamicComposeSchemaYaml['services'][string] | undefined;
type OutputService = {
  networks?: Record<string, unknown>;
  labels?: Record<string, string | number | boolean>;
};
/** A generated Compose file: services already went through the builder, so networks and labels are records. */
export type PatchableCompose = {
  services: Record<string, OutputService | undefined>;
  networks?: Record<string, unknown>;
};

// Docker network names and aliases.
const DOCKER_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const TEMPLATE_REGEX = /\{\{\s*([^}]*?)\s*\}\}/g;
const PROTECTED_LABEL_PREFIXES = ['runtipi.', 'traefik.'];

/**
 * Whether a plugin section applies to a service of an app.
 */
export const isServiceApplicable = (service: SourceService, filter: PluginAppliesTo) => {
  if (!service) return false;
  if (filter.exclude_network_mode && service.network_mode !== undefined) return false;
  if (filter.services === 'main' && !service['x-runtipi']?.is_main) return false;

  return true;
};

/**
 * Names of the services of an app a plugin section applies to.
 */
export const getApplicableServices = (compose: Pick<DynamicComposeSchemaYaml, 'services'>, filter: PluginAppliesTo) =>
  Object.entries(compose.services)
    .filter(([, service]) => isServiceApplicable(service, filter))
    .map(([name]) => name);

type TemplateContext = { plugin: PluginConfigValues; app: PluginConfigValues; appId: string };

/**
 * Replace `{{plugin.X}}`, `{{app.X}}` and `{{RUNTIPI_APP_ID}}` in a string. Unknown or missing values render as an empty string.
 */
export const renderTemplate = (value: string, context: TemplateContext) =>
  value.replace(TEMPLATE_REGEX, (_, reference: string) => {
    if (reference === 'RUNTIPI_APP_ID') return context.appId;

    const [scope, key = ''] = reference.split(/\.(.*)/s);
    const values = scope === 'plugin' ? context.plugin : scope === 'app' ? context.app : undefined;
    const resolved = values && Object.hasOwn(values, key) ? values[key] : undefined;

    return resolved === undefined ? '' : String(resolved);
  });

/** Compose key of the external network a plugin attaches services to. */
const networkKey = (name: string) => `plugin_${name}`;

type PatchContext = {
  compose: PatchableCompose;
  serviceNames: string[];
  template: TemplateContext;
  warn: (message: string) => void;
  pluginUrn: string;
};

const applyAddNetwork = (patch: Extract<ComposePatch, { op: 'add_network' }>, context: PatchContext, sources: Record<string, SourceService>) => {
  const { compose, template, warn, pluginUrn } = context;
  const name = renderTemplate(patch.network, template);

  if (!DOCKER_NAME_REGEX.test(name)) {
    warn(`Plugin ${pluginUrn}: skipped add_network, "${name}" is not a valid Docker network name`);
    return;
  }

  const key = networkKey(name);
  const declared = { name, external: true };
  const existing = compose.networks?.[key] as { name?: string; external?: boolean } | undefined;

  if (existing && (existing.name !== name || existing.external !== true)) {
    warn(`Plugin ${pluginUrn}: skipped add_network, the app already declares a network called ${key}`);
    return;
  }

  const aliases = (patch.aliases ?? [])
    .map((alias) => renderTemplate(alias, template))
    .filter((alias) => {
      if (DOCKER_NAME_REGEX.test(alias)) return true;
      if (alias !== '') warn(`Plugin ${pluginUrn}: skipped the network alias "${alias}", it is not a valid name`);
      return false;
    });

  // Services sharing the network namespace of another container cannot join networks.
  const targets = context.serviceNames.filter((serviceName) => sources[serviceName]?.network_mode === undefined);
  if (targets.length === 0) return;

  for (const serviceName of targets) {
    const service = compose.services[serviceName];
    if (!service) continue;

    service.networks = service.networks ?? {};
    const current = (service.networks[key] ?? {}) as { aliases?: string[] };
    const merged = [...new Set([...(current.aliases ?? []), ...aliases])];
    service.networks[key] = merged.length > 0 ? { ...current, aliases: merged } : current;
  }

  compose.networks = compose.networks ?? {};
  compose.networks[key] = declared;
};

const applyAddLabels = (patch: Extract<ComposePatch, { op: 'add_labels' }>, context: PatchContext) => {
  const { compose, template, warn, pluginUrn } = context;
  const labels: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(patch.labels)) {
    const key = renderTemplate(rawKey, template);

    if (!key || PROTECTED_LABEL_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      warn(`Plugin ${pluginUrn}: skipped the label "${key}", it is empty or reserved by Runtipi`);
      continue;
    }

    labels[key] = renderTemplate(rawValue, template);
  }

  for (const serviceName of context.serviceNames) {
    const service = compose.services[serviceName];
    if (!service) continue;

    // Labels set by the app or by Runtipi win over plugin labels.
    service.labels = { ...labels, ...service.labels };
  }
};

/**
 * Apply the Compose patches of the plugins enabled for an app to a generated Compose file.
 *
 * @param sources - the services before Runtipi built them, used for the applicability filter (`x-runtipi`, `network_mode`)
 * @param compose - the generated Compose file, changed in place
 */
export const applyPluginPatches = (params: {
  sources: Record<string, SourceService>;
  compose: PatchableCompose;
  plugins: ComposePlugin[];
  appId: string;
  warn?: (message: string) => void;
}) => {
  const { sources, compose, plugins, appId, warn = () => {} } = params;

  for (const plugin of plugins) {
    const serviceNames = getApplicableServices({ services: sources as DynamicComposeSchemaYaml['services'] }, plugin.appSettings.applies_to);
    if (serviceNames.length === 0) continue;

    const context: PatchContext = {
      compose,
      serviceNames,
      template: { plugin: plugin.globalConfig, app: plugin.appConfig, appId },
      warn,
      pluginUrn: plugin.urn,
    };

    for (const patch of plugin.appSettings.compose_patches) {
      if (plugin.appConfig[patch.when] !== true) continue;

      if (patch.op === 'add_network') {
        applyAddNetwork(patch, context, sources);
      } else {
        applyAddLabels(patch, context);
      }
    }
  }
};
