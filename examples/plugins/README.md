# Dashboard widget plugins

A plugin with the `dashboard-widget` capability can add widgets to the dashboard. Plugins never ship frontend code: a
widget picks a **type** from a fixed set of renderers and binds it to a **data source** implemented by Runtipi.

```json
{
  "capabilities": ["dashboard-widget"],
  "widgets": [
    {
      "id": "backup-status",
      "title": "Backup status",
      "type": "list",
      "source": "app-backups",
      "refresh_seconds": 60,
      "options": { "limit": 8 }
    }
  ]
}
```

| Field             | Description                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `id`              | Unique within the plugin. Lowercase letters, digits and hyphens.                                         |
| `title`           | Shown as the widget heading.                                                                             |
| `type`            | `stat`, `progress`, `list` or `timeseries`. Each source supports some of them, see below.                |
| `source`          | `app-resources`, `app-storage` or `app-backups`.                                                         |
| `refresh_seconds` | Optional. How often the dashboard refreshes the widget. Raised to the minimum of the source.             |
| `options.limit`   | `list` only: the maximum number of rows, 1 to 50 (default 10).                                           |
| `options.metric`  | `app-resources` only: `memory` (default) or `cpu`. Sorts lists and picks the value of `stat`/`progress`. |
| `options.period`  | `app-storage` only: `24h`, `7d` (default) or `30d`. The period growth and time series cover.             |

## Data sources

| Source          | Types                        | Data                                                                                                                                     | Refresh (default / minimum) |
| --------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `app-resources` | `list`, `stat`, `progress`   | CPU (share of the host) and memory of each app's running containers, from Docker stats. `progress` shows app memory against host memory. | 15 s / 10 s                 |
| `app-storage`   | `list`, `stat`, `timeseries` | Size of each app's app-data folder, sampled every 6 hours and kept for 31 days, with the growth over the period.                         | 15 min / 5 min              |
| `app-backups`   | `list`, `stat`               | Last backup time, number and size of backups, and the last error per app. `stat` counts apps whose latest backup failed.                 | 60 s / 30 s                 |

Sources are cached in the backend, so several widgets on the same source and several open dashboards share one read.
Storage sampling only runs while an enabled plugin has an `app-storage` widget. Right after such a widget appears it
shows "Collecting data" until the first sample has been taken.

Users can hide widgets from the dashboard's **Widgets** menu. Disabling or removing the plugin removes its widgets.

## Example

[`dashboard-insights/plugin.json`](dashboard-insights/plugin.json) adds a "Backup status" and a "Per-app resource usage"
widget. To try it, copy the `dashboard-insights` folder to `plugins/` in an app store repository, then install it from
the Plugins tab of the store.
