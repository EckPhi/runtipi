import { DATABASE, type Database } from '@/core/database/database.module';
import { appStorageSample, userDashboardPreference } from '@/core/database/drizzle/schema';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, gte, lt } from 'drizzle-orm';

export type StorageSample = { appId: number; sampledAt: number; bytes: number };

@Injectable()
export class DashboardWidgetsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  public async getHiddenWidgets(userId: number) {
    const rows = await this.db
      .select({ hidden: userDashboardPreference.hiddenWidgets })
      .from(userDashboardPreference)
      .where(eq(userDashboardPreference.userId, userId));
    return rows[0]?.hidden ?? [];
  }

  public async setHiddenWidgets(userId: number, hidden: string[]) {
    await this.db
      .insert(userDashboardPreference)
      .values({ userId, hiddenWidgets: hidden })
      .onConflictDoUpdate({ target: userDashboardPreference.userId, set: { hiddenWidgets: hidden } });
  }

  /** Samples taken at or after `since` (seconds), oldest first. */
  public async getStorageSamples(since: number): Promise<StorageSample[]> {
    return this.db.select().from(appStorageSample).where(gte(appStorageSample.sampledAt, since)).orderBy(asc(appStorageSample.sampledAt));
  }

  public async addStorageSamples(samples: StorageSample[]) {
    if (samples.length === 0) return;
    await this.db.insert(appStorageSample).values(samples).onConflictDoNothing();
  }

  public async deleteStorageSamplesBefore(before: number) {
    await this.db.delete(appStorageSample).where(lt(appStorageSample.sampledAt, before));
  }
}
