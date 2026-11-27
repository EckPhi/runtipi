import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PLUGIN_CAPABILITIES, type PluginCapability, capabilityKey, iconForCapability } from '../../helpers/plugin-helpers';

interface Props {
  onSelect: (value?: PluginCapability) => void;
  initialValue?: PluginCapability;
}

export const CapabilitySelector = ({ onSelect, initialValue }: Props) => {
  const { t } = useTranslation();
  const [resetCounter, setResetCounter] = useState(0);
  const [value, setValue] = useState(initialValue);

  const handleChange = (option: PluginCapability | 'clear') => {
    if (option === 'clear') {
      setValue(undefined);
      onSelect(undefined);
      setResetCounter((prev) => prev + 1);
      return;
    }
    setValue(option);
    onSelect(option);
  };

  return (
    <Select key={resetCounter.toString()} value={value} onValueChange={handleChange}>
      <SelectTrigger value={value}>
        <SelectValue placeholder={t('PLUGIN_STORE_CHOOSE_CAPABILITY')} />
      </SelectTrigger>
      <SelectContent>
        {value && (
          <>
            <SelectItem key="clear" value="clear">
              <span className="d-flex gap-2">
                <IconX size={20} />
                {t('CLEAR')}
              </span>
            </SelectItem>
            <div className="dropdown-divider" />
          </>
        )}
        {PLUGIN_CAPABILITIES.map((capability) => {
          const Icon = iconForCapability[capability];
          return (
            <SelectItem key={capability} value={capability}>
              <span className="d-flex gap-2">
                <Icon size={20} />
                {t(`${capabilityKey(capability)}_LABEL`)}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};
