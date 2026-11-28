import { renderWithProviders } from '@/modules/plugins/__tests__/plugin-test-utils';
import type { AppInfo, AppPluginSection } from '@/types/app.types';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InstallForm } from '../install-form';
import { fromPluginFormValues, getVisiblePluginFields, toPluginFormValues } from '../plugin-sections';

// Radix switches measure themselves, jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userSettings: { guestDashboard: false, localDomain: 'tipi.local', internalIp: '10.0.0.2', domain: 'example.com', maxBackups: 0 },
  }),
}));

const info = {
  id: 'nginx',
  urn: 'nginx:store',
  name: 'Nginx',
  port: 8080,
  exposable: true,
  dynamic_config: true,
  form_fields: [],
} as unknown as AppInfo;

const tailscale: AppPluginSection = {
  urn: 'tailscale:my.store',
  name: 'Tailscale',
  title: 'Tailscale',
  description: 'Attach this app to your tailnet.',
  applicableServices: ['nginx'],
  fields: [
    { type: 'boolean', label: 'Attach to Tailscale', env_variable: 'ENABLED', required: false, default: false },
    { type: 'text', label: 'Hostname', env_variable: 'HOSTNAME', required: true, visible_when: 'ENABLED' },
    { type: 'number', label: 'Priority', env_variable: 'PRIORITY', required: false, visible_when: 'ENABLED' },
  ],
};

const renderForm = (props: { initialValues?: Record<string, unknown>; pluginSections?: AppPluginSection[] } = {}) => {
  const onSubmit = vi.fn();
  renderWithProviders(
    <>
      <InstallForm info={info} formId="install-form" onSubmit={onSubmit} pluginSections={[tailscale]} {...props} />
      <button type="submit" form="install-form">
        submit
      </button>
    </>,
  );
  return onSubmit;
};

describe('InstallForm plugin sections', () => {
  it('renders a section per plugin after the reverse proxy settings', () => {
    renderForm();

    const section = screen.getByTestId('plugin-section-tailscale:my.store');
    expect(section.textContent).toContain('Tailscale');
    expect(section.textContent).toContain('Attach this app to your tailnet.');
    expect(screen.getByText('Reverse proxy').compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('only shows fields depending on a toggle while it is on', async () => {
    renderForm();

    expect(screen.queryByPlaceholderText('Hostname')).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: /Attach to Tailscale/ }));

    await waitFor(() => expect(screen.getByPlaceholderText('Hostname')).toBeTruthy());
  });

  it('submits the plugin settings keyed by plugin urn', async () => {
    const onSubmit = renderForm();

    fireEvent.click(screen.getByRole('switch', { name: /Attach to Tailscale/ }));
    fireEvent.change(await screen.findByPlaceholderText('Hostname'), { target: { value: 'my-nginx' } });
    fireEvent.change(screen.getByPlaceholderText('Priority'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const values = onSubmit.mock.calls[0]?.[0];
    expect(values.plugins).toEqual({ 'tailscale:my.store': { ENABLED: true, HOSTNAME: 'my-nginx', PRIORITY: 3 } });
    expect(values).not.toHaveProperty('pluginSettings');
  });

  it('does not submit when a visible plugin field is invalid', async () => {
    const onSubmit = renderForm();

    fireEvent.click(screen.getByRole('switch', { name: /Attach to Tailscale/ }));
    await screen.findByPlaceholderText('Hostname');
    fireEvent.click(screen.getByText('submit'));

    await waitFor(() => expect(screen.getByPlaceholderText('Hostname').getAttribute('aria-invalid')).toBe('true'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('starts from the stored settings and keeps the ones of other plugins', async () => {
    const onSubmit = renderForm({
      initialValues: {
        openPort: true,
        plugins: { 'tailscale:my.store': { ENABLED: true, HOSTNAME: 'stored' }, 'removed:store': { ENABLED: true } },
      },
    });

    expect((screen.getByPlaceholderText('Hostname') as HTMLInputElement).value).toBe('stored');
    fireEvent.click(screen.getByRole('switch', { name: /Attach to Tailscale/ }));
    fireEvent.click(screen.getByText('submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0].plugins).toEqual({ 'tailscale:my.store': { ENABLED: false }, 'removed:store': { ENABLED: true } });
  });

  it('leaves the form unchanged without plugin sections', async () => {
    const onSubmit = renderForm({ pluginSections: [] });

    fireEvent.click(screen.getByText('submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('plugins');
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('pluginSettings');
  });
});

describe('plugin section helpers', () => {
  it('follows visible_when chains and defaults', () => {
    const fields = [
      { type: 'boolean' as const, label: 'A', env_variable: 'A', required: false, default: true },
      { type: 'boolean' as const, label: 'B', env_variable: 'B', required: false, visible_when: 'A' },
      { type: 'text' as const, label: 'C', env_variable: 'C', required: false, visible_when: 'B' },
    ];
    const keys = (values: Record<string, unknown>) => getVisiblePluginFields(fields, values).map((field) => field.env_variable);

    expect(keys({})).toEqual(['A', 'B']);
    expect(keys({ B: true })).toEqual(['A', 'B', 'C']);
    expect(keys({ A: false, B: true })).toEqual(['A']);
  });

  it('round-trips stored settings and drops hidden and empty values', () => {
    const stored = { 'tailscale:my.store': { ENABLED: false, HOSTNAME: 'old' } };
    const form = toPluginFormValues([tailscale], stored);

    expect(form).toEqual({ p0: { ENABLED: false, HOSTNAME: 'old' } });
    expect(fromPluginFormValues([tailscale], form, stored)).toEqual({ 'tailscale:my.store': { ENABLED: false } });
    expect(fromPluginFormValues([tailscale], { p0: { ENABLED: 'true', HOSTNAME: '', PRIORITY: '2' } }, undefined)).toEqual({
      'tailscale:my.store': { ENABLED: true, PRIORITY: 2 },
    });
    expect(fromPluginFormValues([], {}, undefined)).toBeUndefined();
  });
});
