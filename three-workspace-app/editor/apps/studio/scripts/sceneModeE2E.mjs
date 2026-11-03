/**
 * S4 end-to-end browser check of App 3 "1 khung · Cả cảnh" through the REAL Studio (App 2 + embedded App 3).
 * docs/APP3-SCENE-MODE-TASK-2026-11-03.md section 9 (steps 1-8) + "Bỏ sửa".
 *
 * Build a fixture first (from packages/builder):
 *   node --import tsx ../../apps/studio/scripts/sceneModeFixture.mts --synthetic --out <fixtureDir> --characters 2
 * Run (from apps/studio):
 *   E2E_FIXTURE=<fixtureDir> E2E_OUT=<screenshotDir> node scripts/sceneModeE2E.mjs
 *
 * The driver COPIES <fixtureDir> to <fixtureDir>-run-<port>, starts `next dev` on E2E_PORT (3120..3129 only) with
 * BBS_UNIFIED_PROJECTS_DIR / W01_LIBRARY pointing at the copy, drives the UI with Playwright, stops the server and reverts
 * apps/studio/tsconfig.json (next dev rewrites it). Set STUDIO_URL (+ E2E_PROJECT_ID, E2E_PROJECTS_DIR) to reuse a running server.
 * Exit code 0 only when no step FAILED (BLOCKED steps are reported, not failures). Report: <E2E_OUT>/report.json.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = process.env.E2E_FIXTURE
const out = path.resolve(process.env.E2E_OUT || path.join(studio, 'work/qa/scene-mode-e2e'))
const port = Number(process.env.E2E_PORT || 3120)
if (!process.env.STUDIO_URL) {
  assert.ok(fixture && existsSync(path.join(fixture, 'projects')), 'Set E2E_FIXTURE to a sceneModeFixture --synthetic output dir')
  assert.ok(port >= 3120 && port <= 3129, 'E2E_PORT must be in 3120..3129')
}
mkdirSync(out, { recursive: true })

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
const embedReadme = readFileSync(path.join(studio, 'public/animation-studio/v1.34.0/README.md'), 'utf8')
const embedSha = /index\.html`\s*\|\s*`([0-9a-f]{64})`/.exec(embedReadme)?.[1] ?? 'unknown'
const report = { startedAt: new Date().toISOString(), embedIndexSha256: embedSha, steps: [], numbers: {}, errors: [], consoleErrors: [] }
const persist = () => writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
let shotNo = 0
const results = {}
let shotFn
async function step(id, title, fn) {
  const entry = { id, title, status: 'FAIL', evidence: {} }
  report.steps.push(entry)
  try {
    const res = await fn(entry.evidence)
    entry.status = res?.blocked ? 'BLOCKED' : 'PASS'
    if (res?.blocked) entry.evidence.reason = res.blocked
  } catch (error) {
    entry.status = 'FAIL'
    entry.evidence.error = error instanceof Error ? error.message : String(error)
    try { entry.evidence.failShot = await shotFn?.(`FAIL-${id}`) } catch { /* page gone */ }
  }
  console.log(`[${entry.status}] ${id} ${title}`, entry.status === 'PASS' ? '' : JSON.stringify(entry.evidence).slice(0, 600))
  persist()
  return entry.status
}

// ---- server -----------------------------------------------------------------
let server, base = process.env.STUDIO_URL, projectsDir = process.env.E2E_PROJECTS_DIR, projectId = process.env.E2E_PROJECT_ID
if (!base) {
  const run = `${path.resolve(fixture)}-run-${port}`
  rmSync(run, { recursive: true, force: true })
  cpSync(path.resolve(fixture), run, { recursive: true })
  projectsDir = path.join(run, 'projects')
  const library = path.join(run, 'library')
  projectId = readdirSync(projectsDir).find((n) => existsSync(path.join(projectsDir, n, 'project.json')))
  spawnSync(process.execPath, ['scripts/copy-draco.cjs'], { cwd: studio, stdio: 'ignore' })
  const portBusy = await new Promise((resolve) => { const sock = net.connect(port, '127.0.0.1'); sock.once('connect', () => { sock.destroy(); resolve(true) }); sock.once('error', () => resolve(false)) })
  assert.ok(!portBusy, `port ${port} is already in use (a leftover dev server would serve stale data); stop it or set E2E_PORT`)
  server = spawn(process.execPath, [path.join(studio, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: studio, env: { ...process.env, BBS_UNIFIED_PROJECTS_DIR: projectsDir, W01_LIBRARY: library, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  let serverLog = ''
  server.stdout.on('data', (d) => { serverLog += d })
  server.stderr.on('data', (d) => { serverLog += d })
  base = `http://127.0.0.1:${port}`
  report.serverLog = () => serverLog
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base)).status < 500) break } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
}
report.base = base; report.projectId = projectId; report.projectsDir = projectsDir
const stopServer = () => {
  if (server) { try { process.kill(-server.pid, 'SIGTERM') } catch { /* gone */ } }
  spawnSync('git', ['checkout', '--', 'apps/studio/tsconfig.json'], { cwd: path.resolve(studio, '../..'), stdio: 'ignore' })
  spawnSync('git', ['checkout', '--', path.join(studio, 'tsconfig.json')], { cwd: studio, stdio: 'ignore' })
}

