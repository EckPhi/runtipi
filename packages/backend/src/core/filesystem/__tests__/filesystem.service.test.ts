import fs from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { FilesystemService } from '../filesystem.service';

afterEach(() => vi.restoreAllMocks());

test('removes the created temporary directory when chmod fails', async () => {
  const logger = { error: vi.fn() } as never;
  const filesystem = new FilesystemService(logger);
  const chmodError = new Error('chmod failed');
  const directory = '/tmp/runtipi-created';
  vi.spyOn(fs.promises, 'mkdtemp').mockResolvedValue(directory);
  vi.spyOn(fs.promises, 'chmod').mockRejectedValue(chmodError);
  const removeDirectory = vi.spyOn(fs.promises, 'rmdir').mockRejectedValue(new Error('cleanup failed'));

  await expect(filesystem.createTempDirectory('/tmp/runtipi-')).rejects.toThrow(chmodError);
  expect(removeDirectory).toHaveBeenCalledWith(directory);
});

test('removes the created temporary directory when it is not private', async () => {
  const logger = { error: vi.fn() } as never;
  const filesystem = new FilesystemService(logger);
  const directory = '/tmp/runtipi-created';
  vi.spyOn(fs.promises, 'mkdtemp').mockResolvedValue(directory);
  vi.spyOn(fs.promises, 'chmod').mockResolvedValue(undefined);
  vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mode: 0o755 } as never);
  const removeDirectory = vi.spyOn(fs.promises, 'rmdir').mockResolvedValue(undefined);

  await expect(filesystem.createTempDirectory('/tmp/runtipi-')).rejects.toThrow('not private');
  expect(removeDirectory).toHaveBeenCalledWith(directory);
});

test('atomically replaces JSON only after the temporary file has been written', async () => {
  const filesystem = new FilesystemService({ error: vi.fn() } as never);
  const write = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
  const rename = vi.spyOn(fs.promises, 'rename').mockResolvedValue(undefined);
  const cleanup = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
  expect(await filesystem.writeJsonFileAtomic('/data/state/plugins/1.json', { 'app-health': true })).toBe(true);
  const temporary = write.mock.calls[0]?.[0];
  expect(temporary).toMatch(/^\/data\/state\/plugins\/1.json\..+\.tmp$/);
  expect(rename).toHaveBeenCalledWith(temporary, '/data/state/plugins/1.json');
  expect(cleanup).toHaveBeenCalledWith(temporary, { force: true });
  expect(write.mock.invocationCallOrder[0]).toBeLessThan(rename.mock.invocationCallOrder[0] ?? 0);
});

test('keeps previous settings when an atomic write fails', async () => {
  const filesystem = new FilesystemService({ error: vi.fn() } as never);
  vi.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('Disk full'));
  const rename = vi.spyOn(fs.promises, 'rename').mockResolvedValue(undefined);
  const cleanup = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
  expect(await filesystem.writeJsonFileAtomic('/data/state/plugins/1.json', {})).toBe(false);
  expect(rename).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalled();
});
