import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '@/common/constants';
import type { PluginManifestInput } from '@runtipi/common/schemas';

/**
 * Write `repos/<store>/plugins/<id>/plugin.json`. Pass `raw` to write an arbitrary (possibly invalid) manifest.
 */
export const createPluginInStore = async (storeId: string, manifest: Partial<PluginManifestInput> & { id: string }, raw?: string) => {
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

  const pluginDir = path.join(DATA_DIR, 'repos', storeId, 'plugins', manifest.id);
  await fs.promises.mkdir(pluginDir, { recursive: true });
  await fs.promises.writeFile(path.join(pluginDir, 'plugin.json'), raw ?? JSON.stringify(content, null, 2));

  return content;
};
