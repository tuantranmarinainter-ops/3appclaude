import { browserOptions } from './browser_test_options.mjs';
import { useClassicLayout } from './classic_test_layout.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const require = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
);
const artifact = fileURLToPath(
  new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url),
);
const baseline = fileURLToPath(
  new URL(
    '../../../../editor/apps/studio/public/animation-studio/v1.31.8/index.html',
    import.meta.url,
  ),
);
const checker = fileURLToPath(new URL('../../../tools/check-features.mjs', import.meta.url));

test(
  'F1 workflow keeps baseline controls and switches Blocking, Tinh chỉnh, and Xuất',
  { skip: !existsSync(artifact), timeout: 120000 },
  async () => {
    const parity = execFileSync(process.execPath, [checker, baseline, artifact], {
      encoding: 'utf8',
    });
    const report = JSON.parse(parity);
    assert.equal(report.baselineIds, 434);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.unresolvedLookups, []);

    const html = readFileSync(artifact);
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { chromium } = require('playwright');
    const executablePath = process.env.CHROMIUM_PATH;
    const browser = await chromium.launch(browserOptions({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: process.platform === 'linux' ? ['--no-sandbox', '--enable-unsafe-swiftshader'] : [],
    }));
    try {
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await useClassicLayout(page);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__studio?.ready);

      assert.equal(await page.locator('#workflowBlocking').getAttribute('aria-current'), 'step');
      await page.locator('#workflowRefine').click();
      await page.waitForFunction(
        () =>
          document.querySelector('#studioMode').value === 'lab' &&
          !document.querySelector('#labPanel').hidden,
      );
      assert.equal(
        await page.locator('#minimalAdvanced').evaluate((element) => element.open),
        true,
      );

      await page.locator('#workflowExport').click();
      assert.equal(
        await page.locator('#minimalExport').evaluate((element) => !element.hidden),
        true,
      );
      assert.equal(await page.locator('#exportPanel').evaluate((element) => element.open), true);

      await page.locator('#workflowBlocking').click();
      await page.waitForFunction(() => document.querySelector('#studioMode').value === 'classic');
      assert.equal(
        await page.locator('#minimalSidebar .library').evaluate((element) => !element.hidden),
        true,
      );
      assert.equal(
        await page.locator('#minimalExport').evaluate((element) => element.hidden),
        true,
      );
      for (const id of ['modeCreate', 'modeRig', 'modeCompare', 'exportQuick', 'exportPanel'])
        assert.equal(await page.locator(`#${id}`).count(), 1, `${id} remains available`);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
