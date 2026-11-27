import { useUIStore } from '@/stores/ui-store';
import type { AppInfoSimple } from '@/types/app.types';
import clsx from 'clsx';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

type Props = {
  apps: AppInfoSimple[];
};

export const PageTitle = ({ apps }: Props) => {
  const { t } = useTranslation();
  const activeRoute = useUIStore((state) => state.activeRoute);

  const path = window.location.pathname;
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- Explicitly ignore this rule to re-render the component when the activeRoute changes
  const pathArray = useMemo(() => path?.substring(1).split('/') || [], [activeRoute]);
  const installedAppRoute =
    pathArray[0] === 'apps' &&
    pathArray[1] &&
    pathArray[2] &&
    apps.some((app) => app.id === pathArray[2] && app.urn === `${pathArray[2]}:${pathArray[1]}`);

  const isPluginRoute = pathArray[0] === 'plugins';

  const breadcrumbLink = (index: number) => {
    // Plugins have no list page of their own: their first two segments lead back to the Plugins tab of the store.
    if (isPluginRoute && index === 0) return '/app-store?tab=plugins';
    if (isPluginRoute && index === 1) return `/app-store?tab=plugins&store=${pathArray[1]}`;
    if (installedAppRoute && index === 1) return `/app-store/${pathArray[1]}`;
    return `/${pathArray.slice(0, index + 1).join('/')}`;
  };

  const renderBreadcrumbs = () => {
    return (
      <ol className="breadcrumb" aria-label="breadcrumbs">
        {pathArray.map((breadcrumb, index) => {
          const to = breadcrumbLink(index);

          return (
            <li key={breadcrumb} className={clsx('breadcrumb-item', { active: index === pathArray.length - 1 })}>
              <Link to={to}>{breadcrumb}</Link>
            </li>
          );
        })}
      </ol>
    );
  };

  const appTitle = isPluginRoute ? undefined : apps.find((app) => app.id.split('_')[0] === pathArray.at(-1))?.name;
  const title = appTitle ?? t(`HEADER_${pathArray[0]?.toUpperCase().replace('-', '_')}`);

  return (
    <>
      <div className="page-pretitle">{renderBreadcrumbs()}</div>
      <h2 className="page-title mt-1">{title}</h2>
    </>
  );
};
