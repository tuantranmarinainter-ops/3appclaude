import { browserOptions } from './browser_test_options.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const { chromium } = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
)('playwright');
const candidate = fileURLToPath(
  new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url),
);
test(
  'G5 default/legacy preference, ten live layout swaps, tabs, shortcuts, panel state, presets, small screen and classic pixels',
  { timeout: 240000 },
  async (t) => {
    const baseline = process.env.APP3_LAYOUT_BASELINE_HTML;
    const dir =
      process.env.APP3_LAYOUT_EVIDENCE_DIR ||
      fileURLToPath(new URL('../../../../editor/.test-results/app3-layout', import.meta.url));
    mkdirSync(dir, { recursive: true });
    const server = createServer((req, res) => {
      const file = req.url?.startsWith('/before') && baseline ? baseline : candidate;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(file));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    const base = 'http://127.0.0.1:' + server.address().port,
      errors = [];
    try {
      browser = await chromium.launch(browserOptions({
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      }));
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      page.setDefaultTimeout(15000);
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (dialog) => dialog.accept());
      const ready = async () => {
        await page.waitForFunction(() => window.__studio?.ready);
        await page.evaluate(() => document.fonts.ready);
      };
      await page.goto(base + '/after');
      await ready();
      assert.equal(await page.locator('#layoutMode').inputValue(), 'modes');
      assert.equal(await page.getAttribute('body', 'data-layout-tab'), 'pose');
      assert.equal(await page.locator('#animationArea').isVisible(), false);
      await page.keyboard.press('Control+2');
      assert.equal(await page.getAttribute('body', 'data-layout-tab'), 'animate');
      assert.equal(await page.locator('#animationArea').isVisible(), true);
      const desktop = await page.locator('#viewportShell').boundingBox();
      assert.ok(desktop.width > 900 && desktop.height > 200);
      assert.ok((await page.locator('#layoutLeft').boundingBox()).width > 180);
      await page.keyboard.press('Control+3');
      assert.equal(await page.getAttribute('body', 'data-layout-tab'), 'export');
      assert.equal(await page.locator('#exportPanel').isVisible(), true);
      assert.equal(await page.locator('#transformPanel').isVisible(), false);
      await page.keyboard.press('Control+1');
      assert.equal(await page.getAttribute('body', 'data-layout-tab'), 'pose');
      assert.equal(await page.locator('#transformPanel').isVisible(), true);
      await page.locator('#boneSearch').fill('Right');
      await page.locator('#boneSearch').press('Control+2');
      assert.equal(await page.getAttribute('body', 'data-layout-tab'), 'pose');
      await page.locator('#boneSearch').fill('');
      await page.locator('body').click({ position: { x: 2, y: 2 } });
      await page.keyboard.press('Control+2');
      // Existing workflow buttons and nested Compare entry must remain usable.
      await page.locator('#workflowExport').click();
      await page.waitForFunction(() => document.body.dataset.layoutTab === 'export');
      await page.locator('#layoutMoreTools > summary').click();
      await page.locator('#workflowTools > summary').click();
      await page.locator('#studioAdvancedTools > summary').click();
      await page.locator('#modeCompare').click();
      await page.waitForFunction(() => document.body.dataset.layoutTab === 'compare');
      assert.equal(await page.locator('#layoutTab-compare').isVisible(), true);
      assert.equal(await page.locator('#compareWorkspace').isVisible(), true);
      await page.locator('#layoutTab-pose').click();
      await page.waitForFunction(() => document.body.dataset.layoutTab === 'pose');
      assert.equal(await page.locator('#compareWorkspace').isVisible(), false);
      await page.keyboard.press('Control+2');
      // Record one real key to make Undo/Redo observable through all layout swaps.
      await page.locator('#keyBtn').click();
      const before = await page.evaluate(() => ({
        project: window.__studio.project(),
        history: window.__studio.state.historyIndex,
      }));
      async function chooseLayout(value) {
        await page.locator('#settingsBtn').click();
        await page.locator('#settingsTab-appearance').click();
        await page.locator('#layoutMode').selectOption(value);
        await page.locator('#settingsTitle button').click();
      }
      for (let i = 0; i < 10; i++) await chooseLayout(i % 2 ? 'modes' : 'classic');
      assert.deepEqual(
        await page.evaluate(() => ({
          project: window.__studio.project(),
          history: window.__studio.state.historyIndex,
        })),
        before,
      );
      await page.locator('#undoBtn').click();
      assert.equal(
        await page.evaluate(() => window.__studio.state.historyIndex),
        before.history - 1,
      );
      await page.locator('#redoBtn').click();
      assert.deepEqual(await page.evaluate(() => window.__studio.project()), before.project);
      const nodes = await page.evaluate(() =>
        [...document.querySelectorAll('[id]')].map((n) => n.id),
      );
      assert.equal(new Set(nodes).size, nodes.length, 'No duplicated panels/ids');
      const parent = await page
        .locator('#controlTree')
        .evaluate((node) => node.closest('[data-layout-pane]').dataset.layoutPane);
      assert.equal(parent, 'left');
      await page.locator('#layoutPane-left').click();
      assert.equal(await page.locator('#layoutLeft').isVisible(), false);
      await page.keyboard.press('Control+1');
      assert.equal(await page.locator('#layoutLeft').isVisible(), true);
      await page.keyboard.press('Control+2');
      assert.equal(await page.locator('#layoutLeft').isVisible(), false);
      await page.locator('#layoutPane-left').click();
      // Existing resizer behavior is reused; keyboard sizing is deterministic.
      await page.locator('[data-layout-grip=right]').focus();
      await page.keyboard.press('ArrowLeft');
      const width = await page
        .locator('#layoutRight')
        .evaluate((n) => n.getBoundingClientRect().width);
      await page.keyboard.press('Control+1');
      await page.keyboard.press('Control+2');
      assert.equal(
        Math.round(
          await page.locator('#layoutRight').evaluate((n) => n.getBoundingClientRect().width),
        ),
        Math.round(width),
      );
      const preset = await page.evaluate(() => window.__studio.settingsPreset());
      assert.equal(preset.settings.layoutMode, 'modes');
      await chooseLayout('classic');
      await page.evaluate((p) => window.__studio.loadSettingsPreset(p), preset);
      assert.equal(await page.locator('#layoutMode').inputValue(), 'modes');
      await page.reload();
      await ready();
      assert.equal(await page.locator('#layoutMode').inputValue(), 'modes');
      await page.evaluate(() => {
        localStorage.removeItem('animation-studio-settings');
        localStorage.setItem('animation-studio-layout-v2', '{}');
      });
      await page.reload();
      await ready();
      assert.equal(await page.locator('#layoutMode').inputValue(), 'classic');
      const classicPixels = [];
      // Fresh contexts with identical settings, static clock/pose and mouse position for pixel parity.
      async function image(which, layout, width, height) {
        const context = await browser.newContext({ viewport: { width, height } });
        const shot = await context.newPage();
        shot.on('pageerror', (e) => errors.push(e.message));
        await shot.addInitScript(
          (layout) =>
            localStorage.setItem(
              'animation-studio-settings',
              JSON.stringify({ layoutMode: layout }),
            ),
          layout,
        );
        await shot.goto(base + '/' + which);
        await shot.waitForFunction(() => window.__studio?.ready);
        await shot.evaluate(() => document.fonts.ready);
        if (layout === 'modes') await shot.locator('#layoutTab-animate').click();
        await shot.mouse.move(0, 0);
        await shot.waitForTimeout(800);
        await shot.evaluate(async () => {
          window.__studio.seek(0);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          window.__studio.setHostActive(false);
        });
        const buffer = await shot.screenshot({
          path: path.join(
            dir,
            `${which === 'before' ? 'before-' : ''}${layout}-${width}x${height}.png`,
          ),
          animations: 'disabled',
          caret: 'hide',
        });
        await context.close();
        return buffer;
      }
      for (const [width, height] of [
        [1920, 1080],
        [1024, 768],
      ]) {
        const current = await image('after', 'classic', width, height);
        await image('after', 'modes', width, height);
        if (baseline && existsSync(baseline)) {
          const old = await image('before', 'classic', width, height);
          assert.ok(current.equals(old), `Classic screenshot changed at ${width}x${height}`);
          classicPixels.push({ width, height, equal: true });
        } else
          t.diagnostic('NOT_RUN classic pre-G5 pixel comparison: set APP3_LAYOUT_BASELINE_HTML');
      }
      await page.setViewportSize({ width: 1024, height: 768 });
      await chooseLayout('modes');
      await page.locator('#layoutTab-animate').click();
      assert.equal(await page.locator('#pcOnlyNotice').isVisible(), false);
      const view = await page.locator('#viewportShell').boundingBox();
      assert.ok(view.width > 700 && view.height > 120, 'Tablet viewport remains usable');
      await page.waitForTimeout(800);
      const keys = await page.locator('#timeline').boundingBox();
      assert.ok(keys.height >= 60 && keys.y >= 0 && keys.y + keys.height < 753,
        'Tablet key tracks stay on screen after asynchronous resize');
      await page.locator('#layoutPane-left').click();
      assert.equal(await page.locator('#layoutLeft').isVisible(), true);
      await page.locator('#layoutDrawerBackdrop').click({ position: { x: 600, y: 200 } });
      assert.equal(await page.locator('#layoutLeft').isVisible(), false);
      await page.setViewportSize({ width: 500, height: 400 });
      await page.waitForFunction(() =>
        document.documentElement.classList.contains('phone-blocked'),
      );
      assert.equal(await page.locator('#pcOnlyNotice').isVisible(), true);
      await page.locator('#layoutOpenSmall').click();
      assert.equal(await page.locator('#pcOnlyNotice').isVisible(), false);
      assert.deepEqual(errors, []);
      writeFileSync(
        path.join(dir, 'layout-results.json'),
        JSON.stringify(
          {
            passed: true,
            swaps: 10,
            projectUnchanged: true,
            undoRedo: true,
            preset: true,
            classicPixels,
            screenshots: [
              'classic-1920x1080.png',
              'modes-1920x1080.png',
              'classic-1024x768.png',
              'modes-1024x768.png',
            ],
            errors,
          },
          null,
          2,
        ),
      );
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
