import type { GetDashboardWidgetDataResponse, GetDashboardWidgetsResponse } from '@/api-client/types.gen';
import { formatBytes } from '@/components/file-size/file-size';
import type { TFunction } from 'i18next';

export type DashboardWidget = GetDashboardWidgetsResponse['widgets'][number];
export type WidgetDataResponse = GetDashboardWidgetDataResponse;
export type WidgetData = NonNullable<WidgetDataResponse['data']>;
export type WidgetValue = Extract<WidgetData, { type: 'stat' }>['value'];
export type WidgetValueKind = WidgetValue['kind'];

export const kindLabel = (t: TFunction, kind: WidgetValueKind) => t(`DASHBOARD_WIDGET_KIND_${kind.toUpperCase()}`);

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

/** "3 hours ago", "yesterday", "now": coarse on purpose, the exact time is in the tooltip. */
export const formatRelativeTime = (timestamp: number, locale: string, now = Date.now()) => {
  const seconds = Math.round((timestamp - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.trunc(seconds / size), unit);
  }

  return formatter.format(0, 'second');
};

const formatSignedBytes = (bytes: number) => {
  if (bytes === 0) return formatBytes(0);
  return `${bytes > 0 ? '+' : '−'}${formatBytes(Math.abs(bytes), 1)}`;
};

/** Format a widget value for display, from its kind. `null` values render as an em dash, or "Never" for a time. */
export const formatWidgetValue = (t: TFunction, locale: string, { kind, value }: WidgetValue) => {
  if (value === null) return kind === 'last_backup' ? t('DASHBOARD_WIDGET_NEVER') : '—';

  switch (kind) {
    case 'cpu':
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 ? 2 : 1 }).format(value)}%`;
    case 'memory':
    case 'size':
    case 'backup_size':
      return formatBytes(value, 1);
    case 'growth':
      return formatSignedBytes(value);
    case 'last_backup':
      return formatRelativeTime(value, locale);
    default:
      return new Intl.NumberFormat(locale).format(value);
  }
};

/** Exact date for tooltips, in the browser's time zone. */
export const formatTimestamp = (timestamp: number, locale: string) => new Date(timestamp).toLocaleString(locale);
