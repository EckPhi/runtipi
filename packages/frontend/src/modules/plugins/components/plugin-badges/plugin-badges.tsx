import { IconAlertTriangle } from '@tabler/icons-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'react-tooltip';
import {
  type PluginCapability,
  type PluginCompatibility,
  capabilityKey,
  iconForCapability,
  incompatibilityMessage,
} from '../../helpers/plugin-helpers';

export const CapabilityBadge = ({ capability }: { capability: PluginCapability }) => {
  const { t } = useTranslation();
  const Icon = iconForCapability[capability];

  return (
    <span className="badge bg-azure-lt me-1 mb-1">
      <Icon size={12} className="me-1" />
      {t(`${capabilityKey(capability)}_LABEL`)}
    </span>
  );
};

export const IncompatibleBadge = ({ compatibility }: { compatibility: PluginCompatibility }) => {
  const { t } = useTranslation();
  const id = useId().replace(/:/g, '');
  const message = incompatibilityMessage(compatibility);

  if (!message) {
    return null;
  }

  return (
    <>
      <span className={`badge bg-red-lt incompatible-${id}`} data-testid="plugin-incompatible-badge">
        <IconAlertTriangle size={12} className="me-1" />
        {t('PLUGIN_INCOMPATIBLE')}
      </span>
      <Tooltip className="tooltip" anchorSelect={`.incompatible-${id}`}>
        {t(message.key, message.params)}
      </Tooltip>
    </>
  );
};
