import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSkeletonMappingSuggestions, createRetargetCalibration, defaultReverseRetargetSettings, isUniversalCalibrationV1, isUniversalReferencePoseV1, MIXAMO65_BONE_PARENTS, type SemanticBonePair } from '@bbs/retarget'
import { validateProject, type UnifiedProject } from '@bbs/animation-workspace-shared'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject, UnifiedStoreError } from '../src/unifiedProjectStore.ts'
import { resolveProjectBlob, stageAssetUpload } from '../src/unifiedAssetFiles.ts'

const projectsDir = mkdtempSync(path.join(tmpdir(), 'bbs-skeleton-mapping-test-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
test.after(() => { rmSync(projectsDir, { recursive: true, force: true }) })

function glbWithBones(names: [string, string]): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, nodes: [{ name: names[0], children: [1] }, { name: names[1], translation: [0, 1, 0] }], skins: [{ joints: [0, 1], skeleton: 0 }] }))
  const chunk = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)])
  const result = Buffer.alloc(20 + chunk.length)
  result.write('glTF', 0, 'ascii'); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8)
  result.writeUInt32LE(chunk.length, 12); result.writeUInt32LE(0x4e4f534a, 16); chunk.copy(result, 20)
  return result
}

function glbWithHierarchy(names: string[], parents: Array<number | null>): Buffer {
  const nodes = names.map((name) => ({ name, children: [] as number[] }))
  parents.forEach((parent, index) => { if (parent !== null) nodes[parent]!.children.push(index) })
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, nodes, skins: [{ joints: names.map((_, index) => index), skeleton: 0 }] }))
  const chunk = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)])
  const result = Buffer.alloc(20 + chunk.length)
  result.write('glTF', 0, 'ascii'); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8)
  result.writeUInt32LE(chunk.length, 12); result.writeUInt32LE(0x4e4f534a, 16); chunk.copy(result, 20)
  return result
}

function mixamo65Glb(): Buffer {
  const names = MIXAMO65_BONE_PARENTS.map(([name]) => `mixamorig:${name}`)
  const indices = new Map(MIXAMO65_BONE_PARENTS.map(([name], index) => [name, index]))
  return glbWithHierarchy(names, MIXAMO65_BONE_PARENTS.map(([, parent]) => parent ? indices.get(parent)! : null))
}

function minecraft20Glb(): Buffer {
  const bones: Array<{ name: string; parent: string | null }> = [
    { name: 'anchor', parent: null }, { name: 'body', parent: 'anchor' }, { name: 'low_body', parent: 'body' }, { name: 'head', parent: 'low_body' },
    { name: 'left_arm', parent: 'low_body' }, { name: 'low_left_arm', parent: 'left_arm' }, { name: 'low_left_arm.end', parent: 'low_left_arm' },
    { name: 'right_arm', parent: 'low_body' }, { name: 'low_right_arm', parent: 'right_arm' }, { name: 'low_right_arm.end', parent: 'low_right_arm' },
    { name: 'left_leg', parent: 'body' }, { name: 'low_left_leg', parent: 'left_leg' }, { name: 'right_leg', parent: 'body' }, { name: 'low_leg_right', parent: 'right_leg' },
  ]
  const indices = new Map(bones.map((bone, index) => [bone.name, index]))
  return glbWithHierarchy(bones.map(({ name }) => name), bones.map(({ parent }) => parent ? indices.get(parent)! : null))
}

function fnvTrackFingerprint(): string {
  let hash = 2166136261
  const add = (value: unknown) => { for (const character of String(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619) } }
  for (const value of ['mixamorig:Hips.quaternion', 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]) add(value)
  return (hash >>> 0).toString(16)
}

