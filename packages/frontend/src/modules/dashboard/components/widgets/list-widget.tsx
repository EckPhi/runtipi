import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { type WidgetData, formatTimestamp, formatWidgetValue, kindLabel } from '../../helpers/widget-helpers';
import { WidgetMessage } from './widget-card';

type Props = { data: Extract<WidgetData, { type: 'list' }> };
type Row = Props['data']['rows'][number];

const STATUS_CLASS: Record<NonNullable<Row['status']>, string> = {
  ok: 'status-green',
  error: 'status-red',
  none: 'status-secondary',
};

const StatusDot = ({ status }: { status: NonNullable<Row['status']> }) => {
  const { t } = useTranslation();
  const label = t(`DASHBOARD_WIDGET_STATUS_${status.toUpperCase()}`);

  return (
    <span className={clsx('status-dot flex-shrink-0', STATUS_CLASS[status])} title={label}>
      <span className="visually-hidden">{label}</span>
    </span>
  );
};

export const ListWidget = ({ data }: Props) => {
  const { t, i18n } = useTranslation();

  if (data.rows.length === 0) {
    return <WidgetMessage>{t('DASHBOARD_WIDGET_EMPTY')}</WidgetMessage>;
  }

  return (
    <>
      <div className="table-responsive">
        <table className="table table-sm table-vcenter card-table mb-0">
          <thead>
            <tr>
              <th>{t('DASHBOARD_WIDGET_APP_COLUMN')}</th>
              {data.columns.map((column) => (
                <th key={column} className="text-end text-nowrap">
                  {kindLabel(t, column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.urn} data-testid="widget-list-row">
                <td className="w-50">
                  <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                    {row.status && <StatusDot status={row.status} />}
                    <span className="text-truncate">{row.name}</span>
                  </div>
                  {row.error && (
                    <div className="small text-danger text-truncate" title={row.error}>
                      {row.error}
                    </div>
                  )}
                  {row.share !== null && (
                    <div className="progress progress-sm mt-1" aria-hidden="true">
                      <div className="progress-bar bg-primary" style={{ width: `${row.share}%` }} />
                    </div>
                  )}
                </td>
                {data.columns.map((column) => {
                  const value = row.values.find((entry) => entry.kind === column) ?? { kind: column, value: null };
                  const title = column === 'last_backup' && value.value ? formatTimestamp(value.value, i18n.language) : undefined;

                  return (
                    <td key={column} className="text-end text-nowrap text-muted" title={title}>
                      {formatWidgetValue(t, i18n.language, value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.hiddenRows > 0 && <div className="small text-muted mt-2">{t('DASHBOARD_WIDGET_MORE_ROWS', { count: data.hiddenRows })}</div>}
    </>
  );
};
