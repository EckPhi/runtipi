import {
  disablePluginMutation,
  enablePluginMutation,
  installPluginMutation,
  removePluginMutation,
  updateGlobalConfigMutation,
  updatePluginMutation,
} from '@/api-client/@tanstack/react-query.gen';
import type { TranslatableError } from '@/types/error.types';
import { type Query, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

const PLUGIN_QUERY_IDS = new Set(['searchCatalog', 'getCatalogPlugin', 'getInstalledPlugins', 'getInstalledPlugin']);

const isPluginQuery = (query: Query) => {
  const key = query.queryKey[0];
  return typeof key === 'object' && key !== null && '_id' in key && PLUGIN_QUERY_IDS.has(String(key._id));
};

/**
 * Plugin mutations with the app workflow's feedback: a toast on success or with the translated error, and the
 * catalog and installed queries refreshed afterwards.
 */
export const usePluginMutations = (name: string, options: { onSuccess?: () => void } = {}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const handlers = (successKey: string) => ({
    onSuccess: async () => {
      await queryClient.invalidateQueries({ predicate: isPluginQuery });
      toast.success(t(successKey, { name }));
      options.onSuccess?.();
    },
    onError: (e: TranslatableError) => {
      toast.error(t(e.message, e.intlParams));
    },
  });

  return {
    install: useMutation({ ...installPluginMutation(), ...handlers('PLUGIN_INSTALL_SUCCESS') }),
    update: useMutation({ ...updatePluginMutation(), ...handlers('PLUGIN_UPDATE_SUCCESS') }),
    remove: useMutation({ ...removePluginMutation(), ...handlers('PLUGIN_REMOVE_SUCCESS') }),
    enable: useMutation({ ...enablePluginMutation(), ...handlers('PLUGIN_ENABLE_SUCCESS') }),
    disable: useMutation({ ...disablePluginMutation(), ...handlers('PLUGIN_DISABLE_SUCCESS') }),
    saveConfig: useMutation({ ...updateGlobalConfigMutation(), ...handlers('PLUGIN_SETTINGS_SAVE_SUCCESS') }),
  };
};
