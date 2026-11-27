import { DatabaseService } from '@/core/database/database.service';
import { plugin } from '@/core/database/drizzle/schema';
import type { NewPlugin } from '@/core/database/drizzle/types';
import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

@Injectable()
export class PluginsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  public async getPlugins() {
    return this.databaseService.db.select().from(plugin).orderBy(asc(plugin.urn));
  }

  public async getPluginByUrn(urn: string) {
    const rows = await this.databaseService.db.select().from(plugin).where(eq(plugin.urn, urn));
    return rows[0];
  }

  public async createPlugin(data: NewPlugin) {
    const rows = await this.databaseService.db.insert(plugin).values(data).returning();
    return rows[0];
  }

  public async updatePlugin(urn: string, data: Partial<Pick<NewPlugin, 'installedVersion' | 'tipiVersion' | 'enabled' | 'globalConfig'>>) {
    const rows = await this.databaseService.db
      .update(plugin)
      .set({ ...data, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(plugin.urn, urn))
      .returning();
    return rows[0];
  }

  public async deletePlugin(urn: string) {
    await this.databaseService.db.delete(plugin).where(eq(plugin.urn, urn));
  }
}
