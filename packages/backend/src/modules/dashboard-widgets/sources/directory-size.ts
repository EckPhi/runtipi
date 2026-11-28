import fs from 'node:fs';
import path from 'node:path';
import { pLimit } from '@/common/helpers/file-helpers';

/**
 * Disk space used by a directory tree, like `du -s`: allocated blocks, symlinks are not followed and hard-linked files
 * are counted once. Unreadable entries are skipped. Directories are walked one at a time with a bounded number of
 * concurrent `lstat` calls, so a large tree is slow rather than heavy.
 */
export const getDirectorySize = async (root: string, concurrency = 16): Promise<number> => {
  const limit = pLimit(concurrency);
  const seenInodes = new Set<string>();
  const directories = [root];
  let total = 0;

  const add = (stats: fs.Stats) => {
    if (stats.nlink > 1 && !stats.isDirectory()) {
      const inode = `${stats.dev}:${stats.ino}`;
      if (seenInodes.has(inode)) return;
      seenInodes.add(inode);
    }

    total += Number.isFinite(stats.blocks) ? stats.blocks * 512 : stats.size;
  };

  try {
    const rootStats = await fs.promises.lstat(root);
    if (!rootStats.isDirectory()) return 0;
    add(rootStats);
  } catch {
    return 0;
  }

  while (directories.length > 0) {
    const directory = directories.pop() as string;
    let entries: fs.Dirent[];

    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    await Promise.all(
      entries.map((entry) =>
        limit(async () => {
          const entryPath = path.join(directory, entry.name);

          try {
            const stats = await fs.promises.lstat(entryPath);
            add(stats);
            if (stats.isDirectory()) directories.push(entryPath);
          } catch {
            // Removed or unreadable while walking
          }
        }),
      ),
    );
  }

  return total;
};
