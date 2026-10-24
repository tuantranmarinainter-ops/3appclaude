import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, statSync, readFileSync, writeFileSync, cpSync } from 'node:fs'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const base = process.env.C1_BASE_URL ?? 'http://127.0.0.1:3003'
const projectId = randomUUID()
const projectsDir = process.env.BBS_UNIFIED_PROJECTS_DIR
assert.ok(projectsDir, 'BBS_UNIFIED_PROJECTS_DIR must point to a QA COPY')
assert.ok(!/w01-library/i.test(projectsDir), 'Original library is forbidden')
const qaRoot = fileURLToPath(new URL('../../../../../qa-c1/', import.meta.url))
const relative = path.relative(qaRoot, path.resolve(projectsDir))
assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Projects directory must be inside this worktree qa-c1/')
const seedDir = process.env.C1_FIXTURE_PROJECT_DIR
assert.ok(seedDir, 'C1_FIXTURE_PROJECT_DIR must identify the read-only fixture project directory')
const seed = JSON.parse(readFileSync(path.join(seedDir, 'project.json'), 'utf8'))
const targetDir = path.join(projectsDir, projectId)
mkdirSync(targetDir, { recursive: false })
for (const name of ['assets', 'originals']) cpSync(path.join(seedDir, name), path.join(targetDir, name), { recursive: true })
const cloned = JSON.parse(JSON.stringify(seed).replaceAll(seed.projectId, projectId))
cloned.revision = 0
cloned.motions = {}
cloned.bindings = {}
cloned.scene.content.timeline.animation.motionClips = []
writeFileSync(path.join(targetDir, 'project.json'), JSON.stringify(cloned, null, 2) + '\n')
const evidence = process.env.C1_EVIDENCE_DIR ?? fileURLToPath(new URL('../../../../../qa-c1/evidence', import.meta.url))
mkdirSync(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'vi-VN' })
const page = await context.newPage()
page.setDefaultTimeout(30_000)
const errors = []
const runEvidence = { projectId, base }
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })

const api = (url, options = {}) => page.evaluate(async ({ url, options }) => {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } })
  return { status: response.status, body: await response.json() }
}, { url, options })

