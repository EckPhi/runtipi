import translations from '../../../../../backend/src/modules/i18n/translations/en.json';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import type { ReactElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach } from 'vitest';
import type { CatalogPlugin, PluginDetails, PluginInfo } from '../helpers/plugin-helpers';

afterEach(() => cleanup());

const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  resources: { en: { translation: translations } },
});

export const createPluginInfo = (overrides: Partial<PluginInfo> = {}): PluginInfo => ({
  id: 'demo',
  urn: 'demo:store',
  name: 'Demo plugin',
  version: '1.0.0',
  tipi_version: 1,
  short_desc: 'A demo plugin',
  description: '',
  author: 'Runtipi',
  source: 'https://example.com/demo',
  available: true,
  deprecated: false,
  capabilities: ['compose', 'dashboard-widget'],
  settings: { global: [], per_app: [] },
  widgets: [],
  ...overrides,
});

export const createCatalogPlugin = (overrides: Partial<CatalogPlugin> = {}): CatalogPlugin => ({
  ...createPluginInfo(),
  installed: false,
  compatibility: { compatible: true, minTipiVersion: null, reason: null },
  ...overrides,
});

export const createPluginDetails = (overrides: Partial<PluginDetails> = {}): PluginDetails => ({
  info: createPluginInfo(),
  compatibility: { compatible: true, minTipiVersion: null, reason: null },
  installed: null,
  updateAvailable: false,
  ...overrides,
});

export const renderWithProviders = (
  ui: ReactElement,
  { path = '/', route = '/', queryClient = new QueryClient() }: { path?: string; route?: string; queryClient?: QueryClient } = {},
) => {
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
};
