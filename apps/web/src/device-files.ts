/** Shared session-io card-file protocol. Transport and memory-map validation are supplied by the device adapter. */
export interface FileMemory {
  read(address: number, count: number): Promise<Uint8Array>;
  write(address: number, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
}
export interface DeviceFileEntry {
  bytes: number;
  name: string;
}
export class DeviceFiles {
  private descriptor?: Uint8Array;
  private pointers?: number[];
  private operations = 0;
  private capacity = 0;
  constructor(
    private memory: FileMemory,
    private address: number,
    private build: number,
    private range: (address: number, count: number) => void,
  ) {}
  private async word(address: number) {
    this.range(address, 4);
    const bytes = await this.memory.read(address, 4);
    if (bytes.length !== 4) throw Error('Incomplete file-service reply.');
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }
  private async check() {
    this.range(this.address, 64);
    const bytes = await this.memory.read(this.address, 64);
    if (bytes.length !== 64) throw Error('Incomplete file-service descriptor.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, 64);
    if (
      view.getUint32(0, true) !== 0x314c4946 ||
      ![1, 2].includes(view.getUint32(4, true)) ||
      view.getUint32(8, true) !== this.build
    )
      throw Error('This device has a different file service or build.');
    if (this.descriptor && bytes.some((value, index) => value !== this.descriptor![index]))
      throw Error('The file-service descriptor changed.');
    const pointers = Array.from({ length: 11 }, (_, i) => view.getUint32(12 + i * 4, true));
    for (const pointer of pointers) this.range(pointer, 4);
    this.range(pointers[5], 64);
    if (!this.descriptor) {
      this.capacity = await this.word(pointers[0]);
      if (!this.capacity || this.capacity > 0xffffff) throw Error('Invalid file buffer capacity.');
      this.range(pointers[6], this.capacity);
      this.operations = await this.word(pointers[7]);
      this.descriptor = bytes.slice();
      this.pointers = pointers;
    }
    return this.pointers!;
  }
  private async idle(p: number[]) {
    if (
      (await this.word(p[7])) !== this.operations ||
      (await this.word(p[1])) ||
      (await this.word(p[2])) === 1
    )
      throw Error('The file service is busy or another operation intervened.');
  }
  private async command(op: number, size = 0) {
    const p = await this.check();
    await this.idle(p);
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, op | (size << 8), true);
    await this.memory.write(p[1], bytes);
    const deadline = performance.now() + 15000;
    for (;;) {
      await this.check();
      const request = await this.word(p[1]),
        state = await this.word(p[2]);
      if (!request && state !== 1) {
        const operations = await this.word(p[7]);
        if (operations !== (this.operations + 1) >>> 0 || (await this.word(p[8])))
          throw Error('The file request was not accepted by this session.');
        this.operations = operations;
        const status = (await this.word(p[3])) | 0;
        if (state !== 2 || status) throw Error(`Camera file operation failed (${status}).`);
        return await this.word(p[4]);
      }
      if (performance.now() >= deadline) throw Error('Camera file operation timed out.');
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  private async path(path: string, listing = false) {
    const p = await this.check();
    await this.idle(p);
    if ((await this.word(p[9])) !== 0xffffffff) throw Error('Another camera file is open.');
    if (
      !(
        listing
          ? /^[A-Z]:\\(?:[A-Za-z0-9._-]+\\)*[A-Za-z0-9._*?-]{1,12}$/
          : /^[A-Z]:\\[A-Za-z0-9._\\-]+$/
      ).test(path) ||
      path.split('\\').some((part) => part === '..' || part === '.')
    )
      throw Error('Invalid camera file path.');
    const bytes = new TextEncoder().encode(path + '\0');
    if (bytes.length > 48) throw Error('Camera file path is too long.');
    await this.memory.write(p[5], bytes);
  }
  async read(path: string, length: number, progress: (bytes: number) => void) {
    if (!Number.isSafeInteger(length) || length < 0) throw Error('Invalid file length.');
    await this.path(path);
    let opened = false;
    try {
      await this.command(1);
      opened = true;
      const bytes = new Uint8Array(length),
        p = this.pointers!;
      let offset = 0;
      while (offset < length) {
        const requested = Math.min(this.capacity, length - offset),
          count = await this.command(2, requested);
        if (count !== requested) throw Error('Camera file ended before its expected length.');
        const chunk = await this.memory.read(p[6], count);
        if (chunk.length !== count) throw Error('Incomplete camera file chunk.');
        bytes.set(chunk, offset);
        offset += count;
        progress(offset);
      }
      await this.command(3);
      return bytes;
    } catch (error) {
      // Match the RAW host: close only a completed operation still owned by us.
      // A timeout retains the camera's pending callback and buffer.
      if (opened) {
        try {
          const p = await this.check();
          if (
            (await this.word(p[7])) === this.operations &&
            !(await this.word(p[1])) &&
            (await this.word(p[2])) !== 1 &&
            (await this.word(p[9])) !== 0xffffffff
          )
            await this.command(4);
        } catch {
          /* Unknown identity or transport: do not send more writes. */
        }
      }
      throw error;
    }
  }

  async list(pattern: string, skip = 0): Promise<DeviceFileEntry[]> {
    await this.check();
    if (new DataView(this.descriptor!.buffer, this.descriptor!.byteOffset).getUint32(4, true) < 2)
      throw Error('Folder listing requires file-service ABI 2.');
    if (!Number.isSafeInteger(skip) || skip < 0 || skip > 0xffffff)
      throw Error('Invalid folder listing skip count.');
    await this.path(pattern, true);
    const count = await this.command(8, skip);
    if (count > this.capacity || count % 24) throw Error('Invalid folder listing byte count.');
    if (!count) return [];
    const data = await this.memory.read(this.pointers![6], count);
    if (data.length !== count) throw Error('Incomplete folder listing.');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const entries: DeviceFileEntry[] = [];
    for (let offset = 0; offset < count; offset += 24) {
      const raw = data.subarray(offset + 4, offset + 24),
        end = raw.indexOf(0);
      if (end < 1 || raw.subarray(end).some((value) => value !== 0))
        throw Error('Invalid folder listing name.');
      const name = String.fromCharCode(...raw.subarray(0, end));
      if (
        raw.subarray(0, end).some((value) => value < 32 || value > 126) ||
        /[\\/:]/.test(name) ||
        name === '.' ||
        name === '..'
      )
        throw Error('Invalid folder listing name.');
      entries.push({ bytes: view.getUint32(offset, true), name });
    }
    return entries;
  }

  async remove(path: string) {
    await this.path(path);
    await this.command(7);
  }
}
