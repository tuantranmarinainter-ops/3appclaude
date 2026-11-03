import { browserOptions } from './browser_test_options.mjs';
import { useClassicLayout } from './classic_test_layout.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSceneShot } from './scene_shot_fixture.mjs';

const artifact = fileURLToPath(
  new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url),
);
const appRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { chromium } = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
)('playwright');
const { unzipSync } = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
)('three/examples/jsm/libs/fflate.module.js');

const validate = (dir, shotDir) =>
  spawnSync('python3', ['-m', 'agent.shot_package', 'validate-result', dir, '--shot', shotDir], {
    cwd: appRoot,
    encoding: 'utf8',
  });

test(
  'Cả cảnh S4: scene export = one package, one edit per edited character (A, B), none for C; empty edits valid',
  { skip: !existsSync(artifact), timeout: 300000 },
  async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(readFileSync(artifact));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch(browserOptions({ headless: true }));
    const errors = [];
    const tmp = mkdtempSync(join(tmpdir(), 'scene-export-'));
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => d.accept());
      await useClassicLayout(page);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__studio?.ready);
      const shotFiles = await page.evaluate(
        async ({ src, args }) => {
          const { files } = await new Function('return ' + src)()(args);
          await window.__studio.shot.openFiles(files);
          const out = {};
          for (const [k, v] of Object.entries(files)) {
            let s = '';
            for (let i = 0; i < v.length; i += 8192) s += String.fromCharCode(...v.subarray(i, i + 8192));
            out[k] = btoa(s);
          }
          return out;
        },
        { src: buildSceneShot.toString(), args: { count: 3, aspect: 2 } },
      );
      const shotDir = join(tmp, 'shot');
      for (const [k, v] of Object.entries(shotFiles)) {
        mkdirSync(join(shotDir, k, '..'), { recursive: true });
        writeFileSync(join(shotDir, k), Buffer.from(v, 'base64'));
      }
      const SS = (fn, arg) =>
        page.evaluate(new Function('arg', 'const SS=window.__studio.sceneShot,S=window.__studio;return (' + fn + ')(arg)'), arg);
      const waitEditing = async (id) => {
        await page.waitForFunction(
          (x) => window.__studio.sceneShot.editing() === x && !window.__studio.sceneShot.switching,
          id,
          { timeout: 20000 },
        );
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      };
      const edit = (arg) =>
        SS(
          `(a)=>{S.seek(a.t);const id=S.rig().records.find(r=>r.name==='mixamorig:'+a.bone).id;S.select(id);
           const e=document.getElementById('rz');e.value=String(a.deg);e.dispatchEvent(new Event('change',{bubbles:true}));
           document.getElementById('keyBtn').click();return SS.keysHash(SS.editing())}`,
          arg,
        );
      const exportZip = (options) =>
        page.evaluate(async (o) => {
          const z = await window.__studio.shot.exportZip(o);
          let s = '';
          for (let i = 0; i < z.length; i += 8192) s += String.fromCharCode(...z.subarray(i, i + 8192));
          return btoa(s);
        }, options);

      // 0) nothing edited: valid package with edits []
      const emptyFiles = unzipSync(Buffer.from(await exportZip({}), 'base64'));
      const emptyResult = JSON.parse(Buffer.from(emptyFiles['result.json']).toString());
      assert.deepEqual(emptyResult.edits, []);
      assert.equal(emptyResult.sceneMode, true);
      assert.deepEqual(Object.keys(emptyFiles), ['result.json']);
      const emptyDir = join(tmp, 'empty');
      mkdirSync(emptyDir);
      writeFileSync(join(emptyDir, 'result.json'), emptyFiles['result.json']);
      const emptyCheck = validate(emptyDir, shotDir);
      assert.equal(emptyCheck.status, 0, 'empty edits validate: ' + emptyCheck.stdout + emptyCheck.stderr);

      // 1) edit A (char0) at frame 30, then B (char1) at frame 15; C (char2) is never touched
      await edit({ t: 1, bone: 'LeftArm', deg: 70 });
      await SS('(id)=>SS.select(id)', 'char1');
      await waitEditing('char1');
      await edit({ t: 0.5, bone: 'RightArm', deg: -50 });
      assert.deepEqual(await SS('()=>SS.edited()'), ['char0', 'char1']);
      const viewBefore = await SS('()=>({editing:SS.editing(),h:SS.keysHash("char1"),a:SS.keysHash("char0")})');

      for (const withBobj of [false, true]) {
        const files = unzipSync(Buffer.from(await exportZip({ includeMinecraft20: withBobj }), 'base64'));
        const result = JSON.parse(Buffer.from(files['result.json']).toString());
        assert.equal(result.sceneMode, true);
        assert.deepEqual(result.edits.map((e) => e.characterId), ['char0', 'char1']);
        assert.equal(new Set(result.edits.map((e) => e.newActionUuid)).size, 2);
        const shot = JSON.parse(readFileSync(join(shotDir, 'shot.json'), 'utf8'));
        for (const e of result.edits) {
          const c = shot.characters.find((x) => x.characterId === e.characterId);
          assert.equal(e.originalActionUuid, c.actionUuid);
          assert.ok(files[e.glb] && files[e.manifest]);
          assert.equal(!!e.bobj, withBobj);
          if (withBobj) assert.ok(files[e.bobj].length > 100);
        }
        if (!withBobj) {
          // the export left the editor view alone
          assert.deepEqual(await SS('()=>({editing:SS.editing(),h:SS.keysHash("char1"),a:SS.keysHash("char0")})'), viewBefore);
          const dir = join(tmp, 'result');
          for (const [k, v] of Object.entries(files)) {
            mkdirSync(join(dir, k, '..'), { recursive: true });
            writeFileSync(join(dir, k), v);
          }
          const check = validate(dir, shotDir);
          assert.equal(check.status, 0, 'python validate-result: ' + check.stdout + check.stderr);
          // 2) every GLB evaluates to its character's edited pose at the edited frame
          const glbs = {};
          for (const e of result.edits) glbs[e.characterId] = Buffer.from(files[e.glb]).toString('base64');
          const orig = {};
          for (const c of shot.characters) orig[c.characterId] = shotFiles[c.glb];
          await SS('(id)=>SS.select(id)', 'char0');
          await waitEditing('char0');
          const worst = {};
          for (const [id, frame, bone] of [['char0', 30, 'LeftArm'], ['char1', 15, 'RightArm']]) {
            if (id !== (await SS('()=>SS.editing()'))) {
              await SS('(i)=>SS.select(i)', id);
              await waitEditing(id);
            }
            worst[id] = await page.evaluate(
              async ({ id, b64, origB64, frame, bone }) => {
                const T = await import('three');
                const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
                const load = async (data) => {
                  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
                  return new GLTFLoader().parseAsync(bytes.buffer, '');
                };
                const S = window.__studio,
                  C = S.core;
                const pose = async (data, t) => {
                  const g = await load(data),
                    m = new T.AnimationMixer(g.scene);
                  m.clipAction(g.animations[0]).play();
                  m.setTime(t);
                  g.scene.updateMatrixWorld(true);
                  const out = {};
                  g.scene.traverse((o) => {
                    if (o.isBone || o.type === 'Bone') out[o.name] = o.quaternion.toArray();
                  });
                  return out;
                };
                S.seek(frame / 30);
                const expected = {};
                for (const r of S.rig().records) expected[C.short(r.name)] = r.o.quaternion.toArray();
                const got = await pose(b64, frame / 30),
                  base = await pose(origB64, frame / 30);
                let diff = 0;
                const angle = (a, b) => {
                  const d = Math.abs(a.reduce((s, v, i) => s + v * b[i], 0));
                  return 2 * Math.acos(Math.min(1, d));
                };
                const missing = Object.keys(expected).filter((n) => !got[n]);
                for (const [n, q] of Object.entries(expected)) if (got[n]) diff = Math.max(diff, angle(q, got[n]));
                return { missing, compared: Object.keys(expected).length - missing.length, diff, movedFromF2: angle(got[bone], base[Object.keys(base).find((n) => n.endsWith(bone))]) };
              },
              { id, b64: glbs[id], origB64: orig[id], frame, bone },
            );
          }
          for (const id of ['char0', 'char1']) {
            assert.ok(worst[id].compared > 20, id + ' compared bones: ' + JSON.stringify(worst[id].missing.slice(0, 5)));
            assert.ok(worst[id].diff < 1e-3, id + ' GLB pose equals editor pose: ' + worst[id].diff);
            assert.ok(worst[id].movedFromF2 > 0.5, id + ' differs from F2 at the edited frame');
          }
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  },
);

