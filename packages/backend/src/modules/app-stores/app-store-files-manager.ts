import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APP_GENERATED_COMPOSE_FILENAME, APP_REL_COMPOSE_FILENAME } from '@/common/constants';
import { extractAppUrn } from '@/common/helpers/app-helpers';
import { execFileAsync } from '@/common/helpers/exec-helpers';
import type { ConfigurationService } from '@/core/config/configuration.service';
import type { AppStore } from '@/core/database/drizzle/types';
import type { FilesystemService } from '@/core/filesystem/filesystem.service';
import type { LoggerService } from '@/core/logger/logger.service';
import { appInfoSchema, convertLegacyToYaml, pluginManifestSchema } from '@runtipi/common/schemas';
import type { AppUrn } from '@runtipi/common/types';
import { type } from 'arktype';
import git from 'isomorphic-git';

export const PLUGIN_MANIFEST_FILENAME = 'plugin.json';

export class AppStoreFilesManager {
  constructor(
    private readonly configuration: ConfigurationService,
    private readonly filesystem: FilesystemService,
    private readonly logger: LoggerService,
    public readonly storeConfig: AppStore,
  ) {}

  private getInstalledAppsFolder() {
    const { directories } = this.configuration.getConfig();

    return path.join(directories.dataDir, 'apps');
  }

  private getAppStoreFolder() {
    const { directories } = this.configuration.getConfig();
    return path.join(directories.dataDir, 'repos', this.storeConfig.slug, 'apps');
  }

  private getPluginStoreFolder() {
    const { directories } = this.configuration.getConfig();
    return path.join(directories.dataDir, 'repos', this.storeConfig.slug, 'plugins');
  }

  private getInstalledPluginsFolder() {
    const { directories } = this.configuration.getConfig();
    return path.join(directories.dataDir, 'plugins');
  }

  /**
   * List the names of the sub-directories of a store folder, skipping test fixtures.
   */
  private async listStoreEntries(folder: string) {
    const entries = await this.filesystem.listFiles(folder);
    const skippedDirs = ['__tests__'];

    const dirs = await Promise.all(
      entries
        .filter((entry) => !skippedDirs.includes(entry))
        .map(async (entry) => ((await this.filesystem.isDirectory(path.join(folder, entry))) ? entry : null)),
    );

    return dirs.filter((entry): entry is string => entry !== null);
  }

  public getPluginPaths(pluginUrn: AppUrn) {
    const { appStoreId, appName: pluginId } = extractAppUrn(pluginUrn);

    return {
      pluginRepoDir: path.join(this.getPluginStoreFolder(), pluginId),
      pluginInstalledDir: path.join(this.getInstalledPluginsFolder(), appStoreId, pluginId),
    };
  }

  /**
   * Get the list of plugin urns available in this store. A store without a `plugins/` folder simply has no plugins.
   */
  public async getAvailablePluginUrns() {
    const pluginsRepoFolder = this.getPluginStoreFolder();

    if (!(await this.filesystem.isDirectory(pluginsRepoFolder))) {
      return [];
    }

    const plugins = await this.listStoreEntries(pluginsRepoFolder);
    return plugins.map((plugin) => `${plugin}:${this.storeConfig.slug}` as AppUrn);
  }

  private async getPluginInfoFromDirectory(pluginUrn: AppUrn, pluginDirectory: string) {
    const manifestPath = path.join(pluginDirectory, PLUGIN_MANIFEST_FILENAME);

    if (!(await this.filesystem.isFile(manifestPath))) {
      return null;
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse((await this.filesystem.readTextFile(manifestPath)) ?? '{}');
    } catch (error) {
      this.logger.error(`Plugin ${pluginUrn} has an invalid ${PLUGIN_MANIFEST_FILENAME}:`, error);
      return null;
    }

    const { appName: pluginId } = extractAppUrn(pluginUrn);
    const parsed = pluginManifestSchema({ ...(manifest as object), urn: pluginUrn });

    if (parsed instanceof type.errors) {
      this.logger.error(`Plugin ${pluginUrn} manifest error:`);
      this.logger.error(parsed.summary);
      return null;
    }

    if (parsed.id !== pluginId) {
      this.logger.error(`Plugin ${pluginUrn} manifest id "${parsed.id}" does not match its folder name "${pluginId}"`);
      return null;
    }

    return parsed;
  }

