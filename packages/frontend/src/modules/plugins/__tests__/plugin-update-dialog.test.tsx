import { client } from '@/api-client/client.gen';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PluginUpdateDialog } from '../components/dialogs/plugin-update-dialog';
import { createPluginInfo, renderWithProviders } from './plugin-test-utils';

const originalConfig = client.getConfig();
afterEach(() => client.setConfig(originalConfig));

it('allows correcting a carried setting for the target schema and submits only target fields', async () => {
  const requests: unknown[] = [];
  client.setConfig({
    baseUrl: 'http://localhost',
    fetch: async (input) => {
      requests.push(await new Request(input).json());
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  const onClose = vi.fn();
  renderWithProviders(
    <PluginUpdateDialog
      info={createPluginInfo({
        version: '2.0.0',
        settings: {
          global: [
            { type: 'text', env_variable: 'MODE', label: 'Mode', required: true, regex: '^new$' },
            { type: 'random', env_variable: 'SECRET', label: 'Secret' },
            { type: 'number', env_variable: 'RETRIES', label: 'Retries', required: true },
          ],
          per_app: [],
        },
      })}
      installedVersion="1.0.0"
      currentConfig={{ MODE: 'old', RETRIES: 0, SECRET: 'keep-secret', REMOVED: 'drop-me' }}
      isOpen
      onClose={onClose}
    />,
  );

  const mode = screen.getByPlaceholderText('Mode') as HTMLInputElement;
  expect(mode.value).toBe('old');
  fireEvent.change(mode, { target: { value: 'new' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(requests).toEqual([{ globalConfig: { MODE: 'new', RETRIES: 0, SECRET: 'keep-secret' } }]);
});
