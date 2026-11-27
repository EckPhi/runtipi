import { hiddenTypes, validateAppConfig } from '@/modules/app/components/install-form/form-validators';
import type { FormValues } from '@/modules/app/components/install-form/install-form';
import { InstallFormField } from '@/modules/app/components/install-form/install-form-field';
import type { FormField } from '@/types/app.types';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { type PluginConfigValues, type PluginInfo, normalizePluginConfig } from '../../helpers/plugin-helpers';

type PluginField = PluginInfo['settings']['global'][number];

interface Props {
  fields: PluginField[];
  formId: string;
  initialValues?: PluginConfigValues;
  loading?: boolean;
  onSubmit: (config: PluginConfigValues) => void;
}

const visibleFields = (fields: PluginField[]) => fields.filter((field) => !hiddenTypes.includes(field.type));

export const hasVisiblePluginSettings = (fields: PluginField[]) => visibleFields(fields).length > 0;

/**
 * Renders the global settings a plugin declares, with the same field components and validation as the app install form.
 */
export const PluginSettingsForm = ({ fields, formId, initialValues, loading, onSubmit }: Props) => {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: initialValues as FormValues | undefined });

  const submit = (values: FormValues) => {
    const formFields = fields as FormField[];
    const validationErrors = validateAppConfig(values, formFields);
    let valid = true;

    for (const [key, value] of Object.entries(validationErrors)) {
      if (value) {
        valid = false;
        setError(key, { message: t(value.messageKey, value.params) });
      }
    }

    if (valid) {
      onSubmit(normalizePluginConfig(values, fields));
    }
  };

  return (
    <form className="flex flex-col" onSubmit={handleSubmit(submit)} id={formId} data-testid="plugin-settings-form">
      {visibleFields(fields).map((field) => (
        <InstallFormField
          key={field.env_variable}
          field={field as FormField}
          register={register}
          control={control}
          loading={loading}
          initialValue={(initialValues?.[field.env_variable] ?? field.default) as string}
          error={errors[field.env_variable]?.message}
        />
      ))}
    </form>
  );
};
