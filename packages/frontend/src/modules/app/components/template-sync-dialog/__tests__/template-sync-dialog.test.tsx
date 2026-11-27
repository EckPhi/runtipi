import { client } from '@/api-client/client.gen';
import { renderWithProviders } from '@/modules/plugins/__tests__/plugin-test-utils';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { afterEach, expect, it, vi } from 'vitest';
import { TemplateSyncDialog } from '../template-sync-dialog';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const originalConfig = client.getConfig();
afterEach(() => {
  client.setConfig(originalConfig);
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const renderDialog = (onClose = vi.fn()) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithProviders(<TemplateSyncDialog appUrn="demo:store" isOpen onClose={onClose} />, { queryClient });
  return onClose;
};

it('keeps a failed sync open and reports the error instead of success', async () => {
  client.setConfig({ baseUrl: 'http://localhost' });
  vi.stubGlobal(
    'fetch',
    async (request: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          new Request(request).method === 'GET'
            ? { hasChanges: true, localVersion: '1', templateVersion: '2', current: '', template: '' }
            : { message: 'APP_SYNC_ERROR' },
        ),
        { status: new Request(request).method === 'GET' ? 200 : 400, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  const onClose = renderDialog();
  fireEvent.click(await screen.findByRole('button', { name: 'Sync Now' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(toast.success).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('shows a failed diff request as an error instead of no changes', async () => {
  client.setConfig({ baseUrl: 'http://localhost' });
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ message: 'APP_SYNC_ERROR' }), { status: 500 }));
  renderDialog();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Your app is already in sync with the template.')).toBeNull();
});
