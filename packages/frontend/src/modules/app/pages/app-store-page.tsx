import { getEnabledAppStoresOptions } from '@/api-client/@tanstack/react-query.gen';
import { ActionBar } from '@/components/action-bar/action-bar';
import { CategorySelector } from '@/components/category-selector/category-selector';
import { StoreSelector } from '@/components/store-selector/store-selector';
import { Input } from '@/components/ui/Input';
import { CapabilitySelector } from '@/modules/plugins/components/capability-selector/capability-selector';
import { PluginsGrid } from '@/modules/plugins/containers/plugins-grid/plugins-grid';
import { useAppStoreState } from '@/stores/app-store';
import { IconApps, IconPuzzle } from '@tabler/icons-react';
import { useSuspenseQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams, useSearchParams } from 'react-router';
import { AppsGrid } from '../containers/apps-grid/apps-grid';

export { AppStorePageSuspense } from '../containers/apps-grid/apps-grid';

type StoreTab = 'apps' | 'plugins';

export default () => {
  const params = useParams<{ storeId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedStore = searchParams.get('store') ?? undefined;
  const tab: StoreTab = searchParams.get('tab') === 'plugins' ? 'plugins' : 'apps';

  const { setCategory, category, capability, setCapability, storeId, setStoreId, search: initialSearch, setSearch } = useAppStoreState();
  const [search, setLocalSearch] = useState(initialSearch);
  const { t } = useTranslation();

  useEffect(() => {
    if (selectedStore !== storeId) {
      setStoreId(selectedStore);
    }
  }, [selectedStore, setStoreId, storeId]);

  const { data: appStores } = useSuspenseQuery({
    ...getEnabledAppStoresOptions(),
  });

  const onSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalSearch(e.target.value);
      setSearch(e.target.value);
    },
    [setSearch],
  );

  const onSelectStore = useCallback(
    (value?: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) {
          next.set('store', value);
        } else {
          next.delete('store');
        }
        return next;
      });
      setStoreId(value);
    },
    [setSearchParams, setStoreId],
  );

  const onSelectTab = (value: StoreTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === 'plugins') {
        next.set('tab', 'plugins');
      } else {
        next.delete('tab');
      }
      return next;
    });
  };

  if (params.storeId) {
    return <Navigate to={`/app-store?store=${params.storeId}`} />;
  }

  const tabs = [
    { id: 'apps' as const, label: t('APP_STORE_TAB_APPS'), Icon: IconApps },
    { id: 'plugins' as const, label: t('APP_STORE_TAB_PLUGINS'), Icon: IconPuzzle },
  ];

  return (
    <>
      <ActionBar sticky>
        <ActionBar.Left>
          <div className="nav nav-segmented flex-shrink-0" role="tablist" aria-label={t('APP_STORE_TABS_LABEL')}>
            {tabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={clsx('nav-link', { active: tab === id })}
                onClick={() => onSelectTab(id)}
                data-testid={`store-tab-${id}`}
              >
                <Icon size={16} className="me-1" />
                {label}
              </button>
            ))}
          </div>
          <Input
            value={search}
            onChange={onSearch}
            placeholder={tab === 'plugins' ? t('PLUGIN_STORE_SEARCH_PLACEHOLDER') : t('APP_STORE_SEARCH_PLACEHOLDER')}
          />
        </ActionBar.Left>
        <ActionBar.Center>
          {appStores.appStores.length > 1 ? (
            <StoreSelector initialValue={selectedStore} stores={appStores.appStores} onSelect={onSelectStore} />
          ) : null}
        </ActionBar.Center>
        <ActionBar.Right>
          {tab === 'plugins' ? (
            <CapabilitySelector initialValue={capability} onSelect={setCapability} />
          ) : (
            <CategorySelector initialValue={category} onSelect={setCategory} />
          )}
        </ActionBar.Right>
      </ActionBar>
      {tab === 'plugins' ? (
        <PluginsGrid search={search} capability={capability} storeId={storeId} />
      ) : (
        <AppsGrid search={search} category={category} storeId={storeId} />
      )}
    </>
  );
};
