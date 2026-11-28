import { useTranslation } from 'react-i18next';
import { type WidgetData, formatWidgetValue, kindLabel } from '../../helpers/widget-helpers';

type Props = { data: Extract<WidgetData, { type: 'progress' }> };

export const ProgressWidget = ({ data }: Props) => {
  const { t, i18n } = useTranslation();
  const percent = Math.max(0, Math.min(data.percent, 100));
  const value = formatWidgetValue(t, i18n.language, data.value);
  const label = data.total ? `${value} / ${formatWidgetValue(t, i18n.language, data.total)}` : value;

  return (
    <>
      <div className="h2 mb-1" data-testid="widget-progress-value">
        {`${percent.toFixed(0)}%`}
      </div>
      <div className="mb-3 text-muted">
        {kindLabel(t, data.value.kind)} · {label}
      </div>
      <div className="progress progress-sm mt-auto">
        <div className="progress-bar bg-primary" style={{ width: `${percent.toFixed(0)}%` }} data-testid="widget-progress-bar">
          <span className="visually-hidden">{`${percent.toFixed(0)}%`}</span>
        </div>
      </div>
    </>
  );
};
