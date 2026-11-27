import { getCatalogPluginOptions } from '@/api-client/@tanstack/react-query.gen';
import { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PluginDetails } from '../helpers/plugin-helpers';
import PluginDetailsPage from '../pages/plugin-details-page';
import { createPluginDetails, createPluginInfo, renderWithProviders } from './plugin-test-utils';

const renderPage = (details: PluginDetails) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } } });
  queryClient.setQueryData(getCatalogPluginOptions({ path: { urn: 'demo:store' } }).queryKey, details);

  return renderWithProviders(<PluginDetailsPage />, { path: '/plugins/:storeId/:pluginId', route: '/plugins/store/demo', queryClient });
};

const installed = {
  id: 1,
  urn: 'demo:store',
  pluginId: 'demo',
  pluginStoreSlug: 'store',
  installedVersion: '1.0.0',
  tipiVersion: 1,
  enabled: true,
  globalConfig: {},
  createdAt: 0,
  updatedAt: 0,
  info: createPluginInfo(),
  latestVersion: '2.0.0',
  latestTipiVersion: 2,
  updateAvailable: true,
};

describe('PluginDetailsPage', () => {
  it('shows the version, compatibility and declared capabilities', () => {
    renderPage(createPluginDetails({ compatibility: { compatible: true, minTipiVersion: '4.0.0', reason: null } }));

    expect(screen.getByText('Demo plugin')).toBeTruthy();
    expect(screen.getByText('1.0.0')).toBeTruthy();
    expect(screen.getByTestId('plugin-compatibility').textContent).toContain('Runtipi 4.0.0 or higher');
    expect(screen.getByTestId('plugin-capabilities').textContent).toContain('Modifies generated Compose files');
    expect(screen.getByTestId('plugin-capabilities').textContent).toContain('Adds dashboard widgets');
    expect(screen.getByTestId('plugin-install-button').hasAttribute('disabled')).toBe(false);
    expect(screen.queryByTestId('plugin-incompatible-alert')).toBeNull();
  });

  it('lists an incompatible plugin but blocks its installation and says why', () => {
    renderPage(createPluginDetails({ compatibility: { compatible: false, minTipiVersion: '9.0.0', reason: 'min_tipi_version' } }));

    expect(screen.getByTestId('plugin-install-button').hasAttribute('disabled')).toBe(true);
    const alert = screen.getByTestId('plugin-incompatible-alert');
    expect(alert.textContent).toContain('This plugin cannot be installed');
    expect(alert.textContent).toContain('requires Runtipi 9.0.0 or higher');
  });

  it('offers update, settings and removal for an installed plugin', () => {
    renderPage(
      createPluginDetails({
        info: createPluginInfo({
          version: '2.0.0',
          tipi_version: 2,
          settings: { global: [{ type: 'text', label: 'Endpoint', env_variable: 'ENDPOINT', required: false }], per_app: [] },
        }),
        installed: {
          ...installed,
          info: createPluginInfo({
            settings: { global: [{ type: 'text', label: 'Endpoint', env_variable: 'ENDPOINT', required: false }], per_app: [] },
          }),
        },
        updateAvailable: true,
      }),
    );

    expect(screen.queryByTestId('plugin-install-button')).toBeNull();
    expect(screen.getByTestId('plugin-update-button').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('plugin-remove-button')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Disable')).toBeTruthy();
    expect(screen.getByText('Installed: 1.0.0')).toBeTruthy();
  });

  it('blocks an update whose version is incompatible', () => {
    renderPage(
      createPluginDetails({
        installed,
        updateAvailable: true,
        compatibility: { compatible: false, minTipiVersion: '9.0.0', reason: 'min_tipi_version' },
      }),
    );

    expect(screen.getByTestId('plugin-update-button').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('plugin-incompatible-alert').textContent).toContain('The latest version cannot be installed');
  });
});
