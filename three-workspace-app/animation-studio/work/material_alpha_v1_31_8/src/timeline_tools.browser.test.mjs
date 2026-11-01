import { browserOptions } from './browser_test_options.mjs';
import { useClassicLayout } from './classic_test_layout.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
)('playwright');
test(
  'Gói 1: real HTML navigation, multi-color, modes/delays, Undo/Redo/reopen and export capture',
  { timeout: 120000 },
  async () => {
    const html = readFileSync(
      new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url),
    );
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    const dir = process.env.BB_EVIDENCE_DIR || path.join(tmpdir(), 'app3-bb-evidence');
    mkdirSync(dir, { recursive: true });
    try {
      browser = await chromium.launch(browserOptions({
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      }));
      const page = await browser.newPage({ viewport: { width: 1680, height: 1120 } }),
        errors = [];
      page.setDefaultTimeout(10000);
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => d.accept());
      await useClassicLayout(page);
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.__studio?.ready);
      await page.evaluate(async () => {
        const s = window.__studio,
          p = s.serialized();
        delete p.lab;
        delete p.parallelModes;
        p.duration = 1;
        p.loop = [0, 1];
        p.keys = {};
        p.ikModes = {};
        p.ikOptions = {};
        const rest = s.core.snap(s.rig().root);
        for (const t of [0, 0.5, 1])
          s.core.addKey(
            p,
            'root',
            t,
            { ...rest, p: [rest.p[0] + t * 0.1, rest.p[1], rest.p[2]] },
            'linear',
          );
        const bone = s.rig().records[0];
        s.core.addKey(p, bone.id, 0.5, s.core.snap(bone.o), 'linear');
        await s.loadProject(p);
        s.select('root');
        s.seek(0);
      });
      const legacy = await page.evaluate(() => window.__studio.serialized());
      writeFileSync(path.join(dir, 'legacy-project.json'), JSON.stringify(legacy));
      const capture = async (name) => {
        const data = await page.evaluate(async () =>
          Array.from(new Uint8Array((await window.__studio.buildGLB()).data)),
        );
        writeFileSync(path.join(dir, name + '.glb'), Buffer.from(data));
      };
      await page.evaluate(() => {
        document.getElementById('includeSkin').checked = false;
        document.getElementById('exportProfile').value = 'same';
      });
      await capture('candidate-legacy');
      console.log('Gói1: sample + GLB ready');
      await page.locator('#nextKey').click();
      assert.equal(await page.evaluate(() => window.__studio.state.time), 0.5);
      await page.locator('#timeline').focus();
      await page.keyboard.press('.');
      assert.equal(await page.evaluate(() => window.__studio.state.time), 1);
      await page.keyboard.press(',');
      assert.equal(await page.evaluate(() => window.__studio.state.time), 0.5);
      await page.locator('#prevKey').click();
      assert.equal(await page.evaluate(() => window.__studio.state.time), 0);
      // Actual context menu after selecting all keys via the timeline shortcut.
      await page.locator('#timeline').focus();
      await page.keyboard.press('Control+a');
      const rect = await page.locator('#timeline').boundingBox();
      const row = Number(await page.locator('#timeline').getAttribute('data-row-height'));
      await page.mouse.click(rect.x + 130 + (rect.width - 142) * 0.5, rect.y + row / 2, {
        button: 'right',
      });
      await page.locator('[data-key-color="#81c784"]').click();
      assert.ok(
        await page.evaluate(() =>
          Object.values(window.__studio.project().keys)
            .flat()
            .every((k) => k.color === '#81c784'),
        ),
      );
      await page.locator('#undoBtn').click();
      assert.ok(
        await page.evaluate(() =>
          Object.values(window.__studio.project().keys)
            .flat()
            .every((k) => k.color === undefined),
        ),
      );
      await page.locator('#redoBtn').click();
      assert.ok(
        await page.evaluate(() =>
          Object.values(window.__studio.project().keys)
            .flat()
            .every((k) => k.color === '#81c784'),
        ),
      );
      await page.mouse.click(rect.x + 130 + (rect.width - 142) * 0.5, rect.y + row / 2, {
        button: 'right',
      });
      await page.screenshot({ path: path.join(dir, 'timeline-color-menu.png'), fullPage: true });
      await page.locator('[data-key-color=""]').click();
      assert.ok(
        await page.evaluate(() =>
          Object.values(window.__studio.project().keys)
            .flat()
            .every((k) => k.color === undefined),
        ),
      );
      await page.locator('#undoBtn').click();
      assert.ok(
        await page.evaluate(() =>
          Object.values(window.__studio.project().keys)
            .flat()
            .every((k) => k.color === '#81c784'),
        ),
      );
      await page.selectOption('#playMode', 'hold');
      await page.locator('#undoBtn').click();
      assert.equal(await page.inputValue('#playMode'), 'loop');
      await page.locator('#redoBtn').click();
      assert.equal(await page.inputValue('#playMode'), 'hold');
      for (const [id, value] of [
        ['startDelay', '.2'],
        ['loopDelay', '.1'],
      ]) {
        await page.locator('#' + id).fill(value);
        await page.locator('#' + id).press('Tab');
        assert.equal(await page.evaluate((id) => window.__studio.project()[id], id), Number(value));
        await page.locator('#undoBtn').click();
        assert.equal(await page.evaluate((id) => window.__studio.project()[id] ?? 0, id), 0);
        await page.locator('#redoBtn').click();
      }
      console.log('Gói1: navigation/color/settings UndoRedo PASS');
      const saved = await page.evaluate(() => window.__studio.serialized());
      await page.evaluate((p) => window.__studio.loadProject(p), saved);
      assert.equal(await page.inputValue('#playMode'), 'hold');
      assert.equal(Number(await page.inputValue('#startDelay')), 0.2);
      console.log('Gói1: reopen PASS');
      const waited = await page.evaluate(async () => {
        window.__studio.seek(0);
        document.getElementById('playBtn').click();
        return new Promise((resolve) => setTimeout(() => resolve(window.__studio.state.time), 60));
      });
      assert.ok(waited < 0.02, 'start wait holds first pose');
      await page.waitForFunction(() => window.__studio.state.time === 1, null, { timeout: 15000 });
      await page.selectOption('#playMode', 'once');
      await page.evaluate(() => {
        window.__studio.seek(0);
        document.getElementById('playBtn').click();
      });
      await page.waitForFunction(
        () => document.getElementById('playBtn').textContent.includes('▶'),
        null,
        { timeout: 15000 },
      );
      assert.equal(await page.evaluate(() => window.__studio.state.time), 0);
      await page.selectOption('#playMode', 'loop');
      await page.locator('#playBtn').dispatchEvent('click');
      await page.waitForTimeout(1700);
      await page.locator('#playBtn').dispatchEvent('click');
      const loopTime = await page.evaluate(() => window.__studio.state.time);
      assert.ok(loopTime >= 0 && loopTime <= 1);
      await capture('candidate-metadata');
      await page.screenshot({ path: path.join(dir, 'timeline-colored.png'), fullPage: true });
      assert.deepEqual(errors, []);
      writeFileSync(
        path.join(dir, 'browser-result.json'),
        JSON.stringify(
          {
            pass: true,
            checks: [
              'buttons',
              'shortcuts',
              'multi-key color',
              'color undo/redo',
              'mode undo/redo',
              'delay undo/redo',
              'reopen',
              'three modes',
              'start delay',
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
