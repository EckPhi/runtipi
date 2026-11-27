import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { type PluginInfo, capabilityKey, iconForCapability } from '../../helpers/plugin-helpers';
import { usePluginMutations } from '../../helpers/use-plugin-mutations';
import { PluginSettingsForm, hasVisiblePluginSettings } from '../plugin-settings-form/plugin-settings-form';

interface Props {
  info: PluginInfo;
  isOpen: boolean;
  onClose: () => void;
}

export const PluginCapabilitySummary = ({ info }: { info: PluginInfo }) => {
  const { t } = useTranslation();

  return (
    <div className="mb-3">
      <h4 className="mb-2">{t('PLUGIN_INSTALL_FORM_CAPABILITIES')}</h4>
      <ul className="list-unstyled mb-0">
        {info.capabilities.map((capability) => {
          const Icon = iconForCapability[capability];
          return (
            <li key={capability} className="d-flex align-items-center gap-2 mb-1 text-muted">
              <Icon size={16} />
              {t(`${capabilityKey(capability)}_DESCRIPTION`)}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export const PluginInstallDialog = ({ info, isOpen, onClose }: Props) => {
  const { t } = useTranslation();
  const formId = useId();
  const { install } = usePluginMutations(info.name, { onSuccess: onClose });
  const fields = info.settings.global;
  const hasSettings = hasVisiblePluginSettings(fields);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('PLUGIN_INSTALL_FORM_TITLE', { name: info.name })}</DialogTitle>
        </DialogHeader>
        <ScrollArea maxheight={500}>
          <DialogDescription>
            <PluginCapabilitySummary info={info} />
            {hasSettings && <h4 className="mb-2">{t('PLUGIN_SETTINGS_TITLE')}</h4>}
            <PluginSettingsForm
              fields={fields}
              formId={formId}
              loading={install.isPending}
              onSubmit={(globalConfig) => install.mutate({ path: { urn: info.urn }, body: { globalConfig } })}
            />
          </DialogDescription>
        </ScrollArea>
        <DialogFooter>
          <Button loading={install.isPending} type="submit" intent="success" form={formId}>
            {t('PLUGIN_INSTALL_FORM_SUBMIT')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
