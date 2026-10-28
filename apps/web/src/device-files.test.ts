import { expect, test } from 'vite-plus/test';
import { DeviceFiles } from './device-files';
import { fileDevice } from './device-files.test-helper';
const range = (address: number, n: number) => {
  if (address < 0x403a0000 || address + n > 0x403b0000) throw Error('Outside mod memory');
};
test('shared file reader follows the advertised capacity and exposes generic deletion', async () => {
  const data = new Uint8Array(37).fill(42),
    device = fileDevice(data);
  device.word(device.pointers[0], 16);
  const files = new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range);
  expect(await files.read('C:\\DCIM\\TEST.RAF', 37, () => {})).toEqual(data);
  expect(device.commands).toEqual([1, 2, 2, 2, 3]);
  await files.remove('C:\\DCIM\\TEST.RAF');
  expect(device.commands.at(-1)).toBe(7);
});
test('rejects open handles and invalid pointers before writing', async () => {
  const device = fileDevice(new Uint8Array(8));
  device.word(device.pointers[9], 7);
  await expect(
    new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range).read(
      'C:\\TEST.RAF',
      8,
      () => {},
    ),
  ).rejects.toThrow('open');
  expect(device.writes).toEqual([]);
  device.word(device.pointers[9], 0xffffffff);
  device.word(device.address + 12 + 6 * 4, 0x40000000);
  await expect(
    new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range).read(
      'C:\\TEST.RAF',
      8,
      () => {},
    ),
  ).rejects.toThrow('Outside');
  expect(device.writes).toEqual([]);
});
test('detects a competing operation before sending another command', async () => {
  const device = fileDevice(new Uint8Array(8));
  const files = new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range);
  await files.read('C:\\TEST.RAF', 8, () => {});
  device.word(device.pointers[7], 99);
  await expect(files.remove('C:\\TEST.RAF')).rejects.toThrow('intervened');
  expect(device.commands).toEqual([1, 2, 3]);
});

test('a short read closes the completed operation rather than retaining an open handle', async () => {
  const device = fileDevice(new Uint8Array(3));
  await expect(
    new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range).read(
      'C:\\TEST.RAF',
      8,
      () => {},
    ),
  ).rejects.toThrow('ended');
  expect(device.commands).toEqual([1, 2, 4]);
});

test('a pending operation prevents even the path from being replaced', async () => {
  const device = fileDevice(new Uint8Array(8));
  device.word(device.pointers[2], 1);
  await expect(
    new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range).read(
      'C:\\TEST.RAF',
      8,
      () => {},
    ),
  ).rejects.toThrow('busy');
  expect(device.writes).toEqual([]);
});

function listing() {
  const records = new Uint8Array(48),
    view = new DataView(records.buffer);
  for (const [index, size] of [1234, 0x81234567].entries()) {
    view.setUint32(index * 24, size, true);
    records.set(new TextEncoder().encode(`R000000${index + 1}.TAR`), index * 24 + 4);
  }
  return records;
}

test('ABI 2 lists file names and unsigned sizes, with capacity-bounded paging', async () => {
  const device = fileDevice(listing(), 0xaaaaaaaa, 2);
  const files = new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range);
  const pattern = 'C:\\FUJIMOD\\REPORTS\\R*.TAR';
  expect(await files.list(pattern)).toEqual([
    { bytes: 1234, name: 'R0000001.TAR' },
    { bytes: 0x81234567, name: 'R0000002.TAR' },
  ]);
  device.word(device.pointers[0], 25);
  const paged = new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range);
  expect(await paged.list(pattern)).toEqual([{ bytes: 1234, name: 'R0000001.TAR' }]);
  expect(await paged.list(pattern, 1)).toEqual([{ bytes: 0x81234567, name: 'R0000002.TAR' }]);
  expect(await paged.list(pattern, 2)).toEqual([]);
  expect(device.argumentsSent).toEqual([8, 8, 8 | (1 << 8), 8 | (2 << 8)]);
  expect(device.commands).toEqual([8, 8, 8, 8]);
});

test('ABI 1 keeps read/remove and refuses listing before writes', async () => {
  const device = fileDevice(listing());
  await expect(
    new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range).list('C:\\*.TAR'),
  ).rejects.toThrow('ABI 2');
  expect(device.writes).toEqual([]);
});

test.each([-1, 0x1000000, 1.5, NaN])(
  'refuses invalid listing skip %s before writing',
  async (skip) => {
    const device = fileDevice(listing(), 0xaaaaaaaa, 2);
    await expect(
      new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range).list('C:\\*.TAR', skip),
    ).rejects.toThrow('skip');
    expect(device.writes).toEqual([]);
  },
);

test.each(['C:\\*\\R*.TAR', 'C:\\..\\*.TAR', 'C:\\REPORTS\\', 'C:\\ABCDEFGHIJKLM'])(
  'refuses invalid listing pattern %s before writing',
  async (pattern) => {
    const device = fileDevice(listing(), 0xaaaaaaaa, 2);
    await expect(
      new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range).list(pattern),
    ).rejects.toThrow('path');
    expect(device.writes).toEqual([]);
  },
);

test.each([1, 16392])('rejects invalid listing result count %s', async (count) => {
  const device = fileDevice(listing(), 0xaaaaaaaa, 2);
  const write = device.memory.write.bind(device.memory);
  device.memory.write = async (address, bytes) => {
    await write(address, bytes);
    if (address === device.pointers[1]) device.word(device.pointers[4], count);
  };
  await expect(
    new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range).list('C:\\*.TAR'),
  ).rejects.toThrow('byte count');
});

test('rejects incomplete listing payloads and malformed names', async () => {
  for (const corrupt of ['short', 'unterminated', 'padding', 'path']) {
    const records = listing(),
      device = fileDevice(records, 0xaaaaaaaa, 2);
    if (corrupt === 'unterminated') records.fill(65, 4, 24);
    if (corrupt === 'padding') records[23] = 65;
    if (corrupt === 'path') records[4] = 92;
    if (corrupt === 'short') {
      const read = device.memory.read.bind(device.memory);
      device.memory.read = async (address, count) =>
        read(address, address === device.pointers[6] ? count - 1 : count);
    }
    await expect(
      new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range).list('C:\\*.TAR'),
    ).rejects.toThrow(corrupt === 'short' ? 'Incomplete' : 'name');
  }
});

test('listing decodes the full name field and avoids zero-byte transport reads', async () => {
  const record = new Uint8Array(24);
  record.set(new TextEncoder().encode('REPORT$12345678.TAR'), 4);
  const device = fileDevice(record, 0xaaaaaaaa, 2),
    read = device.memory.read.bind(device.memory);
  device.memory.read = async (address, count) => {
    if (!count) throw Error('Transport requires a positive read size.');
    return read(address, count);
  };
  const files = new DeviceFiles(device.memory, device.address, 0xaaaaaaaa, range);
  expect(await files.list('C:\\*.TAR')).toEqual([{ bytes: 0, name: 'REPORT$12345678.TAR' }]);
  expect(await files.list('C:\\*.TAR', 1)).toEqual([]);
});
