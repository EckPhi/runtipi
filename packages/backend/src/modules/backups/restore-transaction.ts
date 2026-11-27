import fs from 'node:fs';
import path from 'node:path';
import type { MigrationLedgerState, RestoreDirectory } from '@/core/database/drizzle/schema';
import type { FilesystemService } from '@/core/filesystem/filesystem.service';
import type { LoggerService } from '@/core/logger/logger.service';
import type { AppsRepository } from '@/modules/apps/apps.repository';
import type { AppUrn } from '@runtipi/common/types';
import { type } from 'arktype';
import { Effect } from 'effect';
import { normalizeBackupIncludes } from './backup-policy';
import { backupStep, requireFilesystemSuccess, runBackupEffect } from './backup-resources';

const ledgerSchema = type({ initialized: 'boolean', migrationIds: 'string[]' });
const directorySchema = type({ destination: 'string', staged: 'string', original: 'string', destinationExisted: 'boolean' });
const journalSchema = type({
  phase: "'prepared' | 'prepared-hook-pending' | 'recovered' | 'committed' | 'hooks-pending'",
  previousState: ledgerSchema,
  targetState: ledgerSchema,
  directories: directorySchema.array(),
});

type RestoreSource = { source: string | null; destination: string; error: string };
type RestoreJournal = typeof journalSchema.infer;

export class RestoreTransaction {
  constructor(
    private readonly appUrn: AppUrn,
    private readonly destinations: string[],
    private readonly filesystem: FilesystemService,
    private readonly appsRepository: AppsRepository,
    private readonly logger: LoggerService,
    private readonly restoreHook?: () => Promise<void>,
  ) {}

  async restore(sources: RestoreSource[], targetState: MigrationLedgerState, runHook = false) {
    const pending = await this.getPendingHookJournal();
    const previousState = await this.appsRepository.getMigrationState(this.appUrn);
    const directories = await this.stageRestoredDirectories(sources);

    try {
      if (pending) {
        // A committed restore's previous copies are never needed again; the journal swap keeps the pending hook until it is replaced.
        this.logger.warn(`Replacing the pending restore hook for ${this.appUrn} with a new restore`);
        for (const directory of pending.directories) {
          await this.assertSafeRestoreDirectory(directory);
          await requireFilesystemSuccess(
            this.filesystem.removeDirectory(directory.original),
            `Failed to remove restore directory ${directory.original}`,
          );
        }
        await this.appsRepository.replaceRestoreJournal(this.appUrn, previousState, targetState, directories);
      } else {
        await this.appsRepository.createRestoreJournal(this.appUrn, previousState, targetState, directories);
      }
    } catch (error) {
      try {
        const journal = await this.appsRepository.getRestoreJournal(this.appUrn);
        const ours = journal?.directories.some((stored) => directories.some((directory) => directory.staged === stored.staged));
        if (!ours) {
          for (const directory of directories) {
            await this.filesystem.removeDirectory(directory.staged).catch((cleanupError) => {
              this.logger.warn(`Failed to remove restore staging ${directory.staged}`, cleanupError);
            });
          }
        }
      } catch (lookupError) {
        this.logger.warn(`Cannot confirm restore journal creation for ${this.appUrn}; staging retained`, lookupError);
      }

      throw error;
    }

    await runBackupEffect(
      backupStep(() => this.swapRestoredDirectories(directories)).pipe(
        Effect.onError(() => backupStep(() => this.recover(previousState, directories, !!pending)).pipe(Effect.orDie)),
      ),
    );

    // The ledger and the commit decision must survive a lost database response together.
    await runBackupEffect(
      backupStep(() => this.appsRepository.finishRestore(this.appUrn, targetState, runHook ? 'hooks-pending' : 'committed')).pipe(
        Effect.onError(() => backupStep(() => this.reconcile()).pipe(Effect.orDie)),
      ),
    );
    if (runHook) await this.finishHook(targetState);
    await this.cleanup(directories, 'original');
  }

