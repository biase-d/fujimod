import { DeviceFiles, type DeviceFileEntry, type FileMemory } from '../device-files';
import { REPORT_FILE, type ReportLink, listedReport, validateReport } from './report-link';
/** X70 1.10 policy belongs here, outside the shared file protocol. Physical
 * bounds of the mod region that holds the file service. */
const MOD_START = 0x390000,
  MOD_END = 0x600000;
function files(memory: FileMemory, link: ReportLink) {
  function range(address: number, count: number) {
    if (
      !Number.isSafeInteger(address) ||
      address < 0 ||
      address >= 0x80000000 ||
      (address & ~0x40000000) < MOD_START ||
      (address & ~0x40000000) + count > MOD_END ||
      count < 0
    )
      throw Error('Invalid file-service memory range.');
  }
  const address = parseInt(link.files, 16);
  if (address % 32) throw Error('Unaligned file-service descriptor.');
  const uncached: FileMemory = {
    read: (at, count) => {
      range(at, count);
      return memory.read(at | 0x40000000, count);
    },
    write: (at, bytes) => {
      range(at, bytes.length);
      return memory.write(at | 0x40000000, bytes);
    },
  };
  return new DeviceFiles(uncached, address, parseInt(link.commit.slice(0, 8), 16), range);
}
export async function retrieveReport(
  memory: FileMemory,
  link: ReportLink,
  progress: (bytes: number) => void,
): Promise<Blob> {
  return validateReport(await files(memory, link).read(link.path, link.bytes, progress), link);
}
export async function removeReport(memory: FileMemory, link: ReportLink): Promise<void> {
  await files(memory, link).remove(link.path);
}
/** Every report file in the folder holding `service`'s report, in the camera's directory order. */
export async function listReports(
  memory: FileMemory,
  service: ReportLink,
): Promise<DeviceFileEntry[]> {
  const access = files(memory, service);
  const pattern = service.path.replace(/[^\\]*$/, 'R*.TAR');
  const found: DeviceFileEntry[] = [];
  for (;;) {
    const page = await access.list(pattern, found.length);
    if (!page.length) break;
    found.push(...page);
  }
  return found.filter((entry) => REPORT_FILE.test(entry.name));
}
/** Read a listed report and check it against its own manifest. */
export async function retrieveListed(
  memory: FileMemory,
  service: ReportLink,
  entry: DeviceFileEntry,
  progress: (bytes: number) => void,
): Promise<{ blob: Blob; link: ReportLink }> {
  const path = service.path.replace(/[^\\]*$/, entry.name);
  const bytes = await files(memory, service).read(path, entry.bytes, progress);
  return listedReport(bytes, service, entry.name);
}
/** The camera's file service, found by its discovery record in the mod region
 * when no QR code names it. Undefined when the installed mods have none that can
 * list folders. */
export async function findReportService(
  memory: Pick<FileMemory, 'read'>,
): Promise<ReportLink | undefined> {
  const bytes = await memory.read(MOD_START | 0x40000000, MOD_END - MOD_START);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: { address: number; tag: number }[] = [];
  for (let offset = 0; offset + 64 <= bytes.length; offset += 32)
    if (view.getUint32(offset, true) === 0x314c4946 && view.getUint32(offset + 4, true) === 2)
      found.push({ address: MOD_START + offset, tag: view.getUint32(offset + 8, true) });
  if (found.length > 1) throw Error('The camera has more than one file service.');
  const [service] = found;
  if (!service) return undefined;
  return {
    v: 1,
    firmware: 'x70-110',
    commit: service.tag.toString(16).padStart(8, '0'),
    path: 'A:\\FUJIMOD\\REPORTS\\R0000000.TAR',
    bytes: 0,
    files: ((service.address | 0x40000000) >>> 0).toString(16),
  };
}
