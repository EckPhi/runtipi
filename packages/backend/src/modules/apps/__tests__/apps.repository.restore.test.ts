import type { Database } from '@/core/database/database.module';
import { appRestoreJournal } from '@/core/database/drizzle/schema';
import type { AppUrn } from '@runtipi/common/types';
import { fromPartial } from '@total-typescript/shoehorn';
import { expect, test, vi } from 'vitest';
import { AppsRepository } from '../apps.repository';

test('persists the restored ledger as the pending hook target in the same transaction', async () => {
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const tx = {
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { where: vi.fn(async () => undefined) };
      },
    })),
  };
  const database = fromPartial<Database>({ transaction: vi.fn(async (callback) => callback(tx)) });
  const repository = new AppsRepository(database);
  vi.spyOn(repository, 'getAppByUrn').mockResolvedValue(fromPartial({ id: 1 }));
  await repository.finishRestore('demo:test' as AppUrn, { initialized: true, migrationIds: ['old-v1'] }, 'hooks-pending');
  expect(updates.find((update) => update.table === appRestoreJournal)?.values).toEqual({
    phase: 'hooks-pending',
    targetState: { initialized: true, migrationIds: ['old-v1'] },
  });
});
