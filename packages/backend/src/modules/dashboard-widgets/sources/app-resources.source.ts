import { pLimit } from '@/common/helpers/file-helpers';
import { LoggerService } from '@/core/logger/logger.service';
import { Inject, Injectable } from '@nestjs/common';
import type { AppUrn } from '@runtipi/common/types';
import type Dockerode from 'dockerode';
import { DOCKERODE } from '../../docker/docker.constants';
import { HostMemoryService } from '../../system/host-memory.service';
import { getUsedCgroupMemory } from '../../system/metrics/cgroup';
import { CachedValue } from '../cached-value';
import { InstalledAppsReader } from '../installed-apps.reader';

export type AppResourceUsage = {
  urn: AppUrn;
  name: string;
  /** Share of the host's total CPU capacity, 0-100. */
  cpu: number;
  /** Used memory in bytes, without reclaimable page cache. */
  memory: number;
  containers: number;
};

export type AppResourcesSnapshot = {
  sampledAt: number;
  apps: AppResourceUsage[];
  memoryTotal: number | null;
};

type ContainerStats = Pick<Dockerode.ContainerStats, 'cpu_stats' | 'precpu_stats' | 'memory_stats'>;

const CACHE_MS = 10_000;
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';

/** The compose project name Runtipi gives an app, as used by `DockerService.getAppRuntime`. */
export const getComposeProject = (urn: AppUrn) => urn.replace(':', '_');

/**
 * CPU used between the two samples of a stats response, as a share of the whole host (all cores). `null` when the
 * response has no previous sample to compare with.
 */
export const getCpuShare = (stats: ContainerStats): number | null => {
  const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const systemDelta = (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);

  if (!stats.precpu_stats?.system_cpu_usage || systemDelta <= 0 || cpuDelta < 0) {
    return null;
  }

  return Math.min((cpuDelta / systemDelta) * 100, 100);
};

export const getMemoryUsage = (stats: ContainerStats): number | null => {
  const memory = stats.memory_stats;

  if (!Number.isFinite(memory?.usage) || memory.usage < 0) {
    return null;
  }

  return memory.stats ? getUsedCgroupMemory(memory.usage, memory.stats as unknown as Record<string, number>) : memory.usage;
};

/** Per-app CPU and memory, summed over each app's running containers. */
@Injectable()
export class AppResourcesSource {
  private readonly snapshot: CachedValue<AppResourcesSnapshot>;

  constructor(
    @Inject(DOCKERODE) private readonly docker: Dockerode,
    private readonly apps: InstalledAppsReader,
    private readonly hostMemory: HostMemoryService,
    private readonly logger: LoggerService,
  ) {
    this.snapshot = new CachedValue(CACHE_MS, () => this.read());
  }

  public getSnapshot() {
    return this.snapshot.get();
  }

  private async read(): Promise<AppResourcesSnapshot> {
    const [apps, containers, memoryTotal] = await Promise.all([
      this.apps.getApps(),
      this.docker.listContainers({ filters: { status: ['running'], label: [COMPOSE_PROJECT_LABEL] } }),
      this.hostMemory
        .getMemory()
        .then((memory) => memory.total)
        .catch(() => null),
    ]);

    const appsByProject = new Map(apps.map((app) => [getComposeProject(app.urn), app]));
    const usage = new Map<AppUrn, AppResourceUsage>();
    const limit = pLimit(5);

    await Promise.all(
      containers.map((container) =>
        limit(async () => {
          const app = appsByProject.get(container.Labels[COMPOSE_PROJECT_LABEL] ?? '');
          if (!app) return;

          let stats: ContainerStats;
          try {
            // Not one-shot: Docker then waits for a second sample so `precpu_stats` is filled in.
            stats = await this.docker.getContainer(container.Id).stats({ stream: false });
          } catch (error) {
            if (!(error instanceof Error && 'statusCode' in error && error.statusCode === 404)) {
              this.logger.debug(`Unable to read stats of container ${container.Id}:`, error);
            }
            return;
          }

          const entry = usage.get(app.urn) ?? { urn: app.urn, name: app.name, cpu: 0, memory: 0, containers: 0 };
          entry.cpu += getCpuShare(stats) ?? 0;
          entry.memory += getMemoryUsage(stats) ?? 0;
          entry.containers += 1;
          usage.set(app.urn, entry);
        }),
      ),
    );

    return { sampledAt: Date.now(), apps: [...usage.values()], memoryTotal };
  }
}
