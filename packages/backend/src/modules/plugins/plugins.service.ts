import { TranslatableError } from '@/common/error/translatable-error';
import { extractAppUrn } from '@/common/helpers/app-helpers';
import { isBelowMinTipiVersion } from '@/common/helpers/version-helpers';
import { ConfigurationService } from '@/core/config/configuration.service';
import type { Plugin } from '@/core/database/drizzle/types';
import { LoggerService } from '@/core/logger/logger.service';
import type { AsyncMutex } from '@/utils/mutex/async-mutex';
import { APP_ASYNC_MUTEX } from '@/utils/mutex/mutex.module';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { PluginCapability, PluginManifest } from '@runtipi/common/schemas';
import type { AppUrn } from '@runtipi/common/types';
import { MarketplaceService } from '../marketplace/marketplace.service';
import { type PluginConfig, validatePluginConfig } from './plugin-config.helpers';
import { PluginsRepository } from './plugins.repository';

@Injectable()
export class PluginsService {
  constructor(
    private readonly repository: PluginsRepository,
    private readonly marketplace: MarketplaceService,
    private readonly config: ConfigurationService,
    private readonly logger: LoggerService,
    @Inject(APP_ASYNC_MUTEX) private readonly mutex: AsyncMutex,
  ) {}

  private async withLock<T>(urn: AppUrn, fn: () => Promise<T>) {
    const release = await this.mutex.acquire(`plugin:${urn}`);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private assertCompatible(urn: AppUrn, manifest: PluginManifest) {
    if (isBelowMinTipiVersion(this.config.get('version'), manifest.min_tipi_version)) {
      throw new TranslatableError('PLUGIN_ERROR_MIN_TIPI_VERSION', { id: urn, minVersion: manifest.min_tipi_version }, HttpStatus.BAD_REQUEST);
    }
  }

  private validateGlobalConfig(urn: AppUrn, manifest: PluginManifest, input: PluginConfig, dropUnknownKeys = false) {
    const result = validatePluginConfig(manifest.settings.global, input, { dropUnknownKeys });

    if (!result.success) {
      throw new TranslatableError('PLUGIN_ERROR_INVALID_CONFIG', { id: urn, reason: result.reason }, HttpStatus.BAD_REQUEST);
    }

    return result.config;
  }

  private async getStoreManifest(urn: AppUrn) {
    try {
      return await this.marketplace.getPluginInfoFromStore(urn);
    } catch {
      // The store the urn points to does not exist
      return null;
    }
  }

  private async getInstalledOrThrow(urn: AppUrn) {
    const installed = await this.repository.getPluginByUrn(urn);

    if (!installed) {
      throw new TranslatableError('PLUGIN_ERROR_NOT_INSTALLED', { id: urn }, HttpStatus.NOT_FOUND);
    }

    return installed;
  }

  private async toInstalledPlugin(row: Plugin) {
    const urn = row.urn as AppUrn;
    const [info, latest] = await Promise.all([this.marketplace.getInstalledPluginInfo(urn).catch(() => null), this.getStoreManifest(urn)]);

    return {
      ...row,
      info: info ?? null,
      latestVersion: latest?.version ?? null,
      latestTipiVersion: latest?.tipi_version ?? null,
      updateAvailable: latest ? latest.tipi_version > row.tipiVersion : false,
    };
  }

  public async searchCatalog(params: {
    search?: string | null;
    capability?: PluginCapability | null;
    storeId?: string | null;
    pageSize?: number;
    cursor?: string | null;
  }) {
    const result = await this.marketplace.searchPlugins(params);
    const installed = new Set((await this.repository.getPlugins()).map((row) => row.urn));

    return { ...result, data: result.data.map((plugin) => ({ ...plugin, installed: installed.has(plugin.urn) })) };
  }

  public async getCatalogPlugin(urn: AppUrn) {
    const info = await this.getStoreManifest(urn);

    if (!info) {
      throw new TranslatableError('PLUGIN_ERROR_NOT_FOUND', { id: urn }, HttpStatus.NOT_FOUND);
    }

    const row = await this.repository.getPluginByUrn(urn);

    return {
      info,
      installed: row ? await this.toInstalledPlugin(row) : null,
      updateAvailable: row ? info.tipi_version > row.tipiVersion : false,
    };
  }

  public async getInstalledPlugins() {
    const rows = await this.repository.getPlugins();
    return Promise.all(rows.map((row) => this.toInstalledPlugin(row)));
  }

  public async getInstalledPlugin(urn: AppUrn) {
    return this.toInstalledPlugin(await this.getInstalledOrThrow(urn));
  }

  public async installPlugin(urn: AppUrn, globalConfig: PluginConfig = {}) {
    return this.withLock(urn, async () => {
      if (await this.repository.getPluginByUrn(urn)) {
        throw new TranslatableError('PLUGIN_ERROR_ALREADY_INSTALLED', { id: urn }, HttpStatus.CONFLICT);
      }

      // Only plugins listed in the catalog (enabled store, available, not deprecated) can be installed.
      const available = await this.marketplace.getAvailablePlugins();
      const manifest = available.find((plugin) => plugin.urn === urn);

      if (!manifest) {
        const exists = await this.getStoreManifest(urn);
        throw exists
          ? new TranslatableError('PLUGIN_ERROR_NOT_AVAILABLE', { id: urn }, HttpStatus.BAD_REQUEST)
          : new TranslatableError('PLUGIN_ERROR_NOT_FOUND', { id: urn }, HttpStatus.NOT_FOUND);
      }

      this.assertCompatible(urn, manifest);
      const config = this.validateGlobalConfig(urn, manifest, globalConfig);

      try {
        await this.marketplace.copyPluginFromRepoToInstalled(urn);
      } catch (error) {
        this.logger.error(`Failed to copy plugin ${urn}:`, error);
        throw new TranslatableError('PLUGIN_ERROR_INSTALL_FAILED', { id: urn }, HttpStatus.INTERNAL_SERVER_ERROR, { cause: error });
      }

      const { appName: pluginId, appStoreId } = extractAppUrn(urn);

      try {
        const row = await this.repository.createPlugin({
          urn,
          pluginId,
          pluginStoreSlug: appStoreId,
          installedVersion: manifest.version,
          tipiVersion: manifest.tipi_version,
          enabled: true,
          globalConfig: config,
        });

        this.logger.info(`Plugin ${urn} installed (version ${manifest.version})`);
        return row;
      } catch (error) {
        await this.marketplace.removeInstalledPlugin(urn).catch(() => undefined);
        throw error;
      }
    });
  }

  public async updatePlugin(urn: AppUrn) {
    return this.withLock(urn, async () => {
      const installed = await this.getInstalledOrThrow(urn);
      const manifest = await this.getStoreManifest(urn);

      if (!manifest || !manifest.available) {
        throw new TranslatableError('PLUGIN_ERROR_NOT_FOUND', { id: urn }, HttpStatus.NOT_FOUND);
      }

      if (manifest.tipi_version <= installed.tipiVersion) {
        throw new TranslatableError('PLUGIN_ERROR_NO_UPDATE_AVAILABLE', { id: urn }, HttpStatus.BAD_REQUEST);
      }

      this.assertCompatible(urn, manifest);
      // Settings removed by the new version are dropped, new defaults are filled in and new required settings must already be satisfied.
      const config = this.validateGlobalConfig(urn, manifest, installed.globalConfig, true);

      try {
        await this.marketplace.copyPluginFromRepoToInstalled(urn);
      } catch (error) {
        this.logger.error(`Failed to copy plugin ${urn}:`, error);
        throw new TranslatableError('PLUGIN_ERROR_INSTALL_FAILED', { id: urn }, HttpStatus.INTERNAL_SERVER_ERROR, { cause: error });
      }

      const row = await this.repository.updatePlugin(urn, {
        installedVersion: manifest.version,
        tipiVersion: manifest.tipi_version,
        globalConfig: config,
      });

      this.logger.info(`Plugin ${urn} updated to version ${manifest.version}`);
      return row;
    });
  }

  public async removePlugin(urn: AppUrn) {
    return this.withLock(urn, async () => {
      await this.getInstalledOrThrow(urn);
      await this.repository.deletePlugin(urn);

      try {
        await this.marketplace.removeInstalledPlugin(urn);
      } catch (error) {
        this.logger.warn(`Plugin ${urn} removed, but its installed files could not be deleted`, error);
      }

      this.logger.info(`Plugin ${urn} removed`);
    });
  }

  public async setPluginEnabled(urn: AppUrn, enabled: boolean) {
    return this.withLock(urn, async () => {
      await this.getInstalledOrThrow(urn);
      return this.repository.updatePlugin(urn, { enabled });
    });
  }

  public async updateGlobalConfig(urn: AppUrn, input: PluginConfig) {
    return this.withLock(urn, async () => {
      const installed = await this.getInstalledOrThrow(urn);
      const manifest = (await this.marketplace.getInstalledPluginInfo(urn).catch(() => null)) ?? (await this.getStoreManifest(urn));

      if (!manifest) {
        throw new TranslatableError('PLUGIN_ERROR_NOT_FOUND', { id: urn }, HttpStatus.NOT_FOUND);
      }

      const config = this.validateGlobalConfig(urn, manifest, { ...installed.globalConfig, ...input });
      return this.repository.updatePlugin(urn, { globalConfig: config });
    });
  }
}
