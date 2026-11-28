import { PLUGIN_CAPABILITIES, pluginManifestObjectSchema } from '@runtipi/common/schemas';
import { type } from 'arktype';
import { createArkDto } from 'nestjs-arktype';

const pluginConfigSchema = type({ '[string]': 'string | number | boolean' });

const searchPluginsQuerySchema = type({
  search: 'string?',
  pageSize: type('number.integer | string.integer.parse').to('number > 0').optional(),
  cursor: 'string?',
  capability: type.enumerated(...PLUGIN_CAPABILITIES).optional(),
  storeId: 'string?',
});

const pluginCompatibilitySchema = type({
  compatible: 'boolean',
  minTipiVersion: type('string').or('null'),
  reason: type("'min_tipi_version' | 'unavailable' | 'deprecated'").or('null'),
});

const catalogPluginSchema = pluginManifestObjectSchema.merge({ installed: 'boolean', compatibility: pluginCompatibilitySchema });

const searchPluginsResponseSchema = type({
  data: catalogPluginSchema.array(),
  nextCursor: type('string').or('null').optional(),
  total: 'number',
});

const installedPluginSchema = type({
  id: 'number',
  urn: 'string',
  pluginId: 'string',
  pluginStoreSlug: 'string',
  installedVersion: 'string',
  tipiVersion: 'number',
  enabled: 'boolean',
  globalConfig: pluginConfigSchema,
  createdAt: 'number',
  updatedAt: 'number',
  info: pluginManifestObjectSchema.or('null'),
  latestVersion: type('string').or('null'),
  latestTipiVersion: type('number').or('null'),
  updateAvailable: 'boolean',
});

const pluginDetailsSchema = type({
  info: pluginManifestObjectSchema,
  compatibility: pluginCompatibilitySchema,
  installed: installedPluginSchema.or('null'),
  updateAvailable: 'boolean',
});

const installedPluginsSchema = type({
  plugins: installedPluginSchema.array(),
});

const installPluginBodySchema = type({
  globalConfig: pluginConfigSchema.optional(),
});

const updatePluginConfigBodySchema = type({
  globalConfig: pluginConfigSchema,
});

const successSchema = type({ success: 'boolean' });

export class SearchPluginsQueryDto extends createArkDto(searchPluginsQuerySchema, { name: 'SearchPluginsQueryDto', input: true }) {}
export class SearchPluginsDto extends createArkDto(searchPluginsResponseSchema, { name: 'SearchPluginsDto' }) {}
export class PluginDetailsDto extends createArkDto(pluginDetailsSchema, { name: 'PluginDetailsDto' }) {}
export class InstalledPluginDto extends createArkDto(installedPluginSchema, { name: 'InstalledPluginDto' }) {}
export class InstalledPluginsDto extends createArkDto(installedPluginsSchema, { name: 'InstalledPluginsDto' }) {}
export class InstallPluginBodyDto extends createArkDto(installPluginBodySchema, { name: 'InstallPluginBodyDto', input: true }) {}
export class UpdatePluginBodyDto extends createArkDto(installPluginBodySchema, { name: 'UpdatePluginBodyDto', input: true }) {}
export class UpdatePluginConfigBodyDto extends createArkDto(updatePluginConfigBodySchema, { name: 'UpdatePluginConfigBodyDto', input: true }) {}
export class PluginSuccessDto extends createArkDto(successSchema, { name: 'PluginSuccessDto' }) {}