async function importProfile(projectId: string, revision: number, names: [string, string]) {
  const bytes = glbWithBones(names)
  const upload = await stageAssetUpload('rig.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  return executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'asset.import', args: { files: [upload.id], format: 'glb' } })
}

test('skeleton.mapping.set stores a fingerprint-bound calibration and participates in history', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Mapping command test', scene: makeEmptyDraft('Mapping command test', 30, 90) } })
  const projectId = String(created.result.projectId)
  const sourceImport = await importProfile(projectId, 0, ['mixamorig:Hips', 'mixamorig:LeftArm'])
  const targetImport = await importProfile(projectId, 1, ['pelvis', 'left_upper_arm'])
  const project = await readUnifiedProject(projectId)
  const source = project.skeletons[(sourceImport.result.skeletonIds as string[])[0]!]!
  const target = project.skeletons[(targetImport.result.skeletonIds as string[])[0]!]!
  const pairs: SemanticBonePair[] = [
    { role: 'pelvis', sourceBoneId: '0', sourceBoneIds: ['0', '1'], sourceBoneWeights: [0.25, 0.75], targetBoneId: '0', enabled: true },
    { role: 'leftUpperArm', sourceBoneId: '1', targetBoneId: '1', enabled: true },
  ]
  const mapping = { id: randomUUID(), sourceProfileId: source.id, targetProfileId: target.id, sourceFingerprint: source.fingerprint, targetFingerprint: target.fingerprint, pairs, ignored: [] }
  const calibration = createRetargetCalibration(source.fingerprint, target.fingerprint, { ...defaultReverseRetargetSettings, intensity: 1.25, rootTravelMode: 'follow' })
  const draft = { requestId: randomUUID(), projectId, expectedRevision: 2, command: 'skeleton.mapping.set', args: { mapping, calibration } }
  const dryRun = await executeUnifiedCommand({ ...draft, requestId: randomUUID(), dryRun: true })
  assert.equal(dryRun.revision, 2)
  assert.ok(Array.isArray((dryRun.result.validationReport as { missingRequiredRoles: unknown[] }).missingRequiredRoles))
  await assert.rejects(executeUnifiedCommand({ ...draft, requestId: randomUUID(), args: { mapping: { ...mapping, pairs: pairs.map((pair) => pair.sourceBoneId === '0' ? { ...pair, sourceBoneWeights: [0, 0] } : pair) }, calibration }, dryRun: true }), /invalid bone assignments/)

  const saved = await executeUnifiedCommand(draft)
  assert.equal(saved.revision, 3)
  const mappingId = String(saved.result.mappingId)
  const savedProject = await readUnifiedProject(projectId)
  const persisted = savedProject.mappings[mappingId]!
  assert.deepEqual(persisted.pairs[0]!.sourceBoneIds, ['0', '1'])
  assert.deepEqual(persisted.pairs[0]!.sourceBoneWeights, [0.25, 0.75])
  assert.equal(persisted.confirmed, false)
  assert.match(persisted.calibration.path, /^mappings\/calibration\/[a-f0-9]{64}\.json$/)
  const calibrationBytes = await resolveProjectBlob(projectId, persisted.calibration)
  assert.deepEqual(JSON.parse(calibrationBytes.toString('utf8')), calibration)

  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'history.undo', args: {} })
  assert.equal(Object.keys((await readUnifiedProject(projectId)).mappings).length, 0)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 4, command: 'history.redo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).mappings[mappingId]!.calibration.sha256, persisted.calibration.sha256)

  const updatedCalibration = createRetargetCalibration(source.fingerprint, target.fingerprint, { ...defaultReverseRetargetSettings, intensity: 0.75 })
  const updated = await executeUnifiedCommand({ ...draft, requestId: randomUUID(), expectedRevision: 5, args: { mapping, calibration: updatedCalibration } })
  assert.equal(updated.revision, 6)
  const updatedMapping = (await readUnifiedProject(projectId)).mappings[mappingId]!
  assert.notEqual(updatedMapping.calibration.sha256, persisted.calibration.sha256)
  assert.deepEqual(JSON.parse((await resolveProjectBlob(projectId, updatedMapping.calibration)).toString('utf8')), updatedCalibration)

  const duplicateRole = structuredClone(savedProject)
  duplicateRole.mappings[mappingId]!.pairs[1]!.role = 'pelvis'
  assert.equal(validateProject(duplicateRole), false)
  const reasonedExtra = structuredClone(savedProject)
  reasonedExtra.mappings[mappingId]!.pairs = [reasonedExtra.mappings[mappingId]!.pairs[0]!]
  reasonedExtra.mappings[mappingId]!.ignored = [{ side: 'target', boneId: '1', reason: 'extra target bone' }]
  assert.equal(validateProject(reasonedExtra), true)
  reasonedExtra.mappings[mappingId]!.ignored = []
  assert.equal(validateProject(reasonedExtra), false)

  await assert.rejects(executeUnifiedCommand({ ...draft, requestId: randomUUID(), expectedRevision: 6, args: { ...draft.args, mapping: { ...mapping, sourceFingerprint: 'f'.repeat(64) } } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'PROFILE_MISMATCH')
  assert.equal((await readUnifiedProject(projectId)).revision, 6)

  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 6, command: 'history.undo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).mappings[mappingId]!.calibration.sha256, persisted.calibration.sha256)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 7, command: 'history.redo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).mappings[mappingId]!.calibration.sha256, updatedMapping.calibration.sha256)
})

