import { expect, test } from 'vite-plus/test';
import { retrieveReport, removeReport } from './transfer';
import { fileDevice } from '../device-files.test-helper';
import { tar, link } from './fixtures.test-helper';
test('report reader uses shared open/read/close and validates the complete TAR', async () => {
  const device = fileDevice(tar),
    progress: number[] = [];
  const blob = await retrieveReport(device.memory, link, (n) => progress.push(n));
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(tar);
  expect(device.commands).toEqual([1, 2, 2, 3]);
  expect(progress).toEqual([16384, tar.length]);
  await removeReport(device.memory, link);
  expect(device.commands.at(-1)).toBe(7);
});
test('rejects wrong builds and file-service addresses before writing', async () => {
  const device = fileDevice(tar, 0);
  await expect(retrieveReport(device.memory, link, () => {})).rejects.toThrow('build');
  expect(device.writes).toEqual([]);
  for (const files of ['40040000', '405fffe0', '403a0001'])
    await expect(retrieveReport(device.memory, { ...link, files }, () => {})).rejects.toThrow();
});
test('report retrieval accepts changed file bytes when the archive shape is intact', async () => {
  const altered = tar.slice();
  altered[512] ^= 1;
  const device = fileDevice(altered);
  const blob = await retrieveReport(device.memory, { ...link, bytes: altered.length }, () => {});
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(altered);
  expect(device.commands).toEqual([1, 2, 2, 3]);
});
