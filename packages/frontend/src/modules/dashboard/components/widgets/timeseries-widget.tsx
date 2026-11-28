import { useTranslation } from 'react-i18next';
import { type WidgetData, formatTimestamp, formatWidgetValue, kindLabel } from '../../helpers/widget-helpers';
import { WidgetMessage } from './widget-card';

type Props = { data: Extract<WidgetData, { type: 'timeseries' }> };

const WIDTH = 300;
const HEIGHT = 80;

/** Scale points into the chart box. A flat series is drawn through the middle. */
export const getChartPoints = (points: { t: number; value: number }[]) => {
  const times = points.map((point) => point.t);
  const values = points.map((point) => point.value);
  const [minT, maxT] = [Math.min(...times), Math.max(...times)];
  const [minV, maxV] = [Math.min(...values), Math.max(...values)];

  return points.map((point) => ({
    x: maxT > minT ? ((point.t - minT) / (maxT - minT)) * WIDTH : WIDTH / 2,
    y: maxV > minV ? HEIGHT - ((point.value - minV) / (maxV - minV)) * HEIGHT : HEIGHT / 2,
  }));
};

export const TimeseriesWidget = ({ data }: Props) => {
  const { t, i18n } = useTranslation();

  if (data.points.length < 2) {
    return <WidgetMessage>{t('DASHBOARD_WIDGET_TIMESERIES_EMPTY')}</WidgetMessage>;
  }

  const first = data.points[0];
  const last = data.points[data.points.length - 1];
  const coordinates = getChartPoints(data.points);
  const line = coordinates.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  return (
    <>
      <div className="d-flex justify-content-between align-items-baseline">
        <div className="h2 mb-1" data-testid="widget-timeseries-value">
          {last ? formatWidgetValue(t, i18n.language, { kind: data.kind, value: last.value }) : '—'}
        </div>
        {first && last && (
          <div className="text-muted small">
            {kindLabel(t, 'growth')}: {formatWidgetValue(t, i18n.language, { kind: 'growth', value: last.value - first.value })}
          </div>
        )}
      </div>
      <svg className="w-100 mt-2 text-primary" viewBox={`0 -4 ${WIDTH} ${HEIGHT + 8}`} preserveAspectRatio="none" height={HEIGHT} aria-hidden="true">
        <polygon points={`0,${HEIGHT + 4} ${line} ${WIDTH},${HEIGHT + 4}`} fill="currentColor" opacity={0.12} />
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      {first && last && (
        <div className="d-flex justify-content-between text-muted small mt-1">
          <span>{formatTimestamp(first.t, i18n.language)}</span>
          <span>{formatTimestamp(last.t, i18n.language)}</span>
        </div>
      )}
    </>
  );
};
