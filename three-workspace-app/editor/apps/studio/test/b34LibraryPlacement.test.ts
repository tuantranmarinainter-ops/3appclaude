import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { addLibraryCharacterToProject, placeLibraryActionForNode } from '../src/libraryCommands'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { linkSplitShotAssets } from '../src/splitShotAssets'
import { resolveUnifiedAssetFile } from '../src/unifiedAssetFiles'
import { materializeLibraryMotionConversion } from '../src/libraryMotionConversion'
import { decodeGlb, encodeGlb } from '../../../packages/retarget/cli/glb'
import { fixture, libraryFiles, sha } from './b34Fixtures'

test('B34 synthetic Mixamo65 placement reuses a recipe without adding library packs, actions or drafts; cache is disposable', { timeout: 180000 }, async (t) => {
  const temp = mkdtempSync(path.join(tmpdir(), 'b34-placement-'))
  const previousLibrary = process.env.W01_LIBRARY, previousProjects = process.env.BBS_UNIFIED_PROJECTS_DIR
  process.env.W01_LIBRARY = path.join(temp, 'library'); process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
  t.after(() => { rmSync(temp, { recursive: true, force: true }); if (previousLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = previousLibrary
    if (previousProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = previousProjects })
  const data = fixture(process.env.W01_LIBRARY, temp)
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'B34', scene: makeEmptyDraft('B34', 30, 180) } })
  const added = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: created.revision, charId: data.den.charId })
  const before = libraryFiles(process.env.W01_LIBRARY)
  const first = await placeLibraryActionForNode({ projectId: created.projectId, actionUuid: data.actionUuid, nodeId: added.nodeId! })
  assert.equal(first.converted, true)
  let project = await readUnifiedProject(created.projectId)
  const motion = project.motions[first.placedActionUuid]!
  assert.ok(motion)
  const recipes = project.extensions.libraryMotionConversions!
  const recipe = recipes[motion.assetId]!
  assert.equal(recipe.sourceActionUuid, data.actionUuid)
  assert.equal(recipe.targetCharId, data.den.charId)
  assert.equal(recipe.sourceSha256, sha(readFileSync(path.join(data.pack, 'anim.glb'))))
  assert.deepEqual(libraryFiles(process.env.W01_LIBRARY), before)
  const second = await placeLibraryActionForNode({ projectId: created.projectId, actionUuid: data.actionUuid, nodeId: added.nodeId! })
  project = await readUnifiedProject(created.projectId)
  assert.equal(second.placedActionUuid, first.placedActionUuid)
  assert.deepEqual(project.extensions.libraryMotionConversions, recipes)
  assert.equal(project.scene.content.timeline.animation.motionClips.filter((clip) => clip.target.nodeId === added.nodeId).length, 2)
  assert.deepEqual(libraryFiles(process.env.W01_LIBRARY), before)
  const cache = path.join(temp, 'disposable-cache')
  const generated = await materializeLibraryMotionConversion(recipe, { cacheRoot: cache })
  rmSync(cache, { recursive: true, force: true })
  const regenerated = await materializeLibraryMotionConversion(JSON.parse(JSON.stringify(recipe)), { cacheRoot: cache })
  assert.equal(sha(regenerated.glb), sha(generated.glb)); assert.equal(sha(regenerated.bobj), sha(generated.bobj))
  const defaultCached = await materializeLibraryMotionConversion(recipe)
  rmSync(path.dirname(defaultCached.glbPath), { recursive: true, force: true })
  const resolved = await resolveUnifiedAssetFile(await readUnifiedProject(created.projectId), motion.assetId, 'source')
  assert.equal(sha(resolved.bytes), sha(generated.glb))
  const split = structuredClone(project); split.projectId = randomUUID()
  await linkSplitShotAssets(process.env.BBS_UNIFIED_PROJECTS_DIR!, project.projectId, split)
  assert.deepEqual(split.extensions.libraryMotionConversions, project.extensions.libraryMotionConversions)
  const splitResolved = await resolveUnifiedAssetFile(split, motion.assetId, 'source')
  assert.equal(sha(splitResolved.bytes), sha(generated.glb))
  const splitFiles = libraryFiles(path.join(process.env.BBS_UNIFIED_PROJECTS_DIR!, split.projectId))
  assert.ok(splitFiles.some((name) => name.endsWith('/conversion.json')))
  assert.ok(!splitFiles.includes(project.assets[motion.assetId]!.source.path), 'split must not copy disposable converted GLB')
  writeFileSync(path.join(data.pack, 'anim.glb'), Buffer.concat([readFileSync(path.join(data.pack, 'anim.glb')), Buffer.from('changed')]))
  await assert.rejects(placeLibraryActionForNode({ projectId: created.projectId, actionUuid: data.actionUuid, nodeId: added.nodeId! }), /Động tác gốc đã đổi/)
})

