import { DATA_DIR } from '@/common/constants';
import { FilesystemService } from '@/core/filesystem/filesystem.service';
import { AsyncMutex } from '@/utils/mutex/async-mutex';
import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { type } from 'arktype';

const catalog = [
  {
    id: 'system-insights',
    name: 'System Insights',
    category: 'Monitoring',
    description: 'Keep an eye on your server. Live resource pressure and capacity insights, right on your dashboard.',
    permission: 'Read system metrics',
    version: '1.0.0',
  },
  {
    id: 'app-health',
    name: 'App Health',
    category: 'Applications',
    description: 'Your apps, at a glance. See what’s running, what needs attention, and which updates are waiting.',
    permission: 'Read installed apps and update status',
    version: '1.0.0',
  },
];
const stateSchema = type({ '[string]': 'boolean' });

@Injectable()
export class PluginsService {
  private readonly mutex = new AsyncMutex();
  constructor(private readonly filesystem: FilesystemService) {}

  private statePath(userId: number) {
    return `${DATA_DIR}/state/plugins/${userId}.json`;
  }

  private async readState(userId: number) {
    const file = this.statePath(userId);
    if (!(await this.filesystem.pathExists(file))) return {};
    const state = await this.filesystem.readJsonFile(file, stateSchema);
    if (!state) throw new InternalServerErrorException('Unable to read plugin settings');
    return state;
  }

  async list(userId: number) {
    const state = await this.readState(userId);
    return catalog.map((plugin) => ({ ...plugin, installed: Object.hasOwn(state, plugin.id), enabled: state[plugin.id] === true }));
  }

  async update(userId: number, id: string, action: string) {
    if (!catalog.some((plugin) => plugin.id === id)) throw new NotFoundException('Plugin not found');
    if (!['install', 'enable', 'disable', 'uninstall'].includes(action)) throw new BadRequestException('Unknown plugin action');
    const release = await this.mutex.acquire(String(userId));
    try {
      const state = await this.readState(userId);
      if ((action === 'enable' || action === 'disable') && !Object.hasOwn(state, id)) {
        throw new BadRequestException('Install the plugin first');
      }
      if (action === 'uninstall') delete state[id];
      else if (action !== 'install' || !Object.hasOwn(state, id)) state[id] = action !== 'disable';
      if (
        !(await this.filesystem.createDirectory(`${DATA_DIR}/state/plugins`)) ||
        !(await this.filesystem.writeJsonFileAtomic(this.statePath(userId), state))
      ) {
        throw new InternalServerErrorException('Unable to save plugin settings');
      }
      return this.list(userId);
    } finally {
      release();
    }
  }
}
