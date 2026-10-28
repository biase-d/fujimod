import { chromium, webkit, type APIResponse } from 'playwright';
import assert from 'node:assert/strict';
import { validateCatalog, type Catalog } from '../../catalog.ts';

const base = process.env.FUJIMOD_WEB_URL;
if (!base) throw Error('Set FUJIMOD_WEB_URL to the development web app URL.');
for (const browserType of [chromium, webkit]) {
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'warning' && /hydration/i.test(message.text()))
        errors.push(message.text());
    });
    await page.goto(new URL('dev-tools/service/', base).href);
    await page.getByRole('button', { name: 'Begin', exact: true }).click();
    const allow = page.getByRole('button', {
      name: 'Allow camera access',
      exact: true,
    });
    assert.equal(await allow.isDisabled(), true);
    await page.locator('.dm-check input').check();
    assert.equal(await allow.isEnabled(), true);
    // Stop before connecting: this test never requests or opens a USB device.
    const catalog = validateCatalog(
      (await (
        await page.request.get(new URL('runtime/catalog.json', base).href)
      ).json()) as Catalog,
    );
    for (const id of ['x70-110', 'xt1-552']) {
      const firmware = catalog.firmwares.find((entry) => entry.id === id);
      assert.ok(firmware?.service_workflow, `${id}: generated service workflow`);
      const response: APIResponse = await page.request.get(
        new URL(firmware.service_workflow, base).href,
      );
      assert.equal(response.ok(), true);
      const workflow = (await response.json()) as {
        firmware_id: string;
        firmware_sha256: string;
        guard?: unknown;
        debug_mode?: unknown;
      };
      assert.equal(workflow.firmware_id, firmware.id);
      assert.equal(workflow.firmware_sha256, firmware.sha256);
      assert.ok(workflow.guard);
      assert.ok(workflow.debug_mode);
    }
    assert.deepEqual(errors, []);
    console.log(
      `${browserType.name()}: service guide deep link, inputs and service workflow asset passed`,
    );
  } finally {
    await browser.close();
  }
}
