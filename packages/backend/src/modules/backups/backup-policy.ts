import fs from 'node:fs';
import path from 'node:path';
import type { ArchiveEntry } from '@/core/archive/archive.service';

export const backupManifestFilename = 'runtipi-backup.json';
export type BackupManifest = { version: 1; partial: true; include: string[] };

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
    !manifest.include.every((entry) => typeof entry === 'string')
  ) {
    throw new Error('Invalid backup manifest');
  }
  const include = normalizeBackupIncludes(manifest.include);
  if (JSON.stringify(include) !== JSON.stringify(manifest.include)) throw new Error('Invalid backup manifest include paths');
  return { version: 1, partial: true, include };
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
