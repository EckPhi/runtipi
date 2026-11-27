import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { PluginInfo } from '../../helpers/plugin-helpers';
import { usePluginMutations } from '../../helpers/use-plugin-mutations';

interface Props {
  info: Pick<PluginInfo, 'urn' | 'name'>;
  isOpen: boolean;
  onClose: () => void;
}

export const PluginRemoveDialog = ({ info, isOpen, onClose }: Props) => {
  const { t } = useTranslation();
  const { remove } = usePluginMutations(info.name, { onSuccess: onClose });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent type="danger" size="sm">
        <DialogHeader>
          <DialogTitle>{t('PLUGIN_REMOVE_FORM_TITLE', { name: info.name })}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-center py-4">
          <IconAlertTriangle className="icon mb-2 text-danger icon-lg" />
          <h3>{t('PLUGIN_REMOVE_FORM_WARNING')}</h3>
          <span className="text-muted">{t('PLUGIN_REMOVE_FORM_SUBTITLE')}</span>
        </DialogDescription>
        <DialogFooter>
          <Button loading={remove.isPending} onClick={() => remove.mutate({ path: { urn: info.urn } })} intent="danger">
            {t('PLUGIN_REMOVE_FORM_SUBMIT')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
