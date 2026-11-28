import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { type WidgetData, formatTimestamp, formatWidgetValue, kindLabel } from '../../helpers/widget-helpers';

type Props = { data: Extract<WidgetData, { type: 'stat' }> };

export const StatWidget = ({ data }: Props) => {
  const { t, i18n } = useTranslation();
  const { value, secondary } = data;
  const alarming = value.kind === 'failures' && (value.value ?? 0) > 0;

  return (
    <>
      <div className={clsx('h2 mb-1', alarming && 'text-danger')} data-testid="widget-stat-value">
        {formatWidgetValue(t, i18n.language, value)}
      </div>
      <div className="text-muted">{kindLabel(t, value.kind)}</div>
      {secondary && (
        <div
          className="text-muted small mt-2"
          title={secondary.kind === 'last_backup' && secondary.value ? formatTimestamp(secondary.value, i18n.language) : undefined}
        >
          {kindLabel(t, secondary.kind)}: {formatWidgetValue(t, i18n.language, secondary)}
        </div>
      )}
    </>
  );
};
