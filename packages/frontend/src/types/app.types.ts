import type { GetAllAppStoresResponse, GetAppBackupsDto, GetAppDto, LinksDto, SearchAppsDto } from '@/api-client';

export type FormField = NonNullable<GetAppDto['info']['form_fields']>[number];
export type AppInfo = GetAppDto['info'];
export type AppMetadata = GetAppDto['metadata'];
export type AppDetails = NonNullable<GetAppDto['app']>;
export type AppStatus = NonNullable<AppDetails>['status'];
export type AppPluginSection = GetAppDto['pluginSections'][number];
export type PluginAppField = AppPluginSection['fields'][number];

export type AppInfoSimple = SearchAppsDto['data'][number];
export type AppCategory = NonNullable<AppInfoSimple['categories']>[number];

export type CustomLink = LinksDto['links'][number];

export type AppBackup = GetAppBackupsDto['data'][number];

export type AppStore = GetAllAppStoresResponse['appStores'][number];
