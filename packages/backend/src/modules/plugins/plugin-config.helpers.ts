import crypto from 'node:crypto';
import type { FormField } from '@runtipi/common/schemas';
import validator from 'validator';

export type PluginConfig = Record<string, string | number | boolean>;

type ValidationResult = { success: true; config: PluginConfig } | { success: false; reason: string };

const isEmpty = (value: unknown) => value === undefined || value === null || value === '';

const generateRandom = (field: FormField) => {
  const length = field.min ?? 32;
  const bytes = crypto.randomBytes(length);

  if (field.encoding === 'base64') {
    return bytes.toString('base64').slice(0, length);
  }

  return bytes.toString('hex').slice(0, length);
};

const checkString = (field: FormField, value: string): string | null => {
  if (field.min !== undefined && value.length < field.min) return `must be at least ${field.min} characters`;
  if (field.max !== undefined && value.length > field.max) return `must be at most ${field.max} characters`;

  switch (field.type) {
    case 'email':
      if (!validator.isEmail(value)) return 'must be a valid email';
      break;
    case 'url':
      if (!validator.isURL(value, { require_tld: false })) return 'must be a valid URL';
      break;
    case 'fqdn':
      if (!validator.isFQDN(value)) return 'must be a valid domain name';
      break;
    case 'ip':
      if (!validator.isIP(value)) return 'must be a valid IP address';
      break;
    case 'fqdnip':
      if (!validator.isFQDN(value) && !validator.isIP(value)) return 'must be a valid domain name or IP address';
      break;
    default:
      break;
  }

  if (field.regex) {
    let regex: RegExp;
    try {
      regex = new RegExp(field.regex);
    } catch {
      return 'has an invalid pattern in the plugin manifest';
    }
    if (!regex.test(value)) return field.pattern_error ?? `must match ${field.regex}`;
  }

  return null;
};

const checkValue = (field: FormField, value: unknown): string | null => {
  if (field.options?.length && !field.options.some((option) => option.value === String(value))) {
    return `must be one of ${field.options.map((option) => option.value).join(', ')}`;
  }

  if (field.type === 'boolean') {
    return typeof value === 'boolean' ? null : 'must be a boolean';
  }

  if (field.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) return 'must be a number';
    if (field.min !== undefined && value < field.min) return `must be at least ${field.min}`;
    if (field.max !== undefined && value > field.max) return `must be at most ${field.max}`;
    return null;
  }

  if (typeof value !== 'string') return 'must be a string';

  return checkString(field, value);
};

/**
 * Validate plugin settings values against the form fields a plugin manifest declares.
 * Missing values fall back to the field default (or a generated value for `random` fields).
 */
export const validatePluginConfig = (fields: FormField[], input: PluginConfig): ValidationResult => {
  const declared = new Map(fields.map((field) => [field.env_variable, field]));

  const unknown = Object.keys(input).filter((key) => !declared.has(key));
  if (unknown.length > 0) {
    return { success: false, reason: `unknown setting ${unknown.join(', ')}` };
  }

  const config: PluginConfig = {};

  for (const field of fields) {
    const key = field.env_variable;
    let value = input[key];

    if (isEmpty(value)) {
      if (field.default !== undefined) {
        value = field.default;
      } else if (field.type === 'random') {
        value = generateRandom(field);
      } else if (field.required) {
        return { success: false, reason: `${field.label || key} is required` };
      } else {
        continue;
      }
    }

    const error = checkValue(field, value);
    if (error) {
      return { success: false, reason: `${field.label || key} ${error}` };
    }

    config[key] = value;
  }

  return { success: true, config };
};
