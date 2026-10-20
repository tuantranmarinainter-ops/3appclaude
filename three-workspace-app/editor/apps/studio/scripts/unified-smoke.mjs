// Local browser regression: Retarget FBX -> shared Character -> Animation binding -> Scene playback/history.
// Requires STUDIO_URL, BBS_TEST_MIXAMO_FBX and a server configured with isolated smoke project storage.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const base = process.env.STUDIO_URL
const fixture = process.env.BBS_TEST_MIXAMO_FBX
if (!base || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname) || !fixture) throw new Error('Set local STUDIO_URL and BBS_TEST_MIXAMO_FBX; use isolated smoke storage.')
const startedAt = new Date().toISOString()
async function writeReport(report) {
  if (!process.env.SMOKE_REPORT) return
  await mkdir(path.dirname(process.env.SMOKE_REPORT), { recursive: true })
  await writeFile(process.env.SMOKE_REPORT, JSON.stringify({ startedAt, ...report }, null, 2) + '\n')
}
await writeReport({ passed: false, state: 'running' })
const browser = await chromium.launch()
const errors = []
const external = []
const failed = []
let projectId
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' })
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (['data:', 'blob:'].includes(url.protocol) || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return route.continue()
    external.push(url.href); return route.abort('internetdisconnected')
  })
  const page = await context.newPage()
  page.setDefaultTimeout(45_000)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('response', (response) => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`) })
  async function command(name, action) {
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/api/unified/commands') && res.request().postDataJSON()?.command === name),
      action(),
    ])
    const body = await response.json()
    assert.equal(body.ok, true, JSON.stringify(body))
    return body
  }
  async function project() {
    const response = await context.request.get(`${base}/api/unified/projects/${projectId}`)
    assert.ok(response.ok())
    return (await response.json()).project
  }
  async function sceneReady() {
    await page.waitForFunction(() => window.__store?.getState?.().ready === true && window.__stage?.ready === true)
  }
  await page.goto(base)
  await page.locator('.wb-hero-actions .wb-cta').click()
  await page.locator('.wb-dialog').getByLabel('Name', { exact: true }).fill('Unified FBX browser smoke')
  await page.locator('.wb-dialog').getByLabel('Frame rate', { exact: true }).fill('30')
  await page.locator('.wb-dialog').getByLabel('Total number of frames', { exact: true }).fill('90')
  const created = await command('project.create', () => page.locator('.wb-dialog').getByRole('button', { name: /Tạo và mở|Create and open/ }).click())
  projectId = created.projectId
  await sceneReady()
  await page.locator('[data-feature-id="1.3"]').click()
  await page.locator('.wb-retarget-preview input[type=file]').setInputFiles(fixture)
  const save = page.getByRole('button', { name: 'Save source motion to project' })
  await save.waitFor()
  const imported = await command('asset.import', () => save.click())
  const assetId = imported.result.assetIds[0]
  const assetRow = page.locator('.wb-unified-asset').filter({ hasText: path.basename(fixture, path.extname(fixture)) })
  const added = await command('character.add', () => assetRow.getByRole('button', { name: /Nhân vật/ }).click())
  const characterId = added.result.characterId
  const nodeId = added.result.nodeId
  const positioned = await context.request.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
    requestId: randomUUID(), projectId, expectedRevision: added.revision, command: 'scene.apply', args: { operations: [{ type: 'node.transform.patch', nodeId, position: { x: 2 } }] },
  } })
  const positionedBody = await positioned.json()
  assert.equal(positionedBody.ok, true, JSON.stringify(positionedBody))
  await page.locator('[data-feature-id="1.5"]').click()
  await sceneReady()
  await page.locator('.wb-animation-editor canvas.t3d-viewport-canvas').waitFor()
  assert.equal(await page.locator('.wb-animation-controls').getByRole('heading', { name: 'Animation' }).count(), 1)
  if (process.env.SMOKE_ANIMATION_SCREENSHOT) { await mkdir(path.dirname(process.env.SMOKE_ANIMATION_SCREENSHOT), { recursive: true }); await page.screenshot({ path: process.env.SMOKE_ANIMATION_SCREENSHOT }) }
  await page.getByLabel('Source in (seconds)', { exact: true }).fill('0.25')
  await page.getByLabel('Source length (seconds, blank = full range)', { exact: true }).fill('1')
  await page.getByLabel('Speed', { exact: true }).fill('2')
  await page.getByLabel('Reverse', { exact: true }).check()
  const placed = await command('motion.place', () => page.getByRole('button', { name: 'Place on timeline', exact: true }).click())
  const clipId = placed.result.clipId
  await page.getByRole('button', { name: /^Edit mixamo/ }).click()
  await page.getByLabel('Start frame', { exact: true }).fill('30')
  await page.getByLabel('End frame (inclusive)', { exact: true }).fill('59')
  await page.getByLabel('Source in (seconds)', { exact: true }).fill('0.5')
  await page.getByLabel('Source length (seconds, blank = full range)', { exact: true }).fill('0.5')
  await page.getByLabel('Speed', { exact: true }).fill('1')
  await page.getByLabel('Root motion', { exact: true }).selectOption('in-place')
  await command('motion.binding.set', () => page.getByRole('button', { name: 'Apply clip changes', exact: true }).click())
  const edited = await project()
  assert.equal(edited.bindings[clipId].characterId, characterId)
  assert.equal(edited.bindings[clipId].sourceStartSeconds, 0.5)
  assert.equal(edited.assets[assetId].kind, 'model')
  assert.equal(edited.bindings[clipId].rootPolicy, 'in-place')
  const rootBoneName = edited.scene.content.timeline.animation.motionClips.find((clip) => clip.id === clipId).motion.rootMotion.boneName
  await page.locator('[data-feature-id="1.4"]').click()
  await sceneReady()
  await page.waitForFunction((id) => window.__stage.characters.has(id), nodeId)
  const stats = await page.evaluate((id) => {
    const stage = window.__stage
    const character = stage.characters.get(id)
    let meshes = 0
    character.inner.traverse((object) => { if (object.isSkinnedMesh) meshes++ })
    return { rig: character.rig, unit: character.inner.scale.x, meshes, renderFrames: stage.stats.renderFrames }
  }, nodeId)
  assert.equal(stats.rig, 'direct'); assert.equal(stats.unit, 0.01); assert.ok(stats.meshes > 0)
  const poses = []
  const rootPoses = []
  for (const frame of [30, 40]) {
    await page.evaluate((value) => window.__store.getState().setFrame(value), frame)
    await page.waitForFunction((value) => window.__stage.currentFrame === value, frame)
    poses.push(await page.evaluate((id) => window.__stage.characters.get(id).inner.getObjectByName('mixamorigRightArm').quaternion.toArray(), nodeId))
    rootPoses.push(await page.evaluate(({ id, name }) => {
      const character = window.__stage.characters.get(id)
      const bone = character.inner.getObjectByName(name)
      return { position: bone.position.toArray(), rotation: bone.quaternion.toArray(), restPosition: character.restPos.get(name).toArray(), restRotation: character.restPose.get(name).toArray(), placement: character.root.position.toArray() }
    }, { id: nodeId, name: rootBoneName }))
  }
  for (const pose of rootPoses) {
    assert.deepEqual(pose.position, pose.restPosition)
    assert.deepEqual(pose.rotation, pose.restRotation)
    assert.deepEqual(pose.placement, [2, 0, 0])
  }
  assert.ok(poses[0].some((value, i) => Math.abs(value - poses[1][i]) > 1e-4), 'FBX pose did not animate between frames')
  if (process.env.SMOKE_SCREENSHOT) { await mkdir(path.dirname(process.env.SMOKE_SCREENSHOT), { recursive: true }); await page.screenshot({ path: process.env.SMOKE_SCREENSHOT }) }
  await command('history.undo', () => page.locator('.wb-unified-actions').getByRole('button', { name: 'Undo', exact: true }).click())
  assert.equal((await project()).bindings[clipId].sourceStartSeconds, 0.25)
  assert.equal((await project()).bindings[clipId].rootPolicy, 'skeletal')
  await command('history.redo', () => page.locator('.wb-unified-actions').getByRole('button', { name: 'Redo', exact: true }).click())
  assert.equal((await project()).bindings[clipId].sourceStartSeconds, 0.5)
  assert.equal((await project()).bindings[clipId].rootPolicy, 'in-place')
  const beforeClone = await project()
  const cloneResponse = await context.request.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
    requestId: randomUUID(), projectId, expectedRevision: beforeClone.revision, command: 'scene.apply', args: { operations: [{ type: 'node.clone', nodeId, delta: { position: [2, 0, 0] } }] },
  } })
  const cloned = await cloneResponse.json()
  assert.equal(cloned.ok, true, JSON.stringify(cloned))
  assert.equal(Object.keys((await project()).characters).length, Object.keys(beforeClone.characters).length + 1)
  await page.reload(); await sceneReady()
  assert.equal((await project()).bindings[clipId].sourceStartSeconds, 0.5)
  async function rootPolicy(policy) {
    await page.locator('[data-feature-id="1.5"]').click()
    await page.getByRole('button', { name: /^Edit mixamo/ }).first().click()
    await page.getByLabel('Root motion', { exact: true }).selectOption(policy)
    if (policy === 'trajectory') await page.getByLabel('Motion alignment', { exact: true }).selectOption('origin')
    await command('motion.binding.set', () => page.getByRole('button', { name: 'Apply clip changes', exact: true }).click())
    await page.locator('[data-feature-id="1.4"]').click()
    await sceneReady()
  }
  async function worldPose(frame) {
    await page.evaluate((value) => window.__store.getState().setFrame(value), frame)
    await page.waitForFunction((value) => window.__stage.currentFrame === value, frame)
    return page.evaluate(({ id, name }) => {
      const character = window.__stage.characters.get(id)
      character.root.updateMatrixWorld(true)
      return { root: character.inner.getObjectByName(name).matrixWorld.toArray(), arm: character.inner.getObjectByName('mixamorigRightArm').matrixWorld.toArray(),
        localRoot: character.inner.getObjectByName(name).position.toArray(), restRoot: character.restPos.get(name).toArray(),
        trajectory: character.motionRoot.matrix.toArray(), placement: character.root.position.toArray() }
    }, { id: nodeId, name: rootBoneName })
  }
  await rootPolicy('skeletal')
  const skeletal = []
  for (const frame of [30, 40]) skeletal.push(await worldPose(frame))
  await rootPolicy('trajectory')
  const trajectory = []
  for (const frame of [30, 40, 30]) trajectory.push(await worldPose(frame))
  let worldPoseMaxDelta = 0
  for (let i = 0; i < trajectory.length; i++) {
    const reference = skeletal[i % 2]
    const actual = trajectory[i]
    for (const channel of ['root', 'arm']) for (let k = 0; k < 16; k++) worldPoseMaxDelta = Math.max(worldPoseMaxDelta, Math.abs(actual[channel][k] - reference[channel][k]))
    assert.deepEqual(actual.localRoot, actual.restRoot)
    assert.deepEqual(actual.placement, [2, 0, 0])
  }
  assert.ok(worldPoseMaxDelta < 1e-5, `trajectory changed the world pose: ${worldPoseMaxDelta}`)
  assert.ok(trajectory[0].trajectory.some((value, index) => Math.abs(value - (index % 5 === 0 ? 1 : 0)) > 1e-5), 'trajectory delta was not transferred')
  await page.reload(); await sceneReady()
  assert.equal((await project()).bindings[clipId].rootPolicy, 'trajectory')
  await worldPose(40)
  const evaluatedResponse = await context.request.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
    requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 40 },
  } })
  const evaluated = await evaluatedResponse.json()
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated))
  assert.deepEqual(evaluated.result.issues, [])
  assert.equal(evaluated.result.transformSpace, 'authored-placement')
  const cpu = evaluated.result.skeletonSamples.find((sample) => sample.nodeId === nodeId)
  assert.equal(cpu.bones.length, 65)
  const browserBones = await page.evaluate(({ id, names }) => {
    const character = window.__stage.characters.get(id)
    character.root.updateMatrixWorld(true)
    return names.map((name) => character.inner.getObjectByName(name).matrixWorld.toArray())
  }, { id: nodeId, names: cpu.bones.map((bone) => bone.name) })
  let cpuWorldPoseMaxDelta = 0
  for (let i = 0; i < cpu.bones.length; i++) for (let k = 0; k < 16; k++) cpuWorldPoseMaxDelta = Math.max(cpuWorldPoseMaxDelta, Math.abs(cpu.bones[i].worldMatrix[k] - browserBones[i][k]))
  assert.ok(cpuWorldPoseMaxDelta < 1e-5, `CPU/browser skeleton mismatch: ${cpuWorldPoseMaxDelta}`)
  assert.equal((await project()).revision, evaluated.revision)
  await worldPose(70)
  const gapResponse = await context.request.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
    requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 70 },
  } })
  const gap = await gapResponse.json()
  assert.equal(gap.ok, true, JSON.stringify(gap)); assert.deepEqual(gap.result.issues, [])
  assert.equal(gap.result.skeletonSamples.find((sample) => sample.nodeId === nodeId).bones.length, 65)
  const aliases = await page.evaluate((id) => {
    const result = []
    window.__stage.characters.get(id).inner.traverse((bone) => {
      if (bone.isBone && bone.parent?.isBone && bone.name === bone.parent.name && bone.userData.originalName === bone.parent.userData.originalName && !bone.userData.transformData) {
        result.push(bone.position.lengthSq() === 0 && bone.quaternion.x === 0 && bone.quaternion.y === 0 && bone.quaternion.z === 0 && bone.quaternion.w === 1)
      }
    })
    return result
  }, nodeId)
  assert.equal(aliases.length, 64); assert.ok(aliases.every(Boolean), 'timeline gap changed a loader bone alias')
  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SMOKE_SCREENSHOT })
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(failed, [])
  const poseDelta = Math.max(...poses[0].map((value, index) => Math.abs(value - poses[1][index])))
  const report = { passed: true, projectId, nodeId, clipId, browserVersion: browser.version(), viewport: [1600, 1000], ...stats, rootPolicy: 'trajectory', rootBoneName, rootPoses, worldPoseMaxDelta, trajectory, cpuWorldPoseMaxDelta, cpuBoneCount: cpu.bones.length, identityAliasesAfterGap: aliases.length, poseMaxComponentDelta: poseDelta, checks: ['Animation workspace mounts the shared Topview rig/timeline editor beside clip controls', 'FBX source import', 'shared Character', 'trim/reverse placement', 'binding edit', 'WebGL skinned mesh', 'animated bone pose', 'in-place root translation and rotation', 'actor placement unchanged', 'Undo/Redo', 'server-side clone', 'reload', 'trajectory/skeletal world pose parity', 'backward seek', 'trajectory reload', 'CPU/browser 65-bone parity', 'read-only headless evaluation', 'motion-to-gap keeps 64 loader aliases at identity'], externalRequests: external.length }
  await writeReport(report)
  console.log(JSON.stringify(report))
} catch (error) {
  await writeReport({ passed: false, projectId, error: error instanceof Error ? error.name : 'unknown', errors, external, failed })
  console.error(JSON.stringify({ projectId, errors, external, failed }))
  throw error
} finally { await browser.close() }
