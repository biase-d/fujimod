import type { FileMemory } from './device-files';
/** A fake file service: reads return `file`; listing (op 8) returns `listing` records. */
export function fileDevice(
  file: Uint8Array,
  tag = 0xaaaaaaaa,
  version = 1,
  listing: Uint8Array = file,
) {
  const address = 0x403a0000,
    bytes = new Map<number, number>(),
    commands: number[] = [],
    argumentsSent: number[] = [],
    writes: number[] = [];
  const key = (at: number) => at & ~0x40000000;
  const store = (at: number, data: Uint8Array) => data.forEach((b, i) => bytes.set(key(at + i), b));
  const read = (at: number, n: number) =>
    Uint8Array.from({ length: n }, (_, i) => bytes.get(key(at + i)) ?? 0);
  const word = (at: number, value: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value, true);
    store(at, b);
  };
  const pointers = Array.from({ length: 11 }, (_, i) => address + 0x100 + i * 4);
  pointers[5] = address + 0x200;
  pointers[6] = address + 0x1000;
  [0x314c4946, version, tag, ...pointers, 0, 0].forEach((value, i) => word(address + i * 4, value));
  word(pointers[0], 16384);
  word(pointers[9], 0xffffffff);
  let cursor = 0;
  const memory: FileMemory = {
    read: async (at, n) => read(at, n),
    write: async (at, data) => {
      writes.push(at);
      store(at, data);
      if (at !== pointers[1]) return;
      const argument = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
          0,
          true,
        ),
        op = argument & 255,
        size = argument >>> 8;
      commands.push(op);
      argumentsSent.push(argument);
      word(pointers[7], new DataView(read(pointers[7], 4).buffer).getUint32(0, true) + 1);
      word(pointers[2], 2);
      word(pointers[3], 0);
      word(pointers[8], 0);
      if (op === 1) {
        cursor = 0;
        word(pointers[9], 7);
      } else if (op === 2) {
        const chunk = file.slice(cursor, cursor + size);
        store(pointers[6], chunk);
        word(pointers[4], chunk.length);
        cursor += chunk.length;
      } else if (op === 8) {
        const capacity = new DataView(read(pointers[0], 4).buffer).getUint32(0, true);
        const chunk = listing.slice(size * 24, size * 24 + Math.floor(capacity / 24) * 24);
        store(pointers[6], chunk);
        word(pointers[4], chunk.length);
      } else if (op === 3 || op === 4) word(pointers[9], 0xffffffff);
      word(pointers[1], 0);
    },
  };
  return { memory, address, pointers, commands, argumentsSent, writes, word };
}
