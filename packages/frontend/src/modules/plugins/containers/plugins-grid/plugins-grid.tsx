import { searchCatalogInfiniteOptions } from '@/api-client/@tanstack/react-query.gen';
import { EmptyPage } from '@/components/empty-page/empty-page';
import { useInfiniteScroll } from '@/lib/hooks/use-infinite-scroll';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { PluginTile } from '../../components/plugin-tile/plugin-tile';
import type { PluginCapability } from '../../helpers/plugin-helpers';

interface Props {
  search: string;
  capability?: PluginCapability;
  storeId?: string;
}

/** Plugin catalog shown in the Plugins tab of the store. */
export const PluginsGrid = ({ search, capability, storeId }: Props) => {
  const { data, hasNextPage, isFetchingNextPage, isFetching, fetchNextPage } = useInfiniteQuery({
    ...searchCatalogInfiniteOptions({ query: { search, capability, pageSize: 24, storeId } }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
  });

  const plugins = data?.pages.flatMap((page) => page.data) ?? [];

  const { lastElementRef } = useInfiniteScroll({
    fetchNextPage,
    hasNextPage: Boolean(hasNextPage),
    isFetching: isFetchingNextPage || isFetching,
  });

  if (!data) {
    return <div className="card px-3 pb-3" style={{ height: 400 }} />;
  }

  if (!plugins.length) {
    return <EmptyPage title="PLUGIN_STORE_NO_RESULTS" subtitle="PLUGIN_STORE_NO_RESULTS_SUBTITLE" />;
  }

  return (
    <div className="card px-3 pb-3" style={{ borderTopRightRadius: 0, borderTopLeftRadius: 0 }}>
      <div className="row row-cards">
        {plugins.map((plugin, index) => (
          <div ref={index === plugins.length - 1 ? lastElementRef : null} key={plugin.urn} className="cursor-pointer col-sm-6 col-lg-4 p-2 mt-4">
            <PluginTile plugin={plugin} />
          </div>
        ))}
      </div>
    </div>
  );
};
