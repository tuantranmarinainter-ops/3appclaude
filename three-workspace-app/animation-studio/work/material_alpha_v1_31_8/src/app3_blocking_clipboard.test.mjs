import { useClassicLayout } from './classic_test_layout.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
const require = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
);
const close = (a, b, tolerance = 1e-8) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < tolerance, `${i}: ${v} != ${b[i]}`));
};
test(
  'A8 Blocking clipboard across animations, ABC, root policy, atomic Undo, reopen and real library preview',
  { timeout: 180000 },
  async () => {
    const server = createServer((q, r) => {
      r.setHeader('Content-Type', 'text/html');
      r.end(
        readFileSync(new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url)),
      );
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { chromium } = require('playwright'),
      browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (dialog) => dialog.accept());
      await useClassicLayout(page);
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.waitForFunction(() => window.__studio?.ready);
      assert.equal(await page.locator('#poseKeepHeight').isChecked(), false);
      const fixture = await page.evaluate(() => {
        const s = window.__studio,
          base = s.serialized(),
          id = s.recordNames().find((r) => /LeftArm$/.test(r.name)).id,
          pose = s.pose();
        function clip(name, angle, root) {
          const p = structuredClone(base);
          p.name = name;
          p.duration = 2;
          p.loop = [0, 2];
          p.keys = {};
          p.ikModes = {};
          p.ikOptions = {};
          s.core.addKey(
            p,
            id,
            0,
            { ...pose[id], q: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)] },
            'linear',
          );
          s.core.addKey(p, 'root', 0, { ...pose.root, p: root }, 'linear');
          return p;
        }
        return {
          id,
          a: clip('A ngoi', -0.6, [3, 0, 5]),
          c: clip('C bay', 1, [3, 4, 5]),
          target: clip('Blocking ABC', 0, [10, 0, 20]),
        };
      });
      await page.evaluate((p) => window.__studio.loadProject(p), fixture.a);
      await page.locator('#blockingCopyPose').click();
      await page.evaluate((p) => window.__studio.loadProject(p), fixture.target);
      await page.locator('#blockingPastePose').click();
      const afterA = await page.evaluate(() => window.__studio.serialized());
      await page.evaluate((p) => window.__studio.loadProject(p), fixture.c);
      const expectedC = await page.evaluate(() => window.__studio.pose());
      await page.locator('#blockingCopyPose').click();
      await page.evaluate((p) => window.__studio.loadProject(p), afterA);
      await page.evaluate(() => window.__studio.seek(2));
      const beforeC = await page.evaluate(() => window.__studio.project());
      await page.locator('#blockingPastePose').click();
      const defaultC = await page.evaluate(() => ({
        pose: window.__studio.pose(),
        project: window.__studio.project(),
      }));
      close(defaultC.pose.root.p, [10, 0, 20]);
      close(defaultC.pose[fixture.id].q, expectedC[fixture.id].q);
      await page.locator('#undoBtn').click();
      assert.deepEqual(await page.evaluate(() => window.__studio.project()), beforeC);
      await page.locator('#redoBtn').click();
      await page.evaluate(() => window.__studio.seek(1));
      const middle = await page.evaluate((id) => window.__studio.pose()[id], fixture.id);
      close(middle.q, [0, 0, Math.sin(0.1), Math.cos(0.1)]);
      const ac = await page.evaluate(() => window.__studio.serialized());
      await page.evaluate((p) => window.__studio.loadProject(p), fixture.a);
      await page.locator('#blockingCopyPose').click();
      await page.evaluate((p) => window.__studio.loadProject(p), ac);
      await page.evaluate(() => window.__studio.seek(1));
      const beforeB = await page.evaluate(() => window.__studio.project());
      await page.locator('#blockingPastePose').click();
      const withB = await page.evaluate(() => window.__studio.project());
      assert.ok(withB.keys[fixture.id].some((k) => k.time === 1));
      await page.locator('#undoBtn').click();
      assert.deepEqual(await page.evaluate(() => window.__studio.project()), beforeB);
      await page.evaluate((p) => window.__studio.loadProject(p), fixture.c);
      await page.locator('#blockingCopyPose').click();
      await page.evaluate((p) => window.__studio.loadProject(p), ac);
      await page.evaluate(() => window.__studio.seek(2));
      await page.locator('#poseKeepHeight').check();
      await page.locator('#blockingPastePose').click();
      const high = await page.evaluate(() => window.__studio.pose());
      close(high.root.p, [3, 4, 5]);
      await page.locator('#undoBtn').click();
      close(await page.evaluate(() => window.__studio.pose().root.p), [10, 0, 20]);
      await page.locator('#redoBtn').click();
      const saved = await page.evaluate(() => window.__studio.serialized());
      await page.evaluate((p) => window.__studio.loadProject(p), saved);
      await page.evaluate(() => window.__studio.seek(2));
      close(await page.evaluate(() => window.__studio.pose().root.p), [3, 4, 5]);
      const beforeReject = await page.evaluate(() => ({
        project: window.__studio.project(),
        pose: window.__studio.pose(),
        index: window.__studio.state.historyIndex,
      }));
      const oldName = await page.evaluate(() => {
        const r = window.__studio.rig().records[0],
          name = r.name;
        r.name = 'Incompatible';
        return name;
      });
      await page.locator('#blockingPastePose').click();
      assert.match(await page.locator('#status').textContent(), /không tương thích/);
      assert.deepEqual(
        await page.evaluate(() => ({
          project: window.__studio.project(),
          pose: window.__studio.pose(),
          index: window.__studio.state.historyIndex,
        })),
        beforeReject,
      );
      await page.evaluate((name) => (window.__studio.rig().records[0].name = name), oldName);
      const evidence = process.env.APP3_EVIDENCE_DIR;
      if (evidence) {
        mkdirSync(evidence, { recursive: true });
        await page.screenshot({ path: evidence + '/blocking-ABC.png', fullPage: true });
      }
      await page.evaluate(async () => {
        await window.__studio.dual.enable(true);
        window.__studio.dual.activate('B');
      });
      await page.locator('#blockingPastePose').click();
      close(
        await page.evaluate((id) => window.__studio.pose()[id].q, fixture.id),
        expectedC[fixture.id].q,
      );
      await page.evaluate(() => window.__studio.dual.enable(false));
      let library = null;
      if (process.env.APP3_LIBRARY_COPY) {
        await page.locator('#modelInput').setInputFiles(process.env.APP3_LIBRARY_COPY);
        await page.waitForFunction(
          () =>
            window.__studio.rig().asset?.name === 'anim.glb' &&
            window.__studio.rig().clips.length > 0,
        );
        await page.evaluate(() => {
          window.__studio.previewSourceClip(0);
          document.querySelector('#playBtn').click();
          window.__studio.seek(0.3);
        });
        const sourceBefore = await page.evaluate(() => ({
          pose: window.__studio.pose(),
          project: window.__studio.project(),
        }));
        await page.locator('#blockingCopyPose').click();
        assert.deepEqual(
          await page.evaluate(() => ({
            pose: window.__studio.pose(),
            project: window.__studio.project(),
          })),
          sourceBefore,
        );
        await page.evaluate(() => window.__studio.endSourcePreview());
        await page.locator('#poseKeepHeight').uncheck();
        await page.locator('#blockingPastePose').click();
        const actual = await page.evaluate(() => window.__studio.pose());
        let maxQuaternionError = 0;
        for (const [id, p] of Object.entries(sourceBefore.pose)) {
          close(actual[id].q, p.q, 1e-6);
          p.q.forEach(
            (v, i) =>
              (maxQuaternionError = Math.max(maxQuaternionError, Math.abs(v - actual[id].q[i]))),
          );
        }
        library = { bones: Object.keys(actual).length, sourceReadOnly: true, maxQuaternionError };
        if (evidence)
          await page.screenshot({ path: evidence + '/library-pose.png', fullPage: true });
      }
      assert.deepEqual(errors, []);
      if (evidence)
        writeFileSync(
          evidence + '/numeric.json',
          JSON.stringify(
            {
              id: fixture.id,
              A: fixture.a.keys[fixture.id][0],
              C: expectedC[fixture.id],
              midB: middle,
              defaultRoot: defaultC.pose.root.p,
              copyRoot: high.root.p,
              undoExact: true,
              reopenExact: true,
              rejectNoMutation: true,
              clipboardSharedAcrossEditors: true,
              library,
              errors,
            },
            null,
            2,
          ),
        );
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  },
);
