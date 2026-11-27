import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PluginSettingsForm } from '../components/plugin-settings-form/plugin-settings-form';
import { type PluginInfo, normalizePluginConfig } from '../helpers/plugin-helpers';
import { renderWithProviders } from './plugin-test-utils';

const fields: PluginInfo['settings']['global'] = [
  { type: 'text', label: 'Endpoint', env_variable: 'ENDPOINT', required: true },
  { type: 'number', label: 'Retention', env_variable: 'RETENTION', required: false, min: 1, max: 30 },
  { type: 'random', label: 'Secret', env_variable: 'SECRET', required: false, min: 32 },
];

const renderForm = (onSubmit = vi.fn(), initialValues?: Record<string, string | number | boolean>) => {
  renderWithProviders(
    <>
      <PluginSettingsForm fields={fields} formId="plugin-form" onSubmit={onSubmit} initialValues={initialValues} />
      <button type="submit" form="plugin-form">
        submit
      </button>
    </>,
  );
  return onSubmit;
};

describe('PluginSettingsForm', () => {
  it('renders the declared fields and hides generated ones', () => {
    renderForm();

    expect(screen.getByPlaceholderText('Endpoint')).toBeTruthy();
    expect(screen.getByPlaceholderText('Retention')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Secret')).toBeNull();
  });

  it('submits typed values', async () => {
    const onSubmit = renderForm(vi.fn(), { ENDPOINT: 'https://s3.example.com', RETENTION: 7 });

    fireEvent.change(screen.getByPlaceholderText('Retention'), { target: { value: '14' } });
    fireEvent.click(screen.getByText('submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ ENDPOINT: 'https://s3.example.com', RETENTION: 14 }));
  });

  it('sends an explicit clear for an existing optional setting', async () => {
    const onSubmit = renderForm(vi.fn(), { ENDPOINT: 'https://s3.example.com', RETENTION: 7 });
    fireEvent.change(screen.getByPlaceholderText('Retention'), { target: { value: '' } });
    fireEvent.click(screen.getByText('submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ ENDPOINT: 'https://s3.example.com', RETENTION: '' }));
  });

  it('does not submit when a required value is missing', async () => {
    const onSubmit = renderForm();

    fireEvent.click(screen.getByText('submit'));

    await waitFor(() => expect(screen.getByPlaceholderText('Endpoint').getAttribute('aria-invalid')).toBe('true'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('normalizePluginConfig', () => {
  it('converts values to declared types and preserves explicit clears', () => {
    expect(
      normalizePluginConfig({ ENDPOINT: 'x', RETENTION: '3', FLAG: true, EMPTY: '' }, [
        ...fields,
        { type: 'boolean', label: 'Flag', env_variable: 'FLAG', required: false },
        { type: 'text', label: 'Empty', env_variable: 'EMPTY', required: false },
      ]),
    ).toEqual({ ENDPOINT: 'x', RETENTION: 3, FLAG: true, EMPTY: '' });
  });
});