test(
  'Cả cảnh S4: host "shotClose" after import closes the scene shot (not dirty, layout back, fresh reopen)',
  { skip: !existsSync(artifact), timeout: 300000 },
  async () => {
    const bridge = readFileSync(new URL('./host_bridge.js', import.meta.url));
    const server = createServer((req, res) => {
      if (req.url === '/app') {
        res.setHeader('content-type', 'text/html');
        res.end(readFileSync(artifact));
      } else if (req.url === '/host-bridge.js') {
        res.setHeader('content-type', 'text/javascript');
        res.end(bridge);
      } else {
        res.setHeader('content-type', 'text/html');
        res.end('<!doctype html><iframe id="app" src="/app" style="width:1600px;height:900px;border:0"></iframe>');
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch(browserOptions({ headless: true }));
    const errors = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => d.accept());
      await useClassicLayout(page);
      await page.addInitScript(() => {
        window.__msgs = [];
        addEventListener('message', (e) => window.__msgs.push(e.data));
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const frame = await (await page.waitForSelector('#app')).contentFrame();
      await frame.waitForFunction(() => window.__studio?.ready);
      await frame.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = '/host-bridge.js';
            s.onload = resolve;
            s.onerror = reject;
            document.body.append(s);
          }),
      );
      await frame.evaluate(
        async ({ src, args }) => {
          const { files } = await new Function('return ' + src)()(args);
          window.__shotFiles = files;
          await window.__studio.shot.openFiles(files);
        },
        { src: buildSceneShot.toString(), args: { count: 3, aspect: 2 } },
      );
      const SS = (fn, arg) =>
        frame.evaluate(new Function('arg', 'const SS=window.__studio.sceneShot,S=window.__studio;return (' + fn + ')(arg)'), arg);
      const waitEditing = async (id) => {
        await frame.waitForFunction(
          (x) => window.__studio.sceneShot.editing() === x && !window.__studio.sceneShot.switching,
          id,
          { timeout: 20000 },
        );
        await frame.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      };
      const edit = (arg) =>
        SS(
          `(a)=>{S.seek(a.t);const id=S.rig().records.find(r=>r.name==='mixamorig:'+a.bone).id;S.select(id);
           const e=document.getElementById('rz');e.value=String(a.deg);e.dispatchEvent(new Event('change',{bubbles:true}));
           document.getElementById('keyBtn').click();return SS.keysHash(SS.editing())}`,
          arg,
        );
      const lastDirty = () =>
        page.evaluate(() => window.__msgs.filter((m) => m?.type === 'dirty').at(-1)?.dirty ?? null);
      assert.equal(await SS('()=>SS.active'), true);
      assert.equal(await frame.evaluate(() => document.getElementById('viewportLayout').value), 'sceneSingle');
      await edit({ t: 1, bone: 'LeftArm', deg: 70 });
      await SS('(id)=>SS.select(id)', 'char1');
      await waitEditing('char1');
      await edit({ t: 0.5, bone: 'RightArm', deg: -50 });
      assert.deepEqual(await SS('()=>SS.edited()'), ['char0', 'char1']);
      await page.waitForFunction(() => window.__msgs.some((m) => m?.type === 'dirty' && m.dirty === true), null, { timeout: 5000 });
      assert.equal(await lastDirty(), true);

      // the host exports + imports, then asks App 3 to close the shot
      const reply = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const requestId = 'close-1';
            const onMessage = (e) => {
              if (e.data?.requestId !== requestId) return;
              removeEventListener('message', onMessage);
              resolve(e.data);
            };
            addEventListener('message', onMessage);
            document
              .getElementById('app')
              .contentWindow.postMessage({ channel: 'bbs-animation-studio-v1.33.0', requestId, type: 'shotClose' }, location.origin);
          }),
      );
      assert.equal(reply.ok, true, JSON.stringify(reply));
      assert.deepEqual(reply.value, { closed: true, wasScene: true, hadShot: true });
      assert.equal(await SS('()=>SS.active'), false);
      assert.equal(await SS('()=>SS.anyDirty()'), false);
      assert.deepEqual(await SS('()=>SS.edited()'), []);
      assert.notEqual(await frame.evaluate(() => document.getElementById('viewportLayout').value), 'sceneSingle');
      assert.equal(await frame.evaluate(() => window.__studio.shot.session), null);
      assert.equal(await frame.evaluate(() => document.getElementById('sceneCharacterList').hidden), true);
      assert.equal(await lastDirty(), false);
      await new Promise((r) => setTimeout(r, 900)); // two poll ticks: still not dirty
      assert.equal(await lastDirty(), false);

      // reopen the same scene zip: fresh state, nothing edited, then a new edit is the only one
      await frame.evaluate(async () => window.__studio.shot.openFiles(window.__shotFiles));
      assert.equal(await SS('()=>SS.active'), true);
      assert.deepEqual(await SS('()=>SS.edited()'), []);
      assert.equal(await SS('()=>SS.anyDirty()'), false);
      assert.equal(await frame.evaluate(() => document.getElementById('viewportLayout').value), 'sceneSingle');
      await edit({ t: 1, bone: 'LeftArm', deg: 40 });
      assert.deepEqual(await SS('()=>SS.edited()'), ['char0']);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.close();
    }
  },
);