  /**
   * Get a plugin manifest from the store repository. Returns null when the plugin does not exist or its manifest is invalid.
   */
  public async getPluginInfoFromStore(pluginUrn: AppUrn) {
    try {
      const { pluginRepoDir } = this.getPluginPaths(pluginUrn);
      return await this.getPluginInfoFromDirectory(pluginUrn, pluginRepoDir);
    } catch (error) {
      this.logger.error(`Error getting plugin info from store for ${pluginUrn}:`, error);
      return null;
    }
  }

  /**
   * Get the manifest of the installed copy of a plugin.
   */
  public async getInstalledPluginInfo(pluginUrn: AppUrn) {
    try {
      const { pluginInstalledDir } = this.getPluginPaths(pluginUrn);
      return await this.getPluginInfoFromDirectory(pluginUrn, pluginInstalledDir);
    } catch (error) {
      this.logger.error(`Error getting installed plugin info for ${pluginUrn}:`, error);
      return null;
    }
  }

  private getPluginStagingFolder() {
    return path.join(this.getInstalledPluginsFolder(), '.staging');
  }

  /**
   * Write the blobs of a Git tree into `destination`. Only regular files and directories are written: symlinks and
   * submodules are skipped so an installed plugin can never point back into (or outside of) the repository.
   */
  private async writeGitTree(repoDir: string, treeOid: string, destination: string) {
    const { tree } = await git.readTree({ fs, dir: repoDir, oid: treeOid });

    for (const entry of tree) {
      // Git never stores these, but a crafted object could; never let one escape the destination.
      if (entry.path === '.' || entry.path === '..' || entry.path.includes('/') || entry.path.includes('\\') || entry.path.includes('\0')) {
        throw new Error(`Invalid path "${entry.path}" in plugin tree`);
      }

      const target = path.join(destination, entry.path);

      if (entry.type === 'tree') {
        if (!(await this.filesystem.createDirectory(target))) {
          throw new Error(`Failed to create ${target}`);
        }
        await this.writeGitTree(repoDir, entry.oid, target);
      } else if (entry.type === 'blob' && (entry.mode === '100644' || entry.mode === '100755')) {
        const { blob } = await git.readBlob({ fs, dir: repoDir, oid: entry.oid });
        if (!(await this.filesystem.writeBinaryFile(target, Buffer.from(blob)))) {
          throw new Error(`Failed to write ${target}`);
        }
      }
    }
  }

  /**
   * Copy a plugin into a private staging directory and read its manifest from that copy.
   *
   * The copy is taken from the commit the store's `HEAD` points to, not from the working tree. Git objects are
   * immutable, so a store pull running at the same time (fetch, branch move, checkout) cannot produce a staged copy that
   * mixes files of two versions: every file comes from one commit, and validating the staged manifest validates exactly
   * what gets installed. The caller must either promote or discard the staged copy.
   */
  public async stagePlugin(pluginUrn: AppUrn) {
    const { appName: pluginId } = extractAppUrn(pluginUrn);
    const { directories } = this.configuration.getConfig();
    const repoDir = path.join(directories.dataDir, 'repos', this.storeConfig.slug);

    let treeOid: string;
    try {
      const commitOid = await git.resolveRef({ fs, dir: repoDir, ref: 'HEAD' });
      // With a filepath, readTree resolves the commit to the tree at that path and returns that tree's own oid.
      ({ oid: treeOid } = await git.readTree({ fs, dir: repoDir, oid: commitOid, filepath: `plugins/${pluginId}` }));
    } catch (error) {
      throw new Error(`Plugin ${pluginUrn} not found in repo ${this.storeConfig.slug}`, { cause: error });
    }

    const stagingDir = path.join(this.getPluginStagingFolder(), `${this.storeConfig.slug}-${pluginId}-${crypto.randomUUID()}`);

    if (!(await this.filesystem.createDirectory(stagingDir))) {
      throw new Error(`Failed to create staging directory for plugin ${pluginUrn}`);
    }

    try {
      await this.writeGitTree(repoDir, treeOid, stagingDir);
    } catch (error) {
      await this.filesystem.removeDirectory(stagingDir);
      throw new Error(`Failed to copy plugin ${pluginUrn} from repo ${this.storeConfig.slug}`, { cause: error });
    }

    const manifest = await this.getPluginInfoFromDirectory(pluginUrn, stagingDir).catch(() => null);

    return { stagingDir, manifest };
  }

  public async discardStagedPlugin(stagingDir: string) {
    await this.filesystem.removeDirectory(stagingDir);
  }

