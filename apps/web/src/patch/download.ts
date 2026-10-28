import type { PatchResult } from './patcher.ts';
import { zipBlob } from '@fujimod/emulator-ui/archive';
import {
  firmwareDownloadName,
  type FirmwareDownloadFormat,
  type FirmwareDownloadIdentity,
} from '../firmware-download';

export async function modifiedDownload(
  format: FirmwareDownloadFormat,
  files: Pick<PatchResult, 'ffboot' | 'ffsys' | 'fpupdate'>,
  firmware: FirmwareDownloadIdentity,
  build: string,
) {
  const name = firmwareDownloadName('modified', format, firmware, build);
  const entries = [
    { path: 'ffboot.bin', data: new Blob([files.ffboot]) },
    { path: 'ffsys.bin', data: new Blob([files.ffsys]) },
  ];
  if (format === 'installable') {
    if (!files.fpupdate) throw Error('Installable firmware is unavailable.');
    entries.push({ path: 'FPUPDATE.DAT', data: new Blob([files.fpupdate]) });
  }
  return { name, blob: await zipBlob(entries) };
}
