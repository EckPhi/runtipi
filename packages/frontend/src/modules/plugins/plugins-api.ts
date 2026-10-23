import { client } from '@/api-client/client.gen';
import { useAppContext } from '@/context/app-context';
import { useQuery } from '@tanstack/react-query';

export type Plugin = {
  id: string;
  name: string;
  category: string;
  description: string;
  permission: string;
  version: string;
  installed: boolean;
  enabled: boolean;
};
export type PluginAction = 'install' | 'enable' | 'disable' | 'uninstall';

export const pluginKey = (userId: number) => ['plugins', userId];

export const usePlugins = () => {
  const { user } = useAppContext();
  return useQuery({
    queryKey: pluginKey(user.id),
    queryFn: async () => {
      const { data } = await client.get<Plugin[], unknown, true>({ url: '/api/plugins', throwOnError: true });
      return data;
    },
  });
};

export const updatePlugin = async ({ id, action }: { id: string; action: PluginAction }) => {
  const { data } = await client.post<Plugin[], unknown, true>({ url: `/api/plugins/${encodeURIComponent(id)}/${action}`, throwOnError: true });
  return data;
};
