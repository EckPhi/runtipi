import { Button } from '@/components/ui/Button';
import { useDisclosure } from '@/lib/hooks/use-disclosure';
import '@/modules/app/containers/app-actions/app-actions.css';
import { IconDownload, IconPlayerPause, IconPlayerPlay, IconSettings, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { PluginInstallDialog } from '../../components/dialogs/plugin-install-dialog';
import { PluginRemoveDialog } from '../../components/dialogs/plugin-remove-dialog';
import { PluginUpdateDialog } from '../../components/dialogs/plugin-update-dialog';
import { hasVisiblePluginSettings } from '../../components/plugin-settings-form/plugin-settings-form';
import { type PluginDetails, pluginPath } from '../../helpers/plugin-helpers';
import { usePluginMutations } from '../../helpers/use-plugin-mutations';

export const PluginActions = ({ details }: { details: PluginDetails }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const installDisclosure = useDisclosure();
  const updateDisclosure = useDisclosure();
  const removeDisclosure = useDisclosure();

  const { info, installed, compatibility, updateAvailable } = details;
  const { enable, disable } = usePluginMutations(info.name);
  const settingsFields = installed?.info?.settings.global ?? info.settings.global;

  if (!installed) {
    return (
      <div className="mt-1 btn-list d-flex">
        <Button
          className="action-button"
          intent="success"
          onClick={installDisclosure.open}
          disabled={!compatibility.compatible}
          data-testid="plugin-install-button"
        >
          {t('PLUGIN_ACTION_INSTALL')}
          <IconDownload className="ms-1" size={14} />
        </Button>
        <PluginInstallDialog info={info} isOpen={installDisclosure.isOpen} onClose={installDisclosure.close} />
      </div>
    );
  }

  const toggling = enable.isPending || disable.isPending;

  return (
    <div className="mt-1 btn-list d-flex flex-wrap">
      {updateAvailable && (
        <Button
          className="action-button"
          intent="success"
          onClick={updateDisclosure.open}
          disabled={!compatibility.compatible}
          data-testid="plugin-update-button"
        >
          {t('PLUGIN_ACTION_UPDATE')}
          <IconDownload className="ms-1" size={14} />
        </Button>
      )}
      {hasVisiblePluginSettings(settingsFields) && (
        <Button className="action-button" onClick={() => navigate(`${pluginPath(info.urn)}/settings`)}>
          {t('PLUGIN_ACTION_SETTINGS')}
          <IconSettings className="ms-1" size={14} />
        </Button>
      )}
      {installed.enabled ? (
        <Button className="action-button" loading={toggling} onClick={() => disable.mutate({ path: { urn: info.urn } })}>
          {t('PLUGIN_ACTION_DISABLE')}
          <IconPlayerPause className="ms-1" size={14} />
        </Button>
      ) : (
        <Button className="action-button" intent="success" loading={toggling} onClick={() => enable.mutate({ path: { urn: info.urn } })}>
          {t('PLUGIN_ACTION_ENABLE')}
          <IconPlayerPlay className="ms-1" size={14} />
        </Button>
      )}
      <Button className="action-button" intent="danger" onClick={removeDisclosure.open} data-testid="plugin-remove-button">
        {t('PLUGIN_ACTION_REMOVE')}
        <IconTrash className="ms-1" size={14} />
      </Button>
      {updateAvailable && (
        <PluginUpdateDialog
          info={info}
          installedVersion={installed.installedVersion}
          currentConfig={installed.globalConfig}
          isOpen={updateDisclosure.isOpen}
          onClose={updateDisclosure.close}
        />
      )}
      <PluginRemoveDialog info={info} isOpen={removeDisclosure.isOpen} onClose={removeDisclosure.close} />
    </div>
  );
};
