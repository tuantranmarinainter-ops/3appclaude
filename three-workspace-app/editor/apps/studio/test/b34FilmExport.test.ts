import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { makeEmptyDraft } from '@topview/3d-builder'
import { addLibraryCharacterToProject, placeLibraryActionForNode } from '../src/libraryCommands'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { createShotPackage } from '../src/shotExchange'
import { stageOriginalLibraryBobjProfile } from '../src/unifiedJobs'
import { bobjModelNodeName } from '../../../packages/retarget/src/bobjModel'
import { Matrix4 } from 'three'
import { createLibraryMotionConversion, materializeLibraryMotionConversion } from '../src/libraryMotionConversion'
import { mergeOriginalBobjActions } from '../src/unifiedJobs'
import { buildFilmExportManifest } from '../src/filmManifest'
import { parseBobjActions, parseBobjArmature } from '@bbs/retarget'
import { rebuildLibraryIndex } from '../../../packages/library/index'
import { fixture, sha } from './b34Fixtures'

test('B34 regenerated native Minecraft20 actions merge into the unchanged base and retain PR173 actor facing', { timeout: 180000 }, async (t) => {
  const temp = mkdtempSync(path.join(tmpdir(), 'b34-film-')), previous = process.env.W01_LIBRARY
  const previousProjects = process.env.BBS_UNIFIED_PROJECTS_DIR
  process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
  process.env.W01_LIBRARY = path.join(temp, 'library')
  t.after(() => { rmSync(temp, { recursive: true, force: true }); if (previousProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = previousProjects; if (previous === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = previous })
  const data = fixture(process.env.W01_LIBRARY, temp)
  // Both sources deliberately collide with the target's existing idle action.
  const metaPath = path.join(data.pack, 'meta.json')
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')); meta.actions[0].name = 'idle'
  writeFileSync(metaPath, JSON.stringify(meta))
  const duplicatePack = path.join(process.env.W01_LIBRARY!, 'packs', '3400000000000003')
  mkdirSync(duplicatePack); const secondUuid = randomUUID()
  writeFileSync(path.join(duplicatePack, 'anim.glb'), readFileSync(path.join(data.pack, 'anim.glb')))
  writeFileSync(path.join(duplicatePack, 'anim.manifest.json'), readFileSync(path.join(data.pack, 'anim.manifest.json')))
  writeFileSync(path.join(duplicatePack, 'meta.json'), JSON.stringify({ ...meta, packId: '3400000000000003', actions: [{ ...meta.actions[0], uuid: secondUuid }] }))
  rebuildLibraryIndex()
  const recipe = await createLibraryMotionConversion({ actionUuid: data.actionUuid, targetCharId: data.den.charId })
  const cacheRoot = path.join(temp, 'cache')
  const original = await materializeLibraryMotionConversion(recipe, { cacheRoot })
  rmSync(cacheRoot, { recursive: true, force: true })
  const native = await materializeLibraryMotionConversion(JSON.parse(JSON.stringify(recipe)), { cacheRoot })
  assert.equal(sha(native.bobj), sha(original.bobj))
  const secondRecipe = await createLibraryMotionConversion({ actionUuid: secondUuid, targetCharId: data.den.charId })
  const secondNative = await materializeLibraryMotionConversion(secondRecipe, { cacheRoot })
  assert.notEqual(native.actionName, secondNative.actionName)
  assert.notEqual(native.actionName, 'idle')
  const base = Buffer.from(data.bobj), merged = mergeOriginalBobjActions(base, [Buffer.from(native.bobj)])
  assert.deepEqual(merged.subarray(0, base.length), base)
  const combined = mergeOriginalBobjActions(base, [Buffer.from(native.bobj), Buffer.from(secondNative.bobj)])
  assert.equal(parseBobjActions(combined.toString()).size, 3, 'idle plus two same-display-name sources remain distinct native actions')
  const actions = [...parseBobjActions(merged.toString()).keys()]
  assert.ok(actions.includes('idle')); assert.equal(actions.length, 2)
  assert.equal(mergeOriginalBobjActions(base, [Buffer.from(native.bobj), Buffer.from(native.bobj)]).toString(), merged.toString())
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'B34 film', scene: makeEmptyDraft('B34 film', 30, 180, { fov: 50, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }) } })
  const added = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: created.revision, charId: data.den.charId })
  await placeLibraryActionForNode({ projectId: created.projectId, actionUuid: data.actionUuid, nodeId: added.nodeId! })
  const snapshot = await readUnifiedProject(created.projectId)
  const defaultCached = await materializeLibraryMotionConversion(recipe)
  rmSync(path.dirname(defaultCached.glbPath), { recursive: true, force: true })
  const app3 = await createShotPackage(snapshot, { cameraNodeId: snapshot.scene.content.nodes.find((item) => item.type === 'camera')!.id, frameStart: 0, frameEnd: 1, editableCharacterIds: [String(added.characterId)] })
  assert.equal(app3.shot.characters.length, 1)
  const app3Character = app3.shot.characters[0]!
  assert.ok(app3.files[app3Character.glb])
  assert.equal(sha(app3.files[app3Character.glb]!), app3Character.glbSha256)
  const node = snapshot.scene.content.nodes.find((item) => item.id === added.nodeId)!
  node.metadata = { ...node.metadata, libraryHiddenObjects: ['Body'] }
  const asset = snapshot.assets[added.assetId]!
  rmSync(path.dirname(defaultCached.glbPath), { recursive: true, force: true })
  const staged = await stageOriginalLibraryBobjProfile(snapshot, { characterId: added.characterId, nodeId: added.nodeId!, assetId: added.assetId, metersPerUnit: 1, source: asset.source } as never, path.join(temp, 'staged'))
  assert.ok(staged)
  assert.ok(staged.actions.includes(native.actionName))
  assert.equal(sha(readFileSync(staged.files[0]!.sourcePath)), staged.files[0]!.sha256)
  const sourceHash = 'a'.repeat(64), identity = new Matrix4().toArray()
  const profile = { schemaVersion: 1 as const, sourceSha256: sourceHash, modelId: 'unified/b34', metersPerUnit: 1,
    bones: parseBobjArmature(data.bobj).bones.map((bone) => ({ name: bone.name, parent: bone.parent, bobjRestMatrixRowMajor: new Matrix4().fromArray([...bone.restWorld]).transpose().toArray() })), actions, textureRequired: false,
    files: [{ sourcePath: path.join(temp, 'model.bobj'), targetPath: 'model.bobj', sha256: sha(merged) }], originalRig: { bobj: merged.toString(), nativeOnly: true, wingAction: 'idle' } }
  const input = { schemaVersion: 1, kind: 'film-sampling-input', targetVersion: '2.4', projectId: 'b34', sourceRevision: 1, sourceSha256: sourceHash, sourceHashes: { asset: sourceHash }, sampleFps: 20,
    range: { startFrame: 0, endFrame: 1 }, sequenceId: 'sequence', durationTicks: 1,
    models: [{ characterId: 'den', nodeId: 'den', name: 'Đen', assetId: 'asset', skeletonId: 'mc20', source: { path: 'model.glb', sha256: sourceHash }, metersPerUnit: 1, skeletonFingerprint: 'mc20', sourceBones: parseBobjArmature(data.bobj).bones.map((bone) => ({ id: bone.name, name: bobjModelNodeName(bone.name), parentId: bone.parent, rest: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } })) }],
    cameras: [{ id: 'shot', startTick: 0, durationTicks: 1, keyframes: [0, 1].map((tick) => ({ tick, x: 0, y: 0, z: 3, yaw: 0, pitch: 0, roll: 0, verticalFovDegrees: 60 })) }], frames: [0, 1].map((tick) => ({ tick, sourceFrame: tick, side: tick ? 'left' : 'right', skeletons: [{ nodeId: 'den', metersPerUnit: 1, placementMatrix: identity, trajectoryMatrix: identity, actorWorldMatrix: identity,
      bones: parseBobjArmature(data.bobj).bones.map((bone) => ({ name: bobjModelNodeName(bone.name), position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], worldMatrix: [...bone.restWorld] })) }] })) }
  const manifest = buildFilmExportManifest(input as never, new Map([['asset', profile]]), 'b34-film')
  writeFileSync(path.join(temp, 'model.bobj'), merged)
  const manifestPath = path.join(temp, 'film-manifest.json'), output = path.join(temp, 'native-output')
  mkdirSync(output); writeFileSync(manifestPath, JSON.stringify(manifest))
  const worker = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import json,sys;from agent.film_worker import run_film_worker;print(json.dumps(run_film_worker(sys.argv[1],sys.argv[2])))', manifestPath, output], { cwd: path.resolve('..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 })
  assert.equal(worker.status, 0, worker.stdout + worker.stderr)
  const exported = JSON.parse(worker.stdout)
  assert.equal(exported.nativeReadback, true)
  assert.deepEqual(readFileSync(path.join(exported.packageDirectory, 'assets/models/unified/b34/model.bobj')), merged)
  assert.deepEqual(manifest.actors[0]!.transformSamples.map((sample) => sample.yaw), [360, 360], 'native BOBJ retains the extra 180 degree correction on top of the common 180 degree Film facing')
})
