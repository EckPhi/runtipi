import { type } from 'arktype';

/** How a widget is drawn. Plugins never ship frontend code, they pick one of these renderers. */
export const WIDGET_TYPES = ['stat', 'progress', 'list', 'timeseries'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Where a widget's data comes from. Each source is implemented in the backend. */
export const WIDGET_SOURCES = ['app-resources', 'app-storage', 'app-backups'] as const;
export type WidgetSource = (typeof WIDGET_SOURCES)[number];

/** Widget types each data source can produce. */
export const WIDGET_SOURCE_TYPES: Record<WidgetSource, readonly WidgetType[]> = {
  'app-resources': ['stat', 'progress', 'list'],
  'app-storage': ['stat', 'list', 'timeseries'],
  'app-backups': ['stat', 'list'],
};

export const WIDGET_METRICS = ['cpu', 'memory'] as const;
export type WidgetMetric = (typeof WIDGET_METRICS)[number];

export const WIDGET_PERIODS = ['24h', '7d', '30d'] as const;
export type WidgetPeriod = (typeof WIDGET_PERIODS)[number];

const widgetOptionsSchema = type({
  '+': 'reject',
  /** `app-resources` only: the metric to show. */
  metric: type.enumerated(...WIDGET_METRICS).optional(),
  /** `list` widgets: the maximum number of rows. */
  limit: 'number.integer >= 1 & number.integer <= 50 = 10',
  /** `app-storage` only: the period growth and time series are computed over. */
  period: type.enumerated(...WIDGET_PERIODS).optional(),
});

export const pluginWidgetSchema = type({
  '+': 'reject',
  id: type('string')
    .atLeastLength(1)
    .narrow((v, ctx) => (/^[a-z0-9][a-z0-9-]*$/.test(v) ? true : ctx.mustBe('lowercase letters, digits and hyphens only'))),
  title: 'string > 0',
  type: type.enumerated(...WIDGET_TYPES),
  source: type.enumerated(...WIDGET_SOURCES),
  /** How often the dashboard refreshes the widget. The backend raises it to the minimum of the source. */
  refresh_seconds: 'number.integer >= 5 & number.integer <= 86400 ?',
  options: widgetOptionsSchema.default(() => ({ limit: 10 })),
}).narrow((widget, ctx) => {
  if (!WIDGET_SOURCE_TYPES[widget.source].includes(widget.type)) {
    return ctx.reject({
      path: ['type'],
      expected: `one of ${WIDGET_SOURCE_TYPES[widget.source].join(', ')} for source ${widget.source}`,
      actual: widget.type,
    });
  }

  if (widget.options.metric && widget.source !== 'app-resources') {
    return ctx.reject({ path: ['options', 'metric'], expected: 'only set for source app-resources', actual: widget.options.metric });
  }

  if (widget.options.period && widget.source !== 'app-storage') {
    return ctx.reject({ path: ['options', 'period'], expected: 'only set for source app-storage', actual: widget.options.period });
  }

  return true;
});

export type PluginWidgetInput = typeof pluginWidgetSchema.inferIn;
export type PluginWidget = typeof pluginWidgetSchema.infer;
