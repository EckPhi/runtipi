import fs from 'node:fs';
import path from 'node:path';
import type { MigrationLedgerState, RestoreDirectory, RestorePhase } from '@/core/database/drizzle/schema';
import { FilesystemService } from '@/core/filesystem/filesystem.service';
import { LoggerService } from '@/core/logger/logger.service';
import { AppsRepository } from '@/modules/apps/apps.repository';
import type { AppUrn } from '@runtipi/common/types';
import { fromPartial } from '@total-typescript/shoehorn';
import { afterEach, expect, test, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { RestoreTransaction } from '../restore-transaction';

const previousState = { initialized: true, migrationIds: ['old-v1'] };
const targetState = { initialized: true, migrationIds: ['new-v2'] };
type StoredJournal = NonNullable<Awaited<ReturnType<AppsRepository['getRestoreJournal']>>>;

const appUrn = 'demo:test' as AppUrn;

const setup = async (phase: RestorePhase, destinationExisted = true) => {
  const logger = mock<LoggerService>();
  const filesystem = new FilesystemService(logger);
  const repository = mock<AppsRepository>();
  const directories: RestoreDirectory[] = ['app-data', 'app', 'user-config'].map((name) => {
    const destination = `/data/restore-transaction/${name}`;
    const staged = `/data/restore-transaction/.${name}.restore-Abc123`;

    return { destination, staged, original: `${staged}.previous`, destinationExisted };
  });
  const state: { ledger: MigrationLedgerState; journal: StoredJournal | undefined } = {
    ledger: previousState,
    journal: fromPartial({ phase, previousState, targetState, directories }),
  };
  repository.getMigrationState.mockImplementation(async () => state.ledger);
  repository.createRestoreJournal.mockImplementation(async (_appUrn, previousState, targetState, directories) => {
    state.journal = fromPartial({ phase: 'prepared', previousState, targetState, directories });
  });
  repository.getRestoreJournal.mockImplementation(async () => state.journal);
  repository.finishRestore.mockImplementation(async (_appUrn, ledger, nextPhase) => {
    state.ledger = ledger;
    if (state.journal) state.journal.phase = nextPhase;
  });
  repository.clearRestoreJournal.mockImplementation(async () => {
    state.journal = undefined;
  });

  for (const directory of directories) {
    await fs.promises.mkdir(directory.staged, { recursive: true });
    await fs.promises.writeFile(path.join(directory.staged, 'state'), 'target');
    if (destinationExisted) {
      await fs.promises.mkdir(directory.destination, { recursive: true });
      await fs.promises.writeFile(path.join(directory.destination, 'state'), 'previous');
    }
  }

  const transaction = new RestoreTransaction(
    appUrn,
    directories.map((directory) => directory.destination),
    filesystem,
    repository,
    logger,
  );

  return { transaction, directories, filesystem, repository, state, logger };
};

afterEach(() => vi.restoreAllMocks());

test.each([0, 1, 2, 3])('recovers an interrupted restore after %i directory swaps', async (swaps) => {
  const { transaction, directories, state } = await setup('prepared');
  for (const directory of directories.slice(0, swaps)) {
    await fs.promises.rename(directory.destination, directory.original);
    await fs.promises.rename(directory.staged, directory.destination);
  }

  await transaction.reconcile();
  await transaction.reconcile();

  for (const directory of directories) {
    await expect(fs.promises.readFile(path.join(directory.destination, 'state'), 'utf8')).resolves.toBe('previous');
    await expect(fs.promises.access(directory.original)).rejects.toThrow();
    await expect(fs.promises.access(directory.staged)).rejects.toThrow();
  }
  expect(state.ledger).toEqual(previousState);
  expect(state.journal).toBeUndefined();
});

test('recovers a crash between moving the original and installing the replacement', async () => {
  const { transaction, directories } = await setup('prepared');
  const directory = directories[0];
  if (!directory) throw new Error('Missing restore fixture');
  await fs.promises.rename(directory.destination, directory.original);

  await transaction.reconcile();

  await expect(fs.promises.readFile(path.join(directory.destination, 'state'), 'utf8')).resolves.toBe('previous');
});

test('removes a partially installed directory that did not previously exist', async () => {
  const { transaction, directories } = await setup('prepared', false);
  for (const directory of directories) {
    await fs.promises.rename(directory.staged, directory.destination);
  }

  await transaction.reconcile();
  await transaction.reconcile();

  for (const directory of directories) {
    await expect(fs.promises.access(directory.destination)).rejects.toThrow();
  }
});

test.each(['committed', 'recovered'] as const)('retries %s cleanup without overwriting later ledger changes', async (phase) => {
  const { transaction, filesystem, repository, state } = await setup(phase);
  state.ledger = { initialized: true, migrationIds: ['later-v3'] };
  const remove = vi.spyOn(filesystem, 'removeDirectory').mockResolvedValueOnce(false);

  await expect(transaction.reconcile()).resolves.toBeUndefined();
  expect(state.journal).toBeDefined();
  remove.mockRestore();
  await transaction.reconcile();

  expect(repository.finishRestore).not.toHaveBeenCalled();
  expect(state.ledger.migrationIds).toEqual(['later-v3']);
  expect(state.journal).toBeUndefined();
});

test('retains the prepared journal when rolling back the ledger fails', async () => {
  const { transaction, repository, state } = await setup('prepared');
  repository.finishRestore.mockRejectedValueOnce(new Error('ledger unavailable'));

  await expect(transaction.reconcile()).rejects.toThrow('ledger unavailable');
  expect(state.journal?.phase).toBe('prepared');
  await transaction.reconcile();
  expect(state.journal).toBeUndefined();
});

test.each(['destination', 'staged', 'original'] as const)('rejects a symlinked %s before filesystem recovery', async (entry) => {
  const { transaction, directories, repository } = await setup('prepared');
  const directory = directories[0];
  if (!directory) throw new Error('Missing restore fixture');
  await fs.promises.mkdir('/data/external', { recursive: true });
  await fs.promises.rm(directory[entry], { force: true, recursive: true });
  await fs.promises.symlink('/data/external', directory[entry]);
  const rename = vi.spyOn(fs.promises, 'rename');

  await expect(transaction.reconcile()).rejects.toThrow('Restore journal');
  expect(rename).not.toHaveBeenCalled();
  expect(repository.finishRestore).not.toHaveBeenCalled();
});

test('rejects forged journal paths outside the canonical restore staging area', async () => {
  const { transaction, directories } = await setup('prepared');
  const directory = directories[0];
  if (!directory) throw new Error('Missing restore fixture');
  directory.staged = '/data/external';
  directory.original = '/data/external.previous';
  const rename = vi.spyOn(fs.promises, 'rename');

  await expect(transaction.reconcile()).rejects.toThrow('Restore journal');
  expect(rename).not.toHaveBeenCalled();
});

test('keeps the committed restore when its database response is lost', async () => {
  const { transaction, directories, repository, state } = await setup('prepared');
  const finish = repository.finishRestore.getMockImplementation();
  repository.finishRestore.mockImplementationOnce(async (...args) => {
    await finish?.(...args);
    throw new Error('connection lost after commit');
  });

  await expect(
    transaction.restore(
      directories.map((directory) => ({ source: directory.staged, destination: directory.destination, error: 'copy failed' })),
      targetState,
    ),
  ).rejects.toThrow('connection lost after commit');

  for (const directory of directories) {
    await expect(fs.promises.readFile(path.join(directory.destination, 'state'), 'utf8')).resolves.toBe('target');
  }
  expect(state.ledger).toEqual(targetState);
  expect(state.journal).toBeUndefined();
  expect(repository.finishRestore).toHaveBeenCalledTimes(1);
});

test('preserves the original and recovery failures when the database remains unavailable', async () => {
  const { transaction, directories, repository, state } = await setup('prepared');
  repository.finishRestore.mockRejectedValue(new Error('ledger unavailable'));

  const failure = await transaction
    .restore(
      directories.map((directory) => ({ source: directory.staged, destination: directory.destination, error: 'copy failed' })),
      targetState,
    )
    .catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(AggregateError);
  if (!(failure instanceof AggregateError)) throw new Error('Expected aggregated recovery failure');
  expect(failure.errors).toHaveLength(2);
  expect(state.journal?.phase).toBe('prepared');
  for (const directory of directories) {
    await expect(fs.promises.readFile(path.join(directory.destination, 'state'), 'utf8')).resolves.toBe('previous');
  }
});

test('recovers an interrupted app-data-only restore with the previous migration state', async () => {
  const { transaction, directories, state } = await setup('prepared');
  const data = directories[0]!;
  state.journal!.directories = [data];
  await fs.promises.rename(data.destination, data.original);
  await fs.promises.rename(data.staged, data.destination);
  await transaction.reconcile();
  expect(await fs.promises.readFile(path.join(data.destination, 'state'), 'utf8')).toBe('previous');
  expect(state.ledger).toEqual(previousState);
  expect(state.journal).toBeUndefined();
});

test('rejects a single-directory journal for anything except app-data', async () => {
  const { transaction, directories, state } = await setup('prepared');
  state.journal!.directories = [directories[1]!];
  await expect(transaction.reconcile()).rejects.toThrow();
  expect(state.journal?.phase).toBe('prepared');
});

test('rolls back selected files after an interrupted multi-path partial restore', async () => {
  const { transaction, directories, state } = await setup('prepared');
  const root = directories[0]!.destination;
  const selections = ['dump.sql', 'config/settings.json'].map((name, index) => {
    const destination = path.join(root, name);
    const staged = path.join(path.dirname(destination), `.${path.basename(destination)}.restore-Abc12${index}`);
    return { destination, staged, original: `${staged}.previous`, destinationExisted: true };
  });
  state.journal!.directories = selections;
  for (const selected of selections) {
    await fs.promises.mkdir(path.dirname(selected.destination), { recursive: true });
    await fs.promises.writeFile(selected.destination, 'previous');
    await fs.promises.writeFile(selected.staged, 'saved');
  }
  await fs.promises.rename(selections[0]!.destination, selections[0]!.original);
  await fs.promises.rename(selections[0]!.staged, selections[0]!.destination);
  await transaction.reconcile();
  for (const selected of selections) {
    expect(await fs.promises.readFile(selected.destination, 'utf8')).toBe('previous');
    await expect(fs.promises.access(selected.original)).rejects.toThrow();
  }
  expect(await fs.promises.readFile(path.join(root, 'state'), 'utf8')).toBe('previous');
  expect(state.journal).toBeUndefined();
});

test.each([0, 1, 3])('preserves a pending hook after replacement crashes with %i swaps', async (swaps) => {
  const { transaction, directories, state } = await setup('prepared');
  state.journal!.phase = 'prepared-hook-pending' as RestorePhase;
  for (const directory of directories.slice(0, swaps)) {
    await fs.promises.rename(directory.destination, directory.original);
    await fs.promises.rename(directory.staged, directory.destination);
  }
  await transaction.reconcile({ pendingHook: 'defer' });
  expect(state.journal?.phase).toBe('hooks-pending');
  expect(state.ledger).toEqual(previousState);
  for (const directory of directories) {
    expect(await fs.promises.readFile(path.join(directory.destination, 'state'), 'utf8')).toBe('previous');
    await expect(fs.promises.access(directory.staged)).rejects.toThrow();
  }
  // No callback is installed in this fixture: lifecycle work must still refuse to proceed.
  await expect(transaction.reconcile()).rejects.toThrow('Pending restore hook');
  expect(state.journal?.phase).toBe('hooks-pending');
});