  /**
   * Swap a staged copy in as the installed plugin. The previous installed copy is kept aside until `commit()`
   * is called, and `rollback()` puts it back, so a failure after the swap (for example a database error) never
   * leaves the installed files out of sync with the recorded version.
   */
  public async promoteStagedPlugin(pluginUrn: AppUrn, stagingDir: string) {
    const { pluginInstalledDir } = this.getPluginPaths(pluginUrn);
    const previousDir = `${stagingDir}.previous`;
    const hadPrevious = await this.filesystem.pathExists(pluginInstalledDir);

    if (hadPrevious && !(await this.filesystem.movePath(pluginInstalledDir, previousDir))) {
      throw new Error(`Failed to set aside the installed files of plugin ${pluginUrn}`);
    }

    const restorePrevious = async () => {
      await this.filesystem.removeDirectory(pluginInstalledDir);
      if (hadPrevious && !(await this.filesystem.movePath(previousDir, pluginInstalledDir))) {
        this.logger.error(`Failed to restore the previous files of plugin ${pluginUrn} from ${previousDir}`);
      }
    };

    const promoted =
      (await this.filesystem.createDirectory(path.dirname(pluginInstalledDir))) && (await this.filesystem.movePath(stagingDir, pluginInstalledDir));

    if (!promoted) {
      await restorePrevious();
      await this.filesystem.removeDirectory(stagingDir);
      throw new Error(`Failed to install the files of plugin ${pluginUrn}`);
    }

    return {
      commit: async () => {
        await this.filesystem.removeDirectory(previousDir);
      },
      rollback: restorePrevious,
    };
  }

  public async removeInstalledPlugin(pluginUrn: AppUrn) {
    const { pluginInstalledDir } = this.getPluginPaths(pluginUrn);

    if (!(await this.filesystem.removeDirectory(pluginInstalledDir))) {
      throw new Error(`Failed to remove installed files for plugin ${pluginUrn}`);
    }
  }

  public getAppPaths(appUrn: AppUrn) {
    const { appStoreId, appName } = extractAppUrn(appUrn);

    const { directories } = this.configuration.getConfig();

    return {
      appDataDir: path.join(directories.appDataDir, appStoreId, appName),
      appRepoDir: path.join(this.getAppStoreFolder(), appName),
      appInstalledDir: path.join(this.getInstalledAppsFolder(), appStoreId, appName),
    };
  }

  private async getAppInfoFromDirectory(appUrn: AppUrn, appDirectory: string) {
    const configPath = path.join(appDirectory, 'config.json');

    if (!(await this.filesystem.isFile(configPath))) {
      return;
    }

    const configFile = await this.filesystem.readTextFile(configPath);

    const config = JSON.parse(configFile ?? '{}');
    const parsedConfig = appInfoSchema({ ...config, urn: appUrn });

    if (parsedConfig instanceof type.errors) {
      this.logger.error(`App ${appUrn} installed config error:`);
      this.logger.error(parsedConfig.summary);

      return null;
    }

    if (!parsedConfig.available) {
      return null;
    }

    const descriptionPath = path.join(appDirectory, 'metadata', 'description.md');
    const description = (await this.filesystem.isFile(descriptionPath)) ? ((await this.filesystem.readTextFile(descriptionPath)) ?? '') : '';

    return { ...parsedConfig, description };
  }

  /**
   * Get the app info from the app store
   * @param appUrn - The app id
   */
  public async getAppInfoFromAppStore(appUrn: AppUrn) {
    try {
      const { appRepoDir } = this.getAppPaths(appUrn);

      return await this.getAppInfoFromDirectory(appUrn, appRepoDir);
    } catch (error) {
      this.logger.error(`Error getting app info from app store for ${appUrn}:`, error);
    }
  }

  public async getAppInfoFromAppStoreOrInstalled(appUrn: AppUrn) {
    const appInfo = await this.getAppInfoFromAppStore(appUrn);
    if (appInfo) {
      return appInfo;
    }

    const { appInstalledDir } = this.getAppPaths(appUrn);

    return await this.getAppInfoFromDirectory(appUrn, appInstalledDir);
  }

