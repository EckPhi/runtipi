import type { FormField } from '@runtipi/common/schemas';
import { describe, expect, it } from 'vitest';
import { getVisibleAppFields, validatePluginConfig } from '../plugin-config.helpers';

const field = (data: Partial<FormField> & Pick<FormField, 'type' | 'env_variable'>): FormField => ({
  label: data.env_variable,
  required: false,
  ...data,
});

describe('validatePluginConfig', () => {
  it('fills defaults, leaves out empty optional values and generates random values', () => {
    const result = validatePluginConfig(
      [
        field({ type: 'text', env_variable: 'A', default: 'a' }),
        field({ type: 'text', env_variable: 'B' }),
        field({ type: 'random', env_variable: 'C', min: 16 }),
      ],
      { B: '' },
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.config.A).toBe('a');
    expect('B' in result.config).toBe(false);
    expect(String(result.config.C)).toHaveLength(16);
  });

  it.each([
    [field({ type: 'email', env_variable: 'X' }), 'not-an-email'],
    [field({ type: 'url', env_variable: 'X' }), 'not a url'],
    [field({ type: 'ip', env_variable: 'X' }), '999.1.1.1'],
    [field({ type: 'fqdn', env_variable: 'X' }), 'no_domain'],
    [field({ type: 'text', env_variable: 'X', regex: '^[a-z]+$' }), 'ABC'],
    [field({ type: 'text', env_variable: 'X', max: 2 }), 'abc'],
    [field({ type: 'text', env_variable: 'X', options: [{ label: 'One', value: 'one' }] }), 'two'],
    [field({ type: 'boolean', env_variable: 'X' }), 'true'],
    [field({ type: 'number', env_variable: 'X' }), '1'],
  ])('rejects an invalid value for a %o field', (formField, value) => {
    expect(validatePluginConfig([formField], { X: value }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(validatePluginConfig([field({ type: 'text', env_variable: 'A' })], { A: 'a', OLD: 'x' }).success).toBe(false);
  });
});

describe('getVisibleAppFields', () => {
  const fields: Array<FormField & { visible_when?: string }> = [
    { type: 'boolean', label: 'Enabled', env_variable: 'ENABLED', required: false },
    { type: 'boolean', label: 'Advanced', env_variable: 'ADVANCED', required: false, default: true, visible_when: 'ENABLED' },
    { type: 'text', label: 'Tag', env_variable: 'TAG', required: false, visible_when: 'ADVANCED' },
    { type: 'text', label: 'Loop', env_variable: 'LOOP', required: false, visible_when: 'LOOP' },
  ];
  const visible = (values: Record<string, unknown>) => getVisibleAppFields(fields, values).map((field) => field.env_variable);

  it('shows a field while its toggle is on, following chains and defaults', () => {
    expect(visible({})).toEqual(['ENABLED']);
    expect(visible({ ENABLED: true })).toEqual(['ENABLED', 'ADVANCED', 'TAG']);
    expect(visible({ ENABLED: true, ADVANCED: false })).toEqual(['ENABLED', 'ADVANCED']);
    expect(visible({ ENABLED: false, ADVANCED: true })).toEqual(['ENABLED']);
  });
});
