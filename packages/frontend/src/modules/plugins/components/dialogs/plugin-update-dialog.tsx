import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginConfigValues, PluginInfo } from '../../helpers/plugin-helpers';
import { usePluginMutations } from '../../helpers/use-plugin-mutations';
import { PluginSettingsForm, hasVisiblePluginSettings } from '../plugin-settings-form/plugin-settings-form';

interface Props {
  /** Manifest of the version in the store, the update target. */
  info: PluginInfo;
  installedVersion: string;
  currentConfig: PluginConfigValues;
  isOpen: boolean;
  onClose: () => void;
}

export const PluginUpdateDialog = ({ info, installedVersion, currentConfig, isOpen, onClose }: Props) => {
  const { t } = useTranslation();
  const formId = useId();
  const { update } = usePluginMutations(info.name, { onSuccess: onClose });

  // Only ask for settings the new version adds; existing values are carried over by the backend.
  const newFields = info.settings.global.filter((field) => !(field.env_variable in currentConfig));
  const hasNewSettings = hasVisiblePluginSettings(newFields);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('PLUGIN_UPDATE_FORM_TITLE', { name: info.name })}</DialogTitle>
        </DialogHeader>
        <ScrollArea maxheight={500}>
          <DialogDescription>
            <p>{t('PLUGIN_UPDATE_FORM_SUBTITLE', { current: installedVersion, latest: info.version })}</p>
            {hasNewSettings && <h4 className="mb-2">{t('PLUGIN_UPDATE_FORM_NEW_SETTINGS')}</h4>}
            <PluginSettingsForm
              fields={newFields}
              formId={formId}
              loading={update.isPending}
              onSubmit={(globalConfig) => update.mutate({ path: { urn: info.urn }, body: { globalConfig } })}
            />
          </DialogDescription>
        </ScrollArea>
        <DialogFooter>
          <Button loading={update.isPending} type="submit" intent="success" form={formId}>
            {t('PLUGIN_UPDATE_FORM_SUBMIT')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
