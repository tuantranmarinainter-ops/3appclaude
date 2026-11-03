// Measurement (not a test): App 3 scene shot vs App 2 reference.
// Usage: node src/scene_shot_f2.measure.mjs <zip> <reference.json> <outdir>
import { browserOptions } from './browser_test_options.mjs';
import { useClassicLayout } from './classic_test_layout.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [zipPath, refPath, outDir] = process.argv.slice(2);
if (!zipPath || !refPath || !outDir) throw Error('usage: node src/scene_shot_f2.measure.mjs <zip> <reference.json> <outdir>');
const name = path.basename(path.dirname(zipPath)) + '-' + path.basename(zipPath, '.zip');
mkdirSync(outDir, { recursive: true });
const artifact = fileURLToPath(new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url));
if (!existsSync(artifact)) throw Error('missing ' + artifact + ' (node src/build.mjs)');
const { chromium } = createRequire(new URL('../../../../editor/apps/studio/package.json', import.meta.url))('playwright');
const result0 = {};
const ref = JSON.parse(readFileSync(refPath, 'utf8'));
// Fixtures from sceneModeFixture.mts --decode-draco (default for --synthetic) are already uncompressed (dracoStripped 0).
// FALLBACK only: real S1 exports carry KHR_draco_mesh_compression, and App 3 has no DRACOLoader (GLTFLoader throws). When a
// GLB still requires Draco, its primitives are replaced by zero-filled accessors (valid glTF: accessor without bufferView)
// and the count is recorded in dracoStripped (meshes invisible, FPS not representative). Skeleton, skin and animation data are untouched.
const { unzipSync, zipSync } = createRequire(import.meta.url)(
  fileURLToPath(new URL('../../../../editor/node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/lib/index.cjs', import.meta.url)),
);
let zipBytes = readFileSync(zipPath);
let dracoStripped = 0;
const hashMap = {};
{
  const files = unzipSync(new Uint8Array(zipBytes));
  for (const [k, v] of Object.entries(files)) {
    if (!k.endsWith('.glb')) continue;
    const origBytes = v;
    const dv = new DataView(v.buffer, v.byteOffset, v.byteLength);
    const jl = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(v.subarray(20, 20 + jl)));
    if (!json.extensionsRequired?.includes('KHR_draco_mesh_compression')) continue;
    // Only the mesh accessors (attributes/indices/targets of primitives) lose their data; animation and skin accessors stay.
    const meshAcc = new Set();
    for (const m of json.meshes || [])
      for (const pr of m.primitives) {
        delete pr.extensions?.KHR_draco_mesh_compression;
        if (pr.extensions && !Object.keys(pr.extensions).length) delete pr.extensions;
        Object.values(pr.attributes).forEach((i) => meshAcc.add(i));
        if (pr.indices !== undefined) meshAcc.add(pr.indices);
        for (const t of pr.targets || []) Object.values(t).forEach((i) => meshAcc.add(i));
      }
    for (const i of meshAcc) { const a = json.accessors[i]; delete a.bufferView; delete a.byteOffset; delete a.sparse; }
    json.extensionsRequired = json.extensionsRequired.filter((e) => e !== 'KHR_draco_mesh_compression');
    if (!json.extensionsRequired.length) delete json.extensionsRequired;
    json.extensionsUsed = json.extensionsUsed.filter((e) => e !== 'KHR_draco_mesh_compression');
    const jb = new TextEncoder().encode(JSON.stringify(json));
    const pad = (4 - (jb.length % 4)) % 4;
    const jpad = new Uint8Array(jb.length + pad).fill(0x20); jpad.set(jb);
    const rest = v.subarray(20 + jl); // BIN chunk (unused now but harmless)
    const out = new Uint8Array(12 + 8 + jpad.length + rest.length);
    const od = new DataView(out.buffer);
    out.set(v.subarray(0, 12)); od.setUint32(8, out.length, true);
    od.setUint32(12, jpad.length, true); od.setUint32(16, 0x4e4f534a, true);
    out.set(jpad, 20); out.set(rest, 20 + jpad.length);
    files[k] = out; dracoStripped++;
    hashMap[createHash('sha256').update(origBytes).digest('hex')] = createHash('sha256').update(out).digest('hex');
  }
  if (dracoStripped)
    for (const [k, v] of Object.entries(files)) {
      if (!k.endsWith('.json')) continue;
      let t = new TextDecoder().decode(v), changed = false;
      for (const [o, n] of Object.entries(hashMap)) if (t.includes(o)) { t = t.split(o).join(n); changed = true; }
      if (changed) files[k] = new TextEncoder().encode(t);
    }
  if (dracoStripped) zipBytes = Buffer.from(zipSync(files, { level: 0 }));
}
result0.dracoStripped = dracoStripped;
const zipB64 = Buffer.from(zipBytes).toString('base64');

