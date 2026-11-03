import { browserOptions } from './browser_test_options.mjs';
import { useClassicLayout } from './classic_test_layout.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { buildSceneShot } from './scene_shot_fixture.mjs';

const artifact = fileURLToPath(
  new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url),
);
const { chromium } = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
)('playwright');

test(
  '1 khung · Cả cảnh: layout option, viewer actors at F2 placement, synced playback, scene camera, clean exit',
  { skip: !existsSync(artifact), timeout: 240000 },
  async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(readFileSync(artifact));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch(browserOptions({ headless: true }));
    const errors = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      page.on('pageerror', (e) => errors.push(e.message));
      // Opening a shot over edited work asks "Thay bài đang chỉnh..."; accept it like the user would.
      page.on('dialog', (dialog) => dialog.accept());
      await useClassicLayout(page);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__studio?.ready);

      // 1) The four existing options are untouched; the new one is last and falls back to single without a scene.
      const before = await page.evaluate(() => {
        const select = document.getElementById('viewportLayout');
        select.value = 'sceneSingle';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const options = [...select.options].map((o) => [o.value, o.textContent]);
        const result = {
          options,
          dataLayout: document.getElementById('viewportGrid').dataset.layout,
          hidden: document.getElementById('sceneCameraBtn').hidden,
          sceneActive: window.__studio.sceneShot.active,
        };
        select.value = 'single';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return result;
      });
      assert.deepEqual(before.options, [
        ['single', '1 khung'],
        ['dual', '2 khung · Front + Pers'],
        ['triple', '3 khung · Front / Pers / Left'],
        ['quad', '4 khung · Front / Pers / Back / Left'],
        ['sceneSingle', '1 khung · Cả cảnh'],
      ]);
      assert.equal(before.dataLayout, 'single', 'sceneSingle without a scene shot behaves like single');
      assert.equal(before.hidden, true, 'camera button hidden without a scene shot');
      assert.equal(before.sceneActive, false);

      // 2) Open a 5-character scene shot with a non-trivial height scale.
      const opened = await page.evaluate(
        async ({ src, args }) => {
          const { files } = await new Function('return ' + src)()(args);
          const t0 = performance.now();
          await window.__studio.shot.openFiles(files);
          return {
            wall: performance.now() - t0,
            stats: window.__studio.sceneShot.stats(),
            layout: document.getElementById('viewportLayout').value,
            dataLayout: document.getElementById('viewportGrid').dataset.layout,
            hidden: document.getElementById('sceneCameraBtn').hidden,
            pressed: document.getElementById('sceneCameraBtn').getAttribute('aria-pressed'),
            views: window.__studio.editorViews().length,
          };
        },
        { src: buildSceneShot.toString(), args: { count: 5, heightScale: 1.25, aspect: 2 } },
      );
      assert.equal(opened.layout, 'sceneSingle');
      assert.equal(opened.dataLayout, 'sceneSingle');
      assert.equal(opened.hidden, false);
      assert.equal(opened.pressed, 'false');
      assert.equal(opened.views, 1);
      assert.deepEqual(
        { characters: opened.stats.characters, viewers: opened.stats.viewers },
        { characters: 5, viewers: 4 },
      );
      assert.ok(opened.stats.openMs > 0 && opened.stats.openMs <= 15000, 'open ' + opened.stats.openMs);

      // 3) Placement and sync, measured against an independent T(p)·R_y(yaw)·S(s)·model-space computation,
      //    and the editing rig against a viewer built from the same GLB (rig keys vs. mixer).
      const measured = await page.evaluate(async () => {
        const T = await import('three');
        const S = window.__studio,
          SS = S.sceneShot,
          out = { frames: [] };
        await SS.ensureViewer('char0');
        const shot = SS.shot;
        const rad = T.MathUtils.degToRad;
        const yup = new T.Matrix4().makeRotationX(-Math.PI / 2);
        // Rotation angle between the rotation parts (columns normalised: bones carry scale), no decomposition.
        const angleBetween = (a, b) => {
          const axes = (m) => [0, 4, 8].map((i) => new T.Vector3(m.elements[i], m.elements[i + 1], m.elements[i + 2]).normalize());
          const [ax, bx] = [axes(a), axes(b)];
          const trace = ax.reduce((sum, v, i) => sum + v.dot(bx[i]), 0);
          return (Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180) / Math.PI;
        };
        for (const t of [0, 1, 2]) {
          SS.setTime(t);
          const sample = SS.sample();
          let worstPos = 0,
            worstAng = 0,
            rootPos = 0,
            rootAng = 0,
            worstWhere = '',
            bones = 0;
          for (const entry of SS.registry.list()) {
            const c = sample.find((s) => s.characterId === entry.characterId);
            const place = entry.placement;
            // Expected world matrix (App 2, Y-up) = T · R_y · S applied to the model-space matrix.
            const trs = new T.Matrix4().compose(
              new T.Vector3(...place.position),
              new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), rad(place.yawDegrees)),
              new T.Vector3(entry.scale, entry.scale, entry.scale),
            );
            const rootObject = entry.editing ? entry.root : entry.viewer.root,
              groupObject = entry.editing ? entry.group : entry.viewer.group;
            rootObject.updateWorldMatrix(true, true);
            const groupInverse = groupObject.matrixWorld.clone().invert();
            const expectRoot = trs.clone().multiply(groupInverse.clone().multiply(rootObject.matrixWorld));
            const gotRoot = new T.Matrix4().fromArray(c.root);
            rootPos = Math.max(rootPos, new T.Vector3().setFromMatrixPosition(gotRoot).distanceTo(new T.Vector3().setFromMatrixPosition(expectRoot)));
            rootAng = Math.max(rootAng, angleBetween(gotRoot, expectRoot));
            rootObject.traverse((o) => {
              if (!o.isBone) return;
              const model = groupInverse.clone().multiply(o.matrixWorld),
                expected = trs.clone().multiply(model),
                got = new T.Matrix4().fromArray(c.bones[o.name]);
              worstPos = Math.max(worstPos, new T.Vector3().setFromMatrixPosition(got).distanceTo(new T.Vector3().setFromMatrixPosition(expected)));
              const angle = angleBetween(got, expected);
              if (angle > worstAng) worstWhere = entry.characterId + ':' + o.name + ':' + (entry.editing ? 'editing' : 'viewer');
              worstAng = Math.max(worstAng, angle);
              bones++;
            });
          }
          // Editing rig (keys) vs. a viewer of the same GLB (mixer).
          const e = SS.registry.get('char0');
          e.viewer.group.visible = true;
          SS.registry.sync(t, true);
          e.viewer.group.updateMatrixWorld(true);
          const editing = sample.find((s) => s.editing);
          let parityPos = 0,
            parityAng = 0;
          e.viewer.root.traverse((o) => {
            if (!o.isBone) return;
            const viewerYup = yup.clone().multiply(o.matrixWorld),
              got = new T.Matrix4().fromArray(editing.bones[o.name]);
            parityPos = Math.max(parityPos, new T.Vector3().setFromMatrixPosition(got).distanceTo(new T.Vector3().setFromMatrixPosition(viewerYup)));
            parityAng = Math.max(parityAng, angleBetween(got, viewerYup));
          });
          e.viewer.group.visible = false;
          // Roots of every character at this time (App 2 Y-up) for the placement check.
          out.frames.push({
            t,
            worstPos,
            worstAng,
            worstWhere,
            rootPos,
            rootAng,
            bones,
            parityPos,
            parityAng,
            roots: sample.map((s) => [s.characterId, s.editing, s.root.slice(12, 15)]),
            hips: sample.map((s) => s.bones['mixamorig:Hips'].slice(12, 15)),
          });
        }
        out.placements = shot.characters.map((c) => [c.characterId, c.placement.position]);
        out.wrapperScale = S.view.wrapper.scale.toArray();
        return out;
      });
      for (const f of measured.frames) {
        assert.equal(f.bones, 5 * 65);
        assert.ok(f.worstPos < 1e-5 && f.rootPos < 1e-5, `frame ${f.t} placement position ${f.worstPos} ${f.rootPos}`);
        assert.ok(f.worstAng < 0.01 && f.rootAng < 0.01, `frame ${f.t} placement angle ${f.worstAng} ${f.rootAng} at ${f.worstWhere}`);
        assert.ok(f.parityPos < 1e-4, `frame ${f.t} editing rig vs viewer position ${f.parityPos}`);
        assert.ok(f.parityAng < 0.5, `frame ${f.t} editing rig vs viewer angle ${f.parityAng}`);
      }
      // Characters actually move with time (the viewers follow the editor time).
      for (let i = 0; i < 5; i++) {
        const [a, b] = [measured.frames[0].hips[i], measured.frames[2].hips[i]];
        assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.3, 'character ' + i + ' moves with time');
      }
      // The editing character keeps the scene scale; all roots sit at their placement (App 2 Y-up metres).
      assert.deepEqual(measured.wrapperScale, [1.25, 1.25, 1.25]);
      for (const [id, , root] of measured.frames[0].roots) {
        const place = measured.placements.find((p) => p[0] === id)[1];
        for (let i = 0; i < 3; i++) assert.ok(Math.abs(root[i] - place[i]) < 1e-6, `${id} root ${root} vs ${place}`);
      }

      // 5) Scene camera: follows shot.camera.keys per frame, letterboxed to camera.aspect, exits on orbit.
      await page.evaluate(() => window.__studio.sceneShot.setTime(0));
      await page.click('#sceneCameraBtn');
      const camera = await page.evaluate(() => {
        const v = window.__studio.view,
          box = document.getElementById('sceneCameraFrame');
        return {
          pressed: document.getElementById('sceneCameraBtn').getAttribute('aria-pressed'),
          active: window.__studio.sceneShot.cameraActive,
          position: v.perspective.position.toArray(),
          fov: v.perspective.fov,
          size: [v.container.clientWidth, v.container.clientHeight],
          box: [box.hidden, parseFloat(box.style.left), parseFloat(box.style.top), parseFloat(box.style.width), parseFloat(box.style.height)],
        };
      });
      assert.equal(camera.pressed, 'true');
      assert.equal(camera.active, true);
      // Frame 0 key: Y-up (0, 1.6, 5) -> Z-up (0, -5, 1.6).
      for (const [i, v] of [0, -5, 1.6].entries()) assert.ok(Math.abs(camera.position[i] - v) < 1e-6, 'camera ' + camera.position);
      const [w, h] = camera.size,
        aspect = 2;
      assert.equal(camera.box[0], false);
      assert.ok(Math.abs(camera.box[3] / camera.box[4] - aspect) < 0.01, 'frame aspect ' + camera.box);
      assert.ok(Math.abs(camera.box[3] - w) < 1 || Math.abs(camera.box[4] - h) < 1, 'letterbox touches the view');
      // Frame 0 key FOV is 40; a film wider than the view needs a larger view FOV, a narrower one keeps 40.
      const expectedFov = aspect > w / h ? (2 * Math.atan(Math.tan((40 * Math.PI) / 360) * (aspect / (w / h))) * 180) / Math.PI : 40;
      assert.ok(Math.abs(camera.fov - expectedFov) < 1e-6, `fov ${camera.fov} vs ${expectedFov}`);
      // Letterbox (view narrower than 2:1) and pillarbox (view wider than 2:1) both keep the shot FOV inside the bars.
      for (const size of [{ width: 1000, height: 900 }, { width: 2600, height: 760 }]) {
        await page.setViewportSize(size);
        // The camera follows on the next animation frame (slow under software GL): wait until the view settled.
        await page.waitForFunction(() => {
          const v = window.__studio.view,
            box = document.getElementById('sceneCameraFrame'),
            [w, h] = [v.container.clientWidth, v.container.clientHeight];
          const inner = parseFloat(box.style.height) / h,
            seen = (2 * Math.atan(Math.tan((v.perspective.fov * Math.PI) / 360) * inner) * 180) / Math.PI;
          return Math.abs(seen - 40) < 1e-6 && Math.abs(parseFloat(box.style.width) / parseFloat(box.style.height) - 2) < 0.01 && Math.abs(Math.max(parseFloat(box.style.width) / w, inner) - 1) < 0.01;
        }, null, { timeout: 30000 });
        const resized = await page.evaluate(() => {
          const v = window.__studio.view,
            box = document.getElementById('sceneCameraFrame');
          return {
            size: [v.container.clientWidth, v.container.clientHeight],
            fov: v.perspective.fov,
            box: [parseFloat(box.style.left), parseFloat(box.style.top), parseFloat(box.style.width), parseFloat(box.style.height)],
          };
        });
        const [rw, rh] = resized.size,
          inner = resized.box[3] / rh,
          // Vertical FOV seen inside the film rectangle must equal the key's (40 at frame 0).
          seen = (2 * Math.atan(Math.tan((resized.fov * Math.PI) / 360) * inner) * 180) / Math.PI;
        assert.ok(Math.abs(resized.box[2] / resized.box[3] - aspect) < 0.01, 'frame aspect ' + resized.box);
        assert.ok(Math.abs(seen - 40) < 1e-6, `inner FOV ${seen} at ${rw}x${rh}`);
        assert.equal(aspect > rw / rh, resized.fov > 40 + 1e-9, 'letterbox widens the view FOV, pillarbox keeps it');
      }
      // Mid-shot (t = 1 s = frame 30): key 30 = angle 45 degrees.
      const mid = await page.evaluate(() => {
        window.__studio.sceneShot.setTime(1);
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.__studio.view.perspective.position.toArray()))));
      });
      const a = (30 / 60) * Math.PI * 0.5,
        expectedMid = [4 * Math.sin(a), -(4 * Math.cos(a) + 1), 1.6];
      for (const [i, v] of expectedMid.entries()) assert.ok(Math.abs(mid[i] - v) < 1e-6, `mid camera ${mid} vs ${expectedMid}`);
      // Pillarbox/letterbox bars are black, the shot area is not.
      const png = await page.screenshot({ clip: await page.evaluate(() => { const r = window.__studio.view.container.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
      assert.ok(png.length > 1000);
      // Real mouse orbit leaves the shot camera (use the configured orbit button).
      const drag = await page.evaluate(() => {
        const r = window.__studio.view.renderer.domElement.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, button: ['left', 'middle', 'right'][Number(document.getElementById('orbitButton').value)] };
      });
      await page.mouse.move(drag.x, drag.y);
      await page.mouse.down({ button: drag.button });
      await page.mouse.move(drag.x + 40, drag.y + 10, { steps: 4 });
      await page.mouse.up({ button: drag.button });
      const after = await page.evaluate(() => ({
        active: window.__studio.sceneShot.cameraActive,
        pressed: document.getElementById('sceneCameraBtn').getAttribute('aria-pressed'),
        hidden: document.getElementById('sceneCameraFrame').hidden,
        fov: window.__studio.view.perspective.fov,
      }));
      assert.deepEqual({ active: after.active, pressed: after.pressed, hidden: after.hidden }, { active: false, pressed: 'false', hidden: true });
      assert.ok(Math.abs(after.fov - 38) < 1e-9, 'free camera FOV restored: ' + after.fov);

      // 6) Leaving scene mode: the same package without sceneMode (one character) restores the old layout, leaves
      //    nothing behind, and gives the editing character exactly the same keys as it had in scene mode.
      const single = await page.evaluate(
        async ({ src, args }) => {
          const { files, shot } = await new Function('return ' + src)()(args);
          await window.__studio.shot.openFiles(files);
          const sceneKeys = JSON.stringify(window.__studio.project().keys);
          delete shot.sceneMode;
          shot.characters = shot.characters.slice(0, 1);
          files['shot.json'] = new TextEncoder().encode(JSON.stringify(shot));
          await window.__studio.shot.openFiles(files);
          const view = window.__studio.view;
          const stray = [];
          view.scene.traverse((o) => { if (o.name?.startsWith('SceneViewer:')) stray.push(o.name); });
          return {
            stats: window.__studio.sceneShot.stats(),
            active: window.__studio.sceneShot.active,
            layout: document.getElementById('viewportLayout').value,
            dataLayout: document.getElementById('viewportGrid').dataset.layout,
            hidden: document.getElementById('sceneCameraBtn').hidden,
            stray,
            wrapperPosition: view.wrapper.position.toArray(),
            quaternion: view.wrapper.quaternion.toArray(),
            basis: window.__studio.core.kinematics.blenderBasis.toArray(),
            sessionScene: window.__studio.shot.session.shot.sceneMode ?? null,
            sceneKeys,
            keys: JSON.stringify(window.__studio.project().keys),
          };
        },
        { src: buildSceneShot.toString(), args: { count: 3, heightScale: 1.25 } },
      );
      assert.equal(single.active, false);
      assert.equal(single.stats.characters, 0);
      assert.equal(single.layout, 'single');
      assert.equal(single.dataLayout, 'single');
      assert.equal(single.hidden, true);
      assert.deepEqual(single.stray, []);
      assert.equal(single.sessionScene, null);
      assert.equal(single.keys, single.sceneKeys, 'scene mode leaves the editing character keys exactly as a plain shot open');
      for (let i = 0; i < 4; i++) assert.ok(Math.abs(single.quaternion[i] - single.basis[i]) < 1e-9, 'wrapper back to the blender basis only');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