  public async getSourceDockerComposeYaml(appUrn: AppUrn) {
    const { appRepoDir } = this.getAppPaths(appUrn);

    const appYamlPath = path.join(appRepoDir, APP_REL_COMPOSE_FILENAME);

    let content = null;

    try {
      if (await this.filesystem.isFile(appYamlPath)) {
        content = await this.filesystem.readYamlFile(appYamlPath);
      }
    } catch (error) {
      this.logger.error(`Error getting ${APP_REL_COMPOSE_FILENAME} for app ${appUrn} from repo ${this.storeConfig.slug}:`, error);
    }

    if (content && typeof content === 'object' && 'x-runtipi' in content) {
      return { path: appYamlPath, content };
    }

    // Fallback to legacy docker-compose.json
    const dockerComposePath = path.join(appRepoDir, 'docker-compose.json');

    try {
      if (await this.filesystem.isFile(dockerComposePath)) {
        content = await this.filesystem.readJsonFile(dockerComposePath);
      }
    } catch (error) {
      this.logger.error(`Error getting docker-compose.json for app ${appUrn} from repo ${this.storeConfig.slug}:`, error);
    }

    return { path: dockerComposePath, content: convertLegacyToYaml(content) };
  }

  /**
   * Copy the app from the repo to the installed apps folder
   * @param appUrn - The app id
   */
  public async copyAppFromRepoToInstalled(appUrn: AppUrn) {
    const { appRepoDir, appDataDir, appInstalledDir } = this.getAppPaths(appUrn);

    if (!(await this.filesystem.isDirectory(appRepoDir))) {
      if (await this.filesystem.isDirectory(appInstalledDir)) {
        this.logger.warn(`App ${appUrn} already installed, but not found in repo ${this.storeConfig.slug}. Using installed version.`);
        return;
      }

      this.logger.warn(`App ${appUrn} not found in repo ${this.storeConfig.slug}`);
      throw new Error(`App ${appUrn} not found in repo ${this.storeConfig.slug}`);
    }

    // delete eventual app folder if exists
    this.logger.info(`Deleting app ${appUrn} folder if exists`);
    if (!(await this.filesystem.removeDirectory(appInstalledDir))) {
      throw new Error(`Failed to remove installed files for app ${appUrn}`);
    }

    // Create app folder
    this.logger.info(`Creating app ${appUrn} folder`);
    if (!(await this.filesystem.createDirectory(appInstalledDir))) {
      throw new Error(`Failed to create installed files directory for app ${appUrn}`);
    }

    // Create app data folder
    this.logger.info(`Creating app ${appUrn} data folder`);
    if (!(await this.filesystem.createDirectory(appDataDir))) {
      throw new Error(`Failed to create data directory for app ${appUrn}`);
    }

    // Copy app folder from repo
    this.logger.info(`Copying app ${appUrn} from repo ${this.storeConfig.slug}`);
    const generatedComposePath = path.join(appRepoDir, APP_GENERATED_COMPOSE_FILENAME);
    const copied = await this.filesystem.copyDirectory(appRepoDir, appInstalledDir, {
      verbatimSymlinks: true,
      filter: (source) => source !== generatedComposePath,
    });

    if (!copied) {
      await this.filesystem.removeDirectory(appInstalledDir);
      throw new Error(`Failed to copy app ${appUrn} from repo ${this.storeConfig.slug}`);
    }
  }

  /**
   *  This function returns an object containing information about the updates available for the app with the provided id.
   *  It checks if the app is installed or not and looks for the config.json file in the appropriate directory.
   *  If the config.json file is invalid, it returns null.
   *  If the app is not found, it returns null.
   *
   *  @param {string} appUrn - The app id.
   */
  public async getAppUpdateInfo(appUrn: AppUrn) {
    const config = await this.getAppInfoFromAppStore(appUrn);
    const paths = this.getAppPaths(appUrn);

    if (config) {
      return {
        ...paths,
        latestVersion: config.tipi_version,
        minTipiVersion: config.min_tipi_version ?? null,
        latestDockerVersion: config.version,
      };
    }

    return {
      latestVersion: 0,
      latestDockerVersion: '0.0.0',
      minTipiVersion: null,
      ...paths,
    };
  }

  /**
   * Get the list of available app ids
   * @returns The list of app ids
   */
  public async getAvailableAppUrns() {
    const appsRepoFolder = this.getAppStoreFolder();

    if (!(await this.filesystem.isDirectory(appsRepoFolder))) {
      this.logger.error(`Apps repo ${this.storeConfig.slug} not found. Make sure your repo is configured correctly.`);
      return [];
    }

    const validApps = await this.listStoreEntries(appsRepoFolder);

    return validApps.map((app) => `${app}:${this.storeConfig.slug}` as AppUrn);
  }