const server = createServer((_q, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(readFileSync(artifact));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(browserOptions({ headless: true }));
const errors = [];
const result = { ...result0, name, zip: zipPath, reference: refPath, frameRange: ref.frameRange, fps: ref.fps, renderer: 'SwiftShader (software GL), FPS not representative' };
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await useClassicLayout(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__studio?.ready);

  // 1) open
  result.open = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const t0 = performance.now();
    await window.__studio.shot.openZip(bytes);
    const wall = performance.now() - t0;
    const s = window.__studio.sceneShot;
    return { wallMs: wall, statsOpenMs: s.stats().openMs, characters: s.stats().characters, viewers: s.stats().viewers, active: s.active };
  }, zipB64);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  result.screenshots = {};
  const shot = async (suffix) => {
    const p = path.join(outDir, `${name}-${suffix}.png`);
    await page.screenshot({ path: p });
    result.screenshots[suffix] = p;
  };
  await shot('open-default'); // whatever framing the app produced on its own (may show only part of the scene)
  // Frame ALL characters (sceneShot.fitRoots) + the editing rig in every edit view, same maths as host_bridge fitEditViews
  // (which is not exposed): keeps the current view direction, distance from the combined bounding box.
  result.fit = await page.evaluate(async () => {
    const studio = window.__studio;
    const roots = studio.sceneShot.fitRoots();
    const report = [];
    for (const view of studio.editorViews()) {
      if (!view.container?.clientWidth) continue;
      const all = [view.rig?.root || view.wrapper, ...roots].filter(Boolean);
      for (const r of all) r.updateMatrixWorld(true);
      const V = view.camera.position.constructor;
      const min = new V(Infinity, Infinity, Infinity), max = new V(-Infinity, -Infinity, -Infinity);
      for (const r of all)
        r.traverse((o) => {
          if (o.isBone) { const p = o.getWorldPosition(new V()); min.min(p); max.max(p); }
          else if (o.isMesh && o.geometry) {
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            const b = o.geometry.boundingBox;
            if (!b) return;
            for (let i = 0; i < 8; i++) {
              const p = new V(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld);
              min.min(p); max.max(p);
            }
          }
        });
      if (!Number.isFinite(min.x)) continue;
      const center = min.clone().add(max).multiplyScalar(0.5), radius = Math.max(0.4, max.clone().sub(min).length() / 2);
      const aspect = view.container.clientWidth / Math.max(1, view.container.clientHeight);
      const direction = view.camera.position.clone().sub(view.orbit.target);
      if (direction.lengthSq() < 1e-9) direction.set(2, -3.3, 0.65);
      direction.normalize();
      view.orbit.target.copy(center);
      const fov = (view.camera.fov / 2) * (Math.PI / 180), angle = Math.min(fov, Math.atan(Math.tan(fov) * aspect));
      const distance = (radius / Math.sin(angle)) * 1.12;
      view.camera.position.copy(center).addScaledVector(direction, distance);
      if (view.camera.far < distance + radius * 2) view.camera.far = (distance + radius * 2) * 2;
      view.camera.updateProjectionMatrix(); view.orbit.update(); view.dirty = true;
      report.push({ roots: all.length, distance, radius });
    }
    return report;
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await shot('open');

  // 2) accuracy: seek via the editor seek (sceneShot.setTime -> app seek()), then sample()
  const frames = Object.keys(ref.characters[0].frames).map(Number).sort((a, b) => a - b);
  result.frames = [];
  for (const frame of frames) {
    const t = (frame - ref.frameRange[0]) / ref.fps;
    const refFrame = Object.fromEntries(ref.characters.map((c) => [c.characterId, c.frames[String(frame)]]));
    const m = await page.evaluate(
      async ({ t, refFrame }) => {
        const T = await import('three');
        const SS = window.__studio.sceneShot;
        SS.setTime(t);
        const sample = SS.sample();
        const rotOf = (e) => {
          const m = new T.Matrix4().fromArray(e);
          const p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3();
          m.decompose(p, q, s); // decompose removes scale
          return { p, q: q.normalize() };
        };
        const deg = (a, b) => (2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180) / Math.PI;
        const out = [];
        for (const c of sample) {
          const r = refFrame[c.characterId];
          if (!r) { out.push({ characterId: c.characterId, error: 'no reference' }); continue; }
          const a = rotOf(c.root), b = rotOf(r.root);
          const rootPosCm = a.p.distanceTo(b.p) * 100;
          const rootRotDeg = deg(a.q, b.q);
          const over = [];
          let bonePosCm = 0, boneRotDeg = 0, worstRot = '', worstPos = '', n = 0, missing = [];
          // App 3 bone names keep the colon ("mixamorig:Hips"), the App 2 reference uses the sanitised GLB node name
          // ("mixamorigHips"): match on the name with non-alphanumerics removed.
          const norm = (k) => k.replace(/[^A-Za-z0-9]/g, '');
          const appByNorm = new Map(Object.entries(c.bones).map(([k, v]) => [norm(k), v]));
          for (const [bn, rm] of Object.entries(r.bones)) {
            const app = appByNorm.get(norm(bn));
            if (!app) { missing.push(bn); continue; }
            const x = rotOf(app), y = rotOf(rm);
            const pc = x.p.distanceTo(y.p) * 100, rd = deg(x.q, y.q);
            if (pc > 0.01) over.push([bn, +pc.toFixed(3)]);
            if (pc > bonePosCm) { bonePosCm = pc; worstPos = bn; }
            if (rd > boneRotDeg) { boneRotDeg = rd; worstRot = bn; }
            n++;
          }
          const refNorm = new Set(Object.keys(r.bones).map(norm)); const extra = Object.keys(c.bones).filter((k) => !refNorm.has(norm(k))).length;
          const hk = Object.keys(r.bones).find((k) => norm(k) === 'mixamorigHips');
          const hipsDeltaCm = hk ? rotOf(c.bones[Object.keys(c.bones).find((k) => norm(k) === norm(hk))]).p.sub(rotOf(r.bones[hk]).p).toArray().map((v) => +(v * 100).toFixed(4)) : null;
          const dRoot = a.p.clone().sub(b.p).toArray().map((v) => v * 100);
          out.push({ characterId: c.characterId, editing: c.editing, rootPosCm, rootRotDeg, rootDeltaCm: dRoot, bonePosCm, boneRotDeg, worstRot, worstPos, hipsDeltaCm, hipsRefCm: hk ? rotOf(r.bones[hk]).p.toArray().map((v) => +(v * 100).toFixed(3)) : null, rootRefCm: b.p.toArray().map((v) => +(v * 100).toFixed(3)), bones: n, bonesPosOver0_01cm: over, missing, extraAppBones: extra });
        }
        return out;
      },
      { t, refFrame },
    );
    result.frames.push({ frame, t, characters: m.map((c) => ({ ...c, name: ref.characters.find((x) => x.characterId === c.characterId)?.name })) });
  }
  const agg = (pred) => {
    const rows = result.frames.flatMap((f) => f.characters).filter((c) => !c.error && pred(c));
    const mx = (k) => (rows.length ? Math.max(...rows.map((r) => r[k])) : null);
    return { samples: rows.length, rootPosCm: mx('rootPosCm'), rootRotDeg: mx('rootRotDeg'), bonePosCm: mx('bonePosCm'), boneRotDeg: mx('boneRotDeg') };
  };
  result.summary = { editing: agg((c) => c.editing), viewers: agg((c) => !c.editing), overall: agg(() => true) };
  const o = result.summary.overall;
  const allRows = result.frames.flatMap((f) => f.characters);
  result.coverage = { refBonesMissingInApp: allRows.reduce((a, c) => a + (c.missing?.length ?? 0), 0), appBonesNotInRef: allRows.reduce((a, c) => a + (c.extraAppBones ?? 0), 0), bonesCompared: allRows.reduce((a, c) => a + (c.bones ?? 0), 0) };
  result.thresholds = {
    coverage_complete: result.coverage.refBonesMissingInApp === 0 && result.coverage.bonesCompared > 0,
    rootPos_le_1cm: o.rootPosCm <= 1,
    rootRot_le_1deg: o.rootRotDeg <= 1,
    boneRot_le_0_5deg: o.boneRotDeg <= 0.5,
    note: 'bone position has no stated threshold; reported only',
  };

  // 3) camera + layout screenshots
  await page.evaluate((t) => window.__studio.sceneShot.setTime(t), 0);
  result.layoutValue = await page.evaluate(() => {
    const s = document.getElementById('viewportLayout');
    return { value: s.value, label: s.options[s.selectedIndex].textContent };
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await shot('layout-scene');
  await page.click('#sceneCameraBtn');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  result.cameraActive = await page.evaluate(() => window.__studio.sceneShot.cameraActive);
  await shot('camera');
  await page.click('#sceneCameraBtn');

  // 4) FPS: 5 s of playback
  const fpsRun = async (snapSuffix) => {
    await page.evaluate(() => {
      window.__fps = { rafs: [], go: true };
      const loop = (ts) => { window.__fps.rafs.push(ts); if (window.__fps.go) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      document.getElementById('playBtn').click();
    });
    await new Promise((r) => setTimeout(r, 2500));
    if (snapSuffix) await shot(snapSuffix); // mid-playback screenshot (time cost is included in the FPS window)
    await new Promise((r) => setTimeout(r, 2500));
    return page.evaluate(() => {
      const stats = window.__studio.sceneShot.stats();
      const { rafs } = window.__fps;
      window.__fps.go = false;
      document.getElementById('playBtn').click();
      const rafFps = ((rafs.length - 1) * 1000) / (rafs[rafs.length - 1] - rafs[0]);
      return { sceneStatsFps: stats.fps, rafFps, rafCount: rafs.length };
    });
  };
  result.fpsScene = await fpsRun('playing'); // screenshot taken ~2.5 s into playback, so rafFps includes its cost

  // baseline: same zip, sceneMode removed, characters[0] only
  try {
    result.fpsBaseline1Char = await page.evaluate(async (b64) => {
      const { unzipSync } = await import('three/addons/libs/fflate.module.js');
      const files = unzipSync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      const shot = JSON.parse(new TextDecoder().decode(files['shot.json']));
      delete shot.sceneMode;
      shot.characters = shot.characters.slice(0, 1);
      files['shot.json'] = new TextEncoder().encode(JSON.stringify(shot));
      await window.__studio.shot.openFiles(files);
      return { sceneActive: window.__studio.sceneShot.active };
    }, zipB64);
    Object.assign(result.fpsBaseline1Char, await fpsRun());
    await shot('baseline1');
  } catch (e) {
    result.fpsBaseline1Char = { skipped: String(e.message || e) };
  }
  result.pageErrors = errors;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
const outJson = path.join(outDir, `${name}-measure.json`);
writeFileSync(outJson, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ name, open: result.open, summary: result.summary, coverage: result.coverage, thresholds: result.thresholds, fpsScene: result.fpsScene, fpsBaseline1Char: result.fpsBaseline1Char, layoutValue: result.layoutValue, cameraActive: result.cameraActive, pageErrors: result.pageErrors, json: outJson }, null, 1));
