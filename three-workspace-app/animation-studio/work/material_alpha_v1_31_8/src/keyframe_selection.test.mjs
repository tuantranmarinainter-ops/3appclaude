import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
const require = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
);
test(
  'A4 real pointers: rectangle, modifiers, cancel and unchanged data/history',
  { timeout: 120000 },
  async () => {
    const html = readFileSync(
      new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url),
    );
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.__studio?.ready);
      await page.evaluate(async () => {
        const s = window.__studio,
          p = s.serialized();
        delete p.lab;
        delete p.parallelModes;
        p.duration = 4;
        p.keys = {};
        const ids = [
          'root',
          ...s
            .rig()
            .records.slice(0, 2)
            .map((r) => r.id),
        ];
        const pose = { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
        for (const id of ids) for (const t of [1, 2, 3]) s.core.addKey(p, id, t, pose, 'linear');
        await s.loadProject(p);
        document.querySelector('#keySelectionScope').value = 'node';
        document.querySelector('#keySelectionScope').dispatchEvent(new Event('change'));
        document.querySelector('#timelineStyle').value = 'classic';
        document.querySelector('#timelineStyle').dispatchEvent(new Event('change'));
      });
      const canvas = page.locator('#timeline');
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      assert.ok(box);
      const x = (t) => box.x + 130 + ((box.width - 142) * t) / 4,
        y = (row) => box.y + (row + 0.5) * 28;
      const before = await page.evaluate(() => ({
        keys: window.__studio.project().keys,
        history: window.__studio.state.historyIndex,
        dirty: window.__studio.state.dirty,
        time: window.__studio.state.time,
      }));
      async function selection() {
        return page.evaluate(() => window.__studio.state.selectionKeys);
      }
      async function drag(a, b, finish = true) {
        await page.mouse.move(...a);
        await page.mouse.down();
        await page.mouse.move(...b, { steps: 8 });
        if (finish) await page.mouse.up();
      }
      await drag([x(0.8), box.y + 2], [x(2.2), box.y + 55]);
      const selected = await selection(),
        expected = Object.entries(before.keys)
          .slice(0, 2)
          .flatMap(([id, keys]) =>
            keys
              .filter((k) => k.time >= 0.8 && k.time <= 2.2)
              .map((k) => ({ kind: 'keys', id, time: k.time })),
          );
      assert.deepEqual(selected, expected);
      assert.equal(selected.length, 4);
      assert.ok(selected.every((k) => k.time === 1 || k.time === 2));
      assert.equal(await page.locator('#keySelectionCount').textContent(), '4 key đã chọn');
      await page.keyboard.down('Control');
      await page.mouse.click(x(1), y(0));
      await page.keyboard.up('Control');
      assert.equal((await selection()).length, 3);
      await page.keyboard.down('Shift');
      await page.mouse.click(x(3), y(0));
      await page.keyboard.up('Shift');
      assert.equal((await selection()).length, 4);
      const prior = await selection();
      await drag([x(0.7), box.y + 2], [x(3.2), box.y + 80], false);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.deepEqual(await selection(), prior);
      const after = await page.evaluate(() => ({
        keys: window.__studio.project().keys,
        history: window.__studio.state.historyIndex,
        dirty: window.__studio.state.dirty,
        time: window.__studio.state.time,
      }));
      assert.deepEqual(after, before, 'selection must not mutate keys, time, dirty or history');
      // Reverse drag and empty rectangle replace, including all-body reference deduplication.
      await drag([x(2.2), box.y + 55], [x(0.8), box.y + 2]);
      assert.equal((await selection()).length, 4);
      await drag([x(0.1), box.y + 2], [x(0.4), box.y + 55]);
      assert.equal((await selection()).length, 0);
      await page.selectOption('#keySelectionScope', 'body');
      await canvas.scrollIntoViewIfNeeded();
      const b = await canvas.boundingBox();
      await drag([x(0.8), b.y + 2], [x(2.2), b.y + 25]);
      assert.equal((await selection()).length, 6);
      // A horizontal empty-canvas drag still scrubs, and clicking a key still selects.
      await drag([x(0.1), b.y + 3], [x(0.5), b.y + 3]);
      assert.ok(Math.abs((await page.evaluate(() => window.__studio.state.time)) - 0.5) < 0.04);
      const highlight = await canvas.evaluate((c) => {
        const ratio = c.width / c.clientWidth,
          x = (130 + (c.clientWidth - 142) / 4) * ratio,
          y = 14 * ratio;
        return [...c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data];
      });
      assert.deepEqual(highlight.slice(0, 3), [238, 188, 81]);
      assert.equal(await page.locator('#keySelectionCount').isVisible(), true);
      assert.deepEqual(errors, []);
      if (process.env.A4_EVIDENCE_DIR) {
        mkdirSync(process.env.A4_EVIDENCE_DIR, { recursive: true });
        await page.screenshot({
          path: process.env.A4_EVIDENCE_DIR + '/selection.png',
          fullPage: true,
        });
        writeFileSync(
          process.env.A4_EVIDENCE_DIR + '/browser.json',
          JSON.stringify(
            {
              selected,
              after,
              errors,
              checks: [
                'rectangle',
                'reverse',
                'ctrl-remove',
                'shift-add',
                'escape',
                'empty',
                'body-dedupe',
                'horizontal-scrub',
                'unchanged-data-history',
              ],
            },
            null,
            2,
          ),
        );
      }
      await canvas.scrollIntoViewIfNeeded();
      const finalBox = await canvas.boundingBox(),
        keyX = finalBox.x + 130 + (finalBox.width - 142) / 4,
        keyY = finalBox.y + 14;
      const originalKeys = await page.evaluate(() => window.__studio.project().keys);
      await drag([keyX, keyY], [keyX + (finalBox.width - 142) / 4 / 30, keyY]);
      const moved = await page.evaluate(() => window.__studio.project().keys.root[0].time);
      assert.ok(Math.abs(moved - (1 + 1 / 30)) < 1e-7, 'existing key drag moves by one frame');
      await page.keyboard.press('Control+z');
      assert.deepEqual(await page.evaluate(() => window.__studio.project().keys), originalKeys);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  },
);