test('mapping command requires a reason for every unmapped bone', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Mapping ignored test', scene: makeEmptyDraft('Mapping ignored test', 30, 90) } })
  const projectId = String(created.result.projectId)
  await importProfile(projectId, 0, ['hips', 'spine'])
  const targetImport = await importProfile(projectId, 1, ['pelvis', 'torso'])
  const project = await readUnifiedProject(projectId)
  const [source, target] = Object.values(project.skeletons)
  const mapping = { id: randomUUID(), sourceProfileId: source!.id, targetProfileId: target!.id, sourceFingerprint: source!.fingerprint, targetFingerprint: target!.fingerprint,
    pairs: [{ role: 'pelvis', sourceBoneId: '0', targetBoneId: '0', enabled: true }], ignored: [{ side: 'target', boneId: '1', reason: 'extra rig control' }] }
  const calibration = createRetargetCalibration(source!.fingerprint, target!.fingerprint)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 2, command: 'skeleton.mapping.set', args: { mapping, calibration } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  assert.equal((await readUnifiedProject(projectId)).revision, 2)
  assert.equal(targetImport.revision, 2)
})

test('skeleton.mapping.set seals Universal calibration to immutable reference and mapping hashes', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Universal calibration persistence', scene: makeEmptyDraft('Universal calibration persistence', 30, 90) } })
  const projectId = String(created.result.projectId)
  const sourceImport = await importProfile(projectId, 0, ['mixamorig:Hips', 'mixamorig:LeftArm'])
  const targetImport = await importProfile(projectId, 1, ['pelvis', 'left_upper_arm'])
  const project = await readUnifiedProject(projectId)
  const source = project.skeletons[(sourceImport.result.skeletonIds as string[])[0]!]!
  const target = project.skeletons[(targetImport.result.skeletonIds as string[])[0]!]!
  const mapping = { id: randomUUID(), sourceProfileId: source.id, targetProfileId: target.id,
    sourceFingerprint: source.fingerprint, targetFingerprint: target.fingerprint,
    pairs: [
      { role: 'pelvis', sourceBoneId: '0', targetBoneId: '0', enabled: true },
      { role: 'leftUpperArm', sourceBoneId: '1', targetBoneId: '1', enabled: true },
    ], ignored: [] }
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const referencePose = {
    type: 'bbs.universal-reference-pose', version: 1, coordinateSpace: 'scene-meters-v1',
    sourceFingerprint: source.fingerprint, targetFingerprint: target.fingerprint,
    source: { kind: 'rest', actionIndex: null, timeSeconds: null, bones: source.bones.map((bone) => ({ id: bone.id, world: matrix })) },
    target: { kind: 'rest', actionIndex: null, timeSeconds: null, bones: target.bones.map((bone) => ({ id: bone.id, world: matrix })) },
  }
  const calibration = {
    type: 'bbs.universal-calibration', version: 1, engine: 'universal', algorithmVersion: 'universal-1',
    sourceFingerprint: source.fingerprint, targetFingerprint: target.fingerprint, chainMode: 'world-average',
    alignmentRotation: [0, 0, 0, 1], corrections: [], rootTranslationPolicy: 'preserve', rootTranslationScale: 1,
  }
  assert.equal(isUniversalReferencePoseV1(referencePose, source.fingerprint, target.fingerprint,
    new Set(source.bones.map((bone) => bone.id)), new Set(target.bones.map((bone) => bone.id))), true)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 2, command: 'skeleton.mapping.set',
    args: { mapping, calibration, referencePose: { ...referencePose, source: { ...referencePose.source, bones: [] } } }, dryRun: true }), /reference pose/)
  const saved = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 2, command: 'skeleton.mapping.set', args: { mapping, calibration, referencePose } })
  const savedMapping = (await readUnifiedProject(projectId)).mappings[String(saved.result.mappingId)]!
  assert.match(savedMapping.referencePose?.path ?? '', /^mappings\/reference-poses\/[a-f0-9]{64}\.json$/)
  const savedReference = await resolveProjectBlob(projectId, savedMapping.referencePose!)
  const savedCalibration = JSON.parse((await resolveProjectBlob(projectId, savedMapping.calibration)).toString('utf8'))
  assert.equal(isUniversalCalibrationV1(savedCalibration, source.fingerprint, target.fingerprint), true)
  assert.equal(savedCalibration.sourceHash, source.provenance.sourceHash)
  assert.equal(savedCalibration.referencePoseSha256, savedMapping.referencePose!.sha256)
  assert.deepEqual(JSON.parse(savedReference.toString('utf8')), referencePose)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'history.undo', args: {} })
  assert.equal(Object.keys((await readUnifiedProject(projectId)).mappings).length, 0)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 4, command: 'history.redo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).mappings[savedMapping.id]!.referencePose!.sha256, savedMapping.referencePose!.sha256)
})

