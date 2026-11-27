import type { FormField } from '@runtipi/common/schemas';
import { describe, expect, it } from 'vitest';
import { validatePluginConfig } from '../plugin-config.helpers';

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

  it('drops unknown keys only when asked to', () => {
    const fields = [field({ type: 'text', env_variable: 'A' })];

    expect(validatePluginConfig(fields, { A: 'a', OLD: 'x' }).success).toBe(false);
    expect(validatePluginConfig(fields, { A: 'a', OLD: 'x' }, { dropUnknownKeys: true })).toEqual({ success: true, config: { A: 'a' } });
  });
});