test('B34 Hero Minecraft20 action places directly on Đen; B19 blocks active stale motion and replaces unused motion', { timeout: 180000 }, async (t) => {
  const temp = mkdtempSync(path.join(tmpdir(), 'b34-same-rig-'))
  const oldLibrary = process.env.W01_LIBRARY, oldProjects = process.env.BBS_UNIFIED_PROJECTS_DIR
  process.env.W01_LIBRARY = path.join(temp, 'library'); process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
  t.after(() => { rmSync(temp, { recursive: true, force: true }); if (oldLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = oldLibrary
    if (oldProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = oldProjects })
  const data = fixture(process.env.W01_LIBRARY, temp)
  const { bobjModelToGlb, parseBobjModel, bobjModelNodeName } = await import('../../../packages/retarget/src/bobjModel')
  const { rebuildLibraryIndex } = await import('../../../packages/library/index')
  const pack = path.join(process.env.W01_LIBRARY, 'packs', '3400000000000002')
  const { mkdirSync } = await import('node:fs'); mkdirSync(pack)
  const actionUuid = randomUUID()
  const save = (value: number) => {
    const bobj = data.bobj.replace('an idle', 'an hero_wave').replace('kf 20 0 LINEAR', `kf 20 ${value} LINEAR`)
    // Stored pack GLB is the owner base only; actual action lives in anim.bobj.
    const baseModel = parseBobjModel(data.bobj); baseModel.actions.clear()
    const decoded = decodeGlb(bobjModelToGlb(baseModel).bytes)
    decoded.json.skins = [{ joints: parseBobjModel(bobj).armature.bones.map((bone) => decoded.json.nodes!.findIndex((node: { name?: string }) => node.name === bobjModelNodeName(bone.name))) }]
    const bytes = Buffer.from(encodeGlb(decoded.json, decoded.bin))
    writeFileSync(path.join(pack, 'anim.glb'), bytes); writeFileSync(path.join(pack, 'anim.bobj'), bobj.slice(bobj.indexOf('an hero_wave')))
    const action = { uuid: actionUuid, name: 'hero_wave', durationSeconds: 1, fps: 30, category: 'idle', tags: [], loop: false, inPlace: true, glbAnimationIndex: 0, ownerCharId: data.hero.charId, status: 'draft', version: 1 }
    writeFileSync(path.join(pack, 'meta.json'), JSON.stringify({ kind: 'motion-pack', libraryVersion: '1.1.0', packId: '3400000000000002', rig: 'minecraft20', glbSha256: sha(bytes), createdAt: '2026-10-26T00:00:00Z', license: { id: 'test', commitable: false }, actions: [action] }))
    writeFileSync(path.join(pack, 'anim.manifest.json'), JSON.stringify({ version: '1.0.0', rig: 'minecraft20', glbSha256: sha(bytes), actions: [action] }))
    rebuildLibraryIndex()
  }
  save(1)
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'B19', scene: makeEmptyDraft('B19', 30, 180) } })
  const added = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: created.revision, charId: data.den.charId })
  const before = libraryFiles(process.env.W01_LIBRARY)
  const placed = await placeLibraryActionForNode({ projectId: created.projectId, actionUuid, nodeId: added.nodeId! })
  assert.equal(placed.placedActionUuid, actionUuid); assert.equal(placed.converted, false)
  assert.deepEqual(libraryFiles(process.env.W01_LIBRARY), before)
  save(2)
  await assert.rejects(placeLibraryActionForNode({ projectId: created.projectId, actionUuid, nodeId: added.nodeId! }), /already belongs|different project content/)
  const project = await readUnifiedProject(created.projectId)
  const document = structuredClone(project.scene)
  document.content.timeline.animation.motionClips = []
  await executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: project.revision, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document }] } })
  const replaced = await placeLibraryActionForNode({ projectId: created.projectId, actionUuid, nodeId: added.nodeId! })
  assert.equal(replaced.placedActionUuid, actionUuid)
  const after = await readUnifiedProject(created.projectId)
  assert.equal(after.scene.content.timeline.animation.motionClips.length, 1)
  assert.notEqual(after.motions[actionUuid]!.sourceClip.sha256, project.motions[actionUuid]!.sourceClip.sha256)
})
