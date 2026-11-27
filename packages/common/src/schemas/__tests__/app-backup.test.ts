import { describe, expect, test } from 'vitest';
import { type } from 'arktype';
import { appBackupSchema } from '../app-info.js';

describe('app backup policy', () => {
  test('defaults to stopping and including all app data', () => {
    expect(appBackupSchema.assert({})).toEqual({ stop: true });
    expect(appBackupSchema.assert({ stop: false, include: ['db/dump.sql', 'config'] })).toEqual({
      stop: false,
      include: ['db/dump.sql', 'config'],
    });
  });
  test('rejects invalid field types', () => {
    expect(appBackupSchema({ stop: 'false' })).toBeInstanceOf(type.errors);
    expect(appBackupSchema({ include: [42] })).toBeInstanceOf(type.errors);
  });
});
