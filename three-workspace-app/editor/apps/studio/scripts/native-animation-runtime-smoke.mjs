import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'
import { AnimationMixer } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const base = process.env.STUDIO_URL
const fixture = process.env.BBS_TEST_MIXAMO_FBX
const storage = process.env.BBS_UNIFIED_PROJECTS_DIR
if (!base || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname) || !fixture || !storage || process.env.SMOKE_ISOLATED_STORAGE !== '1') {
  throw new Error('Set loopback STUDIO_URL, BBS_TEST_MIXAMO_FBX, BBS_UNIFIED_PROJECTS_DIR and SMOKE_ISOLATED_STORAGE=1.')
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' })
const page = await context.newPage()
page.setDefaultTimeout(60_000)
const errors = []
const motionGlbResponses = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('response', (response) => { if (new URL(response.url()).searchParams.get('format') === 'glb') motionGlbResponses.push(response.status()) })

async function command(name, action) {
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url().endsWith('/api/unified/commands') && item.request().postDataJSON()?.command === name, { timeout: 20_000 }),
    action(),
  ])
  const body = await response.json()
  assert.equal(body.ok, true, JSON.stringify(body))
  return body
}

try {
  await page.goto(base)
  await page.locator('.wb-hero-actions .wb-cta').click()
  const dialog = page.locator('.wb-dialog')
  await dialog.getByLabel('Name', { exact: true }).fill('Native Animation Runtime Demo')
  const created = await command('project.create', () => dialog.getByRole('button', { name: /Tạo và mở|Create and open/ }).click())
  const projectId = created.projectId
  await page.waitForURL((url) => url.searchParams.has('unified'))
  const workspaces = page.getByRole('navigation', { name: 'Workspaces' })
  await workspaces.waitFor()

  await workspaces.getByRole('button', { name: /1 Standardize/ }).click()
  await page.locator('.wb-retarget-preview input[type=file]').setInputFiles(fixture)
  const saveSource = page.getByRole('button', { name: /Save source motion to project|Lưu nguồn vào dự án/ })
  await saveSource.waitFor()
  const imported = await command('asset.import', () => saveSource.click())
  const assetId = imported.result.assetIds[0]
  await page.getByRole('button', { name: /Assets|Tài nguyên/ }).click()
  const assetRow = page.locator('.wb-unified-asset').filter({ hasText: /T-Pose/i })
  await assetRow.waitFor()
  const added = await command('character.add', () => assetRow.getByRole('button', { name: /Nhân vật|character/i }).click())
  const projectAfterCharacter = await context.request.get(`${base}/api/unified/projects/${projectId}`).then((response) => response.json())
  assert.ok(projectAfterCharacter.project.characters[added.result.characterId], 'Character was not persisted')
  console.log('character added')
  await page.locator('.wb-drawer').getByRole('button', { name: /Close panel|Đóng bảng/ }).click()
  console.log('asset drawer closed')

  await workspaces.getByRole('button', { name: /3 Animation/ }).click()
  console.log('animation selected')
  await page.locator('.wb-animation-creation-frame').waitFor()
  const frame = page.frame({ url: /animation-studio\/v1\.31\.8\/index\.html/ })
  assert.ok(frame, 'Native editor iframe did not load')
  await frame.waitForFunction(() => window.__studio?.ready === true)
  const initialViewportWidth = await frame.evaluate(() => window.__studio.view.container.clientWidth)
  await page.setViewportSize({ width: 1280, height: 900 })
  await frame.waitForFunction((width) => window.__studio.view.container.clientWidth < width && window.__studio.view.renderer.domElement.width > 0, initialViewportWidth)
  const resizedViewportWidth = await frame.evaluate(() => window.__studio.view.container.clientWidth)
  assert.ok(resizedViewportWidth < initialViewportWidth, 'Native editor viewport did not resize with the host')
  await page.setViewportSize({ width: 1600, height: 1000 })
  const rendererLifecycle = await frame.evaluate(async () => {
    const nativeRequestAnimationFrame = window.requestAnimationFrame
    window.__hostRafSchedules = 0
    window.requestAnimationFrame = function (callback) { window.__hostRafSchedules++; return nativeRequestAnimationFrame.call(window, callback) }
    await new Promise((resolve) => setTimeout(resolve, 120))
    window.__studio.setHostActive(false)
    const stoppedAt = window.__hostRafSchedules
    await new Promise((resolve) => setTimeout(resolve, 120))
    const stopped = window.__hostRafSchedules === stoppedAt
    window.__studio.setHostActive(true)
    await new Promise((resolve) => setTimeout(resolve, 120))
    return { stopped, resumed: window.__hostRafSchedules > stoppedAt }
  })
  assert.ok(rendererLifecycle.stopped && rendererLifecycle.resumed, `Hidden iframe renderer did not pause/resume: ${JSON.stringify(rendererLifecycle)}`)
  const selectInfo = await frame.locator('#bbsHostControls .wb-animation-creation-toolbar select').first().evaluate((select) => ({ disabled: select.disabled, options: [...select.options].map((option) => ({ text: option.text, value: option.value })) }))
  console.log('native character selector', JSON.stringify(selectInfo), 'project characters', Object.keys(projectAfterCharacter.project.characters))
  await frame.locator('#bbsHostControls .wb-animation-creation-toolbar select').first().selectOption(added.result.characterId)
  await frame.getByRole('button', { name: 'Tạo animation' }).click()
  await frame.waitForFunction(() => window.__studio?.ready === true && window.__studio.recordNames().length > 10 && document.getElementById('status')?.textContent.includes('T-Pose.fbx'))
  const native = await frame.evaluate(() => {
    const studio = window.__studio
    const project = studio.project()
    project.name = 'Runtime Demo Motion'
    project.duration = 3
    project.fps = 30
    return { project, bones: studio.recordNames() }
  })
  assert.ok(native.bones.length > 10, 'The selected Character rig did not load')
  const poseBone = native.bones.find((bone) => /spine/i.test(bone.name)) ?? native.bones[1]
  const poseEdit = await frame.evaluate(async ({ project, boneId }) => {
    const studio = window.__studio
    await studio.loadProject(project)
    studio.selectUser(boneId, false)
    studio.seek(0)
    document.getElementById('keyBtn').click()
    studio.seek(3)
    studio.selectUser(boneId, false)
    const beforePose = studio.pose()[boneId]
    const rotation = document.getElementById('rx')
    rotation.value = '35'
    rotation.dispatchEvent(new Event('change', { bubbles: true }))
    const afterPose = studio.pose()[boneId]
    document.getElementById('keyBtn').click()
    return { rotationDisabled: rotation.disabled, beforePose, afterPose, selected: studio.state.selected, mode: studio.state.mode }
  }, { project: native.project, boneId: poseBone.id })
  assert.equal(poseEdit.rotationDisabled, false, 'Selected spine rotation control is disabled')
  assert.equal(poseEdit.selected, poseBone.id, 'Native editor did not keep the selected bone active')
  assert.ok(Math.abs(poseEdit.beforePose.q.reduce((sum, value, index) => sum + value * poseEdit.afterPose.q[index], 0)) < 0.999, 'The bone rotation did not change from its prior pose')
  const keyed = await frame.evaluate(() => Object.values(window.__studio.project().keys).reduce((count, keys) => count + keys.length, 0))
  assert.ok(keyed > 0, 'Native editor did not create animation keys')
  const afterUndo = await frame.evaluate(() => { document.getElementById('undoBtn').click(); return Object.values(window.__studio.project().keys).reduce((count, keys) => count + keys.length, 0) })
  assert.ok(afterUndo < keyed, `Native editor Undo did not restore the earlier keyframe state: ${afterUndo}/${keyed}`)
  const afterRedo = await frame.evaluate(() => { document.getElementById('redoBtn').click(); return Object.values(window.__studio.project().keys).reduce((count, keys) => count + keys.length, 0) })
  assert.equal(afterRedo, keyed, 'Native editor Redo did not restore the keyframe state')
  await page.getByRole('button', { name: 'Bỏ sửa' }).waitFor()
  await workspaces.getByRole('button', { name: /2 Scene/ }).click()
  await page.waitForTimeout(250)
  await workspaces.getByRole('button', { name: /3 Animation/ }).click()
  try { await frame.waitForFunction((count) => window.__studio?.ready === true && Object.values(window.__studio.project().keys).reduce((total, keys) => total + keys.length, 0) === count, keyed, { timeout: 5_000 }) }
  catch (error) { console.log('workspace draft diagnostic', JSON.stringify({ frames: page.frames().map((item) => item.url()), native: await frame.evaluate(() => ({ ready: window.__studio?.ready, keys: Object.values(window.__studio.project().keys).reduce((total, keys) => total + keys.length, 0), status: document.getElementById('status')?.textContent })), host: await page.locator('.wb-animation-creation').innerText() })); throw error }
  const afterWorkspaceSwitch = await frame.evaluate(() => Object.values(window.__studio.project().keys).reduce((count, keys) => count + keys.length, 0))
  assert.equal(afterWorkspaceSwitch, keyed, 'Switching workspaces discarded the native animation draft')
  await page.getByRole('button', { name: 'Bỏ sửa' }).waitFor()
  const [closeMessage] = await Promise.all([
    page.waitForEvent('dialog').then(async (dialog) => { const message = dialog.message(); await dialog.dismiss(); return message }),
    page.locator('.wb-unified-close').click(),
  ])
  assert.match(closeMessage, /unsaved|chưa lưu/i, 'Closing the project did not explain that native animation edits are unsaved')
  const beforeUnloadPrompt = page.waitForEvent('dialog').then(async (dialog) => { const type = dialog.type(); await dialog.dismiss(); return type })
  const canceledReload = page.reload().catch(() => null)
  const beforeUnloadType = await beforeUnloadPrompt
  await canceledReload
  assert.equal(beforeUnloadType, 'beforeunload', 'A dirty native animation did not guard browser reload/close')

  let saved
  try { saved = await command('motion.edit', () => frame.getByRole('button', { name: 'Lưu vào project' }).click()) }
  catch (error) {
    console.log('save panel', await page.locator('.wb-animation-creation').innerText())
    console.log('native state', await frame.evaluate(() => ({ draft: window.__studio.state.draft, sourceClip: window.__studio.state.sourceClip, dirty: window.__studio.state.dirty, selected: window.__studio.state.selected, mode: window.__studio.state.mode, keys: Object.values(window.__studio.project().keys).reduce((count, keys) => count + keys.length, 0), status: document.getElementById('status')?.textContent })))
    throw error
  }
  const latestResponse = await context.request.get(`${base}/api/unified/projects/${projectId}`)
  assert.ok(latestResponse.ok())
  const project = (await latestResponse.json()).project
  const motionId = saved.result.motionId
  const motion = project.motions[motionId]
  assert.equal(motion.evaluator, 'animation-1.31.8')
  assert.ok(motion.edit?.sha256 && motion.sourceClip?.sha256, 'Native edit and baked GLB were not persisted')

  const placed = await context.request.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
    requestId: randomUUID(), projectId, expectedRevision: project.revision, command: 'motion.place',
    args: { motionId, characterId: added.result.characterId, frameStart: 0, sourceStartSeconds: 0, sourceLengthSeconds: 3, speed: 1, loop: false, reverse: false },
  } })
  const placedBody = await placed.json()
  assert.equal(placedBody.ok, true, JSON.stringify(placedBody))
  const placedProject = await context.request.get(`${base}/api/unified/projects/${projectId}`).then((response) => response.json())
  const undo = await context.request.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
    requestId: randomUUID(), projectId, expectedRevision: placedProject.project.revision, command: 'history.undo', args: {},
  } }).then((response) => response.json())
  assert.equal(undo.ok, true, JSON.stringify(undo))
  const undoneProject = await context.request.get(`${base}/api/unified/projects/${projectId}`).then((response) => response.json())
  assert.ok(!undoneProject.project.scene.content.timeline.animation.motionClips.some((clip) => clip.id === placedBody.result.clipId), 'Undo did not remove the new timeline placement')
  const redo = await context.request.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
    requestId: randomUUID(), projectId, expectedRevision: undoneProject.project.revision, command: 'history.redo', args: {},
  } }).then((response) => response.json())
  assert.equal(redo.ok, true, JSON.stringify(redo))
  const redoneProject = await context.request.get(`${base}/api/unified/projects/${projectId}`).then((response) => response.json())
  assert.ok(redoneProject.project.scene.content.timeline.animation.motionClips.some((clip) => clip.id === placedBody.result.clipId), 'Redo did not restore the timeline placement')
  const secondCharacterResponse = await context.request.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
    requestId: randomUUID(), projectId, expectedRevision: redoneProject.project.revision, command: 'character.add',
    args: { assetId, skeletonId: project.characters[added.result.characterId].skeletonId, name: 'Shared Motion Isolation Probe' },
  } })
  const secondCharacterResult = await secondCharacterResponse.json()
  assert.equal(secondCharacterResult.ok, true, JSON.stringify(secondCharacterResult))
  const afterSecondCharacter = await context.request.get(`${base}/api/unified/projects/${projectId}`).then((response) => response.json())
  const secondPlacement = await context.request.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
    requestId: randomUUID(), projectId, expectedRevision: afterSecondCharacter.project.revision, command: 'motion.place',
    args: { motionId, characterId: secondCharacterResult.result.characterId, frameStart: 100, sourceStartSeconds: 0, sourceLengthSeconds: 3, speed: 1, loop: false, reverse: false },
  } }).then((response) => response.json())
  assert.equal(secondPlacement.ok, true, JSON.stringify(secondPlacement))
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId: id } })), projectId)
  const updatedResponse = await context.request.get(`${base}/api/unified/projects/${projectId}`)
  const updated = (await updatedResponse.json()).project
  assert.ok(Object.values(updated.bindings).some((binding) => binding.motionId === motionId), 'Native motion was not bound to the Character')
  const evaluateFrame = async (frame) => {
    const response = await context.request.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
      requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame },
    } })
    const body = await response.json()
    assert.equal(body.ok, true, JSON.stringify(body))
    assert.ok(body.result.skeletonSamples.length, `CPU scene evaluation returned no samples at frame ${frame}`)
    assert.ok(!body.result.issues.some((issue) => issue.code === 'SKELETON_EVALUATION_UNAVAILABLE'), JSON.stringify(body.result.issues))
    return body.result.skeletonSamples[0]
  }
  const startSample = await evaluateFrame(0)
  const middleSample = await evaluateFrame(45)
  const editedEndSample = await evaluateFrame(89)
  const normalizedBoneName = (name) => name.split(':').pop().replace(/^mixamorig\d*/i, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase()
  const normalizedName = normalizedBoneName(poseBone.name)
  const startBone = startSample.bones.find((bone) => normalizedBoneName(bone.name) === normalizedName)
  const middleBone = middleSample.bones.find((bone) => normalizedBoneName(bone.name) === normalizedName)
  const editedEndBone = editedEndSample.bones.find((bone) => normalizedBoneName(bone.name) === normalizedName)
  assert.ok(startBone && middleBone && editedEndBone, `CPU skeleton samples are missing edited bone ${poseBone.name}`)
  const rotationDot = Math.abs(startBone.rotation.reduce((sum, value, index) => sum + value * middleBone.rotation[index], 0))
  assert.ok(rotationDot < 0.999, `CPU runtime did not play the changed ${poseBone.name} pose between keys`)
  const nativePoseDot = Math.abs(editedEndBone.rotation.reduce((sum, value, index) => sum + value * poseEdit.afterPose.q[index], 0))
  assert.ok(nativePoseDot > 0.999, `CPU runtime did not load the edited native GLB pose for ${poseBone.name}: dot=${nativePoseDot}`)
  const motionBytes = await context.request.get(`${base}/api/unified/projects/${projectId}/assets/${encodeURIComponent(motion.assetId)}/source?format=glb`).then(async (response) => {
    assert.ok(response.ok(), `Saved Motion GLB failed to load for parity check: HTTP ${response.status()}`)
    return response.body()
  })
  const gltf = await new GLTFLoader().parseAsync(Uint8Array.from(motionBytes).buffer, '')
  assert.ok(gltf.animations[0], 'Saved Motion GLB contains no animation for WebGL mixer parity check')
  let mixerBone
  gltf.scene.traverse((object) => { if (normalizedBoneName(object.name) === normalizedName) mixerBone = object })
  assert.ok(mixerBone, `Saved Motion GLB is missing ${poseBone.name}`)
  const mixer = new AnimationMixer(gltf.scene)
  mixer.clipAction(gltf.animations[0]).play()
  const mixerParityDots = []
  for (const [frame, cpuBone] of [[0, startBone], [45, middleBone], [89, editedEndBone]]) {
    mixer.setTime(frame / 30)
    gltf.scene.updateMatrixWorld(true)
    mixerParityDots.push(Math.abs(cpuBone.rotation.reduce((sum, value, index) => sum + value * mixerBone.quaternion.toArray()[index], 0)))
  }
  mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene)
  assert.ok(mixerParityDots.every((dot) => dot > 0.99999), `CPU/Three.js WebGL mixer pose parity failed: ${mixerParityDots.join(', ')}`)
  await workspaces.getByRole('button', { name: /2 Scene/ }).click()
  await page.waitForTimeout(5000)
  assert.ok(motionGlbResponses.includes(200), 'Scene WebGL did not load the persisted native motion GLB')
  await page.locator('button[aria-label="Timeline"]').click()
  const viewport = page.locator('canvas').first()
  const viewportBefore = await viewport.screenshot()
  await page.getByRole('button', { name: 'Play forward' }).click()
  await page.waitForTimeout(1800)
  const viewportAfter = await viewport.screenshot()
  assert.notDeepEqual(viewportAfter, viewportBefore, 'Scene WebGL viewport did not change while native motion played')
  await page.reload()
  const refreshedWorkspaces = page.getByRole('navigation', { name: 'Workspaces' })
  await refreshedWorkspaces.getByRole('button', { name: /3 Animation/ }).click()
  await frame.locator('#bbsHostControls .wb-animation-creation-toolbar select').first().selectOption(added.result.characterId)
  const motionSelectBeforeClone = frame.locator('#bbsHostControls .wb-animation-creation-toolbar select').nth(1)
  await motionSelectBeforeClone.selectOption(motionId)
  await page.getByRole('button', { name: 'Chỉnh animation' }).click()
  const cloneFrame = page.frame({ url: /animation-studio\/v1\.31\.8\/index\.html/ })
  await cloneFrame.waitForFunction(() => window.__studio?.ready === true && Object.values(window.__studio.project().keys).some((keys) => keys.length > 0))
  await cloneFrame.evaluate(({ boneId }) => {
    const studio = window.__studio
    studio.seek(1.5)
    studio.selectUser(boneId, false)
    const rotation = document.getElementById('rx')
    rotation.value = '42'
    rotation.dispatchEvent(new Event('change', { bubbles: true }))
    document.getElementById('keyBtn').click()
  }, { boneId: poseBone.id })
  const [cloneSaveResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/unified/commands') && response.request().postDataJSON()?.command === 'motion.edit'),
    frame.getByRole('button', { name: 'Lưu vào project' }).click(),
  ])
  const cloneSave = await cloneSaveResponse.json()
  assert.equal(cloneSave.ok, true, JSON.stringify(cloneSave))
  const clonedProject = await context.request.get(`${base}/api/unified/projects/${projectId}`).then((response) => response.json())
  const updatedClipA = clonedProject.project.bindings[placedBody.result.clipId]
  const unchangedClipB = clonedProject.project.bindings[secondPlacement.result.clipId]
  assert.notEqual(updatedClipA.motionId, motionId, 'Editing Character A did not clone its shared Motion')
  assert.equal(unchangedClipB.motionId, motionId, 'Editing Character A changed Character B shared Motion binding')
  assert.ok(clonedProject.project.motions[motionId], 'Editing Character A mutated/deleted the shared source Motion')
  await page.reload()
  const reloadedWorkspaces = page.getByRole('navigation', { name: 'Workspaces' })
  await reloadedWorkspaces.getByRole('button', { name: /3 Animation/ }).click()
  const motionSelect = frame.locator('#bbsHostControls .wb-animation-creation-toolbar select').nth(1)
  await motionSelect.waitFor()
  await assert.doesNotReject(() => motionSelect.selectOption(motionId))
  await page.getByRole('button', { name: 'Chỉnh animation' }).click()
  const reopenedFrame = page.frame({ url: /animation-studio\/v1\.31\.8\/index\.html/ })
  await reopenedFrame.waitForFunction(() => window.__studio?.ready === true && Object.values(window.__studio.project().keys).some((keys) => keys.length > 0))
  assert.deepEqual(errors, [], `Browser reported errors: ${errors.join('; ')}`)
  console.log(JSON.stringify({ pass: true, projectId, assetId, characterId: added.result.characterId, secondCharacterId: secondCharacterResult.result.characterId, motionId, clonedMotionId: updatedClipA.motionId, clipId: placedBody.result.clipId, sharedMotionIsolation: true, placementUndoRedo: true, nativeUndoRedo: true, nativeDraftSurvivesWorkspaceSwitch: true, unsavedProjectCloseGuard: true, browserBeforeUnloadGuard: beforeUnloadType, iframeRendererPauseResume: rendererLifecycle, iframeResize: true, keyed, poseBone: poseBone.name, cpuRotationDot: rotationDot, nativePoseDot, cpuSamples: 3, cpuWebglMixerParityDots: mixerParityDots, webglMotionGlbStatus: motionGlbResponses.find((status) => status === 200), webglViewportChangedDuringPlayback: true, errors }))
} catch (error) {
  console.error(error.stack ?? String(error))
  console.error(JSON.stringify({ errors }))
  process.exitCode = 1
} finally {
  await browser.close()
}
