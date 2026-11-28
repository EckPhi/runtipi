import { pLimit } from '@/common/helpers/file-helpers';
import { Injectable } from '@nestjs/common';
import type { AppUrn } from '@runtipi/common/types';
import { AppsRepository } from '../../apps/apps.repository';
import { BackupManager } from '../../backups/backup.manager';
import { CachedValue } from '../cached-value';
import { InstalledAppsReader } from '../installed-apps.reader';

export type AppBackupState = 'ok' | 'error' | 'none';

export type AppBackupStatus = {
  urn: AppUrn;
  name: string;
  count: number;
  /** Total size of the app's backups, in bytes. */
  size: number;
  /** Time of the newest backup, in milliseconds. */
  lastBackupAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  status: AppBackupState;
};

export type AppBackupsSnapshot = { sampledAt: number; apps: AppBackupStatus[] };

const CACHE_MS = 30_000;

/**
 * An app's backups are failing when the latest recorded attempt failed: there is an error newer than both the last
 * success and the newest archive (an archive can also come from an upload or an update).
 */
export const getBackupState = (params: { count: number; lastBackupAt: number | null; lastSuccessAt: number | null; lastErrorAt: number | null }) => {
  const lastGood = Math.max(params.lastBackupAt ?? 0, params.lastSuccessAt ?? 0);

  if (params.lastErrorAt !== null && params.lastErrorAt > lastGood) return 'error';
  return params.count > 0 ? 'ok' : 'none';
};

/** Backup count, size, last backup time and last error per app. */
@Injectable()
export class AppBackupsSource {
  private readonly snapshot: CachedValue<AppBackupsSnapshot>;

  constructor(
    private readonly apps: InstalledAppsReader,
    private readonly appsRepository: AppsRepository,
    private readonly backups: BackupManager,
  ) {
    this.snapshot = new CachedValue(CACHE_MS, () => this.read());
  }

  public getSnapshot() {
    return this.snapshot.get();
  }

  private async read(): Promise<AppBackupsSnapshot> {
    const [apps, statuses] = await Promise.all([this.apps.getApps(), this.appsRepository.getBackupStatuses()]);
    const statusByApp = new Map(statuses.map((status) => [status.appId, status]));
    const limit = pLimit(5);

    const result = await Promise.all(
      apps.map((app) =>
        limit(async (): Promise<AppBackupStatus> => {
          const files = await this.backups.listBackupsByAppId(app.urn);
          const status = statusByApp.get(app.id);
          const lastBackupAt = files.length > 0 ? Math.max(...files.map((file) => file.date)) : null;
          const lastSuccessAt = status?.lastSuccessAt ? status.lastSuccessAt * 1000 : null;
          const lastErrorAt = status?.lastErrorAt ? status.lastErrorAt * 1000 : null;

          return {
            urn: app.urn,
            name: app.name,
            count: files.length,
            size: files.reduce((total, file) => total + file.size, 0),
            lastBackupAt,
            lastError: status?.lastError ?? null,
            lastErrorAt,
            status: getBackupState({ count: files.length, lastBackupAt, lastSuccessAt, lastErrorAt }),
          };
        }),
      ),
    );

    return { sampledAt: Date.now(), apps: result };
  }
}