test('retarget.session.set persists V9.12 JSON by hash and participates in shared history', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Retarget session test', scene: makeEmptyDraft('Retarget session test', 30, 90) } })
  const projectId = String(created.result.projectId)
  const importGlb = async (revision: number, name: string, bytes: Buffer) => {
    const upload = await stageAssetUpload(name, new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
    return executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'asset.import', args: { files: [upload.id], format: 'glb' } })
  }
  const sourceImport = await importGlb(0, 'source.glb', mixamo65Glb())
  const targetImport = await importGlb(1, 'target.glb', minecraft20Glb())
  const beforeCharacter = await readUnifiedProject(projectId)
  const sourceProfile = beforeCharacter.skeletons[(sourceImport.result.skeletonIds as string[])[0]!]!
  const targetProfile = beforeCharacter.skeletons[(targetImport.result.skeletonIds as string[])[0]!]!
  const targetAssetId = (targetImport.result.assetIds as string[])[0]!
  const characterResult = await executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: 2, command: 'character.add',
    args: { assetId: targetAssetId, skeletonId: targetProfile.id, name: 'Target' },
  })
  const projectAfterCharacter = await readUnifiedProject(projectId)
  const sourceMapping = { id: sourceProfile.id, family: sourceProfile.family, fingerprint: sourceProfile.fingerprint, bones: sourceProfile.bones }
  const targetMapping = { id: targetProfile.id, family: targetProfile.family, fingerprint: targetProfile.fingerprint, bones: targetProfile.bones }
  const suggestions = buildSkeletonMappingSuggestions(sourceMapping, targetMapping)
  const pairs: SemanticBonePair[] = suggestions.flatMap((suggestion) => suggestion.sourceBoneId && suggestion.targetBoneId
    ? [{ role: suggestion.role, sourceBoneId: suggestion.sourceBoneId, targetBoneId: suggestion.targetBoneId, enabled: true }]
    : [])
  const usedSource = new Set(pairs.flatMap((pair) => pair.sourceBoneIds ?? [pair.sourceBoneId]))
  const usedTarget = new Set(pairs.map((pair) => pair.targetBoneId))
  const mapping = {
    id: randomUUID(), sourceProfileId: sourceProfile.id, targetProfileId: targetProfile.id,
    sourceFingerprint: sourceProfile.fingerprint, targetFingerprint: targetProfile.fingerprint, pairs,
    ignored: [
      ...sourceProfile.bones.filter((bone) => !usedSource.has(bone.id)).map((bone) => ({ side: 'source' as const, boneId: bone.id, reason: 'helper bone' })),
      ...targetProfile.bones.filter((bone) => !usedTarget.has(bone.id)).map((bone) => ({ side: 'target' as const, boneId: bone.id, reason: 'root/helper bone' })),
    ],
  }
  const calibration = createRetargetCalibration(sourceProfile.fingerprint, targetProfile.fingerprint)
  const mappingResult = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'skeleton.mapping.set', args: { mapping, calibration } })
  const mappingId = String(mappingResult.result.mappingId)

  const seeded = await readUnifiedProject(projectId)
  const sourceAssetId = (sourceImport.result.assetIds as string[])[0] as `sha256:${string}`
  const sourceAsset = seeded.assets[sourceAssetId]!
  const fileName = 'source.fbx'
  const nativeFingerprint = { kind: 'fbx', name: fileName, clip: 'Walk', duration: 1, tracks: 1, content: fnvTrackFingerprint() }
  sourceAsset.kind = 'motion'
  sourceAsset.source = { ...sourceAsset.source, path: `assets/${sourceAssetId.slice(7)}/${fileName}`, mediaType: 'application/vnd.autodesk.fbx' }
  sourceAsset.provenance.original = { ...sourceAsset.provenance.original, path: `originals/${sourceAssetId.slice(7)}/${fileName}`, mediaType: 'application/vnd.autodesk.fbx' }
  const sourceMotionId = randomUUID()
  seeded.motions[sourceMotionId] = {
    id: sourceMotionId, assetId: sourceAssetId, skeletonId: sourceProfile.id, durationSeconds: 1, sourceFps: 30,
    sourceClip: sourceAsset.provenance.original, evaluator: 'retarget-9.12', edit: null, derivedFrom: null,
  }
  seeded.extensions.retargetMotionMetadata = { [sourceMotionId]: { name: 'Walk', clipIndex: 0, nativeFingerprint } }
  assert.equal(validateProject(seeded), true)
  writeFileSync(path.join(projectsDir, projectId, 'project.json'), JSON.stringify(seeded))

  const targetNames = new Map(targetProfile.bones.map((bone) => [bone.id, bone.name]))
  const nativeProject = {
    type: 'mixamo-retarget-project', version: 1, build: 'V9.9', mode: 'retarget', rig: { source: 'mixamo65', target: 'bobj20' },
    source: nativeFingerprint,
    target: targetProfile.bones.map((bone) => [bone.name, bone.parentId === null ? null : targetNames.get(bone.parentId)!, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]]),
    tick: 0, previewSpeed: 1,
    state: { context: { offsets: {}, calibration: {}, segments: {}, mapping: {}, sourcePose: {}, interpolation: {}, feet: { enabled: false, mode: 'auto', side: 'both', floor: 0, height: 0.08, speed: 0.15, start: 0, end: 1, fade: 0.1 } }, controls: {}, sides: { proportionSide: 'both', handSide: 'both', motionSide: 'both' }, movement: {} },
  }
  const request = {
    requestId: randomUUID(), projectId, expectedRevision: 4, command: 'retarget.session.set',
    args: { sourceMotionId, targetCharacterId: String(characterResult.result.characterId), mappingId, nativeProject },
  }
  const dryRun = await executeUnifiedCommand({ ...request, requestId: randomUUID(), dryRun: true })
  assert.equal(dryRun.revision, 4)
  assert.equal(dryRun.result.valid, true)
  const saved = await executeUnifiedCommand(request)
  assert.equal(saved.revision, 5)
  const sessionId = String(saved.result.sessionId)
  const savedSession = (await readUnifiedProject(projectId)).retargetSessions[sessionId]!
  assert.match(savedSession.nativeProject.path, /^retarget\/sessions\/[a-f0-9]{64}\.json$/)
  assert.deepEqual(JSON.parse((await resolveProjectBlob(projectId, savedSession.nativeProject)).toString('utf8')), nativeProject)

  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 5, command: 'history.undo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).retargetSessions[sessionId], undefined)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 6, command: 'history.redo', args: {} })
  const restored = (await readUnifiedProject(projectId)).retargetSessions[sessionId]!
  assert.deepEqual(JSON.parse((await resolveProjectBlob(projectId, restored.nativeProject)).toString('utf8')), nativeProject)

  const stale = structuredClone(nativeProject)
  stale.source.content = 'deadbeef'
  await assert.rejects(executeUnifiedCommand({ ...request, requestId: randomUUID(), expectedRevision: 7, args: { ...request.args, nativeProject: stale } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'PROFILE_MISMATCH')
  assert.equal((await readUnifiedProject(projectId)).revision, 7)
})
