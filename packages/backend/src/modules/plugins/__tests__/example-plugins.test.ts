import fs from 'node:fs/promises';
import path from 'node:path';
import { createAppUrn } from '@/common/helpers/app-helpers';
import { DockerComposeBuilder } from '@/modules/docker/builders/compose.builder';
import { pluginManifestSchema } from '@runtipi/common/schemas';
import { type } from 'arktype';
import { describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';

const examplePath = path.resolve(__dirname, '../../../../../../examples/plugins/tailscale/plugin.json');

describe('Tailscale example plugin', () => {
  it('is a valid manifest that attaches the main service to the configured network', async () => {
    // The tests mock node:fs with an in-memory filesystem, read the example from disk.
    const actualFs = await vi.importActual<typeof fs>('node:fs/promises');
    const manifest = pluginManifestSchema({ ...JSON.parse(await actualFs.readFile(examplePath, 'utf-8')), urn: 'tailscale:examples' });
    if (manifest instanceof type.errors) throw new Error(manifest.summary);
    if (!manifest.app_settings) throw new Error('Missing app_settings');

    const compose = yaml.parse(`x-runtipi:
  schema-version: 2
services:
  web:
    image: nginx
    x-runtipi:
      is_main: true
      internal_port: 80
  db:
    image: postgres
`);
    const result = yaml.parse(
      new DockerComposeBuilder().getDockerCompose(compose, { openPort: true }, createAppUrn('web', 'store'), '10.128.0.0/24', undefined, {
        plugins: [
          {
            urn: 'tailscale:examples',
            appSettings: manifest.app_settings,
            globalConfig: { NETWORK_NAME: 'tailscale' },
            appConfig: { ENABLED: true, TSDPROXY: true, HOSTNAME: 'web' },
          },
        ],
      }),
    );

    expect(result.networks.plugin_tailscale).toEqual({ name: 'tailscale', external: true });
    expect(result.services.web.networks.plugin_tailscale).toEqual({ aliases: ['web'] });
    expect(result.services.web.labels).toMatchObject({ 'tsdproxy.enable': 'true', 'tsdproxy.name': 'web' });
    expect(result.services.db.networks).not.toHaveProperty('plugin_tailscale');
  });
});
