import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { AnimationMixer, LoopOnce } from 'three'
import { makeEmptyDraft } from '@topview/3d-builder'
import { getAction, resolveCharacter, saveCharacterActionVersion } from '../../../packages/library/index'
import { addLibraryCharacterToProject } from '../src/libraryCommands'
import { packLibraryGlb, unpackLibraryGlb } from '../src/libraryModels'
import { createShotPackage, saveShotExport } from '../src/shotExchange'
import { jsonBytes, sha256, zipPackage } from '../src/shotPackage'
import { stageAssetUpload } from '../src/unifiedAssetFiles'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { stageOriginalLibraryBobjProfile } from '../src/unifiedJobs'
import { bobjModelToGlb, parseBobjModel } from '../../../packages/retarget/src/bobjModel'
import { loadAsset } from '../../../packages/retarget/cli/loadAsset'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const qaRoot = path.resolve(editor, '../../work/test-native')
mkdirSync(qaRoot, { recursive: true })
const run = mkdtempSync(path.join(qaRoot, 'run-'))
const source = process.env.NATIVE_SHOT_LIBRARY_FIXTURE || 'C:/w01-samples/lib-mvp'
const fixtureExists = existsSync(path.join(source, 'library.json'))
if (process.env.NATIVE_SHOT_LIBRARY_FIXTURE) assert.ok(fixtureExists, `Explicit real library fixture missing: ${source}`)
const oldLibrary = process.env.W01_LIBRARY, oldProjects = process.env.BBS_UNIFIED_PROJECTS_DIR
process.env.W01_LIBRARY = path.join(run, 'library')
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(run, 'projects')
if (fixtureExists) cpSync(source, process.env.W01_LIBRARY, { recursive: true })
const sambaHash = '68fcdb75d373b7338ecf58a9f2f8a2d3a12d3501615a88de9f06285254f644c4'
const sambaSource = process.env.NATIVE_SHOT_SAMBA_FIXTURE || 'C:/w01-samples/adjust-base-main/Samba Dancing.glb'
const sambaExists = existsSync(sambaSource)
if (process.env.NATIVE_SHOT_SAMBA_FIXTURE) assert.ok(sambaExists, `Explicit Samba baseline missing: ${sambaSource}`)
if (sambaExists) cpSync(sambaSource, path.join(run, 'Samba Dancing.glb'))
test.after(() => {
  if (oldLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = oldLibrary
  if (oldProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = oldProjects
})

const characters = [
  ['Hero', 'aab3befd-227d-4dd7-8986-f8caf194f232', 20],
  ['Den', '5747a1ad-06fd-4021-b304-788f85554ba3', 20],
  ['GoXua', '3bc37c74-0209-4413-90f4-c69302a43625', 84],
] as const

function embeddedTextures(bytes: Buffer) {
  const { json, binary } = unpackLibraryGlb(bytes)
  return (json.images ?? []).filter((image: any) => image.bufferView !== undefined).map((image: any) => {
    const view = json.bufferViews[image.bufferView]
    return sha256(binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength))
  }) as string[]
}

for (const [name, charId, jointCount] of characters) test(`${name}: real native shot, topology guard, edited version and reopen`, { skip: fixtureExists ? false : `Real library absent: ${source}; set NATIVE_SHOT_LIBRARY_FIXTURE` }, async (t) => {
  const resolved = resolveCharacter(charId)
  const baseBytes = readFileSync(resolved.modelPath)
  assert.equal(resolved.baseModel?.format, 'bobj')
  const draft = resolved.actions.find(action => action.ownerCharId === charId && action.status === 'draft' && action.version === 1)
  assert.ok(draft, `${name} requires an actual owned v1 draft`)
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: {
    name, scene: makeEmptyDraft(name, 30, 9000, { fov: 50, position: { x: 0, y: 2, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }),
  } })
  const placed = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: created.revision, charId })
  let project = await readUnifiedProject(created.projectId)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: project.revision, command: 'library.place', args: { actionUuid: draft.uuid, characterId: placed.characterId } })
  project = await readUnifiedProject(created.projectId)
  const characterId = String(placed.characterId)
  const clip = project.scene.content.timeline.animation.motionClips.find(c => c.target.nodeId === project.characters[characterId]!.nodeId)!
  const args = { cameraNodeId: 'camera_1', frameStart: clip.frameStart, frameEnd: clip.frameEnd, editableCharacterIds: [characterId] }
  const built = await createShotPackage(project, args)
  await saveShotExport(project, built)
  const shotCharacter = built.shot.characters.find(c => c.characterId === characterId)!
  const original = Buffer.from(built.files[shotCharacter.glb]!)
  const { json, binary } = unpackLibraryGlb(original)
  assert.equal(json.skins[0].joints.length, jointCount)
  assert.equal(json.animations.length, 1)
  for (const texture of Object.values(resolved.textures)) assert.ok(embeddedTextures(original).includes(sha256(readFileSync(texture))), `${name} own texture ${texture}`)
  assert.ok(Object.keys(resolved.textures).length, 'real skin must be exercised')
  if (jointCount === 84) assert.ok(json.nodes.some((node: any) => /jaw/i.test(node.name)))

  // Change the first actual rotation sample, not only GLB metadata.
  const rotation = json.animations[0].channels.find((channel: any) => channel.target.path === 'rotation')
  assert.ok(rotation)
  const accessor = json.accessors[json.animations[0].samplers[rotation.sampler].output]
  const view = json.bufferViews[accessor.bufferView]
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  assert.equal(accessor.componentType, 5126)
  const editedBinary = Buffer.from(binary)
  const before = Array.from({ length: 4 }, (_, i) => binary.readFloatLE(offset + i * 4))
  const angle = 0.15, [x, y, z, w] = before as [number, number, number, number]
  const changed = [Math.cos(angle) * x + Math.sin(angle) * w, Math.cos(angle) * y - Math.sin(angle) * z, Math.cos(angle) * z + Math.sin(angle) * y, Math.cos(angle) * w - Math.sin(angle) * x]
  changed.forEach((value, i) => editedBinary.writeFloatLE(value, offset + i * 4))
  const edited = packLibraryGlb(json, editedBinary)
  assert.notEqual(sha256(edited), sha256(original))

  async function importResult(bytes: Buffer) {
    const id = randomUUID(), hash = sha256(bytes)
    const manifest = JSON.parse(Buffer.from(built.files[shotCharacter.manifest]!).toString())
    manifest.glbSha256 = hash
    manifest.actions = [{ ...manifest.actions.find((action: any) => action.uuid === shotCharacter.actionUuid), uuid: id, originalActionUuid: shotCharacter.actionUuid, glbAnimationIndex: 0 }]
    const result = { version: '1.0.0', shotId: built.shot.shotId, baseShotSha256: sha256(built.files['shot.json']!), edits: [{ characterId, originalActionUuid: shotCharacter.actionUuid, newActionUuid: id, glb: 'edit.glb', manifest: 'edit.json', glbSha256: hash, placementKeys: [{ frame: args.frameStart, position: [0, 0, 0], yawDegrees: 0 }] }] }
    const zip = zipPackage({ 'result.json': jsonBytes(result), 'edit.glb': bytes, 'edit.json': jsonBytes(manifest) })
    const upload = await stageAssetUpload('result.zip', new ReadableStream({ start(controller) { controller.enqueue(zip); controller.close() } }))
    const response = await executeUnifiedCommand({ requestId: randomUUID(), projectId: project.projectId, expectedRevision: project.revision, command: 'shot.result.import', args: { file: upload.id, shotId: built.shot.shotId } })
    return { id, response }
  }

  await t.test('reject wrong native topology without project mutation', async () => {
    const wrong = structuredClone(json)
    wrong.nodes[wrong.skins[0].joints[1]].name += '_wrong_topology'
    await assert.rejects(importResult(packLibraryGlb(wrong, editedBinary)), /native skeleton|rig|topology/i)
    const reparented = structuredClone(json)
    const joint = reparented.skins[0].joints.find((index: number) => reparented.nodes.some((node: any) => node.children?.includes(index)))
    assert.notEqual(joint, undefined)
    for (const node of reparented.nodes) if (node.children) node.children = node.children.filter((index: number) => index !== joint)
    await assert.rejects(importResult(packLibraryGlb(reparented, editedBinary)), /skeleton|rig|topology/i)
    assert.deepEqual(await readUnifiedProject(project.projectId), project)
  })

  await t.test('same bytes create v2 and v3; retry UUID returns the same version', () => {
    const file = path.join(run, `${name}-edited.glb`)
    writeFileSync(file, edited)
    const options = { charId, baseUuid: draft.uuid, glbFile: file, status: 'edited' as const, rig: resolved.baseModel!.rig }
    const v2 = saveCharacterActionVersion(options)
    const v3 = saveCharacterActionVersion({ ...options, baseUuid: v2.uuid })
    assert.equal(v2.version, 2); assert.equal(v3.version, 3)
    assert.notEqual(v2.uuid, v3.uuid); assert.notEqual(v2.packId, v3.packId)
    assert.deepEqual(readFileSync(getAction({ actionUuid: v2.uuid }).glbPath), readFileSync(getAction({ actionUuid: v3.uuid }).glbPath))
    assert.equal(saveCharacterActionVersion({ ...options, baseUuid: v3.uuid, actionUuid: v3.uuid }).uuid, v3.uuid)
  })

  await t.test('result import retains the edited sample and textures when reopened', async () => {
    const { id, response } = await importResult(edited)
    assert.deepEqual(response.result.libraryActionUuids, [id])
    const after = await readUnifiedProject(project.projectId)
    assert.equal(after.revision, project.revision + 1)
    assert.equal(after.bindings[clip.id]!.motionId, id)
    assert.ok(after.motions[draft.uuid], 'original motion survives')
    const saved = getAction({ actionUuid: id })
    assert.equal(saved.status, 'edited'); assert.equal(saved.ownerCharId, charId)
    const sidecar = readFileSync(path.join(path.dirname(saved.glbPath), 'anim.original.bbs.bobj'))
    assert.deepEqual(sidecar.subarray(0, baseBytes.length), baseBytes, 'saved pack preserves authoritative prefix')
    assert.ok(sidecar.length > baseBytes.length)
    const nativeModel = parseBobjModel(sidecar.toString('utf8'))
    const savedNativeAction = nativeModel.actions.get(`app3_${id}`)
    assert.ok(savedNativeAction, 'saved pack contains the edited action')
    nativeModel.actions = new Map([[`app3_${id}`, savedNativeAction]])
    const roundtrip = Buffer.from(bobjModelToGlb(nativeModel, { faceForward: true }).bytes)
    const roots = await Promise.all([edited, roundtrip].map(bytes => loadAsset(bytes, 'glb', { skeletonOnly: true })))
    const mixers = roots.map(root => {
      const mixer = new AnimationMixer(root), action = mixer.clipAction(root.animations[0]!)
      action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play()
      return mixer
    })
    const roundtripBones = new Map<string, (typeof roots)[number]>()
    roots[1]!.traverse(node => { if (node.type === 'Bone') roundtripBones.set(node.name, node) })
    let maxPositionError = 0, maxAngleError = 0, samples = 0, worstAngleSample = ''
    const lastTick = Math.floor(roots[0]!.animations[0]!.duration * 20)
    for (const tick of [0, Math.min(5, lastTick), Math.floor(lastTick / 2), lastTick]) {
      mixers.forEach(mixer => mixer.setTime(tick / 20))
      roots[0]!.traverse(node => {
        if (node.type !== 'Bone') return
        const other = roundtripBones.get(node.name)
        assert.ok(other, `roundtrip joint ${node.name}`)
        maxPositionError = Math.max(maxPositionError, node.position.distanceTo(other.position))
        const angleError = node.quaternion.clone().normalize().angleTo(other.quaternion.clone().normalize())
        if (angleError > maxAngleError) { maxAngleError = angleError; worstAngleSample = `${node.name} at tick ${tick}` }
        samples++
      })
    }
    mixers.forEach((mixer, i) => { mixer.stopAllAction(); mixer.uncacheRoot(roots[i]!) })
    t.diagnostic(`${name} saved BOBJ→GLB: ${samples} joint samples; max position error ${maxPositionError}; max angle error ${maxAngleError} rad (${worstAngleSample})`)
    assert.ok(samples >= jointCount * 4)
    assert.ok(maxPositionError < 1e-4, `native roundtrip position error ${maxPositionError}`)
    assert.ok(maxAngleError < 1e-4, `native roundtrip angle error ${maxAngleError}`)
    const reopened = await createShotPackage(after, args)
    const reopenedCharacter = reopened.shot.characters.find(c => c.characterId === characterId)!
    const reopenedBytes = Buffer.from(reopened.files[reopenedCharacter.glb]!)
    const reopenedGlb = unpackLibraryGlb(reopenedBytes)
    const channel = reopenedGlb.json.animations[0].channels.find((c: any) => c.target.path === 'rotation')
    const output = reopenedGlb.json.accessors[reopenedGlb.json.animations[0].samplers[channel.sampler].output]
    const bufferView = reopenedGlb.json.bufferViews[output.bufferView]
    changed.forEach((value, i) => assert.ok(Math.abs(reopenedGlb.binary.readFloatLE((bufferView.byteOffset ?? 0) + (output.byteOffset ?? 0) + i * 4) - value) < 1e-6))
    assert.deepEqual(embeddedTextures(reopenedBytes), embeddedTextures(original))
  })
  await t.test('edited native Film export preserves BOBJ prefix and appends action', async () => {
    const after = await readUnifiedProject(project.projectId)
    const model = after.assets[String(placed.assetId)]!
    const profile = await stageOriginalLibraryBobjProfile(after, { characterId, nodeId: after.characters[characterId]!.nodeId, assetId: model.id, source: model.source, metersPerUnit: 1 } as never, path.join(run, `${name}-film`))
    assert.ok(profile)
    const bobj = readFileSync(profile.files[0]!.sourcePath)
    assert.deepEqual(bobj.subarray(0, baseBytes.length), baseBytes)
    assert.ok(bobj.length > baseBytes.length, 'edited native action must be appended')
  })
  assert.deepEqual(readFileSync(resolved.modelPath), baseBytes, 'authoritative QA base stays unchanged')
  t.diagnostic(`QA copies retained at ${run}`)
})

test('Samba reference GLB SHA stays byte-identical in source and QA copy', { skip: sambaExists ? false : `Samba baseline absent: ${sambaSource}; set NATIVE_SHOT_SAMBA_FIXTURE` }, () => {
  assert.equal(sha256(readFileSync(sambaSource)), sambaHash)
  assert.equal(sha256(readFileSync(path.join(run, 'Samba Dancing.glb'))), sambaHash)
})
