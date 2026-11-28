import { Injectable } from '@nestjs/common';
import type { PluginWidget, WidgetSource } from '@runtipi/common/schemas';
import type { AppUrn } from '@runtipi/common/types';
import { PluginsService } from '../plugins/plugins.service';
import { CachedValue } from './cached-value';

export type RegisteredWidget = {
  key: string;
  pluginUrn: AppUrn;
  pluginName: string;
  widget: PluginWidget;
  refreshSeconds: number;
};

/** Refresh interval bounds per source, in seconds. The minimum keeps the dashboard from hammering Docker or the disk. */
export const SOURCE_REFRESH: Record<WidgetSource, { min: number; default: number }> = {
  'app-resources': { min: 10, default: 15 },
  'app-backups': { min: 30, default: 60 },
  'app-storage': { min: 300, default: 900 },
};

const CACHE_MS = 5_000;

export const getWidgetKey = (pluginUrn: string, widgetId: string) => `${pluginUrn}/${widgetId}`;

export const getRefreshSeconds = (widget: PluginWidget) => {
  const bounds = SOURCE_REFRESH[widget.source];
  return Math.max(widget.refresh_seconds ?? bounds.default, bounds.min);
};

/** Widgets declared by enabled plugins, in plugin order. */
@Injectable()
export class WidgetRegistry {
  private readonly widgets: CachedValue<RegisteredWidget[]>;

  constructor(private readonly plugins: PluginsService) {
    this.widgets = new CachedValue(CACHE_MS, () => this.read());
  }

  public getWidgets() {
    return this.widgets.get();
  }

  public async getWidget(key: string) {
    const widgets = await this.getWidgets();
    return widgets.find((widget) => widget.key === key) ?? null;
  }

  public async usesSource(source: WidgetSource) {
    const widgets = await this.getWidgets();
    return widgets.some(({ widget }) => widget.source === source);
  }

  private async read(): Promise<RegisteredWidget[]> {
    const manifests = await this.plugins.getEnabledPluginManifests();

    return manifests.flatMap((manifest) =>
      manifest.widgets.map((widget) => ({
        key: getWidgetKey(manifest.urn, widget.id),
        pluginUrn: manifest.urn,
        pluginName: manifest.name,
        widget,
        refreshSeconds: getRefreshSeconds(widget),
      })),
    );
  }
}
