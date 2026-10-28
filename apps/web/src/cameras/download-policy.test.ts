import { expect, test } from 'vite-plus/test';
import { cardDownloadAllowed } from './download-policy';

test('card firmware files obey independent per-firmware release switches', () => {
  for (const sd_card of [false, true])
    for (const installable of [false, true]) {
      const switches = { sd_card, installable };
      expect(cardDownloadAllowed('FFBoot.BIN', switches)).toBe(sd_card);
      expect(cardDownloadAllowed('ffsys.bin', switches)).toBe(sd_card);
      expect(cardDownloadAllowed('FPUPDATE.DAT', switches)).toBe(installable);
      expect(cardDownloadAllowed('DSCF0001.JPG', switches)).toBe(true);
    }
  expect(cardDownloadAllowed('ffboot.bin')).toBe(false);
  expect(cardDownloadAllowed('FPUPDATE.DAT')).toBe(false);
  expect(cardDownloadAllowed('ffboot.bin.bak')).toBe(true);
});
