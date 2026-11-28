import { pLimit } from '@/common/helpers/file-helpers';
import { LoggerService } from '@/core/logger/logger.service';
import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { WidgetPeriod } from '@runtipi/common/schemas';
import type { AppUrn } from '@runtipi/common/types';
import { AppFilesManager } from '../../apps/app-files-manager';
import { type ScheduledCronTask, scheduleCron } from '../../queue/cron-scheduler';
import { DashboardWidgetsRepository, type StorageSample } from '../dashboard-widgets.repository';
import { InstalledAppsReader } from '../installed-apps.reader';
import { WidgetRegistry } from '../widget-registry';
import { getDirectorySize } from './directory-size';

export const PERIOD_SECONDS: Record<WidgetPeriod, number> = {
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
};

/** Samples are kept a little longer than the longest period, so a 30 day growth always has a starting point. */
const RETENTION_SECONDS = 31 * 24 * 60 * 60;
const SAMPLE_CRON = '23 */6 * * *';
const FIRST_SAMPLE_DELAY_MS = 2 * 60 * 1000;

export type AppStorageUsage = {
  urn: AppUrn;
  name: string;
  /** Size of the app-data folder at the latest sample, in bytes. */
  bytes: number;
  /** Change since the oldest sample in the period, `null` without an older sample. */
  growth: number | null;
};

export type AppStorageSnapshot = {
  /** Time of the latest sample, in milliseconds. `null` when the folders have not been sampled yet. */
  sampledAt: number | null;
  apps: AppStorageUsage[];
  /** Total size of all app-data folders at each sample run, oldest first. */
  series: { t: number; value: number }[];
};

/**
 * Summarise the samples of a period. Each sampling run stores all apps under one timestamp, so a run is a point of the
 * total series. Growth compares an app's latest sample with its oldest one in the period.
 */
export const summariseStorageSamples = (samples: StorageSample[], apps: { id: number; urn: AppUrn; name: string }[]): AppStorageSnapshot => {
  if (samples.length === 0) return { sampledAt: null, apps: [], series: [] };

  const byApp = new Map<number, StorageSample[]>();
  const totals = new Map<number, number>();

  for (const sample of samples) {
    byApp.set(sample.appId, [...(byApp.get(sample.appId) ?? []), sample]);
    totals.set(sample.sampledAt, (totals.get(sample.sampledAt) ?? 0) + sample.bytes);
  }

  const latestRun = Math.max(...samples.map((sample) => sample.sampledAt));
  const usage: AppStorageUsage[] = [];

  for (const app of apps) {
    const appSamples = (byApp.get(app.id) ?? []).sort((a, b) => a.sampledAt - b.sampledAt);
    const latest = appSamples.at(-1);
    const oldest = appSamples[0];

    // Only apps present in the latest run: an app removed since then has no current size.
    if (!latest || !oldest || latest.sampledAt !== latestRun) continue;

    usage.push({
      urn: app.urn,
      name: app.name,
      bytes: latest.bytes,
      growth: oldest.sampledAt < latest.sampledAt ? latest.bytes - oldest.bytes : null,
    });
  }

  const series = [...totals.entries()].sort(([a], [b]) => a - b).map(([t, value]) => ({ t: t * 1000, value }));

  return { sampledAt: latestRun * 1000, apps: usage, series };
};

/**
 * Size of each app's app-data folder, sampled every 6 hours to show growth. Sampling only runs while an enabled plugin
 * has a widget on this source, so instances without such a widget never walk their app data.
 */
@Injectable()
export class AppStorageSource implements OnApplicationBootstrap, OnModuleDestroy {
  private cron: ScheduledCronTask | null = null;
  private firstSample: NodeJS.Timeout | null = null;
  private sampling: Promise<void> | null = null;

  constructor(
    private readonly repository: DashboardWidgetsRepository,
    private readonly apps: InstalledAppsReader,
    private readonly appFiles: AppFilesManager,
    private readonly registry: WidgetRegistry,
    private readonly logger: LoggerService,
  ) {}

  onApplicationBootstrap() {
    this.cron = scheduleCron(SAMPLE_CRON, () => this.sampleIfUsed());
    this.firstSample = setTimeout(() => void this.sampleIfUsed(), FIRST_SAMPLE_DELAY_MS);
    this.firstSample.unref();
  }

  onModuleDestroy() {
    this.cron?.stop();
    if (this.firstSample) clearTimeout(this.firstSample);
  }

  public async getSnapshot(period: WidgetPeriod): Promise<AppStorageSnapshot> {
    const now = Math.floor(Date.now() / 1000);
    const [samples, apps] = await Promise.all([this.repository.getStorageSamples(now - PERIOD_SECONDS[period]), this.apps.getApps()]);
    const snapshot = summariseStorageSamples(samples, apps);

    if (snapshot.sampledAt === null) {
      // Right after the widget appears, or after a long downtime: take a first sample now instead of waiting for cron.
      void this.sample();
    }

    return snapshot;
  }

  public async sampleIfUsed() {
    try {
      if (await this.registry.usesSource('app-storage')) {
        await this.sample();
      }
    } catch (error) {
      this.logger.error('Failed to sample app storage:', error);
    }
  }

  /** Measure every app now. Concurrent calls share one run. */
  public sample() {
    if (!this.sampling) {
      this.sampling = this.runSample()
        .catch((error) => this.logger.error('Failed to sample app storage:', error))
        .finally(() => {
          this.sampling = null;
        });
    }

    return this.sampling;
  }

  private async runSample() {
    const apps = await this.apps.getApps();
    const sampledAt = Math.floor(Date.now() / 1000);
    const limit = pLimit(2);

    const samples = await Promise.all(
      apps.map((app) =>
        limit(async () => ({ appId: app.id, sampledAt, bytes: await getDirectorySize(this.appFiles.getAppPaths(app.urn).appDataDir) })),
      ),
    );

    await this.repository.addStorageSamples(samples);
    await this.repository.deleteStorageSamplesBefore(sampledAt - RETENTION_SECONDS);
    this.logger.debug(`Sampled the app-data size of ${samples.length} apps`);
  }
}
