import { TranslatableError } from '@/common/error/translatable-error';
import { HttpStatus, Injectable } from '@nestjs/common';
import { DashboardWidgetsRepository } from './dashboard-widgets.repository';
import type { WidgetDataResponse, WidgetDefinition } from './dto/dashboard-widgets.dto';
import { AppBackupsSource } from './sources/app-backups.source';
import { AppResourcesSource } from './sources/app-resources.source';
import { AppStorageSource } from './sources/app-storage.source';
import { mapBackups, mapResources, mapStorage } from './widget-data.mapper';
import { type RegisteredWidget, WidgetRegistry } from './widget-registry';

const MAX_HIDDEN_WIDGETS = 500;

@Injectable()
export class DashboardWidgetsService {
  constructor(
    private readonly registry: WidgetRegistry,
    private readonly repository: DashboardWidgetsRepository,
    private readonly resources: AppResourcesSource,
    private readonly backups: AppBackupsSource,
    private readonly storage: AppStorageSource,
  ) {}

  public async getWidgets(userId: number): Promise<WidgetDefinition[]> {
    const [widgets, hidden] = await Promise.all([this.registry.getWidgets(), this.repository.getHiddenWidgets(userId)]);
    const hiddenKeys = new Set(hidden);

    return widgets.map(({ key, pluginUrn, pluginName, widget, refreshSeconds }) => ({
      key,
      pluginUrn,
      pluginName,
      widgetId: widget.id,
      title: widget.title,
      type: widget.type,
      source: widget.source,
      refreshSeconds,
      hidden: hiddenKeys.has(key),
    }));
  }

  public async getWidgetData(key: string): Promise<WidgetDataResponse> {
    const registered = await this.registry.getWidget(key);

    if (!registered) {
      throw new TranslatableError('DASHBOARD_WIDGET_ERROR_NOT_FOUND', { key }, HttpStatus.NOT_FOUND);
    }

    return this.readWidget(registered);
  }

  private async readWidget({ key, widget }: RegisteredWidget): Promise<WidgetDataResponse> {
    switch (widget.source) {
      case 'app-resources': {
        const snapshot = await this.resources.getSnapshot();
        return { key, status: 'ok', sampledAt: snapshot.sampledAt, data: mapResources(widget, snapshot) };
      }
      case 'app-backups': {
        const snapshot = await this.backups.getSnapshot();
        return { key, status: 'ok', sampledAt: snapshot.sampledAt, data: mapBackups(widget, snapshot) };
      }
      case 'app-storage': {
        const snapshot = await this.storage.getSnapshot(widget.options.period ?? '7d');

        if (snapshot.sampledAt === null) {
          return { key, status: 'pending', sampledAt: null, data: null };
        }

        return { key, status: 'ok', sampledAt: snapshot.sampledAt, data: mapStorage(widget, snapshot) };
      }
    }
  }

  /**
   * Replace the list of widgets the user has hidden. Keys of widgets that are not installed right now are kept, so a
   * widget stays hidden when its plugin is disabled and enabled again.
   */
  public async setHiddenWidgets(userId: number, hidden: string[]) {
    const keys = [...new Set(hidden.filter((key) => key.length > 0 && key.length <= 300))].slice(0, MAX_HIDDEN_WIDGETS);
    await this.repository.setHiddenWidgets(userId, keys);
  }
}