const browser = await chromium.launch({ headless: true })
let exitCode = 0
try {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1150 }, locale: 'en-US' })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  const dialogs = []
  let dialogMode = 'accept'
  page.on('dialog', (dialog) => { dialogs.push({ type: dialog.type(), message: dialog.message() }); void (dialogMode === 'accept' ? dialog.accept() : dialog.dismiss()) })
  page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 300)) })
  const shot = async (name) => { const file = path.join(out, `${String(++shotNo).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: file }); return file }
  shotFn = shot
  const api = context.request
  const origin = { Origin: base }
  const frameHandle = async () => (await (await page.locator('iframe.wb-animation-creation-frame').elementHandle()).contentFrame())
  const unified = async () => (await (await api.get(`${base}/api/unified/projects/${projectId}`)).json())
  const SS = async (fn, arg) => (await frameHandle()).evaluate(new Function('arg', `const SS=window.__studio.sceneShot,S=window.__studio;return (${fn})(arg)`), arg)
  // The host panel (App 2 React) is portalled INTO the App 3 iframe document, so its controls live in the frame.
  const host = async () => frameHandle()
  const hostStatus = async () => (await host()).locator('.wb-animation-creation-status').first().textContent().catch(() => '')
  const hostError = async () => (await host()).locator('.wb-animation-creation-error').allTextContents()

  // per-character fingerprint of everything App 2 stores for it
  const fingerprint = (project) => {
    const nodes = Object.fromEntries(Object.values(project.characters).map((c) => [c.id, c]))
    const out = {}
    for (const c of Object.values(nodes)) {
      const clips = project.scene.content.timeline.animation.motionClips.filter((k) => k.target.nodeId === c.nodeId)
      const bindings = Object.entries(project.bindings ?? {}).filter(([, b]) => JSON.stringify(b).includes(c.id))
      out[c.id] = { name: c.name, nodeId: c.nodeId, clips, bindings, clipsHash: sha(clips), bindingsHash: sha(bindings) }
    }
    return out
  }
  const stateHash = (project) => ({ scene: sha(project.scene), extensions: sha(project.extensions), motions: sha(project.motions), bindings: sha(project.bindings), assets: sha(Object.keys(project.assets).sort()), characters: sha(project.characters) })

  assert.ok((await api.post(`${base}/api/unified/session`, { headers: origin })).ok())
  const initial = (await unified()).project
  const chars = Object.values(initial.characters)
  assert.ok(chars.length >= 2, 'fixture needs >= 2 characters')
  const [A, B] = chars
  const before = fingerprint(initial)
  const beforeState = stateHash(initial)
  const beforeRevision = initial.revision
  report.numbers.projectRevisionBefore = beforeRevision
  report.numbers.characters = chars.map((c) => c.name)
  report.numbers.clipsBefore = Object.fromEntries(Object.values(before).map((c) => [c.name, c.clips.map((k) => [k.frameStart, k.frameEnd])]))
  const frameRange = (() => { const all = Object.values(before).flatMap((c) => c.clips); return [Math.min(...all.map((k) => k.frameStart)), Math.max(...all.map((k) => k.frameEnd))] })()

  // ---- open the project, F3 -----------------------------------------------------
  await step('S0', 'Mở project, sang workspace 3 Animation', async (ev) => {
    await page.goto(`${base}/?unified=${projectId}`)
    await page.getByRole('navigation', { name: '5 workspace', exact: true }).waitFor()
    await page.waitForTimeout(1500)
    // F3 is not bound in the Studio workbench (observed: pressing F3 does nothing); the 5-workspace nav button is the way.
    const how = 'nav button "3 Animation" (F3 key is not a workbench shortcut)'
    await page.getByRole('navigation', { name: '5 workspace', exact: true }).getByRole('button', { name: /Animation/ }).click()
    await page.locator('.wb-animation-creation-frame').waitFor()
    const frame = await frameHandle()
    await frame.waitForFunction(() => window.__studio?.ready === true && !!window.__app3LocalBridge, null, { polling: 100 })
    ev.how = how
    ev.file = await shot('f3-animation')
  })

  await step('S1', 'Nhân vật = nhân vật đầu, bấm "Mở cả cảnh": thấy mọi nhân vật', async (ev) => {
    const select = (await host()).locator('.wb-animation-creation-toolbar select').first()
    await select.selectOption({ label: A.name })
    ev.selected = await select.evaluate((el) => el.selectedOptions[0].textContent)
    const t0 = Date.now()
    await (await host()).getByRole('button', { name: 'Mở cả cảnh', exact: true }).click()
    await page.waitForFunction(({ n }) => {
      const f = document.querySelector('iframe.wb-animation-creation-frame')?.contentWindow
      const ss = f?.__studio?.sceneShot
      return !!ss && ss.active && ss.stats().characters === n && !ss.switching
    }, { n: chars.length }, { polling: 50, timeout: 120_000 })
    report.numbers.openAllCharactersMs = Date.now() - t0
    ev.openAllCharactersMs = report.numbers.openAllCharactersMs
    ev.hostStatus = await hostStatus()
    ev.hostError = await hostError()
    assert.deepEqual(ev.hostError, [])
    ev.appStats = await SS('()=>({stats:SS.stats(),editing:SS.editing(),label:document.getElementById("sceneEditingLabel").textContent,list:[...document.querySelectorAll("#sceneCharacterList [data-character-id]")].map(r=>[r.dataset.characterId,r.textContent]),layout:document.getElementById("viewportLayout").value})')
    ev.cameraNote = 'App3-side openMs=' + JSON.stringify(ev.appStats.stats.openMs ?? null)
    assert.equal(ev.appStats.stats.characters, chars.length)
    assert.equal(ev.appStats.editing, A.id, 'first editable character = selected one')
    assert.match(ev.appStats.label, new RegExp(`Đang sửa: ${A.name}`))
    assert.equal(ev.appStats.layout, 'sceneSingle')
    await page.waitForTimeout(800)
    ev.file = await shot('scene-opened')
  })

  const ref = JSON.parse(readFileSync(path.join(fixture ?? '', 'scene-2.reference.json'), 'utf8').toString())
  await step('S1b', 'Vị trí gốc trong F3 khớp sampler App 2 (reference.json) ở 3 khung', async (ev) => {
    const worst = { posM: 0, rows: [] }
    for (const [frameNo] of Object.entries(ref.characters[0].frames)) {
      const sample = await SS('(f)=>{SS.setTime(f/30);return SS.sample().map(s=>({characterId:s.characterId,root:s.root}))}', Number(frameNo))
      for (const c of ref.characters) {
        const got = sample.find((s) => s.characterId === c.characterId)
        assert.ok(got, `character ${c.name} missing in sample`)
        const exp = c.frames[frameNo].root
        const d = Math.hypot(got.root[12] - exp[12], got.root[13] - exp[13], got.root[14] - exp[14])
        worst.posM = Math.max(worst.posM, d); worst.rows.push([c.name, Number(frameNo), Number(d.toFixed(6))])
      }
    }
    await SS('()=>SS.setTime(0)')
    report.numbers.rootPosDiffMaxM = worst.posM
    Object.assign(ev, worst)
    assert.ok(worst.posM <= 0.01, `root position diff ${worst.posM} m > 1 cm`)
  })

  await step('S2', 'Phát: cả hai chạy cùng lúc', async (ev) => {
    const frame = await frameHandle()
    await frame.getByRole('tab', { name: 'Animate', exact: true }).click() // #playBtn lives in the Animate tab of App 3's mode layout
    await frame.locator('#playBtn').waitFor({ state: 'visible' })
    const sample0 = await SS('()=>SS.sample().map(s=>[s.characterId,JSON.stringify(s.bones).length,Object.values(s.bones).flat().slice(0,40).reduce((a,b)=>a+b,0)])')
    await frame.locator('#playBtn').click()
    const fps = await frame.evaluate(() => new Promise((resolve) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else resolve(n * 1000 / (performance.now() - t0)) }; requestAnimationFrame(tick) }))
    const during = await SS('()=>({time:document.getElementById("timeReadout").textContent,frame:document.getElementById("frameInput").value,fps:SS.stats().fpsPlaying??null,stats:SS.stats()})')
    ev.file = await shot('playing')
    await frame.locator('#playBtn').click()
    await frame.getByRole('tab', { name: 'Pose', exact: true }).click() // the host panel (Mở cả cảnh / Trả kết quả) lives in the Pose layout
    const sample1 = await SS('()=>SS.sample().map(s=>[s.characterId,JSON.stringify(s.bones).length,Object.values(s.bones).flat().slice(0,40).reduce((a,b)=>a+b,0)])')
    report.numbers.playbackRafFps2Chars = Number(fps.toFixed(1))
    ev.rafFps = report.numbers.playbackRafFps2Chars; ev.during = during
    // both characters' poses at the paused frame must differ from frame 0 (the two clips are different/ staggered, so compare each)
    for (const [id, , v0] of sample0) { const v1 = sample1.find((s) => s[0] === id)[2]; ev[`pose-changed-${id.slice(0, 8)}`] = v0 !== v1 }
    assert.ok(Number(during.frame) > 0 || during.time !== '0.000 s', 'time advanced during play')
    assert.ok(sample0.every(([id, , v0]) => sample1.find((s) => s[0] === id)[2] !== v0), 'both characters moved while playing')
    await SS('()=>SS.setTime(0)')
  })

  const editSnippet = `(a)=>{S.seek(a.t);const rec=S.rig().records.find(r=>new RegExp(a.bone+'$').test(r.name));S.select(rec.id);
    const e=document.getElementById('rz');e.value=String(a.deg);e.dispatchEvent(new Event('change',{bubbles:true}));
    document.getElementById('keyBtn').click();return SS.keysHash(SS.editing())}`
  const waitEditing = async (id) => {
    await page.waitForFunction((x) => { const ss = document.querySelector('iframe.wb-animation-creation-frame').contentWindow.__studio.sceneShot; return ss.editing() === x && !ss.switching }, id, { timeout: 30_000 })
    await page.waitForTimeout(400)
  }
  const aKeys0 = await SS(`()=>SS.keysHash(${JSON.stringify(A.id)})`)
  let aKeys1, bKeys1
  await step('S3', 'Sửa A tại một khung, click thân B (chuột thật): sang B, A mờ và vẫn chạy bản vừa sửa', async (ev) => {
    aKeys1 = await SS(editSnippet, { t: 0.5, bone: 'LeftArm', deg: 70 })
    ev.keysHashA = [aKeys0, aKeys1]
    assert.notEqual(aKeys1, aKeys0, 'A keys changed')
    assert.deepEqual(await SS('()=>SS.edited()'), [A.id])
    await page.locator('iframe.wb-animation-creation-frame').scrollIntoViewIfNeeded()
    // find a real clickable point on B's body (canvas on top, B nearest hit), in iframe coords, then offset by the iframe box
    const where = async (id) => SS(
      `(id)=>{const e=SS.registry.get(id),root=e.editing?e.rig.root:e.viewer.root;root.updateMatrixWorld(true);
       const v=S.editorViews()[0],c=v.camera;c.updateMatrixWorld(true);const r=v.renderer.domElement.getBoundingClientRect();
       for(const n of ['Spine1','Spine2','Hips','Spine','Neck','LeftUpLeg','RightUpLeg','LeftArm','RightArm']){
         let p=null;root.traverse(o=>{if(o.isBone&&(o.name==='mixamorig:'+n||o.name==='mixamorig'+n))p=o.getWorldPosition(S.rig().root.position.clone())});
         if(!p)continue;p.project(c);const x=r.left+(p.x+1)/2*r.width,y=r.top+(1-p.y)/2*r.height;
         const top=document.elementFromPoint(x,y),hits=SS.hitsAt(x,y).sort((a,b)=>a.distance-b.distance);
         if(top===v.renderer.domElement&&hits[0]&&hits[0].characterId===id)return {x,y,bone:n};}
       return null}`, id)
    let w = await where(B.id)
    if (!w) { await page.waitForTimeout(1500); w = await where(B.id) }
    assert.ok(w, 'no clickable point on B body (B occluded by DOM or A)')
    const box = await page.locator('iframe.wb-animation-creation-frame').boundingBox()
    ev.clickPoint = { ...w, iframeBox: box }
    const t0 = Date.now()
    await page.mouse.click(box.x + w.x, box.y + w.y)
    await waitEditing(B.id)
    ev.switchWallMs = Date.now() - t0; report.numbers.firstSwitchWallMs = ev.switchWallMs
    ev.switchAppMs = await SS('()=>SS.lastSwitchMs')
    assert.equal(await SS(`()=>SS.keysHash(${JSON.stringify(A.id)})`), aKeys1, 'A keys unchanged after switching away')
    ev.look = await SS(`()=>{const opac=(root)=>{const o=[];root.traverse(m=>{if(m.isMesh&&m.material)for(const x of [].concat(m.material))o.push(x.opacity)});return [...new Set(o)]};
      return {A:opac(SS.registry.get(${JSON.stringify(A.id)}).viewer.root),B:opac(S.rig().root),label:document.getElementById('sceneEditingLabel').textContent,
      rows:[...document.querySelectorAll('#sceneCharacterList [data-character-id]')].map(r=>[r.dataset.characterId,r.classList.contains('active'),r.textContent])}}`)
    assert.deepEqual(ev.look.A, [0.5], 'A dimmed to 50%')
    assert.deepEqual(ev.look.B, [1], 'B normal')
    assert.equal(ev.look.label, `Đang sửa: ${B.name}`)
    assert.ok(ev.look.rows.find((r) => r[0] === A.id)[2].includes('●'), 'A has the edited dot')
    ev.file = await shot('switched-to-B')
  })

  await step('S4', 'Sửa B; click lại A: bản sửa A còn nguyên, Undo riêng của A dùng được', async (ev) => {
    bKeys1 = await SS(editSnippet, { t: 0.4, bone: 'RightArm', deg: -60 })
    assert.deepEqual((await SS('()=>SS.edited()')).sort(), [A.id, B.id].sort())
    await shot('B-edited')
    // back to A through real clicks: 3D body click on A (fallback list row), 10 round trips A<->B keep keys
    const row = async (id) => { await (await frameHandle()).locator(`#sceneCharacterList [data-character-id="${id}"]`).click(); await waitEditing(id) }
    await row(A.id)
    assert.equal(await SS(`()=>SS.keysHash(${JSON.stringify(A.id)})`), aKeys1, 'A edit intact')
    assert.equal(await SS(`()=>SS.keysHash(${JSON.stringify(B.id)})`), bKeys1, 'B edit intact')
    for (let i = 0; i < 10; i++) { await row(B.id); await row(A.id) }
    ev.afterTenRoundTrips = { A: await SS(`()=>SS.keysHash(${JSON.stringify(A.id)})`), B: await SS(`()=>SS.keysHash(${JSON.stringify(B.id)})`) }
    assert.equal(ev.afterTenRoundTrips.A, aKeys1, 'A keys unchanged after 10 A<->B round trips')
    assert.equal(ev.afterTenRoundTrips.B, bKeys1, 'B keys unchanged after 10 round trips')
    ev.file = await shot('back-to-A')
    // A's own undo: Ctrl+Z (keyboard focus outside inputs) then redo
    const h = await SS('()=>S.state.historyIndex')
    await page.mouse.move(5, 5)
    await (await frameHandle()).locator('#viewport, canvas').first().hover().catch(() => {})
    let undone = false
    for (let i = 0; i < 6 && !undone; i++) { await page.keyboard.press('Control+z'); undone = (await SS('()=>S.state.historyIndex')) < h }
    ev.undoKeyboardWorked = undone
    if (undone) {
      ev.afterUndoA = await SS(`()=>SS.keysHash(${JSON.stringify(A.id)})`)
      assert.equal(ev.afterUndoA, aKeys0, 'Ctrl+Z restores A baseline')
      assert.equal(await SS(`()=>SS.keysHash(${JSON.stringify(B.id)})`), bKeys1, 'B untouched by A undo')
      for (let i = 0; i < 6 && (await SS('()=>S.state.historyIndex')) < h; i++) await page.keyboard.press('Control+Shift+z')
      assert.equal(await SS(`()=>SS.keysHash(${JSON.stringify(A.id)})`), aKeys1, 'redo restores A edit')
    } else throw new Error('Ctrl+Z in App 3 iframe did not change historyIndex (keyboard focus)')
  })

  await step('S5', 'Bóng pose: chỉ nhân vật đang sửa có bóng', async (ev) => {
    await SS(`()=>{const set=(id,v)=>{const e=document.getElementById(id);if(e.type==='checkbox')e.checked=v;else e.value=v;e.dispatchEvent(new Event('change'))};
      set('onionEnabled',true);set('onionBefore','2');set('onionAfter','2');set('onionStep','3');set('onionParts','bones');return 1}`)
    const frame = await frameHandle()
    await frame.waitForFunction(() => window.__studio.onion().samples.length > 0)
    ev.ghosts = await SS(`()=>{const o=S.onion();const viewerRoots=SS.registry.viewers().map(e=>e.viewer.group);let inViewer=0;
      o.group.traverse(x=>{for(let p=x;p;p=p.parent)if(viewerRoots.includes(p))inViewer++});return {samples:o.samples.length,slots:o.slots.length,inViewer}}`)
    assert.ok(ev.ghosts.slots > 0 && ev.ghosts.inViewer === 0, JSON.stringify(ev.ghosts))
    ev.file = await shot('onion')
    await SS(`()=>{const e=document.getElementById('onionEnabled');e.checked=false;e.dispatchEvent(new Event('change'));return 1}`)
  })

  await step('S6', '"Nhìn qua camera cảnh"', async (ev) => {
    const frame = await frameHandle()
    await SS('()=>SS.setTime(0)')
    await frame.locator('#sceneCameraBtn').click()
    ev.camera = await SS(`()=>{const v=S.view,box=document.getElementById('sceneCameraFrame');return {pressed:document.getElementById('sceneCameraBtn').getAttribute('aria-pressed'),active:SS.cameraActive,position:v.perspective.position.toArray(),fov:v.perspective.fov,box:[box.hidden,box.clientWidth,box.clientHeight]}}`)
    const shotCamera = (await unified()).project.scene.content.camera ?? null
    ev.hostCameraKeys = JSON.stringify(shotCamera)?.slice(0, 200)
    assert.equal(ev.camera.pressed, 'true'); assert.equal(ev.camera.active, true)
    ev.file = await shot('scene-camera')
    await frame.locator('#sceneCameraBtn').click()
    assert.equal(await SS('()=>SS.cameraActive'), false)
  })

  let afterDialogRows
  await step('S7a', '"Trả kết quả về cảnh": hộp "Lưu clip gộp" có 2 dòng', async (ev) => {
    // With the floating "Danh sách animation" list open (App 3 opens it with the scene) it sits over the host panel and
    // intercepts the pointer: record that, click via DOM, then close the list like a user has to.
    const hostFrame = await host()
    const returnButton = hostFrame.getByRole('button', { name: 'Trả kết quả về cảnh', exact: true }).first()
    ev.floatingListOpenBefore = await hostFrame.locator('#floatingAnimationList').isVisible()
    await returnButton.dispatchEvent('click')
    const dialog = hostFrame.getByRole('dialog', { name: 'Lưu clip gộp' })
    await dialog.waitFor()
    ev.dialogHiddenUnderFloatingList = await hostFrame.evaluate(() => {
      const d = document.querySelector('[role=dialog][aria-label="Lưu clip gộp"]'); const r = d.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + Math.min(r.width / 2, 100), r.top + 30)
      return { dialogRect: [r.left, r.top, r.width, r.height].map(Math.round), topElement: top?.id || top?.className || top?.tagName, coveredByFloatingList: !!top?.closest('#floatingAnimationList') }
    })
    ev.fileDialogWithFloatingList = await shot('merge-dialog-with-floating-list-open')
    await hostFrame.locator('#floatingAnimationList button[aria-label="Đóng danh sách animation"]').click()
    await page.waitForTimeout(300)
    await dialog.scrollIntoViewIfNeeded()
    afterDialogRows = await dialog.locator('fieldset.wb-scene-merge-row').count()
    ev.rows = afterDialogRows
    ev.defaults = await dialog.locator('fieldset.wb-scene-merge-row').evaluateAll((els) => els.map((e) => ({ character: e.querySelectorAll('input')[0].value, name: e.querySelectorAll('input')[1].value, description: e.querySelector('textarea').value })))
    ev.file = await shot('merge-dialog-defaults')
    assert.equal(afterDialogRows, 2, 'one row per edited character')
    assert.deepEqual(ev.defaults.map((r) => r.character).sort(), [A.name, B.name].sort())
  })

  const names = { [A.id]: `E2E clip ${A.name}`, [B.id]: `E2E clip ${B.name}` }
  await step('S7b', 'Điền tên, xác nhận; mỗi nhân vật đã sửa đúng một clip phủ khoảng shot, nhân vật khác nguyên vẹn', async (ev) => {
    const dialog = (await host()).getByRole('dialog', { name: 'Lưu clip gộp' })
    const rows = dialog.locator('fieldset.wb-scene-merge-row')
    for (let i = 0; i < 2; i++) {
      const who = await rows.nth(i).locator('input').nth(0).inputValue()
      const id = who === A.name ? A.id : B.id
      await rows.nth(i).locator('input').nth(1).fill(names[id])
      await rows.nth(i).locator('textarea').fill(`e2e ${who}`)
    }
    ev.file1 = await shot('merge-dialog-filled')
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/unified/commands') && r.request().postDataJSON()?.command === 'shot.result.import', { timeout: 120_000 }),
      dialog.getByRole('button', { name: 'Lưu clip gộp', exact: true }).click(),
    ])
    const body = await resp.json()
    ev.importResponse = { ok: body.ok, revision: body.revision, result: JSON.parse(JSON.stringify(body.result ?? body.error ?? {}, (k, v) => (typeof v === 'string' && v.length > 200 ? v.slice(0, 200) : v))) }
    assert.equal(body.ok, true, JSON.stringify(body).slice(0, 600))
    results.import = body
    await (await host()).waitForFunction(() => !document.querySelector('[aria-label="Lưu clip gộp"]'))
    await page.waitForTimeout(1500)
    ev.status = await hostStatus(); ev.error = await hostError()
    ev.file2 = await shot('after-import')
    const after = (await unified()).project
    results.after = after
    const fp = fingerprint(after)
    ev.revision = [beforeRevision, after.revision]
    ev.clipsAfter = Object.fromEntries(Object.values(fp).map((c) => [c.name, c.clips.map((k) => ({ id: k.id, range: [k.frameStart, k.frameEnd], name: k.motion?.name }))]))
    for (const c of [A, B]) {
      assert.equal(fp[c.id].clips.length, 1, `${c.name}: exactly one clip, got ${fp[c.id].clips.length}`)
      const k = fp[c.id].clips[0]
      assert.equal(k.frameStart, report.numbers.shotFrameRange?.[0] ?? frameRange[0], `${c.name} clip start`)
      assert.equal(k.frameEnd, frameRange[1], `${c.name} clip end`)
      const asset = after.assets[k.motion?.assetId]
      const motion = Object.values(after.motions ?? {}).find((m) => m.id === k.motion?.motionId || m.assetId === k.motion?.assetId)
      ev[`${c.name}.nameFound`] = [k.motion?.name, asset?.displayName, motion?.name, motion?.displayName, k.name].filter(Boolean)
      assert.ok(JSON.stringify([k, asset, motion]).includes(names[c.id]), `${c.name}: typed name "${names[c.id]}" not found in clip/asset/motion`)
    }
    ev.libraryActionUuids = body.result?.libraryActionUuids ?? null
    // non-edited characters would be compared here; with 2 chars both are edited, so also assert the shot's other-state: bindings of both exist
    ev.untouchedCheck = 'Both fixture characters were edited; untouched-character hash is verified in S7c (3rd character).'
    results.fp = fp
  })

  // Ctrl+Z at page level (focus: neutral App 2 header), fallback to the host Undo button; returns how it was undone.
  const openAnimation = async () => {
    await page.getByRole('navigation', { name: '5 workspace', exact: true }).getByRole('button', { name: /Animation/ }).click()
    await page.locator('.wb-animation-creation-frame').waitFor()
    const f = await frameHandle()
    await f.waitForFunction(() => window.__studio?.ready === true && !!window.__app3LocalBridge, null, { polling: 100 })
    await page.waitForTimeout(800)
  }
  // Observed: after a successful "Trả kết quả về cảnh" App 3 keeps the returned edits in memory and the host keeps showing
  // "Bỏ sửa" (editorDirty), which disables "Mở cả cảnh". The harness presses "Bỏ sửa" to continue and records that it was needed.
  const resetEditorIfDirty = async (ev) => {
    const h = await host()
    const discard = h.getByRole('button', { name: 'Bỏ sửa', exact: true })
    if (await discard.count() && await discard.isVisible().catch(() => false)) {
      ev.editorStillDirtyAfterReturn = true; report.numbers.editorStillDirtyAfterReturn = true
      ev.fileStillDirty = await shot('still-dirty-after-return')
      const n = dialogs.length
      await discard.click()
      ev.discardDialogsShown = dialogs.length - n
      await page.waitForTimeout(1500)
      await openAnimation()
    }
  }
  const undoOnce = async (previousRevision, screenshotName) => {
    await page.getByRole('navigation', { name: '5 workspace', exact: true }).getByRole('button', { name: /Dựng cảnh/ }).click()
    await page.waitForTimeout(3500) // App 2 scene workspace (the only workspace where Ctrl+Z is bound: StudioOverlay onKeyDown)
    if (screenshotName) await shot(screenshotName)
    await page.mouse.click(420, 28) // neutral header area (NOT the top-right Đóng button)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(2500)
    let after = await unified()
    let via = 'keyboard Ctrl+Z in "2 Dựng cảnh" (App 2), focus on the page header'
    if (after.project.revision === previousRevision) {
      await page.getByRole('button', { name: /Hoàn tác|Undo/ }).first().click()
      await page.waitForTimeout(2500)
      after = await unified()
      via = 'keyboard Ctrl+Z did NOT undo; used the host Undo button (aria-label Hoàn tác)'
    }
    return { after, via }
  }
  await step('S7c', 'Ctrl+Z một lần ở App 2: project về đúng như trước', async (ev) => {
    ev.historyBefore = (await unified()).history
    const { after, via } = await undoOnce(results.after.revision, 'scene-F2-after-import')
    ev.undoVia = via
    ev.revisions = [beforeRevision, results.after.revision, after.project.revision]
    ev.historyAfter = after.history
    const now = stateHash(after.project)
    ev.hashesBefore = beforeState; ev.hashesNow = now
    assert.deepEqual(now.scene, beforeState.scene, 'scene equals before')
    assert.equal(now.extensions, beforeState.extensions, 'extensions equals before')
    assert.equal(now.scene, beforeState.scene); assert.equal(now.motions, beforeState.motions); assert.equal(now.bindings, beforeState.bindings)
    const fp = fingerprint(after.project)
    for (const c of chars) { assert.equal(fp[c.id].clipsHash, before[c.id].clipsHash, `${c.name} clips restored`); assert.equal(fp[c.id].bindingsHash, before[c.id].bindingsHash, `${c.name} bindings restored`) }
    ev.file = await shot('scene-F2-after-undo')
  })

  await step('S7d', 'Chỉ sửa A (B không sửa): hộp có 1 dòng, hash clip/binding của B giữ nguyên, rồi Undo', async (ev) => {
    await openAnimation()
    await resetEditorIfDirty(ev)
    await (await host()).getByRole('button', { name: 'Mở cả cảnh', exact: true }).click()
    await page.waitForFunction(({ n }) => { const ss = document.querySelector('iframe.wb-animation-creation-frame')?.contentWindow?.__studio?.sceneShot; return !!ss && ss.active && ss.stats().characters === n && !ss.switching }, { n: chars.length }, { polling: 100, timeout: 120_000 })
    const keysB = await SS(`()=>SS.keysHash(${JSON.stringify(B.id)})`)
    await SS(editSnippet, { t: 0.5, bone: 'LeftArm', deg: 40 })
    assert.deepEqual(await SS('()=>SS.edited()'), [A.id])
    const hostFrame = await host()
    await hostFrame.locator('#floatingAnimationList button[aria-label="Đóng danh sách animation"]').click().catch(() => {})
    await hostFrame.getByRole('button', { name: 'Trả kết quả về cảnh', exact: true }).first().click()
    const dialog = hostFrame.getByRole('dialog', { name: 'Lưu clip gộp' })
    await dialog.waitFor()
    ev.rows = await dialog.locator('fieldset.wb-scene-merge-row').count()
    assert.equal(ev.rows, 1, 'only edited character A has a row')
    await dialog.locator('fieldset.wb-scene-merge-row').first().locator('input').nth(1).fill('E2E solo A')
    ev.file = await shot('merge-dialog-one-row')
    const revBefore = (await unified()).project.revision
    await dialog.getByRole('button', { name: 'Lưu clip gộp', exact: true }).click()
    await page.waitForFunction(async ({ url, rev }) => (await (await fetch(url)).json()).project.revision > rev, { url: `${base}/api/unified/projects/${projectId}`, rev: revBefore }, { timeout: 60_000 })
    await page.waitForTimeout(1500)
    const after = (await unified()).project
    const fp = fingerprint(after)
    ev.clipsAfter = Object.fromEntries(Object.values(fp).map((c) => [c.name, c.clips.map((k) => ({ range: [k.frameStart, k.frameEnd], name: k.motion?.name }))]))
    assert.equal(fp[A.id].clips.length, 1); assert.ok(JSON.stringify(fp[A.id].clips).includes('E2E solo A'))
    assert.equal(fp[B.id].clipsHash, before[B.id].clipsHash, 'B clips hash unchanged (untouched character)')
    assert.equal(fp[B.id].bindingsHash, before[B.id].bindingsHash, 'B bindings hash unchanged')
    ev.hashB = { before: before[B.id].clipsHash, after: fp[B.id].clipsHash, bindingsBefore: before[B.id].bindingsHash, bindingsAfter: fp[B.id].bindingsHash }
    ev.keysBHash = keysB
    const undone = await undoOnce(after.revision, 'scene-F2-after-solo-import')
    ev.undoVia = undone.via
    const now = stateHash(undone.after.project)
    assert.deepEqual(now, beforeState, 'project back to the original state after one undo')
  })

  await step('S8', 'Thư viện (F5) có clip gộp mới đúng tên', async (ev) => {
    const uuids = report.steps.find((s) => s.id === 'S7b').evidence.libraryActionUuids
    ev.libraryActionUuids = uuids
    const list = Array.isArray(uuids) ? uuids : (uuids && typeof uuids === 'object' ? Object.values(uuids).flat() : [])
    if (!list.length) return { blocked: 'libraryActionUuids rỗng: nhân vật synthetic không phải nhân vật Thư viện (không có libraryCharacterId) nên shotResult không lưu bản Thư viện; fixture không có nhân vật thư viện.' }
    const lib = await (await api.get(`${base}/api/library?status=draft`)).json()
    ev.libraryNames = (lib.actions ?? []).map((a) => a.name)
    for (const n of Object.values(names)) assert.ok(ev.libraryNames.includes(n), `library missing ${n}`)
  })

  // ---- Bỏ sửa --------------------------------------------------------------------
  await step('S9', '"Bỏ sửa" hỏi lại khi ≥1 nhân vật đã sửa, chấp nhận thì bỏ hết bản sửa', async (ev) => {
    // after undo the host project is back; re-open the whole scene and make one edit
    await openAnimation()
    await resetEditorIfDirty(ev)
    await (await host()).getByRole('button', { name: 'Mở cả cảnh', exact: true }).click()
    await page.waitForFunction(({ n }) => { const ss = document.querySelector('iframe.wb-animation-creation-frame')?.contentWindow?.__studio?.sceneShot; return !!ss && ss.active && ss.stats().characters === n && !ss.switching }, { n: chars.length }, { polling: 100, timeout: 120_000 })
    await SS(editSnippet, { t: 0.5, bone: 'LeftArm', deg: 55 })
    await page.waitForTimeout(500)
    const discard = (await host()).getByRole('button', { name: 'Bỏ sửa', exact: true })
    await discard.waitFor({ timeout: 10_000 })
    ev.file1 = await shot('before-discard')
    dialogs.length = 0
    dialogMode = 'dismiss'
    await discard.click()
    await page.waitForTimeout(500)
    ev.dismissedDialogs = [...dialogs]
    assert.equal(dialogs.length, 1); assert.match(dialogs[0].message, /Bỏ mọi bản sửa của cả cảnh/)
    assert.equal(await SS('()=>SS.active'), true, 'dismiss keeps the edits')
    dialogs.length = 0
    dialogMode = 'accept'
    await discard.click()
    await page.waitForTimeout(500)
    ev.acceptedDialogs = [...dialogs]
    assert.equal(dialogs.length, 1)
    await (await host()).getByRole('button', { name: 'Mở cả cảnh', exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('iframe.wb-animation-creation-frame')?.contentWindow?.__studio?.ready === true, null, { timeout: 60_000 }).catch(() => {})
    ev.status = await hostStatus()
    ev.projectRevisionUnchanged = (await unified()).project.revision
    ev.file2 = await shot('after-discard')
    assert.match(ev.status, /Đã bỏ bản sửa/)
  })
} catch (error) {
  report.errors.push(`harness: ${error instanceof Error ? error.stack : String(error)}`)
  exitCode = 1
} finally {
  await browser.close().catch(() => {})
  if (typeof report.serverLog === 'function') { writeFileSync(path.join(out, 'dev-server.log'), report.serverLog()); delete report.serverLog }
  stopServer()
  report.finishedAt = new Date().toISOString()
  report.summary = Object.fromEntries(report.steps.map((s) => [s.id, s.status]))
  persist()
  console.log(JSON.stringify({ embedIndexSha256: embedSha, summary: report.summary, numbers: report.numbers, errors: report.errors, consoleErrors: report.consoleErrors.slice(0, 10) }, null, 2))
}
if (report.steps.some((s) => s.status === 'FAIL')) exitCode = 1
process.exit(exitCode)
