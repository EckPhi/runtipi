import { getCatalogPluginOptions } from '@/api-client/@tanstack/react-query.gen';
import { Markdown } from '@/components/markdown/markdown';
import { Alert, AlertDescription, AlertHeading, AlertIcon } from '@/components/ui/Alert/Alert';
import { IconAlertCircle, IconCircleCheck, IconCircleX, IconExternalLink } from '@tabler/icons-react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { PluginLogo } from '../components/plugin-logo/plugin-logo';
import { PluginActions } from '../containers/plugin-actions/plugin-actions';
import { type PluginDetails, capabilityKey, iconForCapability, incompatibilityMessage } from '../helpers/plugin-helpers';

const Compatibility = ({ details }: { details: PluginDetails }) => {
  const { t } = useTranslation();
  const { compatibility } = details;
  const versionOk = compatibility.reason !== 'min_tipi_version';

  return (
    <div className="d-flex align-items-center gap-1" data-testid="plugin-compatibility">
      {versionOk ? <IconCircleCheck size={16} className="text-green" /> : <IconCircleX size={16} className="text-red" />}
      <span>
        {compatibility.minTipiVersion
          ? t('PLUGIN_DETAILS_REQUIRES_VERSION', { version: compatibility.minTipiVersion })
          : t('PLUGIN_DETAILS_ANY_VERSION')}
      </span>
    </div>
  );
};

export default () => {
  const { t } = useTranslation();
  const { pluginId, storeId } = useParams<{ pluginId: string; storeId: string }>();

  const { data } = useSuspenseQuery({
    ...getCatalogPluginOptions({ path: { urn: `${pluginId}:${storeId}` } }),
  });

  const { info, installed, compatibility } = data;
  // Compatibility is about the store version: it blocks an install, or an update when one is available.
  const incompatibility = !installed || data.updateAvailable ? incompatibilityMessage(compatibility) : null;

  return (
    <div className="card" data-testid="plugin-details">
      <div className="card-header d-flex flex-column flex-md-row border-0">
        <PluginLogo size={130} />
        <div className="w-100 d-flex flex-column ms-md-3 align-items-center align-items-md-start">
          <h2 className="mt-2 mt-md-0 mb-1">{info.name}</h2>
          <div>
            <span className="mt-1 me-1">{t('PLUGIN_DETAILS_VERSION')}: </span>
            <span className="badge bg-muted mt-2 text-white">{info.version}</span>
            {installed && installed.installedVersion !== info.version && (
              <span className="ms-2 text-muted">{t('PLUGIN_DETAILS_INSTALLED_VERSION', { version: installed.installedVersion })}</span>
            )}
          </div>
          <span className="mt-1 text-muted text-center text-md-start mb-2">{info.short_desc}</span>
          <div className="mb-2 d-flex gap-2 flex-wrap justify-content-center">
            {installed ? (
              <span className={installed.enabled ? 'badge bg-green-lt' : 'badge bg-muted-lt'}>
                {installed.enabled ? t('PLUGIN_STATUS_ENABLED') : t('PLUGIN_STATUS_DISABLED')}
              </span>
            ) : (
              <span className="badge bg-muted-lt">{t('PLUGIN_STATUS_NOT_INSTALLED')}</span>
            )}
          </div>
          <PluginActions details={data} />
        </div>
      </div>
      <div className="card-body">
        {incompatibility && (
          <Alert variant="danger" className="mb-4" data-testid="plugin-incompatible-alert">
            <AlertIcon>
              <IconAlertCircle stroke={2} />
            </AlertIcon>
            <div>
              <AlertHeading>{installed ? t('PLUGIN_UPDATE_BLOCKED_TITLE') : t('PLUGIN_INSTALL_BLOCKED_TITLE')}</AlertHeading>
              <AlertDescription>{t(incompatibility.key, incompatibility.params)}</AlertDescription>
            </div>
          </Alert>
        )}
        <div className="row g-4">
          <div className="col-lg-8">
            <h3>{t('PLUGIN_DETAILS_CAPABILITIES')}</h3>
            <ul className="list-unstyled mb-4" data-testid="plugin-capabilities">
              {info.capabilities.map((capability) => {
                const Icon = iconForCapability[capability];
                return (
                  <li key={capability} className="d-flex align-items-start gap-2 mb-2">
                    <Icon size={20} className="text-azure flex-shrink-0" />
                    <div>
                      <div className="fw-bold">{t(`${capabilityKey(capability)}_LABEL`)}</div>
                      <div className="text-muted">{t(`${capabilityKey(capability)}_DESCRIPTION`)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {info.description && (
              <>
                <h3>{t('PLUGIN_DETAILS_DESCRIPTION')}</h3>
                <Markdown className="markdown" content={info.description} />
              </>
            )}
          </div>
          <div className="col-lg-4">
            <h3>{t('PLUGIN_DETAILS_INFO')}</h3>
            <dl className="row mb-0">
              <dt className="col-5">{t('PLUGIN_DETAILS_COMPATIBILITY')}</dt>
              <dd className="col-7">
                <Compatibility details={data} />
              </dd>
              <dt className="col-5">{t('PLUGIN_DETAILS_AUTHOR')}</dt>
              <dd className="col-7">{info.author}</dd>
              <dt className="col-5">{t('PLUGIN_DETAILS_SOURCE')}</dt>
              <dd className="col-7 text-truncate">
                <a href={info.source} target="_blank" rel="noreferrer">
                  {info.source}
                  <IconExternalLink size={14} className="ms-1" />
                </a>
              </dd>
              {info.website && (
                <>
                  <dt className="col-5">{t('PLUGIN_DETAILS_WEBSITE')}</dt>
                  <dd className="col-7 text-truncate">
                    <a href={info.website} target="_blank" rel="noreferrer">
                      {info.website}
                      <IconExternalLink size={14} className="ms-1" />
                    </a>
                  </dd>
                </>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
};
