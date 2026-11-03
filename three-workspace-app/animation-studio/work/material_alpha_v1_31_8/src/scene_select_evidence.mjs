// Evidence run (not a test): App 3 scene mode S3, §9 steps 3-6 with screenshots.
// Usage: node src/scene_select_evidence.mjs <scene-2.zip> <scene-5.zip> <outdir>
import { browserOptions } from './browser_test_options.mjs';
import { useClassicLayout } from './classic_test_layout.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [zip2, zip5, outDir] = process.argv.slice(2);
if (!zip2 || !zip5 || !outDir) throw Error('usage: node src/scene_select_evidence.mjs <scene-2.zip> <scene-5.zip> <outdir>');
mkdirSync(outDir, { recursive: true });
const artifact = fileURLToPath(new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url));
if (!existsSync(artifact)) throw Error('missing ' + artifact + ' (node src/build.mjs)');
const { chromium } = createRequire(new URL('../../../../editor/apps/studio/package.json', import.meta.url))('playwright');

const summary = { checks: {}, screenshots: {}, errors: [] };
const check = (name, ok, detail) => { summary.checks[name] = { pass: !!ok, detail }; console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(detail) ?? ''); };

const server = createServer((_q, res) => { res.setHeader('content-type', 'text/html'); res.end(readFileSync(artifact)); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(browserOptions({ headless: true }));
const raf2 = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => summary.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await useClassicLayout(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__studio?.ready);
  return page;
}
const helpers = (page) => {
  const SS = (fn, arg) => page.evaluate(new Function('arg', 'const SS=window.__studio.sceneShot,S=window.__studio;return (' + fn + ')(arg)'), arg);
  const waitEditing = async (id) => {
    await page.waitForFunction((x) => window.__studio.sceneShot.editing() === x && !window.__studio.sceneShot.switching, id, { timeout: 30000 });
    await raf2(page);
  };
  return { SS, waitEditing };
};
async function openZip(page, zipPath) {
  const b64 = readFileSync(zipPath).toString('base64');
  const r = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const t0 = performance.now();
    await window.__studio.shot.openZip(bytes);
    const wall = performance.now() - t0;
    const s = window.__studio.sceneShot;
    return { wallMs: wall, statsOpenMs: s.stats().openMs, characters: s.stats().characters, viewers: s.stats().viewers, active: s.active };
  }, b64);
  await raf2(page);
  // frame all characters (same maths as scene_shot_f2.measure.mjs)
  r.fit = await page.evaluate(() => {
    const studio = window.__studio;
    const roots = studio.sceneShot.fitRoots();
    const report = [];
    for (const view of studio.editorViews()) {
      if (!view.container?.clientWidth) continue;
      const all = [view.rig?.root || view.wrapper, ...roots].filter(Boolean);
      for (const x of all) x.updateMatrixWorld(true);
      const V = view.camera.position.constructor;
      const min = new V(Infinity, Infinity, Infinity), max = new V(-Infinity, -Infinity, -Infinity);
      for (const x of all)
        x.traverse((o) => {
          if (o.isBone) { const p = o.getWorldPosition(new V()); min.min(p); max.max(p); }
          else if (o.isMesh && o.geometry) {
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            const b = o.geometry.boundingBox; if (!b) return;
            for (let i = 0; i < 8; i++) { const p = new V(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld); min.min(p); max.max(p); }
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
  await raf2(page);
  await page.waitForTimeout(800);
  return r;
}
const shot = async (page, file) => { const p = path.join(outDir, file); await page.screenshot({ path: p, timeout: 90000 }); summary.screenshots[file] = p; };
const uiState = (page) => page.evaluate(() => {
  const SS = window.__studio.sceneShot;
  const opac = (root) => { const o = new Set(); root.traverse((m) => { if (m.isMesh && m.material) for (const x of [].concat(m.material)) o.add(x.opacity + (x.transparent ? 't' : '')); }); return [...o]; };
  const rows = [...document.querySelectorAll('#sceneCharacterList [data-character-id]')];
  const list = document.getElementById('sceneCharacterList');
  const vis = (el) => { const r = el?.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  return {
    editing: SS.editing(), label: document.getElementById('sceneEditingLabel')?.textContent,
    listVisible: vis(list), rows: rows.map((r) => [r.dataset.characterId, r.classList.contains('active'), r.textContent]),
    opacity: Object.fromEntries(SS.registry.all ? SS.registry.all().map((e) => [e.id, 0]) : []),
    viewerOpacity: Object.fromEntries(rows.map((r) => r.dataset.characterId).map((id) => { const e = SS.registry.get(id); return e && e.viewer ? [id, { viewerVisible: e.viewer.group.visible, opac: opac(e.viewer.root) }] : [id, null]; }).filter((x) => x[1])),
    editingRigOpac: opac(window.__studio.rig().root),
  };
});

try {
  // ===== 2-character =====
  let page = await newPage();
  let { SS, waitEditing } = helpers(page);
  const open2 = await openZip(page, zip2);
  summary.open2 = open2;
  const ids = await SS('()=>SS.registry.viewers().map(e=>e.id).concat([SS.editing()])');
  summary.ids = ids;
  await shot(page, '01-open.png');
  const ui1 = await uiState(page);
  summary.ui1 = ui1;
  const A = ui1.editing;
  const Bid = ui1.rows.map((r) => r[0]).find((x) => x !== A);
  check('open: scene active, 2 characters', open2.active && open2.characters === 2, open2);
  check('open: label "Đang sửa: …"', /^Đang sửa: .+/.test(ui1.label || ''), ui1.label);
  check('open: left list visible with 2 rows', ui1.listVisible && ui1.rows.length === 2, ui1.rows);
  check('open: editing char has rig (opacity 1), other viewer dimmed 0.5', ui1.editingRigOpac.length > 0 && ui1.editingRigOpac.every((o) => o.startsWith('1')) && ui1.viewerOpacity[Bid]?.opac.every((o) => o === '0.5t'), { editingRigOpac: ui1.editingRigOpac, viewers: ui1.viewerOpacity });

  const A0 = await SS(`()=>SS.keysHash(SS.editing())`);
  const edit = (arg) => SS(`(a)=>{S.seek(a.t);const id=S.rig().records.find(r=>r.name==='mixamorig:'+a.bone).id;S.select(id);
      const e=document.getElementById('rz');e.value=String(a.deg);e.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('keyBtn').click();return SS.keysHash(SS.editing())}`, arg);
  const bones = (id, t) => SS(`(a)=>{SS.setTime(a.t);const s=SS.sample().find(x=>x.characterId===a.id);return s.bones}`, { id, t });
  const maxDiff = (a, b) => { let w = 0; for (const k of Object.keys(a)) a[k].forEach((v, i) => (w = Math.max(w, Math.abs(v - b[k][i])))); return w; };
  const h0 = await SS('()=>S.state.historyIndex');
  const A1 = await edit({ t: 1, bone: 'LeftArm', deg: 70 });
  const hEditA = await SS('()=>S.state.historyIndex');
  summary.keysHashA = { before: A0, afterEdit: A1 };
  await raf2(page); await page.waitForTimeout(300);
  await shot(page, '02-edited-A.png');
  check('edit A: keysHash changed, edited()=[A]', A1 !== A0 && JSON.stringify(await SS('()=>SS.edited()')) === JSON.stringify([A]), { A0, A1 });
  const aPose = await bones(A, 1);

  // real mouse click on B
  const where = (id) => SS(`(id)=>{const e=SS.registry.get(id),root=e.editing?e.rig.root:e.viewer.root;root.updateMatrixWorld(true);
     const v=S.editorViews()[0],c=v.camera;c.updateMatrixWorld(true);const r=v.renderer.domElement.getBoundingClientRect();
     for(const n of ['Spine1','Spine2','Hips','Spine','Neck','LeftUpLeg','RightUpLeg','LeftArm','RightArm']){
       let p=null;root.traverse(o=>{if(o.isBone&&o.name==='mixamorig:'+n)p=o.getWorldPosition(S.rig().root.position.clone())});
       if(!p)continue;p.project(c);const x=r.left+(p.x+1)/2*r.width,y=r.top+(1-p.y)/2*r.height;
       const top=document.elementFromPoint(x,y),hits=SS.hitsAt(x,y).sort((a,b)=>a.distance-b.distance);
       if(top===v.renderer.domElement&&hits[0]&&hits[0].characterId===id)return {x,y,bone:n};}
     return null}`, id);
  const clickOn = async (id) => {
    const w = await where(id);
    if (!w) throw Error('no clickable point on ' + id);
    await page.mouse.move(w.x, w.y);
    const t0 = Date.now();
    await page.mouse.click(w.x, w.y);
    await waitEditing(id);
    return { w, wallMs: Date.now() - t0, switchMs: await SS('()=>SS.lastSwitchMs') };
  };
  const cB = await clickOn(Bid);
  summary.clickB = cB;
  await page.mouse.move(5, 5);
  await shot(page, '03-switched-to-B.png');
  const ui3 = await uiState(page);
  summary.ui3 = ui3;
  const aAfter = await bones(A, 1);
  const poseDiff = maxDiff(aPose, aAfter);
  check('click B: editing=B, label B', ui3.editing === Bid && /^Đang sửa: /.test(ui3.label), { editing: ui3.editing, label: ui3.label });
  check('click B: A dimmed (0.5), ● next to A in list', ui3.viewerOpacity[A]?.opac.every((o) => o === '0.5t') && ui3.rows.find((r) => r[0] === A)?.[2].includes('●'), { A: ui3.viewerOpacity[A], rows: ui3.rows });
  check('click B: A keysHash unchanged', (await SS(`(id)=>SS.keysHash(id)`, A)) === A1, null);
  check('A viewer shows edited pose at frame (maxDiff < 1e-4)', poseDiff < 1e-4, { poseDiff });

  // edit B, back to A
  const B0 = await SS(`(id)=>SS.keysHash(id)`, Bid);
  const B1 = await edit({ t: 0.5, bone: 'RightArm', deg: -60 });
  const hEditB = await SS('()=>S.state.historyIndex');
  const cA = await clickOn(A);
  summary.clickBackA = cA;
  await page.mouse.move(5, 5);
  await shot(page, '04-back-to-A.png');
  const ui4 = await uiState(page);
  summary.ui4 = ui4;
  check('edit B: hash changed', B1 !== B0, { B0, B1 });
  check('back to A: editing=A, A keysHash unchanged', ui4.editing === A && (await SS(`(id)=>SS.keysHash(id)`, A)) === A1, { editing: ui4.editing });
  check('back to A: ● next to B', ui4.rows.find((r) => r[0] === Bid)?.[2].includes('●'), ui4.rows);
  // Ctrl+Z
  const bPose = await bones(Bid, 0.5);
  let presses = 0;
  for (; presses < 12 && (await SS('()=>S.state.historyIndex')) > h0; presses++) await page.keyboard.press('Control+z');
  const hUndo = await SS('()=>S.state.historyIndex');
  const Aun = await SS(`(id)=>SS.keysHash(id)`, A), Bun = await SS(`(id)=>SS.keysHash(id)`, Bid);
  check('Ctrl+Z: A edit undone (hash = baseline)', Aun === A0, { presses, h0, hEditA, hEditB, hUndo, Aun, A0 });
  check('Ctrl+Z: B keysHash unchanged', Bun === B1, { Bun, B1 });
  check('Ctrl+Z: B viewer pose unchanged', maxDiff(bPose, await bones(Bid, 0.5)) < 1e-6, null);
  for (let i = 0; i < 12 && (await SS('()=>S.state.historyIndex')) < hEditA; i++) await page.keyboard.press('Control+y');
  const hAfterY = await SS('()=>S.state.historyIndex');
  for (let i = 0; i < 12 && (await SS('()=>S.state.historyIndex')) < hEditA; i++) await page.keyboard.press('Control+Shift+z');
  const Are = await SS(`(id)=>SS.keysHash(id)`, A);
  check('redo (Ctrl+Y, else Ctrl+Shift+Z): A edit redone', Are === A1, { Are, A1, histAfterCtrlY: hAfterY, histAfterAll: await SS('()=>S.state.historyIndex'), hEditA });

  // onion
  await page.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); if (e.type === 'checkbox') e.checked = v; else e.value = v; e.dispatchEvent(new Event('change')); };
    set('onionBefore', '2'); set('onionAfter', '2'); set('onionStep', '3'); set('onionParts', 'both');
  }).catch(() => {});
  let onionHow = 'onionToggle click';
  try { await page.click('#onionToggle', { timeout: 3000 }); } catch { onionHow = 'onionEnabled checkbox'; await SS(`()=>{const e=document.getElementById('onionEnabled');e.checked=true;e.dispatchEvent(new Event('change'));return 1}`); }
  const onionOn = await page.waitForFunction(() => window.__studio.onion().samples.length > 0, null, { timeout: 8000 }).then(() => true, () => false);
  await raf2(page); await page.waitForTimeout(500);
  await shot(page, '05-onion.png');
  const ghosts = await SS(`()=>{const o=S.onion();const viewerGroups=SS.registry.viewers().map(e=>e.viewer.group);
    let inViewer=0,total=0,meshes=0,lines=0;o.group.traverse(x=>{total++;if(x.isMesh)meshes++;if(x.isLine||x.isLineSegments)lines++;});
    const eRoots=[];o.group.traverse(x=>{for(let p=x;p;p=p.parent)if(viewerGroups.includes(p)){inViewer++;break}});
    return {enabled:document.getElementById('onionEnabled').checked,samples:o.samples.length,slots:o.slots.length,groupVisible:o.group.visible,objects:total,meshes,lines,ghostObjectsInsideViewerGroups:inViewer,editing:SS.editing()}}`);
  summary.onion = { how: onionHow, ...ghosts };
  check('onion: enabled with samples, ghosts only on editing rig (0 inside viewers)', onionOn && ghosts.slots > 0 && ghosts.ghostObjectsInsideViewerGroups === 0, summary.onion);
  await page.mouse.move(5, 5);

  // scene camera
  await SS(`()=>{const e=document.getElementById('onionEnabled');if(e.checked){e.checked=false;e.dispatchEvent(new Event('change'))}return 1}`);
  const camBtn = await page.evaluate(() => { const b = document.getElementById('sceneCameraBtn'); const r = b.getBoundingClientRect(); return { hidden: b.hidden, w: r.width }; });
  await page.click('#sceneCameraBtn');
  await raf2(page); await page.waitForTimeout(500);
  const camActive = await SS('()=>SS.cameraActive');
  await shot(page, '06-scene-camera.png');
  check('scene camera: button visible, cameraActive true', !camBtn.hidden && camActive === true, { camBtn, camActive });
  await page.click('#sceneCameraBtn');

  // stress
  await SS(`(id)=>SS.select(id)`, A); await waitEditing(A);
  const hashes = [], times = [];
  const A1s = await SS(`(id)=>SS.keysHash(id)`, A);
  for (let i = 0; i < 10; i++) {
    await SS(`(id)=>SS.select(id)`, Bid); times.push(await SS('()=>SS.lastSwitchMs'));
    hashes.push(await SS(`(id)=>SS.keysHash(id)`, A));
    await SS(`(id)=>SS.select(id)`, A); times.push(await SS('()=>SS.lastSwitchMs'));
    hashes.push(await SS(`(id)=>SS.keysHash(id)`, A));
  }
  const stable = hashes.every((h) => h === hashes[0]);
  summary.stress = { n: hashes.length, stable, equalsPreStress: hashes[0] === A1s, switchMsMean: times.reduce((a, b) => a + b, 0) / times.length, switchMsMax: Math.max(...times), switchMsMin: Math.min(...times), times };
  check('stress A->B->A x10: keysHash(A) all equal', stable && hashes[0] === A1s, { equalsPreStress: hashes[0] === A1s, mean: summary.stress.switchMsMean, max: summary.stress.switchMsMax });
  await page.close();

  // ===== 5-character =====
  page = await newPage();
  ({ SS, waitEditing } = helpers(page));
  const open5 = await openZip(page, zip5);
  summary.open5 = open5;
  await shot(page, '07-five-open.png');
  const ui7 = await uiState(page);
  summary.ui7 = ui7;
  check('5-char open: 5 characters, list has 5 rows, label', open5.characters === 5 && ui7.rows.length === 5 && /^Đang sửa: /.test(ui7.label || ''), { characters: open5.characters, rows: ui7.rows, label: ui7.label });
  const first5 = ui7.editing;
  const target = ui7.rows.map((r) => r[0]).filter((x) => x !== first5)[1] ?? ui7.rows[1][0];
  summary.five5SelectedBefore = await SS('()=>S.state.selected');
  // The editor's rotate gizmo (XYZE sphere/ring picker) of the selected object is a control too and sits over crowded neighbours;
  // select the Head bone so the gizmo is away from the body, then skip any candidate that still has a gizmo axis under the pointer.
  summary.five5Deselect = await SS(`()=>{S.select(S.rig().records.find(r=>r.name==='mixamorig:Head').id);return S.state.selected}`);
  const cands = await SS(`(id)=>{const e=SS.registry.get(id),root=e.viewer.root;root.updateMatrixWorld(true);
     const v=S.editorViews()[0],c=v.camera;c.updateMatrixWorld(true);const r=v.renderer.domElement.getBoundingClientRect();const out=[];
     root.traverse(o=>{if(!o.isBone)return;const p=o.getWorldPosition(S.rig().root.position.clone());p.project(c);
       const x=r.left+(p.x+1)/2*r.width,y=r.top+(1-p.y)/2*r.height;
       const top=document.elementFromPoint(x,y),hits=SS.hitsAt(x,y).sort((a,b)=>a.distance-b.distance);
       if(top===v.renderer.domElement&&hits[0]&&hits[0].characterId===id)out.push({x,y,bone:o.name})});return out}`, target);
  summary.five5Candidates = cands.length;
  let sw5 = null; const attempts = [];
  const edPos = await SS(`()=>{const v=S.editorViews()[0],c=v.camera,r=v.renderer.domElement.getBoundingClientRect(),root=S.rig().root,res=[];
     root.traverse(o=>{if(!o.isBone)return;const p=o.getWorldPosition(root.position.clone());p.project(c);res.push([r.left+(p.x+1)/2*r.width,r.top+(1-p.y)/2*r.height])});return res}`);
  const dEd = (w) => Math.min(...edPos.map(([x, y]) => Math.hypot(x - w.x, y - w.y)));
  cands.sort((a, b) => dEd(b) - dEd(a));
  summary.five5CandidateMinDistToEditingBonesPx = cands.slice(0, 12).map((w) => Math.round(dEd(w)));
  for (const w of cands.slice(0, 40)) {
    if (await SS('()=>S.state.draft')) { await SS(`()=>document.getElementById('undoBtn').click()`); summary.five5DraftDiscarded = (summary.five5DraftDiscarded || 0) + 1; }
    const before = await SS('()=>S.state.selected');
    await page.mouse.move(w.x, w.y); await page.waitForTimeout(150);
    // The editor's own transform gizmo (hovered axis) and the rig widgets are controls and keep priority; report who is under the pointer.
    const under = await SS(`(p)=>{const v=S.editorViews()[0],ev={clientX:p.x,clientY:p.y},sv=v.rootPickYields;v.rootPickYields=null;const without=S.widgetPick(v,ev)?.id||null;v.rootPickYields=sv;
      return {gizmoAxis:v.gizmo?.axis||v.moveGizmo?.axis||null,widgetWithoutYield:without,widgetNow:S.widgetPick(v,ev)?.id||null}}`, w);
    if (under.gizmoAxis) { attempts.push({ bone: w.bone, skipped: 'transform gizmo under pointer', under }); continue; }
    const t0 = Date.now();
    await page.mouse.click(w.x, w.y);
    const ok = await page.waitForFunction((x) => window.__studio.sceneShot.editing() === x && !window.__studio.sceneShot.switching, target, { timeout: 4000 }).then(() => true, () => false);
    attempts.push({ bone: w.bone, switched: ok, under, selectedBefore: before, selectedAfter: await SS('()=>S.state.selected'), status: await page.evaluate(() => document.getElementById('status')?.textContent) });
    if (ok) { await raf2(page); sw5 = { how: 'real click on ' + w.bone, target, wallMs: Date.now() - t0, switchMs: await SS('()=>SS.lastSwitchMs') }; break; }
  }
  summary.five5Attempts = attempts;
  if (!sw5) {
    summary.five5DraftAfterClicks = await SS('()=>S.state.draft');
    if (summary.five5DraftAfterClicks) await SS(`()=>document.getElementById('undoBtn').click()`);
    const t0 = Date.now();
    await SS(`(id)=>SS.select(id)`, target); await waitEditing(target);
    sw5 = { how: 'select() fallback (real clicks failed, see five5Attempts)', target, wallMs: Date.now() - t0, switchMs: await SS('()=>SS.lastSwitchMs') };
  }
  await page.mouse.move(5, 5);
  await shot(page, '08-five-switch.png');
  summary.five = { openWallMs: open5.wallMs, openStatsMs: open5.statsOpenMs, switch: sw5, uiAfter: await uiState(page) };
  check('5-char switch: editing = target', summary.five.uiAfter.editing === target, sw5);
  summary.pageErrors = summary.errors;
  check('no page errors', summary.errors.length === 0, summary.errors);
} catch (e) {
  summary.fatal = String(e.stack || e);
  console.log('FATAL', summary.fatal);
} finally {
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
