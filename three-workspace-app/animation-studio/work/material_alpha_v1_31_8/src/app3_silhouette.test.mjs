// Run against Studio with APP3_RUNTIME_BASE and its own BBS_UNIFIED_PROJECTS_DIR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
const require = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
);
const workspace = fileURLToPath(new URL('../../../../', import.meta.url)),
  base = process.env.APP3_RUNTIME_BASE;

// Chromium screenshots are 8-bit RGB/RGBA PNGs. Decode with Node's zlib so the
// pixel oracle has no undeclared image-library dependency on Windows or CI.
function pixels(png) {
  let width, height, channels;
  const compressed = [];
  for (let at = 8; at < png.length; ) {
    const size = png.readUInt32BE(at),
      name = png.toString('ascii', at + 4, at + 8),
      data = png.subarray(at + 8, at + 8 + size);
    at += size + 12;
    if (name === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.ok([2, 6].includes(data[9]));
      channels = data[9] === 6 ? 4 : 3;
      assert.equal(data[12], 0);
    }
    if (name === 'IDAT') compressed.push(data);
  }
  const input = inflateSync(Buffer.concat(compressed)),
    stride = width * channels,
    out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c,
      da = Math.abs(p - a),
      db = Math.abs(p - b),
      dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const row = y * stride,
      filter = input[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[row + x - channels] : 0,
        b = y ? out[row + x - stride] : 0,
        c = y && x >= channels ? out[row + x - stride - channels] : 0;
      out[row + x] =
        (input[y * (stride + 1) + 1 + x] +
          [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) &
        255;
    }
  }
  return { width, height, channels, data: out };
}
function colorCounts(image) {
  let outside = 0,
    dark = 0,
    light = 0;
  for (let i = 0; i < image.data.length; i += image.channels) {
    const p = image.data.subarray(i, i + 3);
    if (p.every((x) => x === 17)) dark++;
    else if (p.every((x) => x === 242)) light++;
    else outside++;
  }
  const total = image.width * image.height;
  return {
    outsideFraction: outside / total,
    darkFraction: dark / total,
    lightFraction: light / total,
  };
}

