import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PluginTile } from '../components/plugin-tile/plugin-tile';
import { createCatalogPlugin, renderWithProviders } from './plugin-test-utils';

describe('PluginTile', () => {
  it('links to the plugin and shows its capabilities', () => {
    renderWithProviders(<PluginTile plugin={createCatalogPlugin()} />);

    expect(screen.getByRole('link').getAttribute('href')).toBe('/plugins/store/demo');
    expect(screen.getByText('Compose')).toBeTruthy();
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.queryByTestId('plugin-incompatible-badge')).toBeNull();
  });

  it('flags an incompatible plugin', () => {
    renderWithProviders(
      <PluginTile plugin={createCatalogPlugin({ compatibility: { compatible: false, minTipiVersion: '9.0.0', reason: 'min_tipi_version' } })} />,
    );

    expect(screen.getByTestId('plugin-incompatible-badge').textContent).toContain('Incompatible');
  });

  it('flags an installed plugin', () => {
    renderWithProviders(<PluginTile plugin={createCatalogPlugin({ installed: true })} />);

    expect(screen.getByText('Installed')).toBeTruthy();
  });
});
