import { getCatalogPluginOptions, getInstalledPluginOptions } from '@/api-client/@tanstack/react-query.gen';
import { Button } from '@/components/ui/Button';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { PluginSettingsForm, hasVisiblePluginSettings } from '../components/plugin-settings-form/plugin-settings-form';
import { pluginPath } from '../helpers/plugin-helpers';
import { usePluginMutations } from '../helpers/use-plugin-mutations';

export default () => {
  const { t } = useTranslation();
  const formId = useId();
  const { pluginId, storeId } = useParams<{ pluginId: string; storeId: string }>();
  const urn = `${pluginId}:${storeId}`;

  const { data: installed } = useSuspenseQuery({ ...getInstalledPluginOptions({ path: { urn } }) });
  // The installed copy is the source of truth for settings; the store manifest is only a fallback for its name.
  const { data: catalog } = useQuery({ ...getCatalogPluginOptions({ path: { urn } }), enabled: !installed.info });

  const info = installed.info ?? catalog?.info;
  const name = info?.name ?? pluginId ?? '';
  const fields = info?.settings.global ?? [];
  const { saveConfig } = usePluginMutations(name);

  return (
    <div className="card" data-testid="plugin-settings">
      <div className="card-header">
        <h3 className="card-title">{t('PLUGIN_SETTINGS_PAGE_TITLE', { name })}</h3>
      </div>
      <div className="card-body">
        {hasVisiblePluginSettings(fields) ? (
          <PluginSettingsForm
            fields={fields}
            formId={formId}
            initialValues={installed.globalConfig}
            loading={saveConfig.isPending}
            onSubmit={(globalConfig) => saveConfig.mutate({ path: { urn }, body: { globalConfig } })}
          />
        ) : (
          <p className="text-muted mb-0">{t('PLUGIN_SETTINGS_EMPTY')}</p>
        )}
      </div>
      <div className="card-footer d-flex justify-content-end gap-2">
        <Link to={pluginPath(urn)} className="btn">
          {t('PLUGIN_SETTINGS_BACK')}
        </Link>
        {hasVisiblePluginSettings(fields) && (
          <Button type="submit" intent="success" form={formId} loading={saveConfig.isPending}>
            {t('PLUGIN_SETTINGS_SUBMIT')}
          </Button>
        )}
      </div>
    </div>
  );
};
