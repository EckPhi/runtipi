import {
  getDashboardWidgetDataOptions,
  getDashboardWidgetsOptions,
  getDashboardWidgetsQueryKey,
  setDashboardWidgetPreferencesMutation,
} from '@/api-client/@tanstack/react-query.gen';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/DropdownMenu';
import type { GetDashboardWidgetsResponse } from '@/api-client/types.gen';
import type { TranslatableError } from '@/types/error.types';
import { IconArchive, IconCpu, IconDatabase, IconLayoutDashboard } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { ListWidget } from '../../components/widgets/list-widget';
import { ProgressWidget } from '../../components/widgets/progress-widget';
import { StatWidget } from '../../components/widgets/stat-widget';
import { TimeseriesWidget } from '../../components/widgets/timeseries-widget';
import { WidgetCard, WidgetLoading, WidgetMessage } from '../../components/widgets/widget-card';
import type { DashboardWidget, WidgetData } from '../../helpers/widget-helpers';

const PENDING_REFRESH_MS = 30_000;

const SOURCE_ICONS = {
  'app-resources': IconCpu,
  'app-storage': IconDatabase,
  'app-backups': IconArchive,
} satisfies Record<DashboardWidget['source'], unknown>;

const WidgetBody = ({ data }: { data: WidgetData }) => {
  switch (data.type) {
    case 'stat':
      return <StatWidget data={data} />;
    case 'progress':
      return <ProgressWidget data={data} />;
    case 'list':
      return <ListWidget data={data} />;
    case 'timeseries':
      return <TimeseriesWidget data={data} />;
  }
};

const PluginWidget = ({ widget }: { widget: DashboardWidget }) => {
  const { t } = useTranslation();
  const { data, isPending, isError } = useQuery({
    ...getDashboardWidgetDataOptions({ query: { key: widget.key } }),
    // A pending source is being sampled in the background: check again soon rather than after the full interval.
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? PENDING_REFRESH_MS : widget.refreshSeconds * 1000),
  });

  let body: React.ReactNode;
  if (isPending) {
    body = <WidgetLoading />;
  } else if (isError && !data) {
    body = <WidgetMessage tone="danger">{t('DASHBOARD_WIDGET_ERROR')}</WidgetMessage>;
  } else if (!data?.data) {
    body = <WidgetMessage>{t('DASHBOARD_WIDGET_PENDING')}</WidgetMessage>;
  } else {
    body = <WidgetBody data={data.data} />;
  }

  return (
    <WidgetCard
      widget={widget}
      icon={SOURCE_ICONS[widget.source]}
      sampledAt={data?.sampledAt}
      wide={widget.type === 'list' || widget.type === 'timeseries'}
    >
      {body}
    </WidgetCard>
  );
};

/**
 * Widgets declared by installed plugins, after the system stats. Renders nothing at all while no enabled plugin declares
 * a widget, so the dashboard looks exactly as before.
 */
export const PluginWidgets = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = getDashboardWidgetsQueryKey();
  const { data } = useQuery(getDashboardWidgetsOptions());

  const preferences = useMutation({
    ...setDashboardWidgetPreferencesMutation(),
    onMutate: async ({ body }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<GetDashboardWidgetsResponse>(queryKey);
      const hidden = new Set(body.hidden);
      queryClient.setQueryData<GetDashboardWidgetsResponse>(queryKey, (current) =>
        current ? { widgets: current.widgets.map((widget) => ({ ...widget, hidden: hidden.has(widget.key) })) } : current,
      );
      return { previous };
    },
    onSuccess: (response) => {
      queryClient.setQueryData(queryKey, response);
    },
    onError: (error: TranslatableError, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error(t(error.message, error.intlParams));
    },
  });

  const widgets = data?.widgets ?? [];
  if (widgets.length === 0) return null;

  const visible = widgets.filter((widget) => !widget.hidden);

  const toggle = (key: string, shown: boolean) => {
    const hidden = widgets.filter((widget) => (widget.key === key ? !shown : widget.hidden)).map((widget) => widget.key);
    preferences.mutate({ body: { hidden } });
  };

  return (
    <section className="mt-3" aria-label={t('DASHBOARD_WIDGETS_MENU')} data-testid="plugin-widgets">
      <div className="d-flex justify-content-end px-1 mb-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="btn btn-sm" data-testid="plugin-widgets-menu">
            <IconLayoutDashboard size={16} className="me-1" aria-hidden="true" />
            {t('DASHBOARD_WIDGETS_MENU')}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('DASHBOARD_WIDGETS_MENU_LABEL')}</DropdownMenuLabel>
            {widgets.map((widget) => (
              <DropdownMenuCheckboxItem
                key={widget.key}
                checked={!widget.hidden}
                onCheckedChange={(checked) => toggle(widget.key, checked === true)}
                onSelect={(event) => event.preventDefault()}
              >
                <span className="d-flex flex-column">
                  <span>{widget.title}</span>
                  <span className="small text-muted">{widget.pluginName}</span>
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {visible.length > 0 && (
        <div className="row row-deck row-cards px-1">
          {visible.map((widget) => (
            <PluginWidget key={widget.key} widget={widget} />
          ))}
        </div>
      )}
    </section>
  );
};
