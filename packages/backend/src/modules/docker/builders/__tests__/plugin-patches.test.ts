import { createAppUrn } from '@/common/helpers/app-helpers';
import { describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { DockerComposeBuilder } from '../compose.builder';
import { type ComposePlugin, getApplicableServices, isServiceApplicable, renderTemplate } from '../plugin-patches';

const urn = createAppUrn('nginx', 'store-id');
const subnet = '10.128.1.0/24';

const compose = `x-runtipi:
  schema-version: 2

services:
  web:
    image: nginx:alpine
    networks:
      - custom
    x-runtipi:
      is_main: true
      internal_port: 80
  db:
    image: postgres:16
  vpn-sidecar:
    image: busybox
    network_mode: service:web

networks:
  custom: {}
`;

const tailscale = (appConfig: ComposePlugin['appConfig'], overrides: Partial<ComposePlugin['appSettings']> = {}): ComposePlugin => ({
  urn: 'tailscale:store',
  globalConfig: { NETWORK_NAME: 'tailscale' },
  appConfig,
  appSettings: {
    applies_to: { exclude_network_mode: true, services: 'all' },
    compose_patches: [
      { op: 'add_network', when: 'ENABLED', network: '{{plugin.NETWORK_NAME}}', aliases: ['{{app.HOSTNAME}}'] },
      { op: 'add_labels', when: 'ENABLED', labels: { 'ts.app': '{{RUNTIPI_APP_ID}}', 'runtipi.managed': 'false' } },
    ],
    ...overrides,
  },
});

const build = (plugins: ComposePlugin[], onWarning?: (message: string) => void, doc = compose) =>
  new DockerComposeBuilder().getDockerCompose(yaml.parse(doc), { openPort: true }, urn, subnet, undefined, { plugins, onWarning });

describe('renderTemplate', () => {
  const context = { plugin: { NAME: 'tailnet', PORT: 41641 }, app: { ENABLED: true }, appId: 'nginx-store' };

  it('renders plugin, app and app id references', () => {
    expect(renderTemplate('{{plugin.NAME}}:{{ plugin.PORT }}/{{app.ENABLED}}/{{RUNTIPI_APP_ID}}', context)).toBe('tailnet:41641/true/nginx-store');
  });

  it('renders unknown and missing references as an empty string', () => {
    expect(renderTemplate('a{{app.MISSING}}b{{env.HOME}}c{{plugin.constructor}}', context)).toBe('abc');
  });
});

describe('applicability filter', () => {
  const services = yaml.parse(compose).services;

  it('skips services using network_mode by default', () => {
    expect(getApplicableServices({ services }, { exclude_network_mode: true, services: 'all' })).toEqual(['web', 'db']);
  });

  it('can include services using network_mode', () => {
    expect(getApplicableServices({ services }, { exclude_network_mode: false, services: 'all' })).toEqual(['web', 'db', 'vpn-sidecar']);
  });

  it('can target the main service only', () => {
    expect(getApplicableServices({ services }, { exclude_network_mode: true, services: 'main' })).toEqual(['web']);
    expect(isServiceApplicable(services.db, { exclude_network_mode: false, services: 'main' })).toBe(false);
  });
});

describe('DockerComposeBuilder with plugin patches', () => {
  it('produces the same output without plugins', () => {
    const parsed = yaml.parse(compose);
    const builder = new DockerComposeBuilder();

    expect(builder.getDockerCompose(parsed, { openPort: true }, urn, subnet, undefined, { plugins: [] })).toBe(
      builder.getDockerCompose(parsed, { openPort: true }, urn, subnet),
    );
  });

  it('does nothing while the toggle of a patch is off', () => {
    expect(build([tailscale({ ENABLED: false, HOSTNAME: 'web' })])).toBe(build([]));
    expect(build([tailscale({})])).toBe(build([]));
  });

  it('attaches applicable services to the external network and keeps their networks', () => {
    const result = yaml.parse(build([tailscale({ ENABLED: true, HOSTNAME: 'my-nginx' })]));

    expect(result.networks.plugin_tailscale).toEqual({ name: 'tailscale', external: true });
    expect(result.services.web.networks).toEqual({
      custom: {},
      'nginx_store-id_network': { gw_priority: 0 },
      tipi_main_network: { gw_priority: 1 },
      plugin_tailscale: { aliases: ['my-nginx'] },
    });
    expect(result.services.db.networks.plugin_tailscale).toEqual({ aliases: ['my-nginx'] });
    expect(result.services['vpn-sidecar'].networks).toEqual({});
    expect(result.networks.custom).toEqual({});
  });

  it('adds labels without overriding Runtipi labels', () => {
    const warn = vi.fn();
    const result = yaml.parse(build([tailscale({ ENABLED: true })], warn));

    expect(result.services.web.labels['ts.app']).toBe('nginx-store-id');
    expect(result.services.web.labels['runtipi.managed']).toBe('true');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('runtipi.managed'));
  });

  it('only patches the main service when the section targets it', () => {
    const result = yaml.parse(build([tailscale({ ENABLED: true }, { applies_to: { exclude_network_mode: true, services: 'main' } })]));

    expect(result.services.web.networks.plugin_tailscale).toEqual({});
    expect(result.services.db.networks).not.toHaveProperty('plugin_tailscale');
  });

  it('never attaches network_mode services to a network, even when the filter includes them', () => {
    const result = yaml.parse(build([tailscale({ ENABLED: true }, { applies_to: { exclude_network_mode: false, services: 'all' } })]));

    expect(result.services['vpn-sidecar'].networks).toEqual({});
    expect(result.services['vpn-sidecar'].labels['ts.app']).toBe('nginx-store-id');
  });

  it('skips a patch whose network name is invalid', () => {
    const warn = vi.fn();
    const plugin = { ...tailscale({ ENABLED: true }), globalConfig: { NETWORK_NAME: '' } };
    const result = yaml.parse(build([plugin], warn));

    expect(result.networks).not.toHaveProperty('plugin_');
    expect(Object.keys(result.networks)).toEqual(['custom', 'tipi_main_network', 'nginx_store-id_network']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a valid Docker network name'));
  });

  it('does not replace a network the app declares itself', () => {
    const warn = vi.fn();
    const doc = `${compose}  plugin_tailscale:\n    driver: bridge\n`;
    const result = yaml.parse(build([tailscale({ ENABLED: true })], warn, doc));

    expect(result.networks.plugin_tailscale).toEqual({ driver: 'bridge' });
    expect(result.services.web.networks).not.toHaveProperty('plugin_tailscale');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already declares'));
  });

  it('declares a network once when several plugins use it', () => {
    const second = { ...tailscale({ ENABLED: true, HOSTNAME: 'other' }), urn: 'other:store' };
    const result = yaml.parse(build([tailscale({ ENABLED: true, HOSTNAME: 'first' }), second]));

    expect(result.services.web.networks.plugin_tailscale).toEqual({ aliases: ['first', 'other'] });
    expect(Object.keys(result.networks).filter((key) => key.startsWith('plugin_'))).toEqual(['plugin_tailscale']);
  });
});
