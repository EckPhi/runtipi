import { Skeleton } from '@/components/ui/Skeleton/Skeleton';
import type { IconAperture } from '@tabler/icons-react';
import clsx from 'clsx';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { type DashboardWidget, formatRelativeTime } from '../../helpers/widget-helpers';

type Props = {
  widget: DashboardWidget;
  icon: typeof IconAperture;
  sampledAt?: number | null;
  wide?: boolean;
  children: React.ReactNode;
};

/** Frame shared by plugin widgets: the title from the plugin, the plugin name and the age of the data. */
export const WidgetCard = ({ widget, icon: IconComponent, sampledAt, wide, children }: Props) => {
  const { t, i18n } = useTranslation();
  const source = t('DASHBOARD_WIDGET_FROM_PLUGIN', { plugin: widget.pluginName });
  const updated = sampledAt ? t('DASHBOARD_WIDGET_UPDATED', { time: formatRelativeTime(sampledAt, i18n.language) }) : null;

  return (
    <div className={clsx('px-1 pt-0 pb-0', wide ? 'col-lg-6' : 'col-sm-6 col-lg-4')} data-testid={`dashboard-widget-${widget.key}`}>
      <div className="card">
        <div className="card-body d-flex flex-column">
          <div className="d-flex justify-content-between align-items-start">
            <div style={{ minWidth: 0 }}>
              <div className="h2 mb-0 font-weight-bold text-truncate">{widget.title}</div>
              <div className="text-muted small text-truncate" title={updated ?? undefined}>
                {updated ? `${source} · ${updated}` : source}
              </div>
            </div>
            <IconComponent className="flex-shrink-0" aria-hidden="true" />
          </div>
          <div className="mt-3 flex-fill d-flex flex-column">{children}</div>
        </div>
      </div>
    </div>
  );
};

export const WidgetMessage = ({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'danger' }) => (
  <output className={clsx('flex-fill d-flex align-items-center', tone === 'danger' ? 'text-danger' : 'text-muted')}>{children}</output>
);

export const WidgetLoading = () => (
  <div aria-busy="true">
    <Skeleton loading>
      <div className="h2">…</div>
    </Skeleton>
    <Skeleton loading>
      <div className="text-muted">…</div>
    </Skeleton>
  </div>
);