try {
  const session = await context.request.post(`${base}/api/unified/session`, { headers: { Origin: base } })
  assert.equal(session.status(), 200, await session.text())
  await page.goto(`${base}/?unified=${projectId}`)
  await page.locator('[role="dialog"][aria-label="Dự án hợp nhất"]').waitFor()
  const beforeResponse = await api(`${base}/api/unified/projects/${projectId}`)
  assert.equal(beforeResponse.status, 200, JSON.stringify(beforeResponse.body))
  let fixture = beforeResponse.body.project
  assert.equal(Object.keys(fixture.characters).length, 3, 'Expected copied Hero + Gỗ Xưa + Đen project')
  const prepare = async (command, args) => {
    const response = await api(`${base}/api/unified/commands`, { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), projectId, expectedRevision: fixture.revision, command, args }) })
    assert.equal(response.body.ok, true, JSON.stringify(response.body))
    fixture = (await api(`${base}/api/unified/projects/${projectId}`)).body.project
  }
  const owners = Object.values(fixture.characters).map(actor => {
    const charId = fixture.scene.content.nodes.find(node => node.id === actor.nodeId)?.metadata?.libraryCharacterId
    assert.ok(charId, `No library owner for ${actor.name}`)
    return charId
  })
  const document = structuredClone(fixture.scene)
  document.content.nodes = document.content.nodes.filter(node => node.type !== 'character')
  document.content.timeline.animation.motionClips = []
  await prepare('scene.apply', { operations: [{ type: 'document.replace', document }] })
  // Re-add from the current library: old seed Characters may still reference pre-L3 mannequin assets.
  for (const charId of owners) {
    const added = await api(`${base}/api/library`, { method: 'POST', body: JSON.stringify({ operation: 'add-to-scene', projectId, expectedRevision: fixture.revision, charId }) })
    assert.equal(added.status, 200, JSON.stringify(added.body))
    fixture = (await api(`${base}/api/unified/projects/${projectId}`)).body.project
  }
  assert.equal(Object.keys(fixture.characters).length, 3)
  runEvidence.libraryDrafts = []
  for (const actor of Object.values(fixture.characters)) {
    const node = fixture.scene.content.nodes.find(n => n.id === actor.nodeId)
    const charId = node.metadata?.libraryCharacterId
    assert.ok(charId, `No library owner for ${actor.name}`)
    const library = await api(`${base}/api/library?charId=${encodeURIComponent(charId)}&status=draft`)
    assert.equal(library.status, 200, JSON.stringify(library.body))
    const action = library.body.actions.find(a => a.ownerCharId === charId && a.version === 1 && a.status === 'draft')
    assert.ok(action, `No owned v1 library draft for ${actor.name}`)
    await prepare('library.place', { characterId: actor.id, actionUuid: action.uuid })
    runEvidence.libraryDrafts.push({ characterId: actor.id, ownerCharId: charId, actionUuid: action.uuid })
  }
  for (const actor of Object.values(fixture.characters)) {
    const clips = fixture.scene.content.timeline.animation.motionClips.filter(c => c.target.nodeId === actor.nodeId)
    assert.equal(clips.length, 1, `Expected one clip for ${actor.name}`)
    const binding = fixture.bindings[clips[0].id]
    await prepare('motion.binding.set', { binding, clipPatch: { frameStart: 0, frameEnd: 300, playback: { speed: 1, loop: true } } })
  }
  await page.reload()
  await page.locator('[role="dialog"][aria-label="Dự án hợp nhất"]').waitFor()
  const before = fixture
  const character = Object.values(before.characters).find((item) => item.name.startsWith(process.env.C1_EDIT_CHARACTER ?? 'Gỗ Xưa'))
  assert.ok(character, 'Gỗ Xưa is missing from copied project')
  const originalClip = before.scene.content.timeline.animation.motionClips.find((clip) => clip.target.nodeId === character.nodeId)
  assert.ok(originalClip, 'Gỗ Xưa has no copied timeline clip')
  const originalBinding = before.bindings[originalClip.id]
  assert.ok(originalBinding, 'Gỗ Xưa has no copied binding')
  const baseline = { revision: before.revision, characterId: character.id, motionId: originalBinding.motionId, clipId: originalClip.id, range: [originalClip.frameStart, originalClip.frameEnd] }

  const oldNav = page.locator('nav[aria-label="Chế độ biên tập trong App 2"]')
  const legacyNavigation = await oldNav.count() > 0
  const workspaceNav = legacyNavigation ? oldNav : page.locator('nav[aria-label="5 workspace"]')
  runEvidence.navigation = legacyNavigation ? 'legacy keyboard' : 'C7 mouse click'
  const animationTab = workspaceNav.getByRole('button', { name: /Animation/ })
  if (legacyNavigation) { await animationTab.focus(); await animationTab.press('Enter') }
  else await animationTab.click()
  await page.waitForFunction(() => document.querySelector('nav[aria-label="Chế độ biên tập trong App 2"] button[aria-current="page"], nav[aria-label="5 workspace"] button[aria-current="page"]')?.textContent?.includes('Animation'))
  const panel = page.locator('.wb-animation-creation')
  await panel.waitFor()
  await panel.locator('select').nth(0).selectOption(character.id)
  const motionSelect = panel.locator('select').nth(1)
  await motionSelect.selectOption(originalBinding.motionId)
  const shotToolbar = panel.locator('header[aria-label="Shot từ cảnh"]')
  const inputs = shotToolbar.locator('input[type="number"]')
  await inputs.nth(0).fill(String(baseline.range[0]))
  await inputs.nth(1).fill(String(baseline.range[1]))
  const [shotExportResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/unified/commands') && response.request().postDataJSON()?.command === 'shot.export'),
    shotToolbar.getByRole('button', { name: 'Mở shot từ cảnh' }).click(),
  ])
  const shotExportBody = await shotExportResponse.json()
  assert.equal(shotExportBody.ok, true, JSON.stringify(shotExportBody))
  const shotId = String(shotExportBody.result.shotId)
  const shotFrame = page.frame({ url: /animation-studio\/v1\.\d+\.\d+\/index\.html/ })
  assert.ok(shotFrame, 'App3 iframe did not load')
  const sourceShot = JSON.parse(readFileSync(path.join(projectsDir, projectId, '.shots', `${shotId}.json`), 'utf8')).shot
  assert.equal(sourceShot.characters.length, 3, 'Shot must contain all three actors')
  assert.deepEqual(sourceShot.frameRange, [0, 300])
  assert.deepEqual(sourceShot.characters.map(c => c.characterId).sort(), Object.keys(before.characters).sort())
  runEvidence.shot = { shotId, actorCount: sourceShot.characters.length, frameRange: sourceShot.frameRange, actors: sourceShot.characters.map(c => ({ characterId: c.characterId, editable: c.editable })) }
  await shotFrame.waitForFunction(() => window.__studio?.ready === true)
  console.log('IFRAME_READY')
  await page.getByText(/Đã mở shot/).waitFor()
  console.log('SHOT_OPEN')
  await page.screenshot({ path: `${evidence}/c1-roundtrip-app3-open.png`, fullPage: true })
  const bone = (await shotFrame.evaluate(() => window.__studio.recordNames())).find((item) => /spine|chest|hips/i.test(item.name))
  assert.ok(bone, 'App3 did not expose an editable bone')
  const edit = await shotFrame.evaluate((boneId) => {
    const studio = window.__studio
    studio.seek(1 / 30)
    const beforeKeys = JSON.stringify(studio.project().keys)
    studio.selectUser(boneId, false)
    const rotation = document.getElementById('rx')
    rotation.value = '18'
    rotation.dispatchEvent(new Event('change', { bubbles: true }))
    document.getElementById('keyBtn').click()
    return { boneId, changed: beforeKeys !== JSON.stringify(studio.project().keys), boneName: studio.recordNames().find(b => b.id === boneId).name, keyAtEdit: studio.project().keys[boneId]?.find(k => Math.abs(k.t - 1 / 30) < 1e-6), keyCount: Object.values(studio.project().keys).reduce((total, keys) => total + keys.length, 0) }
  }, bone.id)
  assert.equal(edit.changed, true, 'The one-frame edit must change recorded keys')
  assert.ok(edit.keyCount > 0, 'App3 did not record the one-frame edit')
  const saveButton = page.getByRole('button', { name: 'Lưu vào project' })
  runEvidence.edit = edit
  console.log('EDIT', JSON.stringify({ boneId: edit.boneId, changed: edit.changed, keyCount: edit.keyCount }))
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('Lưu vào project'))
    return button instanceof HTMLButtonElement && !button.disabled
  }, null, { timeout: 10000 })
  assert.equal(await saveButton.isDisabled(), false, 'Shot save button stayed disabled after shotOpen')
  const savedResponse = page.waitForResponse(response => response.url().endsWith(`/api/unified/projects/${projectId}/shots/${shotId}/draft`) && response.request().method() === 'POST', { timeout: 35000 })
  const saveError = panel.getByRole('alert').waitFor({ state: 'visible', timeout: 35000 }).then(async () => { throw new Error(await panel.getByRole('alert').innerText()) })
  await saveButton.click()
  const draftSaveResponse = await Promise.race([savedResponse, saveError])
  console.log('DRAFT_RESPONSE', draftSaveResponse.status())
  assert.equal(draftSaveResponse.status(), 200, await draftSaveResponse.text())
  const draftSaveBody = await draftSaveResponse.json()
  assert.equal(draftSaveBody.shotId, shotId)
  console.log('DRAFT_BODY', JSON.stringify(draftSaveBody))
  const draftReload = await page.evaluate(async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
    const bytes = new Uint8Array(await response.arrayBuffer()); return { status: response.status, byteLength: bytes.length, sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('') }
  }, `${base}/api/unified/projects/${projectId}/shots/${shotId}/draft`)
  console.log('DRAFT_READBACK', JSON.stringify(draftReload))
  assert.equal(draftReload.status, 200, JSON.stringify(draftReload))
  assert.ok(draftReload.byteLength > 0, 'Persisted shot draft ZIP is empty')
  const draftPath = path.join(projectsDir, projectId, '.shots', `${shotId}.draft.zip`)
  assert.ok(statSync(draftPath).size > 0, `Persisted shot draft ZIP is missing: ${draftPath}`)
  assert.equal(draftReload.sha256, createHash('sha256').update(readFileSync(draftPath)).digest('hex'), 'Readback differs from durable ZIP')
  assert.equal(draftSaveBody.sha256, draftReload.sha256)
  await page.getByText(/Đã lưu bản chỉnh của shot vào project/).waitFor()
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/unified/commands') && response.request().postDataJSON()?.command === 'shot.result.import'),
    shotToolbar.getByRole('button', { name: 'Trả kết quả về cảnh' }).click(),
  ])
  console.log('RETURN_RESPONSE')
  const afterResponse = await api(`${base}/api/unified/projects/${projectId}`)
  assert.equal(afterResponse.status, 200, JSON.stringify(afterResponse.body))
  const after = afterResponse.body.project
  for (const [id, binding] of Object.entries(before.bindings)) {
    if (id !== originalClip.id) assert.deepEqual(after.bindings[id], binding, 'Reference actor binding changed')
  }
  const afterBinding = after.bindings[originalClip.id]
  assert.ok(afterBinding, 'Returned clip binding is missing')
  assert.notEqual(afterBinding.motionId, baseline.motionId, 'Returned shot did not create a new Motion')
  assert.equal(after.revision, baseline.revision + 1, 'Roundtrip should commit exactly one project revision')
  const evaluatedResponse = await api(`${base}/api/unified/commands`, { method: 'POST', headers: { Origin: base }, body: JSON.stringify({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: Math.min(baseline.range[0] + 30, baseline.range[1]) } }) })
  assert.equal(evaluatedResponse.body.ok, true, JSON.stringify(evaluatedResponse.body))
  assert.ok(!evaluatedResponse.body.result.issues.some((issue) => issue.code === 'SKELETON_EVALUATION_UNAVAILABLE'), JSON.stringify(evaluatedResponse.body.result.issues))
  const sceneTab = workspaceNav.getByRole('button', { name: /Dựng cảnh|Scene/ })
  if (legacyNavigation) { await sceneTab.focus(); await sceneTab.press('Enter') }
  else await sceneTab.click()
  await page.waitForFunction(() => window.__store?.getState().ready === true)
  const playbackBefore = await page.evaluate(() => { const s = window.__store.getState(); s.setFrame(0); s.togglePlay(); return s.frame })
  await page.waitForFunction((before) => window.__store.getState().frame > before, playbackBefore)
  const playbackAfter = await page.evaluate(() => { const s = window.__store.getState(); if (s.playing) s.togglePlay(); return s.frame })
  assert.ok(playbackAfter > playbackBefore, 'App2 playback frame did not advance')
  await page.screenshot({ path: `${evidence}/c1-roundtrip-app2-returned.png`, fullPage: true })
  assert.deepEqual(errors, [], 'Browser errors during the authenticated roundtrip')
  const report = { ...runEvidence, pass: true, shot: { actorCount: sourceShot.characters.length, frameRange: sourceShot.frameRange }, durableDraft: { ...draftReload, path: draftPath }, playback: { before: playbackBefore, after: playbackAfter }, baseline, after: { revision: after.revision, motionId: afterBinding.motionId }, edit, evaluatedIssues: evaluatedResponse.body.result.issues, errors }
  writeFileSync(`${evidence}/c1-roundtrip-report.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} catch (error) {
  const hostState = await page.locator('.wb-animation-creation').innerText().catch(() => 'panel missing')
  console.error('HOST_STATE', hostState)
  writeFileSync(`${evidence}/c1-failure-report.json`, JSON.stringify({ ...runEvidence, pass: false, error: error.message, hostState, errors }, null, 2) + '\n')
  await page.screenshot({ path: `${evidence}/c1-failure.png`, fullPage: true }).catch(() => {});
  throw error
} finally {
  await browser.close()
}
