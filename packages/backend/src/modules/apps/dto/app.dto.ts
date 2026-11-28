import { APP_STATUS } from '@/core/database/drizzle/types';
import { AppInfoDto, MetadataDto } from '@/modules/marketplace/dto/marketplace.dto';
import { pluginAppFieldSchema } from '@runtipi/common/schemas';
import { type } from 'arktype';
import { createArkDto } from 'nestjs-arktype';

const appSchema = type({
  id: 'number',
  port: 'number | null',
  status: type.enumerated(...APP_STATUS),
  createdAt: 'number',
  updatedAt: 'number',
  version: 'number',
  exposed: 'boolean',
  openPort: 'boolean',
  exposedLocal: 'boolean',
  domain: 'string | null',
  isVisibleOnGuestDashboard: 'boolean',
  config: 'Record<string, unknown>?',
  enableAuth: 'boolean?',
  localSubdomain: type('string').or('null').optional(),
  pendingRestart: 'boolean',
  ignoredVersion: 'number | null',
  templateUrn: 'string | null',
});

const myAppsSchema = type({
  installed: type({
    app: appSchema,
    info: AppInfoDto.schema,
    metadata: MetadataDto.schema,
  }).array(),
});

const guestAppSchema = appSchema.omit('config').onUndeclaredKey('delete');

const guestAppsSchema = type({
  installed: type({
    app: guestAppSchema,
    info: AppInfoDto.schema,
    metadata: MetadataDto.schema,
  }).array(),
});

const appPluginSectionSchema = type({
  urn: 'string',
  name: 'string',
  title: 'string',
  description: 'string',
  fields: pluginAppFieldSchema.array(),
  applicableServices: 'string[]',
});

const getAppSchema = type({
  app: appSchema.or('null').optional(),
  info: AppInfoDto.schema,
  metadata: MetadataDto.schema,
  pluginSections: appPluginSectionSchema.array(),
});

const getRandomPortSchema = type({
  port: 'number',
});

const getComposeDiff = type({
  current: 'string | null',
  new: 'string | null',
});

const getConfigDiffSchema = type({
  current: 'string | null',
  new: 'string | null',
});

export class AppDto extends createArkDto(appSchema, { name: 'AppDto' }) {}
export class MyAppsDto extends createArkDto(myAppsSchema, {
  name: 'MyAppsDto',
}) {}
export class GuestAppsDto extends createArkDto(guestAppsSchema, {
  name: 'GuestAppsDto',
}) {}
export class GetAppDto extends createArkDto(getAppSchema, {
  name: 'GetAppDto',
}) {}
export class GetRandomPortDto extends createArkDto(getRandomPortSchema, {
  name: 'GetRandomPortDto',
}) {}
export class GetConfigDiffDto extends createArkDto(getConfigDiffSchema, {
  name: 'GetConfigDiffDto',
}) {}
export class GetComposeDiffDto extends createArkDto(getComposeDiff, {
  name: 'GetComposeDiffDto',
}) {}
