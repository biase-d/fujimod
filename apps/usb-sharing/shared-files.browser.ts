/** Exercise native media players and SVG script isolation against the actual Worker. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtime } from './test-runtime.ts';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const { chromium, webkit } =
  require('playwright') as typeof import('../web/node_modules/playwright/index.js');
const mf = await runtime();
const temporary = await mkdtemp(join(tmpdir(), 'share-media-browser-'));
try {
  const bucket = await mf.getR2Bucket('SHARED_FILES');
  const video = join(temporary, 'clip.mp4');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=64x64:r=10',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    video,
  ]);
  await bucket.put('clip.mp4', await readFile(video), {
    httpMetadata: { contentType: 'video/mp4' },
  });
  await bucket.put(
    'hostile.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="document.documentElement.setAttribute(\'data-executed\',\'yes\')"><script>document.documentElement.setAttribute("data-executed","yes")</script><rect width="10" height="10" fill="red"/></svg>',
    {
      httpMetadata: { contentType: 'image/svg+xml' },
    },
  );
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      const base = await mf.ready;
      const response = await page.goto(new URL('/file/hostile.svg?direct=true', base).href);
      assert.equal(response?.status(), 200);
      assert.equal(await page.locator('svg').getAttribute('data-executed'), null);
      await page.goto(new URL('/file/hostile.svg', base).href);
      await page.locator('img').waitFor();
      assert.equal(
        await page
          .locator('img')
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
        true,
      );
      console.log(
        `${engine.name()}: SVG displays as an image and cannot execute scripts when opened directly`,
      );
      await page.goto(new URL('/file/clip.mp4?direct=true', base).href);
      await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1);
      await page.locator('video').evaluate(async (video: HTMLVideoElement) => {
        video.muted = true;
        await video.play();
      });
      await page.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0);
      console.log(`${engine.name()}: direct native video player plays successfully`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await mf.dispose();
  await rm(temporary, { recursive: true });
}
