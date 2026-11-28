import { createAppUrn } from '@/common/helpers/app-helpers';
import { pLimit } from '@/common/helpers/file-helpers';
import type { AppStatus } from '@/core/database/drizzle/types';
import { Injectable } from '@nestjs/common';
import type { AppUrn } from '@runtipi/common/types';
import { AppFilesManager } from '../apps/app-files-manager';
import { AppsRepository } from '../apps/apps.repository';
import { CachedValue } from './cached-value';

export type InstalledApp = { id: number; urn: AppUrn; name: string; status: AppStatus };

const CACHE_MS = 30_000;

/** Installed apps with their display names, as shown in widget rows. */
@Injectable()
export class InstalledAppsReader {
  private readonly apps: CachedValue<InstalledApp[]>;

  constructor(
    private readonly appsRepository: AppsRepository,
    private readonly appFilesManager: AppFilesManager,
  ) {
    this.apps = new CachedValue(CACHE_MS, () => this.read());
  }

  public getApps() {
    return this.apps.get();
  }

  private async read(): Promise<InstalledApp[]> {
    const rows = await this.appsRepository.getApps();
    const limit = pLimit(10);

    return Promise.all(
      rows.map((row) =>
        limit(async () => {
          const urn = createAppUrn(row.appName, row.appStoreSlug);
          const info = await this.appFilesManager.getInstalledAppInfo(urn).catch(() => null);

          return { id: row.id, urn, name: info?.name ?? row.appName, status: row.status };
        }),
      ),
    );
  }
}
