import type { AppPluginSection, PluginAppField } from '@/types/app.types';

export type PluginConfigValues = Record<string, string | number | boolean>;
type SectionFormValues = Record<string, unknown>;
type PluginFormValues = Record<string, SectionFormValues | undefined>;

/**
 * Form key holding the values of the plugin sections while the form is edited. Values are grouped by section index
 * rather than plugin urn because store slugs can contain dots, which react-hook-form reads as nested paths.
 */
export const PLUGIN_FORM_KEY = 'pluginSettings';

const sectionKey = (index: number) => `p${index}`;

export const pluginFieldName = (index: number, envVariable: string) => `${PLUGIN_FORM_KEY}.${sectionKey(index)}.${envVariable}`;

export const getSectionValues = (values: unknown, index: number): SectionFormValues =>
  ((values as PluginFormValues | undefined)?.[sectionKey(index)] ?? {}) as SectionFormValues;

/**
 * The fields of a plugin section that show for the given values. A field with `visible_when` shows while that boolean
 * field is on (or defaults to on) and is shown itself. Mirrors the backend validation, which drops hidden values.
 */
export const getVisiblePluginFields = (fields: PluginAppField[], values: SectionFormValues) => {
  const byKey = new Map(fields.map((field) => [field.env_variable, field]));

  const isVisible = (field: PluginAppField, seen: Set<string>): boolean => {
    if (!field.visible_when) return true;
    if (seen.has(field.env_variable)) return false;

    const controller = byKey.get(field.visible_when);
    if (!controller) return false;

    const value = values[controller.env_variable] ?? controller.default;
    return (value === true || value === 'true') && isVisible(controller, new Set([...seen, field.env_variable]));
  };

  return fields.filter((field) => isVisible(field, new Set()));
};

/**
 * Initial form values of the plugin sections, from the settings stored in `app.config.plugins`.
 */
export const toPluginFormValues = (sections: AppPluginSection[], stored: unknown) => {
  const storedPlugins = (stored ?? {}) as Record<string, PluginConfigValues | undefined>;

  return Object.fromEntries(sections.map((section, index) => [sectionKey(index), { ...storedPlugins[section.urn] }]));
};

const normalizeValue = (field: PluginAppField, value: unknown): string | number | boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (field.type === 'boolean') return value === true || value === 'true';
  if (field.type === 'number') return Number(value);
  return String(value);
};

/**
 * Turn the values of the plugin sections back into `app.config.plugins`. Settings of plugins without a section here
 * (not applicable, disabled or uninstalled) are passed through unchanged.
 */
export const fromPluginFormValues = (sections: AppPluginSection[], formValues: unknown, stored: unknown) => {
  const plugins: Record<string, PluginConfigValues> = { ...((stored ?? {}) as Record<string, PluginConfigValues>) };

  sections.forEach((section, index) => {
    const values = getSectionValues(formValues, index);
    const config: PluginConfigValues = {};

    for (const field of getVisiblePluginFields(section.fields, values)) {
      const value = normalizeValue(field, values[field.env_variable]);
      if (value !== undefined) config[field.env_variable] = value;
    }

    plugins[section.urn] = config;
  });

  return Object.keys(plugins).length > 0 ? plugins : undefined;
};
