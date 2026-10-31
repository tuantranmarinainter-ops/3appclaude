import { useClassicLayout } from './classic_test_layout.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
)('playwright');
test(
  'A6 real pointers move/scale group, ripple, cancel, collision and exact undo',
  { timeout: 180000 },
  async () => {
    const artifact = new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url),
      server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(readFileSync(artifact));
      });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
      page.on('dialog', (d) => d.accept());
      await useClassicLayout(page);
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.__studio?.ready);
      const evidence = [];
      for (const lab of [false, true]) {
        await page.evaluate(async (lab) => {
          const s = window.__studio,
            C = s.core,
            p = s.project();
          delete p.lab;
          delete p.parallelModes;
          p.rig.asset = null;
          p.duration = 4;
          p.fps = 30;
          p.loop = [0, 4];
          p.keys = {};
          p.ikModes = {};
          p.ikOptions = {};
          const a = { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
          for (const f of [0, 30, 45, 60, 90])
            C.addKey(p, 'root', f / 30, { ...a, p: [f, 0, 0] }, 'linear');
          if (lab) {
            const base = C.clone(p);
            base.keys = {};
            p.lab = C.motionLab.create(base);
            C.motionLab.sync(p);
            p.parallelModes = { version: 1, active: 'lab' };
          }
          await s.loadProject(p);
          const scope = document.getElementById('keySelectionScope');
          scope.value = 'body';
          scope.dispatchEvent(new Event('change'));
          document.getElementById('keyTimeRipple').checked = true;
        }, lab);
        const before = await page.evaluate(() => window.__studio.project());
        assert.equal(!!before.lab, lab);
        async function point(f, edge = false) {
          const b = await page.locator('#timeline').boundingBox(),
            h = Number(await page.locator('#timeline').getAttribute('data-row-height'));
          return { x: b.x + 130 + ((b.width - 142) * f) / 120, y: b.y + (edge ? 3 : h / 2) };
        }
        async function choose() {
          await page.locator('#keySelectionScope').dispatchEvent('change');
          for (const f of [30, 45, 60]) {
            const p = await point(f);
            await page.keyboard.down('Control');
            await page.mouse.click(p.x, p.y);
            await page.keyboard.up('Control');
          }
        }
        async function drag(from, to, edge = false, cancel = false) {
          const a = await point(from, edge),
            b = await point(to, edge);
          await page.mouse.move(a.x, a.y);
          await page.mouse.down();
          await page.mouse.move(b.x, b.y, { steps: 8 });
          if (cancel)
            await page.locator('#timeline').dispatchEvent('pointercancel', { pointerId: 1 });
          await page.mouse.up();
        }
        await choose();
        const index = await page.evaluate(() => window.__studio.state.historyIndex);
        await drag(60, 45, true);
        const compressed = await page.evaluate(() => {
          const s = window.__studio,
            p = s.project();
          return {
            p,
            index: s.state.historyIndex,
            sample: s.core.sampleKeys(p.keys.root, 1.25, {
              p: [0, 0, 0],
              q: [0, 0, 0, 1],
              s: [1, 1, 1],
            }).p[0],
          };
        });
        assert.deepEqual(
          compressed.p.keys.root.map((k) => k.time * 30),
          [0, 30, 37.5, 45, 75],
        );
        assert.equal(compressed.sample, 45);
        assert.equal(compressed.index, index + 1);
        if (lab) assert.deepEqual(compressed.p.lab.layers[0].keys, compressed.p.keys);
        await page.keyboard.press('Control+z');
        assert.deepEqual(await page.evaluate(() => window.__studio.project()), before);
        await choose();
        await drag(60, 45, true, true);
        assert.deepEqual(await page.evaluate(() => window.__studio.project()), before);
        // Escape cancellation preserves data too.
        const a = await point(60, true),
          b = await point(45, true);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 8 });
        await page.keyboard.press('Escape');
        await page.mouse.up();
        assert.deepEqual(await page.evaluate(() => window.__studio.project()), before);
        await drag(45, 30);
        assert.deepEqual(
          await page.evaluate(() => window.__studio.project().keys.root.map((k) => k.time * 30)),
          [0, 15, 30, 45, 75],
        );
        await page.keyboard.press('Control+z');
        assert.deepEqual(await page.evaluate(() => window.__studio.project()), before);
        await choose();
        await page.evaluate(() => (document.getElementById('keyTimeRipple').checked = false));
        await drag(60, 90, true);
        assert.deepEqual(await page.evaluate(() => window.__studio.project()), before);
        const out = process.env.APP3_EVIDENCE_DIR;
        if (out) {
          mkdirSync(out, { recursive: true });
          await page.screenshot({
            path: `${out}/a6-${lab ? 'lab' : 'classic'}.png`,
            fullPage: true,
          });
        }
        evidence.push({
          mode: lab ? 'lab' : 'classic',
          frames: [0, 30, 37.5, 45, 75],
          speed: 2,
          sample45: true,
          undoExact: true,
          pointerCancel: true,
          escape: true,
          collisionRejected: true,
        });
      }
      if (process.env.APP3_EVIDENCE_DIR)
        writeFileSync(
          `${process.env.APP3_EVIDENCE_DIR}/browser.json`,
          JSON.stringify(evidence, null, 2),
        );
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);
