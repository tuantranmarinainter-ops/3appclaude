import { browserOptions } from './browser_test_options.mjs';
import { useClassicLayout } from './classic_test_layout.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
)('playwright');
const artifact = new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url);
test(
  'A5 real pointers: delete ten keys, resample and undo exactly in Classic and Lab',
  { timeout: 180000 },
  async () => {
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(readFileSync(artifact));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const browser = await chromium.launch(browserOptions({ headless: true }));
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => d.accept());
      await useClassicLayout(page);
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.__studio?.ready);
      const results = [];
      for (const lab of [false, true]) {
        await page.evaluate(async (lab) => {
          const s = window.__studio,
            C = s.core,
            p = s.project();
          delete p.lab;
          delete p.parallelModes;
          p.duration = 2;
          p.loop = [0, 2];
          p.keys = {};
          p.ikModes = {};
          p.ikOptions = {};
          const a = { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
          for (let i = 0; i <= 11; i++)
            C.addKey(
              p,
              'root',
              (i * 2) / 11,
              { ...a, p: [i === 11 ? 22 : i === 0 ? 0 : 100 + i, 0, 0] },
              'linear',
            );
          if (lab) {
            const base = C.clone(p);
            base.keys = {};
            p.lab = C.motionLab.create(base);
            C.motionLab.sync(p);
            p.parallelModes = { version: 1, active: 'lab' };
          }
          await s.loadProject(p);
          if (lab && !s.project().lab)
            throw Error(
              'Lab lost on load ' +
                JSON.stringify({
                  input: !!p.lab,
                  parallel: p.parallelModes,
                  errors: s.state.errors,
                }),
            );
          document.getElementById('keySelectionScope').value = 'body';
          document.getElementById('keySelectionScope').dispatchEvent(new Event('change'));
        }, lab);
        const before = await page.evaluate(() => window.__studio.project());
        let box = await page.locator('#timeline').boundingBox();
        const row = await page.locator('#timeline').getAttribute('data-row-height');
        assert.ok(box);
        const point = (i) => ({
          x: box.x + 130 + ((box.width - 142) * i) / 11,
          y: box.y + Number(row) / 2,
        });
        for (let i = 1; i <= 10; i++) {
          await page.keyboard.down('Control');
          await page.mouse.click(point(i).x, point(i).y);
          await page.keyboard.up('Control');
        }
        // Input shortcuts must leave animation data intact.
        await page.evaluate(() => {
          const input = document.createElement('input');
          input.id = 'a5-test-input';
          document.body.append(input);
          input.focus();
        });
        await page.keyboard.press('Delete');
        assert.deepEqual(await page.evaluate(() => window.__studio.project()), before);
        await page.locator('#a5-test-input').evaluate((e) => e.remove());
        await page.evaluate(() => {
          const e = document.createElement('div');
          e.id = 'a5-test-editable';
          e.setAttribute('contenteditable', '');
          e.textContent = 'text';
          document.body.append(e);
          e.focus();
        });
        await page.keyboard.press('Delete');
        assert.deepEqual(await page.evaluate(() => window.__studio.project()), before);
        await page.locator('#a5-test-editable').evaluate((e) => e.remove());
        await page.locator('#timeline').focus();
        const index = await page.evaluate(() => window.__studio.state.historyIndex);
        await page.keyboard.press('Delete');
        const after = await page.evaluate(() => {
          const s = window.__studio,
            p = s.project();
          return {
            p,
            index: s.state.historyIndex,
            sample: s.core.sampleKeys(p.keys.root, 1, {
              p: [0, 0, 0],
              q: [0, 0, 0, 1],
              s: [1, 1, 1],
            }).p[0],
          };
        });
        assert.equal(after.p.keys.root.length, 2);
        assert.equal(after.sample, 11);
        assert.equal(after.index, index + 1);
        if (lab) assert.deepEqual(after.p.lab.layers[0].keys, after.p.keys);
        await page.keyboard.press('Control+z');
        assert.deepEqual(await page.evaluate(() => window.__studio.project()), before);
        // Re-select with real pointers; Undo can change the Lab panel layout.
        box = await page.locator('#timeline').boundingBox();
        for (let i = 1; i <= 10; i++) {
          await page.keyboard.down('Control');
          await page.mouse.click(point(i).x, point(i).y);
          await page.keyboard.up('Control');
        }
        // Right-click a selected key preserves the multi-selection.
        box = await page.locator('#timeline').boundingBox();
        await page.mouse.click(point(5).x, point(5).y, { button: 'right' });
        await page.getByRole('menuitem', { name: 'Xoá', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__studio.project().keys.root.length), 2);
        await page.keyboard.press('Control+z');
        assert.deepEqual(await page.evaluate(() => window.__studio.project()), before);
        const out = process.env.APP3_EVIDENCE_DIR;
        if (out) {
          mkdirSync(out, { recursive: true });
          await page.screenshot({
            path: `${out}/a5-${lab ? 'lab' : 'classic'}.png`,
            fullPage: true,
          });
        }
        results.push({
          mode: lab ? 'lab' : 'classic',
          deleted: 10,
          remaining: 2,
          sample: after.sample,
          undoExact: true,
        });
      }
      assert.deepEqual(errors, []);
      if (process.env.APP3_EVIDENCE_DIR)
        writeFileSync(
          `${process.env.APP3_EVIDENCE_DIR}/browser.json`,
          JSON.stringify(results, null, 2),
        );
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);