  /**
   * Given a template and a map of variables, this function replaces all instances of the variables in the template with their values.
   *
   * @param {string} template - The template to be rendered.
   * @param {Map<string, string>} envMap - The map of variables and their values.
   */
  private renderTemplate(template: string, envMap: Map<string, string>) {
    let renderedTemplate = template;

    envMap.forEach((value, key) => {
      const safeKey = key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      renderedTemplate = renderedTemplate.replace(new RegExp(`{{${safeKey}}}`, 'g'), value);
    });

    return renderedTemplate;
  }

  public async copyDataDir(appUrn: AppUrn, envMap: Map<string, string>) {
    const { appInstalledDir, appDataDir } = this.getAppPaths(appUrn);

    // return if app does not have a data directory
    if (!(await this.filesystem.isDirectory(path.join(appInstalledDir, 'data')))) {
      return;
    }

    // Return if app has already a data directory
    if (await this.filesystem.pathExists(path.join(appDataDir, 'data'))) {
      return;
    }

    // Create app-data folder
    await this.filesystem.createDirectory(path.join(appDataDir, 'data'));

    const dataDir = await this.filesystem.listFiles(path.join(appInstalledDir, 'data'));

    const processFile = async (file: string) => {
      const sourcePath = path.join(appInstalledDir, 'data', file);

      if (!(await this.filesystem.isFile(sourcePath))) {
        return;
      }

      if (file.endsWith('.template')) {
        const template = await this.filesystem.readTextFile(sourcePath);
        if (template) {
          const renderedTemplate = this.renderTemplate(template, envMap);

          await this.filesystem.writeTextFile(path.join(appDataDir, 'data', file.replace('.template', '')), renderedTemplate);
        }
      } else {
        await this.filesystem.copyFile(sourcePath, path.join(appDataDir, 'data', file));
      }
    };

    const processDir = async (p: string) => {
      await this.filesystem.createDirectory(path.join(appDataDir, 'data', p));

      const files = await this.filesystem.listFiles(path.join(appInstalledDir, 'data', p));

      await Promise.all(
        files.map(async (file) => {
          const fullPath = path.join(appInstalledDir, 'data', p, file);

          if (await this.filesystem.isDirectory(fullPath)) {
            await processDir(path.join(p, file));
          } else {
            await processFile(path.join(p, file));
          }
        }),
      );
    };

    await Promise.all(
      dataDir.map(async (file) => {
        const fullPath = path.join(appInstalledDir, 'data', file);

        if (await this.filesystem.isDirectory(fullPath)) {
          await processDir(file);
        } else {
          await processFile(file);
        }
      }),
    );

    // Remove any .gitkeep files from the app-data folder at any level
    if (await this.filesystem.isDirectory(path.join(appDataDir, 'data'))) {
      await execFileAsync('find', [`${appDataDir}/data`, '-name', '.gitkeep', '-delete']).catch(() => {
        this.logger.error(`Error removing .gitkeep files from ${appDataDir}/data`);
      });
    }
  }

  public async getAppImage(appUrn: AppUrn) {
    const { appInstalledDir, appRepoDir } = this.getAppPaths(appUrn);
    const { appDir } = this.configuration.get('directories');

    const defaultFilePath = path.join(appInstalledDir, 'metadata', 'logo.jpg');
    const appRepoFilePath = path.join(appRepoDir, 'metadata', 'logo.jpg');

    let filePath = path.join(appDir, 'assets', 'default-app-logo.jpg');

    if (await this.filesystem.isFile(defaultFilePath)) {
      filePath = defaultFilePath;
    } else if (await this.filesystem.isFile(appRepoFilePath)) {
      filePath = appRepoFilePath;
    }

    const file = await this.filesystem.readBinaryFile(filePath);
    const etag = await this.filesystem.getFileEtag(filePath);

    return { image: file, etag };
  }

  public async getConfigJson(appUrn: AppUrn) {
    const { appRepoDir } = this.getAppPaths(appUrn);

    const configPath = path.join(appRepoDir, 'config.json');

    let content = null;
    try {
      if (await this.filesystem.isFile(configPath)) {
        content = await this.filesystem.readJsonFile(configPath);
      }
    } catch (error) {
      this.logger.error(`Error getting config.json for app ${appUrn} from repo ${this.storeConfig.slug}:`, error);
    }

    return { path: configPath, content };
  }
}
