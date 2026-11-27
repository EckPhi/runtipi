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

  // Existing values may need correction when the target version changes their constraints or type.
  const fields = info.settings.global;
  const hasSettings = hasVisiblePluginSettings(fields);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('PLUGIN_UPDATE_FORM_TITLE', { name: info.name })}</DialogTitle>
        </DialogHeader>
        <ScrollArea maxheight={500}>
          <DialogDescription>
            <p>{t('PLUGIN_UPDATE_FORM_SUBTITLE', { current: installedVersion, latest: info.version })}</p>
            {hasSettings && <h4 className="mb-2">{t('PLUGIN_SETTINGS_TITLE')}</h4>}
            <PluginSettingsForm
              fields={fields}
              initialValues={currentConfig}
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
