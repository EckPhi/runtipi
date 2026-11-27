import type { PluginCapability } from '@/modules/plugins/helpers/plugin-helpers';
import type { AppCategory } from '@/types/app.types';
import { create } from 'zustand';

type Store = {
  search: string;
  setSearch: (textSearch: string) => void;
  category?: AppCategory;
  setCategory: (selectedCategory?: AppCategory) => void;
  sortDirection: 'asc' | 'desc';
  setSortDirection: (sortDirection: 'asc' | 'desc') => void;
  storeId?: string;
  setStoreId: (storeId?: string) => void;
  capability?: PluginCapability;
  setCapability: (capability?: PluginCapability) => void;
};

const debouncedSearch = (fn: (search: string) => void, delay: number) => {
  let timeoutId: NodeJS.Timeout;
  return (search: string) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn(search);
    }, delay);
  };
};

export const useAppStoreState = create<Store>((set) => ({
  category: undefined,
  search: '',
  setSearch: debouncedSearch((search) => set({ search }), 300),
  setCategory: (category) => set({ category }),
  sort: 'id',
  sortDirection: 'asc',
  setSortDirection: (sortDirection) => set({ sortDirection }),
  storeId: undefined,
  setStoreId: (storeId) => set({ storeId }),
  capability: undefined,
  setCapability: (capability) => set({ capability }),
}));
