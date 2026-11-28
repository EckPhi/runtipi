import { appBackupStatus, appStorageSample, user } from '@/core/database/drizzle/schema';
import { AppsRepository } from '@/modules/apps/apps.repository';
import { DashboardWidgetsRepository } from '@/modules/dashboard-widgets/dashboard-widgets.repository';
import type { AppUrn } from '@runtipi/common/types';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { cleanTestData, createTestDatabase, type TestDatabase } from '../utils/create-test-database';

const appUrn = 'demo:test' as AppUrn;
let db: TestDatabase;
let apps: AppsRepository;
let widgets: DashboardWidgetsRepository;
let appId: number;

beforeAll(async () => {
  db = await createTestDatabase('dashboard_widgets');
  apps = new AppsRepository(db);
  widgets = new DashboardWidgetsRepository(db);
});

beforeEach(async () => {
  await cleanTestData(db);
  const created = await apps.createApp({ appName: 'demo', appStoreSlug: 'test', config: {} });
  appId = created?.id as number;
});

afterAll(async () => {
  await db.$client.end();
});

test('records backup outcomes per app, keeping the last error after a success', async () => {
  await apps.recordBackupResult(appUrn, { success: false, error: 'disk full' });
  let [status] = await apps.getBackupStatuses();
  expect(status).toMatchObject({ appId, lastError: 'disk full', lastSuccessAt: null });
  expect(status?.lastErrorAt).toBeGreaterThan(0);

  await apps.recordBackupResult(appUrn, { success: true });
  [status] = await apps.getBackupStatuses();
  expect(status).toMatchObject({ appId, lastError: 'disk full' });
  expect(status?.lastSuccessAt).toBeGreaterThan(0);

  // Unknown apps are ignored rather than failing the backup.
  await apps.recordBackupResult('missing:test' as AppUrn, { success: true });
  expect(await apps.getBackupStatuses()).toHaveLength(1);
});

test('stores, reads and prunes storage samples, and removes them with the app', async () => {
  await widgets.addStorageSamples([
    { appId, sampledAt: 100, bytes: 5 * 1024 ** 4 },
    { appId, sampledAt: 200, bytes: 2 },
  ]);
  await widgets.addStorageSamples([{ appId, sampledAt: 200, bytes: 3 }]);

  expect(await widgets.getStorageSamples(0)).toEqual([
    { appId, sampledAt: 100, bytes: 5 * 1024 ** 4 },
    { appId, sampledAt: 200, bytes: 2 },
  ]);

  await widgets.deleteStorageSamplesBefore(150);
  expect(await widgets.getStorageSamples(0)).toEqual([{ appId, sampledAt: 200, bytes: 2 }]);

  await apps.recordBackupResult(appUrn, { success: true });
  await apps.deleteAppById(appId);
  expect(await db.select().from(appStorageSample)).toEqual([]);
  expect(await db.select().from(appBackupStatus)).toEqual([]);
});

test('stores hidden widgets per user', async () => {
  const [created] = await db.insert(user).values({ username: 'a@b.c', password: 'x' }).returning();
  const userId = created?.id as number;

  expect(await widgets.getHiddenWidgets(userId)).toEqual([]);

  await widgets.setHiddenWidgets(userId, ['p:s/a']);
  await widgets.setHiddenWidgets(userId, ['p:s/a', 'p:s/b']);

  expect(await widgets.getHiddenWidgets(userId)).toEqual(['p:s/a', 'p:s/b']);
});