  // 'defer' leaves a restore waiting on its hook in place, for work that does not depend on the restored data.
  async reconcile(options: { pendingHook?: 'run' | 'defer' } = {}) {
    const stored = await this.appsRepository.getRestoreJournal(this.appUrn);
    if (!stored) {
      return;
    }

    const journal = await this.validateJournal(stored);
    if (journal.phase === 'prepared' || journal.phase === 'prepared-hook-pending') {
      const pending = journal.phase === 'prepared-hook-pending';
      await this.recover(journal.previousState, journal.directories, pending);
      if (pending) await this.reconcile(options);
      return;
    }

    if (journal.phase === 'hooks-pending') {
      if (options.pendingHook === 'defer') return;
      await this.finishHook(journal.targetState);
    }
    const directoryKind = journal.phase === 'recovered' ? 'staged' : 'original';
    await this.cleanup(journal.directories, directoryKind);
  }

  private async getPendingHookJournal() {
    // Other unfinished journals are reconciled before a restore; inserting a new journal still refuses them.
    const stored = await this.appsRepository.getRestoreJournal(this.appUrn);
    if (stored?.phase !== 'hooks-pending') return null;
    return this.validateJournal(stored);
  }

  private async finishHook(state: MigrationLedgerState) {
    if (!this.restoreHook) throw new Error('Pending restore hook cannot be recovered');
    await this.restoreHook();
    await this.appsRepository.finishRestore(this.appUrn, state, 'committed');
  }

  private async recover(previousState: MigrationLedgerState, directories: RestoreDirectory[], pendingHook = false) {
    await this.rollbackRestoredDirectories(directories);
    if (pendingHook) {
      // Keep the prepared marker until rollback and staging cleanup are both durable.
      // A retry can repeat rollback safely, then restore the previous hook obligation.
      for (const directory of directories) {
        await this.assertSafeRestoreDirectory(directory);
        await requireFilesystemSuccess(this.filesystem.removeDirectory(directory.staged), 'Failed to remove replacement restore staging');
      }
      await this.appsRepository.finishRestore(this.appUrn, previousState, 'hooks-pending');
      return;
    }
    await this.appsRepository.finishRestore(this.appUrn, previousState, 'recovered');
    await this.cleanup(directories, 'staged');
  }

  private async cleanup(directories: RestoreDirectory[], kind: 'original' | 'staged') {
    try {
      for (const directory of directories) {
        await this.assertSafeRestoreDirectory(directory);
        await requireFilesystemSuccess(this.filesystem.removeDirectory(directory[kind]), `Failed to remove restore directory ${directory[kind]}`);
      }

      await this.appsRepository.clearRestoreJournal(this.appUrn);
    } catch (error) {
      this.logger.warn(`Restore completed for ${this.appUrn}; cleanup will be retried on the next lifecycle operation`, error);
    }
  }

  private async validateJournal(value: unknown): Promise<RestoreJournal> {
    const journal = journalSchema(value);
    if (journal instanceof type.errors) {
      throw new Error('Restore journal is invalid');
    }

    for (const state of [journal.previousState, journal.targetState]) {
      if (
        new Set(state.migrationIds).size !== state.migrationIds.length ||
        state.migrationIds.some((id) => !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id))
      ) {
        throw new Error('Restore journal ledger is invalid');
      }
    }

    const destinations = new Set(journal.directories.map((directory) => directory.destination));
    const paths = journal.directories.flatMap((directory) => [directory.destination, directory.staged, directory.original]);
    const full = destinations.size === this.destinations.length && this.destinations.every((destination) => destinations.has(destination));
    if (!(full || this.arePartialDestinations([...destinations])) || new Set(paths).size !== paths.length) {
      throw new Error('Restore journal directories are invalid');
    }

    for (const directory of journal.directories) {
      await this.assertSafeRestoreDirectory(directory);
    }

