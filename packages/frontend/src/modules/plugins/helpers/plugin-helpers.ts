import type { GetCatalogPluginResponse, SearchCatalogResponse } from '@/api-client';
import { IconBoxMultiple, IconDatabaseExport, IconLayoutDashboard } from '@tabler/icons-react';

export type CatalogPlugin = SearchCatalogResponse['data'][number];
export type PluginDetails = GetCatalogPluginResponse;
export type PluginInfo = PluginDetails['info'];
export type PluginCompatibility = PluginDetails['compatibility'];
export type PluginCapability = PluginInfo['capabilities'][number];
export type PluginConfigValues = Record<string, string | number | boolean>;

export const PLUGIN_CAPABILITIES: PluginCapability[] = ['compose', 'backup-backend', 'dashboard-widget'];

export const iconForCapability = {
  compose: IconBoxMultiple,
  'backup-backend': IconDatabaseExport,
  'dashboard-widget': IconLayoutDashboard,
} satisfies Record<PluginCapability, unknown>;

export const capabilityKey = (capability: PluginCapability) =>
  `PLUGIN_CAPABILITY_${capability.toUpperCase().replace('-', '_')}` as `PLUGIN_CAPABILITY_${Uppercase<string>}`;

/** Translation key and params explaining why a plugin cannot be installed, or null when it can. */
export const incompatibilityMessage = (compatibility: PluginCompatibility) => {
  switch (compatibility.reason) {
    case 'min_tipi_version':
      return { key: 'PLUGIN_INCOMPATIBLE_MIN_TIPI_VERSION', params: { version: compatibility.minTipiVersion ?? '' } } as const;
    case 'deprecated':
      return { key: 'PLUGIN_INCOMPATIBLE_DEPRECATED', params: {} } as const;
    case 'unavailable':
      return { key: 'PLUGIN_INCOMPATIBLE_UNAVAILABLE', params: {} } as const;
    default:
      return null;
  }
};

export const pluginPath = (urn: string) => {
  const [pluginId, storeId] = urn.split(':');
  return `/plugins/${storeId}/${pluginId}`;
};

/**
 * Form values come back as strings (text inputs) or booleans (switches). Convert them to what the plugin
 * declares so the backend validation accepts them, and drop empty optional values.
 */
export const normalizePluginConfig = (values: Record<string, unknown>, fields: PluginInfo['settings']['global']): PluginConfigValues => {
  const config: PluginConfigValues = {};

  for (const field of fields) {
    const value = values[field.env_variable];

    if (value === undefined || value === null || value === '') {
      continue;
    }

    if (field.type === 'number') {
      config[field.env_variable] = Number(value);
    } else if (field.type === 'boolean') {
      config[field.env_variable] = value === true || value === 'true';
    } else {
      config[field.env_variable] = String(value);
    }
  }

  return config;
};
