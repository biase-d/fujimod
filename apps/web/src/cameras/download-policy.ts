import type { ReleaseDownloads } from '../patch/catalog';

/** Firmware artifacts on an emulated card follow the selected firmware's release switches. */
export function cardDownloadAllowed(name: string, downloads?: ReleaseDownloads) {
  if (/^ff(?:boot|sys)\.bin$/i.test(name)) return downloads?.sd_card ?? false;
  if (/^fpupdate\.dat$/i.test(name)) return downloads?.installable ?? false;
  return true;
}
