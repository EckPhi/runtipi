import { getEnabledAppStoresOptions } from '@/api-client/@tanstack/react-query.gen';
import AppStorePage from '@/modules/app/pages/app-store-page';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from './plugin-test-utils';

vi.mock('@/modules/app/containers/apps-grid/apps-grid', () => ({
  AppStorePageSuspense: () => null,
  AppsGrid: ({ search }: { search: string }) => <div data-testid="apps-grid">{search}</div>,
}));

vi.mock('@/modules/plugins/containers/plugins-grid/plugins-grid', () => ({
  PluginsGrid: ({ search }: { search: string }) => <div data-testid="plugins-grid">{search}</div>,
}));

const renderStore = (route: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } } });
  queryClient.setQueryData(getEnabledAppStoresOptions().queryKey, { appStores: [] });

  return renderWithProviders(<AppStorePage />, { path: '/app-store', route, queryClient });
};

describe('App store tabs', () => {
  it('shows apps by default and switches to plugins, keeping the search', () => {
    renderStore('/app-store');

    expect(screen.getByTestId('apps-grid')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search apps')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Search apps'), { target: { value: 'tail' } });
    fireEvent.click(screen.getByTestId('store-tab-plugins'));

    expect(screen.queryByTestId('apps-grid')).toBeNull();
    expect(screen.getByTestId('plugins-grid').textContent).toBe('tail');
    expect(screen.getByPlaceholderText('Search plugins')).toBeTruthy();
    expect(screen.getByTestId('store-tab-plugins').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Choose a capability')).toBeTruthy();
  });

  it('opens the plugins tab from the URL', () => {
    renderStore('/app-store?tab=plugins');

    expect(screen.getByTestId('plugins-grid')).toBeTruthy();
  });
});
