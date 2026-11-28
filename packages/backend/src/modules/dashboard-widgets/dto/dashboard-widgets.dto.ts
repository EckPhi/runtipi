import { WIDGET_SOURCES, WIDGET_TYPES } from '@runtipi/common/schemas';
import { type } from 'arktype';
import { createArkDto } from 'nestjs-arktype';

/**
 * What a value measures. The frontend picks the label and the formatting from it, so plugins cannot inject text into
 * the dashboard beyond the widget title.
 */
export const WIDGET_VALUE_KINDS = ['cpu', 'memory', 'size', 'growth', 'last_backup', 'backup_count', 'backup_size', 'apps', 'failures'] as const;
export type WidgetValueKind = (typeof WIDGET_VALUE_KINDS)[number];

const widgetValueSchema = type({
  kind: type.enumerated(...WIDGET_VALUE_KINDS),
  /** Percent (0-100), bytes, a count, or a timestamp in milliseconds. `null` when unknown. */
  value: type('number').or('null'),
});

const statDataSchema = type({
  type: "'stat'",
  value: widgetValueSchema,
  secondary: widgetValueSchema.or('null'),
});

const progressDataSchema = type({
  type: "'progress'",
  percent: 'number',
  value: widgetValueSchema,
  total: widgetValueSchema.or('null'),
});

const listRowSchema = type({
  urn: 'string',
  name: 'string',
  values: widgetValueSchema.array(),
  status: type("'ok' | 'error' | 'none'").or('null'),
  error: type('string').or('null'),
  /** Size of the row relative to the largest row (0-100), drawn as a bar. */
  share: type('number').or('null'),
});

const listDataSchema = type({
  type: "'list'",
  columns: type.enumerated(...WIDGET_VALUE_KINDS).array(),
  rows: listRowSchema.array(),
  /** Rows left out because of the widget's limit. */
  hiddenRows: 'number',
});

const timeseriesDataSchema = type({
  type: "'timeseries'",
  kind: type.enumerated(...WIDGET_VALUE_KINDS),
  points: type({ t: 'number', value: 'number' }).array(),
});

export const widgetDataSchema = statDataSchema.or(progressDataSchema).or(listDataSchema).or(timeseriesDataSchema);
export type WidgetData = typeof widgetDataSchema.infer;
export type WidgetValue = typeof widgetValueSchema.infer;
export type WidgetListRow = typeof listRowSchema.infer;

const widgetDefinitionSchema = type({
  key: 'string',
  pluginUrn: 'string',
  pluginName: 'string',
  widgetId: 'string',
  title: 'string',
  type: type.enumerated(...WIDGET_TYPES),
  source: type.enumerated(...WIDGET_SOURCES),
  refreshSeconds: 'number',
  hidden: 'boolean',
});

const widgetsResponseSchema = type({ widgets: widgetDefinitionSchema.array() });

const widgetDataQuerySchema = type({ key: 'string > 0' });

const widgetDataResponseSchema = type({
  key: 'string',
  /** `pending` while a sampled source has no data yet, for example right after the plugin is installed. */
  status: "'ok' | 'pending'",
  /** When the data was collected, in milliseconds. */
  sampledAt: type('number').or('null'),
  data: widgetDataSchema.or('null'),
});

const widgetPreferencesBodySchema = type({ hidden: type('string').array().atMostLength(500) });

export type WidgetDefinition = typeof widgetDefinitionSchema.infer;
export type WidgetDataResponse = typeof widgetDataResponseSchema.infer;

export class DashboardWidgetsDto extends createArkDto(widgetsResponseSchema, { name: 'DashboardWidgetsDto' }) {}
export class DashboardWidgetDataQueryDto extends createArkDto(widgetDataQuerySchema, { name: 'DashboardWidgetDataQueryDto', input: true }) {}
export class DashboardWidgetDataDto extends createArkDto(widgetDataResponseSchema, { name: 'DashboardWidgetDataDto' }) {}
export class DashboardWidgetPreferencesBodyDto extends createArkDto(widgetPreferencesBodySchema, {
  name: 'DashboardWidgetPreferencesBodyDto',
  input: true,
}) {}