test(
  'App3 silhouette: two-color pixels, exact off restoration, view-only shortcut and real App2 synchronization',
  { skip: !base, timeout: 240000 },
  async () => {
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
    const { chromium } = require('playwright'),
      { makeEmptyDraft } = await import(pathToFileURL(require.resolve('@topview/3d-builder')).href);
    const browser = await chromium.launch({
      headless: true,
      args: ['--enable-unsafe-swiftshader'],
    });
    const artifacts = path.join(workspace, 'editor/.test-results/app3-silhouette');
    mkdirSync(artifacts, { recursive: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } }),
        page = await context.newPage(),
        request = context.request,
        headers = { Origin: base },
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      assert.ok((await request.post(base + '/api/unified/session', { headers })).ok());
      async function command(command, args = {}, projectId) {
        const revision = projectId
          ? (await request.get(`${base}/api/unified/projects/${projectId}`).then((r) => r.json()))
              .project.revision
          : undefined;
        const response = await request.post(base + '/api/unified/commands', {
            headers,
            data: {
              requestId: randomUUID(),
              command,
              args,
              ...(projectId ? { projectId, expectedRevision: revision } : {}),
            },
          }),
          body = await response.json();
        assert.equal(body.ok, true, JSON.stringify(body));
        return body;
      }
      const projectId = (
        await command('project.create', {
          name: 'App3 silhouette test',
          scene: makeEmptyDraft('Silhouette', 30, 60, {
            fov: 50,
            position: { x: 0, y: 2, z: 5 },
            rotation: { x: 0, y: 0, z: 0 },
            lookAt: { x: 0, y: 1, z: 0 },
          }),
        })
      ).projectId;
      const upload = await request.post(base + '/api/unified/uploads', {
        headers: {
          ...headers,
          'Content-Type': 'application/octet-stream',
          'X-File-Name': 'silhouette.fbx',
        },
        data: readFileSync(path.join(workspace, 'builtin-assets/animation-studio/sample.fbx')),
      });
      assert.ok(upload.ok());
      const imported = await command(
          'asset.import',
          { files: [(await upload.json()).uploadId], format: 'fbx', unitMeters: 0.01 },
          projectId,
        ),
        project = (
          await request.get(`${base}/api/unified/projects/${projectId}`).then((r) => r.json())
        ).project;
      await command(
        'character.add',
        {
          assetId: imported.result.assetIds.find((id) => project.assets[id].kind === 'model'),
          skeletonId: Object.keys(project.skeletons)[0],
          name: 'Silhouette actor',
        },
        projectId,
      );
      await page.goto(`${base}/?unified=${projectId}`);
      // Enable App2 first: covers the event emitted before the iframe is ready.
      const app2 = page.locator('#wb-silhouette-toggle');
      await app2.click();
      await page
        .locator('nav[aria-label="5 workspace"], nav[aria-label="Chế độ biên tập trong App 2"]')
        .getByRole('button', { name: /Animation/ })
        .click();
      const iframe = page.locator('.wb-animation-creation-frame');
      await iframe.waitFor();
      const frame = await (await iframe.elementHandle()).contentFrame();
      assert.ok(frame);
      await frame.waitForURL(/animation-studio\/v1\.33\.0\/index\.html/);
      await frame.waitForFunction(
        () => window.__studio?.ready && window.__studio.silhouette.enabled,
        null,
        { timeout: 60000 },
      );
      await frame
        .locator('#bbsHostControls .wb-animation-creation-toolbar')
        .first()
        .getByRole('button', { name: 'Tạo animation', exact: true })
        .click();
      await frame.waitForFunction(() => window.__app3LocalBridge?.status().bound, null, {
        timeout: 60000,
      });
      await app2.click();
      await frame.waitForFunction(() => !window.__studio.silhouette.enabled);
      const initialRevision = (
        await request.get(`${base}/api/unified/projects/${projectId}`).then((r) => r.json())
      ).project.revision;
      await frame.evaluate(() => {
        const s = window.__studio;
        window.__silhouetteMaterials = s.rig().mesh.map((m) => m.material);
        window.__silhouetteControls = s
          .editorViews()
          .flatMap((v) => [v.gizmo.enabled, v.moveGizmo.enabled]);
        window.__silhouetteFrames = [];
        const render = s.view.renderer.render.bind(s.view.renderer);
        s.view.renderer.render = (scene, camera) => {
          if (s.silhouette.enabled)
            window.__silhouetteFrames.push({
              background: scene.background.getHex(),
              materials: s
                .rig()
                .mesh.map((m) => ({
                  id: m.material.uuid,
                  basic: m.material.isMeshBasicMaterial,
                  color: m.material.color.getHex(),
                  toneMapped: m.material.toneMapped,
                })),
              visible: s.rig().mesh.every((m) => m.visible),
            });
          return render(scene, camera);
        };
      });
      const original = await frame.evaluate(() =>
          JSON.stringify(window.__studio.serialized(false)),
        ),
        digest = (text) => createHash('sha256').update(text).digest('hex');
      async function capture(name) {
        const count = await frame.evaluate(() => {
          const v = window.__studio.view;
          v.dirty = true;
          return v.renderer.info.render.frame;
        });
        await frame.waitForFunction((count) => {
          const v = window.__studio.view;
          return v.renderer.info.render.frame > count && !v.dirty;
        }, count);
        const png = await frame
          .locator('#editViewport > .studio-scene-canvas')
          .screenshot({ path: path.join(artifacts, name + '.png') });
        return pixels(png);
      }
      console.log('Silhouette actor bound; capturing pixels');
      const before = await capture('before');
      await frame.locator('#silhouetteBtn').click();
      const on = await capture('on'),
        counts = colorCounts(on);
      assert.ok(counts.outsideFraction < 0.02, JSON.stringify(counts));
      assert.ok(counts.darkFraction > 0.002, JSON.stringify(counts));
      assert.ok(counts.lightFraction > 0.5, JSON.stringify(counts));
      console.log('Silhouette pixels verified; checking camera and playback');
      const cameraBefore = await frame.evaluate(() => {
        const v = window.__studio.view;
        return {
          position: v.camera.position.toArray(),
          quaternion: v.camera.quaternion.toArray(),
          target: v.orbit.target.toArray(),
        };
      });
      const binding = await frame.evaluate(() => ({
        button: document.getElementById('orbitButton').value,
        modifier: document.getElementById('orbitModifier').value,
      }));
      const canvas = frame.locator('#editViewport > .studio-scene-canvas'),
        box = await canvas.boundingBox();
      assert.ok(box);
      assert.notEqual(binding.button, 'none');
      const modifier = { alt: 'Alt', ctrl: 'Control', shift: 'Shift' }[binding.modifier];
      if (modifier) await page.keyboard.down(modifier);
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3);
      await page.mouse.down({ button: ['left', 'middle', 'right'][Number(binding.button)] });
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4, { steps: 8 });
      await page.mouse.up({ button: ['left', 'middle', 'right'][Number(binding.button)] });
      if (modifier) await page.keyboard.up(modifier);
      assert.notDeepEqual(
        await frame.evaluate(() => window.__studio.view.camera.position.toArray()),
        cameraBefore.position,
        'camera orbit remains interactive',
      );
      assert.equal(
        await frame.evaluate(
          () => window.__studio.view.gizmo.enabled || window.__studio.view.moveGizmo.enabled,
        ),
        false,
        'hidden gizmos cannot intercept camera input',
      );
      await frame.evaluate((camera) => {
        const v = window.__studio.view;
        v.camera.position.fromArray(camera.position);
        v.orbit.target.fromArray(camera.target);
        v.orbit.update();
        v.camera.position.fromArray(camera.position);
        v.camera.quaternion.fromArray(camera.quaternion);
        v.dirty = true;
      }, cameraBefore);
      const startTime = await frame.evaluate(() => window.__studio.state.time);
      await frame.locator('#playBtn').click();
      await frame.waitForFunction((start) => window.__studio.state.time > start + 0.08, startTime, {
        timeout: 10000,
      });
      await frame.locator('#silhouetteBtn').click();
      const runningTime = await frame.evaluate(() => window.__studio.state.time);
      await frame.waitForFunction(
        (start) => window.__studio.state.time > start + 0.08,
        runningTime,
        { timeout: 10000 },
      );
      await frame.locator('#playBtn').click();
      await frame.evaluate((time) => window.__studio.seek(time), startTime);
      assert.deepEqual(
        await frame.evaluate(() => window.__studio.view.camera.position.toArray()),
        cameraBefore.position,
        'toggle preserves camera',
      );
      const off = await capture('off');
      assert.equal(before.width, off.width);
      assert.equal(before.height, off.height);
      let changed = 0;
      for (let i = 0; i < before.data.length; i++) if (before.data[i] !== off.data[i]) changed++;
      assert.equal(changed, 0, 'off must reproduce original pixels');
      await frame.locator('#silhouetteBtn').focus();
      await frame.locator('body').press('Shift+S');
      await frame.waitForFunction(() => window.__studio.silhouette.enabled);
      await frame.locator('body').press('Shift+S');
      await frame.waitForFunction(() => !window.__studio.silhouette.enabled);
      await frame.locator('#clipName').focus();
      await frame
        .locator('#clipName')
        .dispatchEvent('keydown', { key: 'S', code: 'KeyS', shiftKey: true, bubbles: true });
      assert.equal(await frame.evaluate(() => window.__studio.silhouette.enabled), false);
      // Real App2 UI emits the event; App3 follows but never changes App2 on its own.
      await app2.click();
      await frame.waitForFunction(() => window.__studio.silhouette.enabled);
      await frame.locator('#silhouetteBtn').click();
      assert.equal(await app2.getAttribute('aria-pressed'), 'true');
      await app2.click();
      await frame.waitForFunction(() => !window.__studio.silhouette.enabled);
      for (let i = 0; i < 12; i++) {
        await frame.evaluate(() => window.__studio.silhouette.set(true));
        await capture('cycle');
        await frame.evaluate(() => window.__studio.silhouette.set(false));
      }
      const state = await frame.evaluate(() => ({
        controlsRestored:
          JSON.stringify(
            window.__studio.editorViews().flatMap((v) => [v.gizmo.enabled, v.moveGizmo.enabled]),
          ) === JSON.stringify(window.__silhouetteControls),
        restored: window.__studio
          .rig()
          .mesh.every((m, i) => m.material === window.__silhouetteMaterials[i]),
        frames: window.__silhouetteFrames,
        project: JSON.stringify(window.__studio.serialized(false)),
      }));
      assert.ok(state.controlsRestored);
      assert.ok(state.restored);
      assert.ok(state.frames.length);
      for (const f of state.frames) {
        assert.equal(f.background, 0xf2f2f2);
        assert.ok(f.visible);
        assert.equal(new Set(f.materials.map((m) => m.id)).size, f.materials.length);
        assert.ok(f.materials.every((m) => m.basic && m.color === 0x111111 && !m.toneMapped));
      }
      assert.equal(digest(state.project), digest(original));
      assert.equal(
        (await request.get(`${base}/api/unified/projects/${projectId}`).then((r) => r.json()))
          .project.revision,
        initialRevision,
      );
      assert.deepEqual(errors, []);
      await app2.click();
      await frame.waitForFunction(() => window.__studio.silhouette.enabled);
      await frame.evaluate(() => location.reload());
      await frame.waitForFunction(
        () => window.__studio?.ready && window.__studio.silhouette.enabled,
        null,
        { timeout: 60000 },
      );
      const report = {
        status: 'PASS',
        cameraOrbit: true,
        playbackContinues: true,
        iframeReloadSync: true,
        counts,
        changedPixelChannels: changed,
        projectSha256: digest(original),
        materialReferencesRestored: state.restored,
        toggleCycles: 12,
        app2Sync: true,
        shortcut: true,
      };
      writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
      console.log('Silhouette metrics ' + JSON.stringify(report));
    } finally {
      await browser.close();
    }
  },
);
