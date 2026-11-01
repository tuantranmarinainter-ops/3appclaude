import { browserOptions } from './browser_test_options.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ACTIONS, GROUPS } from './keymap_catalog.js';
const { chromium } = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
)('playwright');
const source = fileURLToPath(new URL('./', import.meta.url));
const html = fileURLToPath(
  new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url),
);
const evidence =
  process.env.KEYMAP_EVIDENCE_DIR ||
  fileURLToPath(new URL('../../../../editor/.test-results/app3-keymap', import.meta.url));
const launch = () =>
  chromium.launch(
    browserOptions({
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    }),
  );
async function serve() {
  const server = createServer((q, r) => {
    if (q.url === '/router') {
      r.setHeader('content-type', 'text/html');
      r.end(
        `<script type="module">import * as K from '/source/keymap.js';import{GROUPS}from'/source/keymap_catalog.js';K.install(()=>({readOnly:false}));window.K=K;window.GROUPS=GROUPS;window.ready=true;</script>`,
      );
      return;
    }
    if (q.url.startsWith('/source/')) {
      const file = path.resolve(source, q.url.slice(8));
      if (!file.startsWith(source)) {
        r.writeHead(403);
        r.end();
        return;
      }
      r.setHeader('content-type', 'text/javascript');
      r.end(readFileSync(file));
      return;
    }
    r.setHeader('content-type', 'text/html');
    r.end(
      readFileSync(
        q.url === '/before' && process.env.KEYMAP_BASELINE_HTML
          ? process.env.KEYMAP_BASELINE_HTML
          : html,
      ),
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
const pressKey = (k) => k.replace('Mod+', 'Control+').replace('Ctrl+', 'Control+');
test(
  'every old binding routes through a single native listener and two independent widget instances',
  { timeout: 120000 },
  async (t) => {
    const server = await serve();
    let browser;
    const cases = [];
    try {
      browser = await launch();
      const page = await browser.newPage();
      await page.goto(server.url + '/router');
      await page.waitForFunction(() => window.ready);
      for (const [group, defs] of Object.entries(GROUPS))
        for (const def of defs) {
          const action = ACTIONS.find((a) => a.id === def.id),
            index = action.defaults.indexOf(def.original),
            physical = action.defaults[index];
          await page.evaluate(
            ({ group }) => {
              window.clean?.();
              document.body.replaceChildren();
              const a = document.createElement('div'),
                b = document.createElement('div');
              a.tabIndex = b.tabIndex = 0;
              a.textContent = 'A';
              b.textContent = 'B';
              a.id = 'timeline';
              b.id = 'other';
              document.body.append(a, b);
              window.seen = [];
              const bind = (node, label) =>
                K.on(node, group, (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  seen.push({
                    label,
                    key: e.key,
                    shift: e.shiftKey,
                    ctrl: e.ctrlKey,
                    meta: e.metaKey,
                    current: e.currentTarget === node,
                  });
                });
              const x = bind(a, 'A'),
                y = bind(b, 'B');
              window.clean = () => {
                x();
                y();
              };
              a.focus();
            },
            { group },
          );
          await page.keyboard.press(pressKey(physical));
          let seen = await page.evaluate(() => window.seen);
          assert.equal(seen.length, 1, group + ' ' + physical);
          assert.equal(seen[0].current, true);
          assert.equal(seen[0].label, 'A');
          assert.equal(seen[0].shift, physical.includes('Shift+'));
          assert.equal(
            seen[0].key,
            physical.split('+').at(-1) === 'Space'
              ? ' '
              : physical.split('+').at(-1).length === 1
                ? physical.split('+').at(-1).toLowerCase()
                : physical.split('+').at(-1),
          );
          await page.evaluate(() => {
            document.getElementById('timeline').id = 'old';
            document.getElementById('other').id = 'timeline';
            document.getElementById('timeline').focus();
          });
          await page.keyboard.press(pressKey(physical));
          seen = await page.evaluate(() => window.seen);
          assert.equal(seen.length, 2);
          assert.equal(seen[1].label, 'B');
          cases.push({
            group,
            action: def.id,
            before: physical,
            after: physical,
            instances: 2,
            result: 'PASS',
          });
        }
      await page.evaluate(() => {
        window.clean?.();
        const a = document.createElement('div'),
          b = document.createElement('div');
        document.body.append(a, b);
        window.ownerSeen = [];
        K.on(window, 'motion_panel.2', () => ownerSeen.push('A'), { owner: a });
        K.on(window, 'motion_panel.2', () => ownerSeen.push('B'), { owner: b });
        a.remove();
        document.body.tabIndex = 0;
        document.body.focus();
      });
      await page.keyboard.press('Escape');
      assert.deepEqual(await page.evaluate(() => window.ownerSeen), ['B']);
      mkdirSync(evidence, { recursive: true });
      writeFileSync(path.join(evidence, 'all-old-bindings.json'), JSON.stringify(cases, null, 2));
      t.diagnostic(
        cases.length +
          ' original binding routes checked with real Playwright keypresses on two widgets each',
      );
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);
test(
  'real App3: exact modifiers, readonly navigation, live key editing/conflicts, presets, export/import, mouse and both layouts',
  { timeout: 300000 },
  async () => {
    const server = await serve();
    let browser;
    const errors = [];
    try {
      browser = await launch();
      const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 },
        acceptDownloads: true,
      });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => d.accept());
      await page.goto(server.url);
      await page.waitForFunction(() => window.__studio?.ready);
      const history = () => page.evaluate(() => window.__studio.state.historyIndex),
        camera = () => page.evaluate(() => window.__studio.settingsPreset().cameras.edit),
        body = () => page.locator('body').click({ position: { x: 2, y: 2 } });
      const settings = async () => {
        await page.locator('#settingsBtn').click();
        await page.locator('#settingsTab-input').click();
        if (!(await page.locator('#keymapSettings').evaluate((n) => n.open)))
          await page.locator('#keymapSettings > summary').click();
      };
      const close = async () => {
        await page.locator('#settingsTitle button').click();
        await body();
      };
      const assign = async (id, key) => {
        await page
          .locator(`#keymapTable tr[data-keymap-action="${id}"] td`)
          .nth(1)
          .locator('button')
          .first()
          .click();
        await page.keyboard.press(key);
      };
      await page.keyboard.press('Control+2');
      await page.keyboard.press('k');
      const h = await history();
      assert.ok(h > 0);
      await page.evaluate(() => {
        document.getElementById('cameraPreset').value = 'front';
        document.getElementById('cameraPreset').dispatchEvent(new Event('change'));
      });
      for (const key of ['K', 'q', ' '])
        for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
          const before = await page.evaluate(() => ({
            history: window.__studio.state.historyIndex,
            camera: window.__studio.settingsPreset().cameras.edit,
            play: document.getElementById('playBtn').textContent,
          }));
          await page.evaluate(
            ({ key, mod }) =>
              document.body.dispatchEvent(
                new KeyboardEvent('keydown', {
                  bubbles: true,
                  cancelable: true,
                  key,
                  code: key === ' ' ? 'Space' : 'Key' + key.toUpperCase(),
                  [mod]: true,
                }),
              ),
            { key, mod },
          );
          assert.deepEqual(
            await page.evaluate(() => ({
              history: window.__studio.state.historyIndex,
              camera: window.__studio.settingsPreset().cameras.edit,
              play: document.getElementById('playBtn').textContent,
            })),
            before,
            key + ' ' + mod,
          );
        }
      await page.evaluate(() => {
        document.getElementById('cameraPreset').value = 'front';
        document.getElementById('cameraPreset').dispatchEvent(new Event('change'));
      });
      const front = await camera();
      await page.keyboard.press('q');
      assert.notDeepEqual(await camera(), front);
      await settings();
      await assign('timeline.play', 'l');
      await close();
      const play = await page.locator('#playBtn').textContent();
      await page.keyboard.press('Space');
      assert.equal(await page.locator('#playBtn').textContent(), play);
      await page.keyboard.press('l');
      assert.notEqual(await page.locator('#playBtn').textContent(), play);
      await page.keyboard.press('l');
      await page.locator('#boneSearch').fill('l');
      await page.locator('#boneSearch').press('l');
      assert.equal(await page.locator('#playBtn').textContent(), play);
      await page.locator('#boneSearch').fill('');
      await body();
      await settings();
      await assign('timeline.play', 'q');
      assert.equal(await page.locator('#keymapConflict').isVisible(), true);
      await page
        .locator('#keymapConflict')
        .getByRole('button', { name: 'Huỷ', exact: true })
        .click();
      assert.deepEqual(await page.evaluate(() => window.__studio.keymap.keysFor('timeline.play')), [
        'L',
      ]);
      await assign('timeline.play', 'q');
      await page.locator('#keymapConflict').getByRole('button', { name: 'Thay thế' }).click();
      assert.deepEqual(await page.evaluate(() => window.__studio.keymap.keysFor('view.reset')), []);
      await page.getByRole('button', { name: 'Về mặc định tất cả', exact: true }).click();
      await page.locator('#keymapPreset').selectOption('blockbench');
      const old = await page.evaluate(() =>
        [...window.__studio.keymap.actions.values()]
          .filter((a) => a.defaults.length)
          .map((a) => ({
            id: a.id,
            expected: a.defaults,
            actual: window.__studio.keymap.keysFor(a.id),
          })),
      );
      for (const a of old)
        for (const k of a.expected) assert.ok(a.actual.includes(k.replace('Ctrl+', 'Mod+')), a.id);
      await page.locator('#keymapConflictsOnly').check();
      assert.ok((await page.locator('#keymapTable tbody tr[data-keymap-action]').count()) > 0);
      await page.locator('#keymapConflictsOnly').uncheck();
      await page.locator('#keymapPriority').selectOption('preset');
      await close();
      const hp = await history();
      await page.keyboard.press('q');
      assert.equal(await history(), hp + 1);
      await page.keyboard.press('Control+z');
      assert.equal(await history(), hp);
      await page.keyboard.press('Control+y');
      assert.equal(await history(), hp + 1);
      await page.keyboard.press('Control+1');
      const transform = await page.locator('#transformMode').inputValue();
      await page.keyboard.press('Space');
      assert.notEqual(await page.locator('#transformMode').inputValue(), transform);
      await page.keyboard.press('Control+2');
      await settings();
      await assign('key.add', 'l');
      await page.locator('#keymapPriority').selectOption('app3');
      assert.deepEqual(await page.evaluate(() => window.__studio.keymap.keysFor('key.add')), ['L']);
      const saved = await page.evaluate(() => window.__studio.keymap.exportState());
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Xuất bộ phím', exact: true }).click();
      const download = await downloadPromise;
      await download.saveAs(path.join(evidence, 'exported-keymap.json'));
      assert.deepEqual(
        JSON.parse(readFileSync(path.join(evidence, 'exported-keymap.json'), 'utf8')),
        saved,
      );
      await page.getByRole('button', { name: 'Về mặc định tất cả', exact: true }).click();
      await page
        .locator('#keymapImport')
        .setInputFiles({
          name: 'keymap.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(saved)),
        });
      await page.waitForFunction(
        (saved) => JSON.stringify(window.__studio.keymap.exportState()) === JSON.stringify(saved),
        saved,
      );
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(window.__studio.settingsPreset().settings.keymapState),
        ),
        saved,
      );
      await page.locator('#keymapSearch').fill('Ghi key');
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({ path: path.join(evidence, 'keymap-settings.png') });
      await page.locator('#keymapSearch').fill('');
      for (const profile of ['blender', 'maya']) {
        await page.locator('#keymapPreset').selectOption(profile);
        assert.equal(await page.locator('#keymapMouse').inputValue(), profile);
        await close();
        const before = await camera();
        const canvas = await page.locator('#editViewport canvas').first().boundingBox();
        if (profile === 'maya') await page.keyboard.down('Alt');
        await page.mouse.move(canvas.x + 60, canvas.y + 80);
        await page.mouse.down({ button: profile === 'blender' ? 'middle' : 'left' });
        await page.mouse.move(canvas.x + 140, canvas.y + 120, { steps: 5 });
        await page.mouse.up({ button: profile === 'blender' ? 'middle' : 'left' });
        if (profile === 'maya') await page.keyboard.up('Alt');
        assert.notDeepEqual(await camera(), before, profile + ' camera mouse preset');
        await settings();
      }
      await page.getByRole('button', { name: 'Về mặc định tất cả', exact: true }).click();
      await close();
      // Synthetic source clip: no user files, native preview lock and real read-only commands.
      await page.evaluate(async () => {
        const T = await import('three'),
          r = window.__studio.rig();
        r.clips.push(
          new T.AnimationClip('keymap-test', 1, [
            new T.VectorKeyframeTrack('.position', [0, 0.5, 1], [0, 0, 0, 0, 0, 0, 0, 0, 0]),
          ]),
        );
        window.__studio.previewSourceClip(r.clips.length - 1);
        document.getElementById('playBtn').click();
        window.__studio.seek(0);
      });
      const readOnly = await page.evaluate(() => ({
        project: window.__studio.project(),
        history: window.__studio.state.historyIndex,
      }));
      await body();
      await page.keyboard.press('.');
      assert.ok((await page.evaluate(() => window.__studio.state.time)) >= 0.49);
      for (const k of ['k', 'i', 'Delete', 'Control+z']) await page.keyboard.press(k);
      assert.deepEqual(
        await page.evaluate(() => ({
          project: window.__studio.project(),
          history: window.__studio.state.historyIndex,
        })),
        readOnly,
      );
      await page.evaluate(() => window.__studio.endSourcePreview());
      for (const layout of ['classic', 'modes']) {
        await page.evaluate((layout) => {
          document.getElementById('layoutMode').value = layout;
          document.getElementById('layoutMode').dispatchEvent(new Event('change'));
        }, layout);
        await body();
        const before = await history();
        await page.keyboard.press('k');
        assert.equal(await history(), before + 1);
        await page.keyboard.press('Control+z');
        assert.equal(await history(), before);
      }
      await page.reload();
      await page.waitForFunction(() => window.__studio?.ready);
      assert.equal(
        await page.locator('#keymapState').inputValue(),
        JSON.stringify(await page.evaluate(() => window.__studio.keymap.exportState())),
      );
      assert.deepEqual(errors, []);
      writeFileSync(
        path.join(evidence, 'real-app-result.json'),
        JSON.stringify(
          {
            result: 'PASS',
            exactModifiers: true,
            readonly: true,
            conflictCancelReplace: true,
            manualWins: true,
            exportImport: true,
            mouseProfiles: ['blender', 'maya'],
            layouts: ['classic', 'modes'],
            errors,
          },
          null,
          2,
        ),
      );
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);
test(
  'real default behavior before/after main matches in both layouts',
  { skip: !process.env.KEYMAP_BASELINE_HTML, timeout: 180000 },
  async () => {
    const server = await serve();
    let browser;
    try {
      browser = await launch();
      const results = [];
      for (const layout of ['classic', 'modes'])
        for (const variant of ['before', 'after']) {
          const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
          const page = await context.newPage();
          await page.addInitScript(
            (layout) =>
              localStorage.setItem(
                'animation-studio-settings',
                JSON.stringify({ layoutMode: layout }),
              ),
            layout,
          );
          await page.goto(server.url + '/' + variant);
          await page.waitForFunction(() => window.__studio?.ready);
          if (layout === 'modes') await page.keyboard.press('Control+2');
          await page.keyboard.press('k');
          await page.evaluate(() => window.__studio.seek(1));
          await page.keyboard.press('i');
          const snaps = [];
          const snap = async () =>
            snaps.push(
              await page.evaluate(() => ({
                project: window.__studio.project(),
                time: window.__studio.state.time,
                history: window.__studio.state.historyIndex,
                transform: document.getElementById('transformMode').value,
                silhouette: window.__studio.silhouette.enabled,
              })),
            );
          await snap();
          for (const key of [
            ',',
            '.',
            'Control+z',
            'Control+Shift+z',
            'g',
            'r',
            'Shift+s',
            'Shift+s',
          ]) {
            await page.keyboard.press(key);
            await snap();
          }
          await page.evaluate(() => {
            const field = document.getElementById('animationEditor');
            field.value = 'graph';
            field.dispatchEvent(new Event('change'));
            window.__studio.graph().canvas.focus();
          });
          await page.keyboard.press('Control+a');
          await page.keyboard.press('ArrowLeft');
          const graph = await page.evaluate(() => ({
            time: window.__studio.state.time,
            selection: window.__studio.graph().times,
          }));
          results.push({ layout, variant, snaps, graph });
          await context.close();
        }
      for (const layout of ['classic', 'modes']) {
        const before = results.find((r) => r.layout === layout && r.variant === 'before'),
          after = results.find((r) => r.layout === layout && r.variant === 'after');
        assert.deepEqual(after.snaps, before.snaps, layout + ' defaults');
        assert.deepEqual(after.graph, before.graph, layout + ' graph widget');
      }
      mkdirSync(evidence, { recursive: true });
      writeFileSync(
        path.join(evidence, 'before-after-real-app.json'),
        JSON.stringify(
          {
            result: 'PASS',
            layouts: ['classic', 'modes'],
            commands: [
              'K',
              'I',
              ',',
              '.',
              'Ctrl+Z',
              'Ctrl+Shift+Z',
              'G',
              'R',
              'Shift+S',
              'Graph Ctrl+A',
              'Graph ArrowLeft',
            ],
          },
          null,
          2,
        ),
      );
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);