    return journal;
  }

  private arePartialDestinations(destinations: string[]) {
    const root = this.destinations[0];
    if (!root) return false;
    const relative = destinations.map((destination) => path.relative(root, destination) || '.');
    try {
      return (
        destinations.every((destination) => path.isAbsolute(destination) && path.resolve(destination) === destination) &&
        normalizeBackupIncludes(relative).length === relative.length
      );
    } catch {
      return false;
    }
  }

  private async assertSafeRestoreDirectory(directory: RestoreDirectory) {
    const { destination, staged, original } = directory;
    const prefix = `.${path.basename(destination)}.restore-`;
    const suffix = path.basename(staged).slice(prefix.length);
    if (
      !(this.destinations.includes(destination) || this.arePartialDestinations([destination])) ||
      !path.basename(staged).startsWith(prefix) ||
      !/^[A-Za-z0-9]{6}$/.test(suffix) ||
      path.dirname(staged) !== path.dirname(destination) ||
      original !== `${staged}.previous`
    ) {
      throw new Error(`Restore journal directory is unsafe: ${destination}`);
    }

    for (const file of [destination, staged, original]) {
      if (!path.isAbsolute(file) || path.resolve(file) !== file || !(await this.hasCanonicalParent(file)) || !(await this.isNotSymlink(file))) {
        throw new Error(`Restore journal directories are invalid: ${file}`);
      }
    }
  }

  private async hasCanonicalParent(value: string) {
    let parent = path.dirname(value);
    while (true) {
      try {
        const stats = await fs.promises.lstat(parent);
        if (stats.isSymbolicLink()) {
          return false;
        }
        return (await fs.promises.realpath(parent)) === parent;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          return false;
        }
      }

      const nextParent = path.dirname(parent);
      if (nextParent === parent) {
        return false;
      }
      parent = nextParent;
    }
  }

  private async isNotSymlink(value: string) {
    try {
      return !(await fs.promises.lstat(value)).isSymbolicLink();
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT';
    }
  }

  private async stageRestoredDirectories(directories: RestoreSource[]): Promise<RestoreDirectory[]> {
    const replacements: RestoreDirectory[] = [];

    try {
      for (const directory of directories) {
        const destinationParent = path.dirname(directory.destination);
        if (!(await this.hasCanonicalParent(directory.destination)) || !(await this.isNotSymlink(directory.destination))) {
          throw new Error(`Restore destination is unsafe: ${directory.destination}`);
        }
        await fs.promises.mkdir(destinationParent, { recursive: true });
        if ((await fs.promises.realpath(destinationParent)) !== destinationParent || !(await this.isNotSymlink(directory.destination))) {
          throw new Error(`Restore destination is unsafe: ${directory.destination}`);
        }
        const destinationExisted = await this.filesystem.pathExists(directory.destination);
        const staged = await fs.promises.mkdtemp(path.join(destinationParent, `.${path.basename(directory.destination)}.restore-`));
        const replacement = { destination: directory.destination, staged, original: `${staged}.previous`, destinationExisted };
        if (!(await this.isNotSymlink(replacement.staged)) || !(await this.isNotSymlink(replacement.original))) {
          throw new Error(`Restore staging directory is unsafe: ${replacement.staged}`);
        }
        replacements.push(replacement);

        if (directory.source) {
          if ((await fs.promises.lstat(directory.source)).isFile()) {
            await fs.promises.rmdir(staged);
          }
          const copied = await this.filesystem.copyDirectory(directory.source, staged, { dereference: false, verbatimSymlinks: true });
          if (!copied) {
            throw new Error(directory.error);
          }
        }
      }
    } catch (error) {
      for (const replacement of replacements) {
        try {
          await requireFilesystemSuccess(this.filesystem.removeDirectory(replacement.staged), 'Failed to remove staged restore data');
        } catch (cleanupError) {
          this.logger.warn('Failed to clean an unused restore staging directory', cleanupError);
        }
      }
      throw error;
    }

    return replacements;
  }

  private async swapRestoredDirectories(replacements: RestoreDirectory[]) {
    for (const replacement of replacements) {
      await this.assertSafeRestoreDirectory(replacement);

      try {
        await fs.promises.rename(replacement.destination, replacement.original);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          throw error;
        }
      }

      await fs.promises.rename(replacement.staged, replacement.destination);
    }
  }

  private async rollbackRestoredDirectories(replacements: RestoreDirectory[]) {
    for (const replacement of [...replacements].reverse()) {
      await this.assertSafeRestoreDirectory(replacement);
      const stagedExists = await this.filesystem.pathExists(replacement.staged);
      const originalExists = await this.filesystem.pathExists(replacement.original);
      const destinationExists = await this.filesystem.pathExists(replacement.destination);

      if (originalExists) {
        if (stagedExists && destinationExists) {
          throw new Error(`Restore rollback markers conflict for ${replacement.destination}`);
        }
        if (!stagedExists && destinationExists) {
          await fs.promises.rename(replacement.destination, replacement.staged);
        }
        await fs.promises.rename(replacement.original, replacement.destination);
      } else if (!replacement.destinationExisted && !stagedExists && destinationExists) {
        const removed = await this.filesystem.removeDirectory(replacement.destination);
        if (!removed) {
          throw new Error(`Failed to remove restored directory ${replacement.destination}`);
        }
      }
    }
  }
}
