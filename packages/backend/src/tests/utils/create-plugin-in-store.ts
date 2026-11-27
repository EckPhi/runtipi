import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '@/common/constants';
import type { PluginManifestInput } from '@runtipi/common/schemas';
import git from 'isomorphic-git';

/**
 * Commit the whole working tree of a store repository, initialising it if needed. Store repositories are Git clones,
 * and plugins are staged from the commit `HEAD` points to.
 */
export const commitStoreRepo = async (repoDir: string, message = 'update') => {
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    await git.init({ fs, dir: repoDir, defaultBranch: 'main' });
  }

  const status = await git.statusMatrix({ fs, dir: repoDir });
  for (const [filepath, , workdir] of status) {
    if (workdir === 0) await git.remove({ fs, dir: repoDir, filepath });
    else await git.add({ fs, dir: repoDir, filepath });
  }

  return git.commit({ fs, dir: repoDir, message, author: { name: 'test', email: 'test@example.com', timestamp: 0 } });
};

/**
 * Write and commit `repos/<store>/plugins/<id>/plugin.json`. Pass `raw` to write an arbitrary (possibly invalid) manifest.
 */
export const createPluginInStore = async (
  storeId: string,
  manifest: Partial<PluginManifestInput> & { id: string },
  raw?: string,
  files: Record<string, string> = {},
) => {
  const { urn: _urn, ...rest } = manifest;
  const content: Omit<PluginManifestInput, 'urn'> = {
    name: `Plugin ${manifest.id}`,
    version: '1.0.0',
    tipi_version: 1,
    short_desc: 'A test plugin',
    author: 'runtipi',
    source: 'https://example.com',
    capabilities: ['compose'],
    ...rest,
  };

  const repoDir = path.join(DATA_DIR, 'repos', storeId);
  const pluginDir = path.join(repoDir, 'plugins', manifest.id);
  await fs.promises.mkdir(pluginDir, { recursive: true });
  await fs.promises.writeFile(path.join(pluginDir, 'plugin.json'), raw ?? JSON.stringify(content, null, 2));

  for (const [file, data] of Object.entries(files)) {
    await fs.promises.mkdir(path.dirname(path.join(pluginDir, file)), { recursive: true });
    await fs.promises.writeFile(path.join(pluginDir, file), data);
  }

  await commitStoreRepo(repoDir);

  return content;
};
