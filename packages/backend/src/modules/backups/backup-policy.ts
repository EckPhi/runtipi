import fs from 'node:fs';
import path from 'node:path';
import type { ArchiveEntry } from '@/core/archive/archive.service';

export const backupManifestFilename = 'runtipi-backup.json';
export type BackupManifest = { version: 1; partial: true; include: string[]; migrationIds: string[] };

export function normalizeBackupIncludes(paths: string[]): string[] {
  const normalized = paths.map((value) => {
    if (!value || value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value) || value.split('/').includes('..')) {
      throw new Error('Invalid backup include path');
    }
    const result = path.posix.normalize(value).replace(/\/$/, '') || '.';
    if (result.split('/').includes('backups')) throw new Error('Backup include paths cannot contain backups directories');
    return result;
  });
  return [...new Set(normalized)]
    .sort()
    .filter((value, _index, all) => !all.some((parent) => parent !== value && (parent === '.' || value.startsWith(`${parent}/`))));
}

export function parseBackupManifest(value: unknown): BackupManifest {
  const manifest = value as Partial<BackupManifest> | null;
  if (
    !manifest ||
    manifest.version !== 1 ||
    manifest.partial !== true ||
    !Array.isArray(manifest.include) ||
    !manifest.include.every((entry) => typeof entry === 'string') ||
    !Array.isArray(manifest.migrationIds) ||
    !manifest.migrationIds.every((id) => typeof id === 'string')
  ) {
    throw new Error('Invalid backup manifest');
  }
  const include = normalizeBackupIncludes(manifest.include);
  if (JSON.stringify(include) !== JSON.stringify(manifest.include)) throw new Error('Invalid backup manifest include paths');
  return { version: 1, partial: true, include, migrationIds: manifest.migrationIds };
}

// Partial archives keep the current ledger, so their data must come from the same migration history.
export function assertSameMigrationHistory(manifest: BackupManifest, current: string[]) {
  const sorted = (ids: string[]) => JSON.stringify([...new Set(ids)].sort());
  if (sorted(manifest.migrationIds) !== sorted(current)) {
    throw new Error('Partial backup was taken with a different app migration history; restore a full backup instead');
  }
}

// A partial archive may contain selected paths and their directory ancestors, nothing else.
export function validatePartialEntries(entries: ArchiveEntry[], include: string[]) {
  for (const entry of entries) {
    const name = path.posix.normalize(entry.path).replace(/\/$/, '');
    if (name === '.' || name === backupManifestFilename || name === 'app-data') continue;
    if (!name.startsWith('app-data/')) throw new Error('Partial backup contains unexpected entries');
    const relative = name.slice('app-data/'.length);
    if (
      !include.some(
        (selected) =>
          selected === '.' ||
          relative === selected ||
          relative.startsWith(`${selected}/`) ||
          (entry.type === 'd' && selected.startsWith(`${relative}/`)),
      )
    ) {
      throw new Error('Partial backup contains unselected paths');
    }
  }
}

// Reject symlinked ancestors before selecting data or staging a restored path.
export async function assertBackupPath(root: string, relative: string) {
  let current = root;
  const segments = relative === '.' ? [] : relative.split('/');
  for (const segment of ['', ...segments]) {
    current = path.join(current, segment);
    const stats = await fs.promises.lstat(current);
    if (stats.isSymbolicLink() || (await fs.promises.realpath(current)) !== current) {
      throw new Error(`Backup path is unsafe: ${current}`);
    }
  }
}

// Restore a missing ancestor as a whole so rollback removes it. Archive ancestors hold only selected entries.
export async function partialRestoreRoots(root: string, include: string[]) {
  const roots: string[] = [];
  for (const selected of include) {
    const segments = selected === '.' ? [] : selected.split('/');
    let restoreRoot = selected;
    for (let index = 0; index < segments.length; index++) {
      const candidate = segments.slice(0, index + 1).join('/');
      const exists = await fs.promises.lstat(path.join(root, candidate)).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        },
      );
      if (!exists) {
        restoreRoot = candidate;
        break;
      }
    }
    roots.push(restoreRoot);
  }
  return normalizeBackupIncludes(roots);
}
