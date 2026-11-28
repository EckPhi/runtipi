import { ConfigurationService } from '@/core/config/configuration.service';
import { LoggerService } from '@/core/logger/logger.service';
import { AppFilesManager } from '@/modules/apps/app-files-manager';
import { AppsRepository } from '@/modules/apps/apps.repository';
import type { PluginsService } from '@/modules/plugins/plugins.service';
import { AppEventsQueue } from '@/modules/queue/entities/app-events';
import type { AppUrn } from '@runtipi/common/types';
import { fromPartial } from '@total-typescript/shoehorn';
import { expect, test } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { AppValidationService } from '../../services/app-validation.service';
import { UpdateConfigHandler } from '../update-config.handler';

const appUrn = 'app:test' as AppUrn;

const setup = () => {
  const logger = mock<LoggerService>();
  const repository = mock<AppsRepository>();
  const events = mock<AppEventsQueue>();
  const files = mock<AppFilesManager>();
  const config = mock<ConfigurationService>();
  const plugins = mock<PluginsService>();
  plugins.resolveAppPluginConfig.mockImplementation(async (input) =>
    input && Object.keys(input).length > 0 ? (input as Awaited<ReturnType<PluginsService['resolveAppPluginConfig']>>) : undefined,
  );
  const validation = new AppValidationService(repository, config, logger, plugins);
  const handler = new UpdateConfigHandler(logger, repository, events, files, validation);

  repository.getAppByUrn.mockResolvedValue(fromPartial({ id: 1, config: {} }));
  repository.updateAppById.mockImplementation(async (_id, update) => fromPartial({ ...update, pendingRestart: true }));
  files.getInstalledAppInfo.mockResolvedValue(fromPartial({ exposable: false, port: 8080 }));
  events.publish.mockResolvedValue({ success: true, message: 'generated' });

  return { handler, repository, events, files, plugins };
};

test('ordinary settings edits still regenerate files before storing the same normalized settings', async () => {
  const { handler, repository, events } = setup();

  const result = await handler.execute(appUrn, { form: { exposed: true, domain: 'app.example.com' } });

  expect(events.publish).toHaveBeenCalledWith({
    command: 'generate_env',
    appUrn,
    requestId: result.requestId,
    form: expect.objectContaining({ exposed: false, domain: undefined, openPort: true }),
  });
  expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ form: repository.updateAppById.mock.calls[0]?.[1].config }));
});

test('rejects invalid settings without writing or publishing', async () => {
  const { handler, repository, events } = setup();

  await expect(handler.execute(appUrn, { form: { port: 80 } })).rejects.toThrow('SYSTEM_ERROR_INVALID_BODY');

  expect(repository.updateAppById).not.toHaveBeenCalled();
  expect(events.publish).not.toHaveBeenCalled();
});

test.each([
  { changed: false, pending: false, expected: false },
  { changed: true, pending: false, expected: true },
  { changed: false, pending: true, expected: true },
])('tracks actual runtime changes independently of JSON object order: $changed / $pending', async ({ changed, pending, expected }) => {
  const { handler, repository } = setup();
  const saved = {
    openPort: false,
    skipEnv: false,
    skipPull: false,
    skipRun: false,
    exposed: false,
    exposedLocal: false,
    enableAuth: false,
    APP_KEY: 'saved-key',
  };
  const form = { ...Object.fromEntries(Object.entries(saved).reverse()), APP_KEY: changed ? 'replacement-key' : 'saved-key' };
  repository.getAppByUrn.mockResolvedValueOnce(fromPartial({ id: 1, config: saved, pendingRestart: pending }));

  await handler.execute(appUrn, { form });

  expect(repository.updateAppById).toHaveBeenCalledWith(1, expect.objectContaining({ pendingRestart: expected }));
});

const tailscaleOn = { 'tailscale:store': { ENABLED: true, HOSTNAME: 'web' } };

test('stores validated plugin settings and passes the stored ones to the validation', async () => {
  const { handler, repository, plugins } = setup();
  const stored = { openPort: true, plugins: { 'old:store': { ENABLED: true } } };
  repository.getAppByUrn.mockResolvedValueOnce(fromPartial({ id: 1, config: stored, pendingRestart: false }));

  await handler.execute(appUrn, { form: { openPort: true, plugins: tailscaleOn } });

  expect(plugins.resolveAppPluginConfig).toHaveBeenCalledWith(tailscaleOn, stored.plugins);
  expect(repository.updateAppById).toHaveBeenCalledWith(1, expect.objectContaining({ config: expect.objectContaining({ plugins: tailscaleOn }) }));
});

test.each([
  { name: 'turning a plugin on', before: undefined, after: tailscaleOn, expected: true },
  { name: 'turning a plugin off', before: tailscaleOn, after: { 'tailscale:store': { ENABLED: false } }, expected: true },
  { name: 'saving the same plugin settings', before: tailscaleOn, after: tailscaleOn, expected: false },
])('marks the app as pending restart when $name', async ({ before, after, expected }) => {
  const { handler, repository } = setup();
  const saved = {
    openPort: true,
    skipEnv: false,
    skipPull: false,
    skipRun: false,
    exposed: false,
    exposedLocal: false,
    enableAuth: false,
    ...(before ? { plugins: before } : {}),
  };
  repository.getAppByUrn.mockResolvedValueOnce(fromPartial({ id: 1, config: saved, pendingRestart: false }));

  await handler.execute(appUrn, { form: { ...saved, plugins: after } });

  expect(repository.updateAppById).toHaveBeenCalledWith(1, expect.objectContaining({ pendingRestart: expected }));
});

test('apps without plugin settings keep a config without plugins', async () => {
  const { handler, repository } = setup();

  await handler.execute(appUrn, { form: { openPort: true } });

  expect(repository.updateAppById.mock.calls[0]?.[1].config).not.toHaveProperty('plugins');
});
