/** Real firmware execution: Run resumes the latest matching camera, Start fresh creates one. */
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { mkdir } from 'node:fs/promises';
const base = process.env.FUJIMOD_WEB_URL,
  dat = process.env.FUJIMOD_TEST_DAT;
assert.ok(base && dat, 'Set FUJIMOD_WEB_URL and FUJIMOD_TEST_DAT.');
const output = new URL('../../build/camera-resume/', import.meta.url);
await mkdir(output, { recursive: true });
for (const engine of [chromium, webkit].filter(
  (engine) =>
    !process.env.FUJIMOD_TEST_BROWSER || process.env.FUJIMOD_TEST_BROWSER === engine.name(),
)) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.routeWebSocket('**/*', () => {});
    // Stock emulation is independent of whether a release is currently published.
    await context.route('**/releases/current', (route) => route.fulfill({ status: 404 }));
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/\[(STRICT_|REACTIVE_|LOADING_|HOT_SCOPE_)/.test(message.text()))
        errors.push(message.text());
    });
    await page.goto(base);
    await page.waitForFunction(() => performance.getEntriesByName('camera-catalog-ready').length);
    await page.locator('#firmware-file').setInputFiles(dat);
    await page.getByRole('radio').waitFor();
    const run = page.getByRole('button', { name: 'Run unmodified in your browser', exact: true });
    async function records() {
      return page.evaluate(async () => {
        const { CameraStore }: typeof import('./store') = await import(
          '/src/' + 'cameras/store.ts'
        );
        return new CameraStore().list();
      });
    }
    async function live() {
      await page.waitForFunction(
        () =>
          document.querySelector('#live-label')?.textContent === 'LIVE' ||
          document.querySelector('#status')?.classList.contains('error'),
        undefined,
        { timeout: 240000 },
      );
      assert.equal(
        await page.locator('#live-label').innerText(),
        'LIVE',
        await page.locator('#fault-raw').innerText(),
      );
      assert.equal(await page.locator('#camera-loading').isVisible(), false);
    }
    async function exit() {
      await page.getByRole('button', { name: 'Save & Exit', exact: true }).click();
      await run.waitFor();
    }
    assert.equal((await records()).length, 0, 'Adding firmware never creates a camera');
    await run.click();
    await live();
    const first = (await records())[0];
    assert.equal(first.modEnabled, false);
    await exit();
    await run.click();
    await live();
    assert.deepEqual(
      (await records()).map((record) => record.id),
      [first.id],
    );
    await exit();
    await page.getByRole('button', { name: 'Start fresh', exact: true }).click();
    await live();
    const fresh = (await records()).find((record) => record.id !== first.id);
    assert.ok(fresh);
    assert.equal(fresh.modEnabled, false);
    await exit();
    const before = await records();
    const latest = before.find((record) => record.id === fresh.id)!;
    await run.click();
    await live();
    await exit();
    const after = await records();
    assert.equal(after.length, 2);
    assert.ok(after.find((record) => record.id === fresh.id)!.revision > latest.revision);
    assert.equal(
      after.find((record) => record.id === first.id)!.revision,
      before.find((record) => record.id === first.id)!.revision,
    );
    assert.deepEqual(errors, []);
    await page.locator('#workspace').scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL(`${engine.name()}.png`, output).pathname });
    console.log(
      `${engine.name()}: real stock boot, save, resume, Start fresh and latest-camera resume passed`,
    );
  } finally {
    await browser.close();
  }
}
