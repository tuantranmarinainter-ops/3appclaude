import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { duplicateDocumentNodes, makeEmptyDraft } from '@topview/3d-builder'
import { FCurveSet } from '@topview/3d-builder/evaluate'
import { validateProject } from '@bbs/animation-workspace-shared'
import { executeUnifiedCommand, readUnifiedProject, UnifiedStoreError } from '../src/unifiedProjectStore.ts'
import { buildImportedAsset, resolveUnifiedAssetFile, stageAssetUpload } from '../src/unifiedAssetFiles.ts'
import { inspectProjectRig, loadProjectRig } from '../src/unifiedRigInspection.ts'
import { sampleProjectCameraSequence, sampleProjectSkeletonRange } from '../src/unifiedSkeletonEvaluation.ts'
import { bakeProjectFilmPoseTracks, preflightProjectFilm, sampleProjectFilm } from '../src/unifiedFilmSampling.ts'
import { cancelUnifiedJob, getUnifiedJob, readUnifiedJobFile, startUnifiedNormalization, startUnifiedAssignment } from '../src/unifiedJobs.ts'
import { MIXAMO65_BONE_PARENTS, universalFramesToGlb, createUniversalRetargeter, createThreeRigAdapter, bakeUniversalRetargetFrames, createRetargetCalibration, type SemanticBonePair } from '@bbs/retarget'
import { planProjectNormalization, stageProjectNormalization } from '../src/unifiedNormalizationPlan.ts'
import { planProjectAssignment, stageProjectAssignment } from '../src/unifiedAssignment.ts'

const projectsDir = mkdtempSync(path.join(tmpdir(), 'bbs-asset-import-test-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
test.after(() => { rmSync(projectsDir, { recursive: true, force: true }) })

test('normalization plan resolves canonical profile identities and binds its hash to revision and mappings', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Normalization plan', scene: makeEmptyDraft('Normalization plan', 30, 90) } })
  const projectId = String(created.result.projectId)
  const worlds = new Map<string, THREE.Matrix4>()
  const rig = { fingerprint: 'synthetic65', bones: MIXAMO65_BONE_PARENTS.map(([name, parent]) => {
    const world = (parent ? worlds.get(parent)!.clone() : new THREE.Matrix4()).multiply(new THREE.Matrix4().makeTranslation(0, parent ? 0.1 : 1, 0))
    worlds.set(name, world)
    return { id: name, name, parentId: parent, restWorld: world.toArray() }
  }) }
  const pairs = rig.bones.map((bone) => ({ sourceBoneId: bone.id, targetBoneId: bone.id, enabled: true }))
  const frames = bakeUniversalRetargetFrames(createUniversalRetargeter(rig, rig, pairs), () => rig.bones.map((bone) => ({ id: bone.id, world: bone.restWorld })), { startFrame: 0, endFrame: 3, fps: 30 })
  const bytes = universalFramesToGlb(rig, rig.bones.map((bone) => bone.id), frames, 'Plan fixture')
  const upload = await stageAssetUpload('plan65.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'glb' } })
  let project = await readUnifiedProject(projectId)
  const assetId = (imported.result.assetIds as string[])[0]!, profileId = (imported.result.skeletonIds as string[])[0]!
  const profile = project.skeletons[profileId]!, mappingId = randomUUID()
  const mappingPairs: SemanticBonePair[] = profile.bones.map((bone) => ({ sourceBoneId: bone.id, targetBoneId: bone.id, enabled: true, role: `mixamo65:${bone.name}` }))
  const excludedBone = profile.bones.find((bone) => !/^(hips|spine|head|left(arm|forearm|hand|upleg|leg|foot)|right(arm|forearm|hand|upleg|leg|foot))$/i.test(bone.name.split(':').pop()!.replace(/^mixamorig\d*/i, '')))
  assert.ok(excludedBone, 'Canonical profile must include an optional bone for exclusion reporting')
  const exclusionReason = 'Auxiliary source bone intentionally omitted from normalized motion.'
  const spine = profile.bones.find((bone) => bone.name.endsWith(':Spine') || bone.name === 'Spine')
  assert.ok(spine, 'Canonical profile must include a spine bone')
  const spineChild = profile.bones.find((bone) => bone.parentId === spine.id)
  assert.ok(spineChild, 'Canonical profile must include an ordered source chain fixture')
  Object.assign(mappingPairs.find((pair) => pair.sourceBoneId === spine.id)!, { sourceBoneIds: [spine.id, spineChild.id], sourceBoneWeights: [1, 3] })
  project.mappings[mappingId] = { id: mappingId, sourceProfileId: profileId, targetProfileId: profileId,
    sourceFingerprint: profile.fingerprint, targetFingerprint: profile.fingerprint,
    pairs: mappingPairs.filter((pair) => pair.sourceBoneId !== excludedBone.id),
    ignored: [{ side: 'source', boneId: excludedBone.id, reason: exclusionReason }, { side: 'target', boneId: excludedBone.id, reason: 'Optional target bone remains at rest pose.' }],
    calibration: project.assets[assetId as keyof typeof project.assets]!.source, referencePose: null, confirmed: true }
  const args = { sourceAssetId: assetId, targetAssetId: assetId, mappingId, actionIndex: 0, fps: 30, rootTranslationScale: 1.5 }
  const inspection = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'rig.inspect', args: { assetId } })
  const inspectedGraph = inspection.result.graph as { bones: unknown[] }
  const inspectedActions = inspection.result.actions as Array<{ index: number; name: string; durationSeconds: number; channels: unknown[]; totalTrackCount: number; issues: unknown[]; ready: boolean }>
  assert.equal(inspectedActions.length, 1)
  assert.equal(inspectedActions[0]!.index, 0)
  assert.equal(inspectedActions[0]!.name, 'Plan fixture')
  assert.ok(inspectedActions[0]!.durationSeconds > 0)
  assert.equal(inspectedActions[0]!.channels.length, 195)
  assert.equal(inspectedActions[0]!.totalTrackCount, 195)
  assert.deepEqual(inspectedActions[0]!.issues, [])
  assert.equal(inspectedActions[0]!.ready, true)
  const { calibration: _calibration, referencePose: _referencePose, confirmed: _confirmed, ...draft } = project.mappings[mappingId]!
  const mappingCheck = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'skeleton.mapping.set',
    args: { mapping: draft, calibration: createRetargetCalibration(profile.fingerprint, profile.fingerprint) } })
  assert.equal(mappingCheck.result.valid, true)
  assert.deepEqual((mappingCheck.result.validationReport as { missingRequiredRoles: string[] }).missingRequiredRoles, [])
  const mappingSaved = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'skeleton.mapping.set',
    args: { mapping: draft, calibration: createRetargetCalibration(profile.fingerprint, profile.fingerprint) } })
  assert.equal(mappingSaved.revision, 2)
  project = await readUnifiedProject(projectId)
  assert.equal(project.mappings[mappingId]!.confirmed, true)
  const planResponse = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'rig.normalization.plan', args })
  const first = await planProjectNormalization(project, args)
  assert.equal(planResponse.result.planSha256, first.planSha256)
  assert.equal(first.ready, true)
  assert.equal(first.resourceCost.withinBudget, true)
  assert.equal(first.resourceCost.nodeSamples, first.sampleCount * 2 * inspectedGraph.bones.length)
  assert.deepEqual(first.excludedSourceBones, [{ sourceBoneId: excludedBone.id, name: excludedBone.name, reason: exclusionReason }])
  assert.equal(first.rootTranslationScale, 1.5)
  const profileLinks = inspection.result.profileBoneLinks as Array<{ profileBoneId: string; adapterNodeId: string | null }>
  const sourceSpine = profileLinks.find((link) => link.profileBoneId === spine.id)?.adapterNodeId
  const sourceSpineChild = profileLinks.find((link) => link.profileBoneId === spineChild.id)?.adapterNodeId
  assert.deepEqual(first.pairs.find((pair) => pair.targetBoneId === sourceSpine)?.sourceBoneIds, [sourceSpine, sourceSpineChild])
  assert.deepEqual(first.pairs.find((pair) => pair.targetBoneId === sourceSpine)?.sourceBoneWeights, [1, 3])
  assert.notEqual((await planProjectNormalization(project, { ...args, rootTranslationScale: 2 })).planSha256, first.planSha256)
  assert.equal(first.pairs.length, 64)
  assert.equal(first.sampleCount, Math.ceil(first.durationSeconds * args.fps) + 1)
  assert.equal((await planProjectNormalization(project, args)).planSha256, first.planSha256)
  const output = await stageProjectNormalization(project, args, first.planSha256)
  assert.equal(output.report.targetJointCount, 65)
  assert.deepEqual(output.report.excludedSourceBones, first.excludedSourceBones)
  assert.equal(output.report.rootTranslationScale, 1.5)
  assert.equal(output.provenance.outputSha256, createHash('sha256').update(output.bytes).digest('hex'))
  assert.equal(output.provenance.sourceRevision, project.revision)
  const runEnvelope = { requestId: randomUUID(), projectId, expectedRevision: 2, command: 'rig.normalization.run', args: { ...args, planSha256: first.planSha256 } }
  const runResponse = await executeUnifiedCommand(runEnvelope)
  assert.equal((await executeUnifiedCommand(runEnvelope)).result.jobId, runResponse.result.jobId)
  const started = { jobId: String(runResponse.result.jobId) }
  let job = await getUnifiedJob(started.jobId, projectId)
  for (let attempt = 0; attempt < 200 && ['queued', 'running'].includes(job.state); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    job = await getUnifiedJob(started.jobId, projectId)
  }
  assert.equal(job.state, 'succeeded', JSON.stringify(job.error))
  assert.equal(job.result!.provenance.committedToProject, false)
  const glbFile = job.result!.files.find((file) => file.mimeType === 'model/gltf-binary')!
  const downloaded = await readUnifiedJobFile(job.jobId, projectId, glbFile.id)
  assert.ok(downloaded)
  assert.equal(createHash('sha256').update(downloaded.bytes).digest('hex'), glbFile.sha256)
  assert.deepEqual(await cancelUnifiedJob(job.jobId, projectId), { state: 'succeeded', committed: false })
  const queued = await startUnifiedNormalization(project, args, first.planSha256)
  await assert.rejects(startUnifiedNormalization(project, args, first.planSha256),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'JOB_BUSY')
  assert.deepEqual(await cancelUnifiedJob(queued.jobId, projectId), { state: 'cancelled', committed: false })
  assert.equal((await getUnifiedJob(queued.jobId, projectId)).result, undefined)
  assert.equal(await readUnifiedJobFile(queued.jobId, projectId, '0'), null)
  const stale = await startUnifiedNormalization(project, args, '0'.repeat(64))
  let failed = await getUnifiedJob(stale.jobId, projectId)
  for (let attempt = 0; attempt < 200 && ['queued', 'running'].includes(failed.state); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10)); failed = await getUnifiedJob(stale.jobId, projectId)
  }
  assert.equal(failed.state, 'failed')
  assert.equal(failed.error?.code, 'NORMALIZATION_FAILED')
  assert.equal(await readUnifiedJobFile(stale.jobId, projectId, '0'), null)
  assert.equal((await readUnifiedProject(projectId)).revision, 2)
  project.revision++
  await assert.rejects(stageProjectNormalization(project, args, first.planSha256), /stale/)
  assert.notEqual((await planProjectNormalization(project, args)).planSha256, first.planSha256)
  project.mappings[mappingId]!.pairs = []
  const incomplete = await planProjectNormalization(project, args)
  assert.equal(incomplete.ready, false)
  assert.ok(incomplete.issues.some((issue) => issue.startsWith('REQUIRED_MAPPING_MISSING')))
  project.mappings[mappingId]!.sourceFingerprint = 'stale'
  await assert.rejects(planProjectNormalization(project, args), /fingerprints/)
  assert.equal((await readUnifiedProject(projectId)).revision, 2)
  const commitRequest = { requestId: randomUUID(), projectId, expectedRevision: 2, command: 'asset.import', args: { normalizationJobId: started.jobId } }
  const manifestPath = path.join(projectsDir, projectId, 'project.json'), manifestBytes = readFileSync(manifestPath)
  const externalEdit = JSON.parse(manifestBytes.toString('utf8')); externalEdit.name = 'External edit with same revision'
  writeFileSync(manifestPath, JSON.stringify(externalEdit))
  try {
    await assert.rejects(executeUnifiedCommand({ ...commitRequest, requestId: randomUUID() }),
      (error: unknown) => error instanceof UnifiedStoreError && error.code === 'REVISION_CONFLICT' && /snapshot content/.test(error.message))
  } finally { writeFileSync(manifestPath, manifestBytes) }
  const committed = await executeUnifiedCommand(commitRequest)
  assert.equal(committed.revision, 3)
  const derivedId = (committed.result.motionIds as string[])[0]!
  const saved = await readUnifiedProject(projectId)
  const derived = saved.motions[derivedId]!
  assert.ok(derived)
  assert.ok(derived.derivedFrom)
  const assignmentSnapshot = structuredClone(saved), receiverId = randomUUID()
  assignmentSnapshot.characters[receiverId] = { id: receiverId, assetId: assetId as `sha256:${string}`, nodeId: 'synthetic-receiver', skeletonId: profileId, name: 'Synthetic receiver' }
  const assignmentArgs = { motionId: derivedId, characterId: receiverId, fps: 30 }
  const assignmentPlan = await planProjectAssignment(assignmentSnapshot, assignmentArgs)
  assert.equal(assignmentPlan.ready, true)
  const assigned = await stageProjectAssignment(assignmentSnapshot, assignmentArgs, assignmentPlan.planSha256)
  assert.equal(assigned.assignment.matchedJoints, 65)
  assert.equal(assigned.provenance.sourceMotionId, derivedId)
  const nativeSnapshot = structuredClone(assignmentSnapshot)
  nativeSnapshot.motions[derivedId]!.evaluator = 'animation-1.31.8'
  nativeSnapshot.motions[derivedId]!.sourceClip = saved.assets[derived.assetId]!.source
  const nativePlan = await planProjectAssignment(nativeSnapshot, assignmentArgs)
  assert.equal(nativePlan.sourceSha256, saved.assets[derived.assetId]!.source.sha256)
  assert.equal((await stageProjectAssignment(nativeSnapshot, assignmentArgs, nativePlan.planSha256)).assignment.matchedJoints, 65)
  nativeSnapshot.motions[derivedId]!.sourceClip.sha256 = '0'.repeat(64)
  await assert.rejects(planProjectAssignment(nativeSnapshot, assignmentArgs))
  assignmentSnapshot.revision++
  await assert.rejects(stageProjectAssignment(assignmentSnapshot, assignmentArgs, assignmentPlan.planSha256), /stale/)
  assert.equal(saved.assets[derived.assetId]!.provenance.legacyId, `normalization-job:${started.jobId}`)
  assert.deepEqual(saved.assets[derived.assetId]!.dependencies, [assetId])
  const reportKey = Object.keys(saved.assets[derived.assetId]!.derivatives).find((key) => key.startsWith('normalizationReport_'))!
  assert.ok(reportKey)
  const persistedReport = await resolveUnifiedAssetFile(saved, derived.assetId, reportKey)
  const report = JSON.parse(persistedReport.bytes.toString('utf8'))
  assert.equal(report.provenance.planSha256, first.planSha256)
  assert.equal(report.provenance.outputSha256, glbFile.sha256)
  assert.deepEqual(report.excludedSourceBones, first.excludedSourceBones)
  assert.equal((await executeUnifiedCommand(commitRequest)).revision, 3)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'history.undo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).motions[derivedId], undefined)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 4, command: 'history.redo', args: {} })
  assert.ok((await readUnifiedProject(projectId)).motions[derivedId])
  assert.deepEqual((await resolveUnifiedAssetFile(await readUnifiedProject(projectId), derived.assetId, reportKey)).bytes, persistedReport.bytes)
  await assert.rejects(executeUnifiedCommand({ ...commitRequest, requestId: randomUUID(), expectedRevision: 5 }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'REVISION_CONFLICT')

  const hostProject = await readUnifiedProject(projectId)
  hostProject.assets[assetId as keyof typeof hostProject.assets]!.kind = 'model'
  writeFileSync(manifestPath, JSON.stringify(hostProject))
  const characterA = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 5, command: 'character.add',
    args: { assetId, skeletonId: profileId, name: 'Character A' } })
  const characterB = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: characterA.revision, command: 'character.add',
    args: { assetId, skeletonId: profileId, name: 'Character B' } })
  const characterC = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: characterB.revision, command: 'character.add',
    args: { assetId, skeletonId: profileId, name: 'Character C' } })
  const characterIds = [characterA, characterB, characterC].map((response) => String(response.result.characterId))
  const characterId = characterIds[2]!, committedSource = await readUnifiedProject(projectId)
  const commitArgs = { motionId: derivedId, characterId, fps: 30 }
  const hostAssignmentPlan = await planProjectAssignment(committedSource, commitArgs)
  const runAssignment = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: committedSource.revision,
    command: 'animation.assignment.run', args: { ...commitArgs, planSha256: hostAssignmentPlan.planSha256 } })
  let assignmentJob = await getUnifiedJob(String(runAssignment.result.jobId), projectId)
  for (let attempt = 0; attempt < 200 && ['queued', 'running'].includes(assignmentJob.state); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10)); assignmentJob = await getUnifiedJob(assignmentJob.jobId, projectId)
  }
  assert.equal(assignmentJob.type, 'animation.assignment.run')
  assert.equal(assignmentJob.state, 'succeeded', JSON.stringify(assignmentJob.error))
  assert.equal(assignmentJob.result!.provenance.committedToProject, false)
  const assignmentCommit = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: committedSource.revision,
    command: 'asset.import', args: { assignmentJobId: assignmentJob.jobId } })
  const assignedProject = await readUnifiedProject(projectId)
  const assignedMotionId = String((assignmentCommit.result.assignment as { motionId: string }).motionId)
  const assignedClipId = String((assignmentCommit.result.assignment as { clipId: string }).clipId)
  assert.ok(assignedProject.motions[assignedMotionId])
  assert.equal(assignedProject.motions[assignedMotionId]!.skeletonId, profileId)
  assert.equal(assignedProject.bindings[assignedClipId]!.characterId, characterId)
  assert.equal(assignedProject.bindings[assignedClipId]!.motionId, assignedMotionId)
  assert.deepEqual(Object.values(assignedProject.bindings).filter((binding) => characterIds.slice(0, 2).includes(binding.characterId)), [])
  assert.ok(assignedProject.motions[derivedId], 'Assignment must preserve the normalized source Motion')
  const assignmentAssetId = assignedProject.motions[assignedMotionId]!.assetId
  const assignmentReportKey = Object.keys(assignedProject.assets[assignmentAssetId]!.derivatives).find((key) => key.startsWith('assignmentReport_'))!
  const assignmentReport = await resolveUnifiedAssetFile(assignedProject, assignmentAssetId, assignmentReportKey)
  assert.equal(JSON.parse(assignmentReport.bytes.toString('utf8')).provenance.receiverCharacterId, characterId)
  assert.equal((await planProjectAssignment(assignedProject, { motionId: assignedMotionId, characterId, fps: 30 })).ready, true)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: assignmentCommit.revision, command: 'history.undo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).motions[assignedMotionId], undefined)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: assignmentCommit.revision + 1, command: 'history.redo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).bindings[assignedClipId]!.motionId, assignedMotionId)
})

test('Universal reference calibration survives blob reload and changes normalization output and plan hash', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Universal calibration plan', scene: makeEmptyDraft('Universal calibration plan', 30, 90) } })
  const projectId = String(created.result.projectId)
  const worlds = new Map<string, THREE.Matrix4>()
  const rig = { fingerprint: 'universal-calibration-source', bones: MIXAMO65_BONE_PARENTS.map(([name, parent]) => {
    const world = (parent ? worlds.get(parent)!.clone() : new THREE.Matrix4()).multiply(new THREE.Matrix4().makeTranslation(0, parent ? 0.04 : 1, 0))
    worlds.set(name, world)
    return { id: name, name: `mixamorig:${name}`, parentId: parent, restWorld: world.toArray() }
  }) }
  const pairs = rig.bones.map((bone) => ({ sourceBoneId: bone.id, targetBoneId: bone.id, enabled: true }))
  const solver = createUniversalRetargeter(rig, rig, pairs)
  const frames = bakeUniversalRetargetFrames(solver, (time) => {
    const travel = new THREE.Matrix4().makeTranslation(time, 0, 0)
    return rig.bones.map((bone) => ({ id: bone.id, world: travel.clone().multiply(new THREE.Matrix4().fromArray(bone.restWorld)).toArray() }))
  }, { startFrame: 0, endFrame: 3, fps: 30 })
  const bytes = universalFramesToGlb(rig, rig.bones.map((bone) => bone.id), frames, 'Calibration travel')
  const upload = await stageAssetUpload('calibration.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'glb' } })
  const assetId = (imported.result.assetIds as string[])[0]!, profileId = (imported.result.skeletonIds as string[])[0]!
  let project = await readUnifiedProject(projectId)
  const profile = project.skeletons[profileId]!
  assert.equal(profile.family, 'mixamo65')
  const inspection = await inspectProjectRig(project, assetId, undefined, profileId)
  assert.equal(inspection.actions.length, 1)
  const profileToAdapter = new Map(inspection.profileBoneLinks.map((link) => [link.profileBoneId, link.adapterNodeId]))
  const graphBones = new Map(inspection.graph.bones.map((bone) => [bone.id, bone]))
  const referenceBones = profile.bones.map((bone) => {
    const adapterId = profileToAdapter.get(bone.id), world = adapterId ? graphBones.get(adapterId)?.restWorld : undefined
    assert.ok(world, `reference pose resolves ${bone.name}`)
    return { id: bone.id, world: [...world] }
  })
  const targetLoaded = await loadProjectRig(project, assetId, undefined, profileId)
  const targetAdapter = createThreeRigAdapter(targetLoaded.group, { ...targetLoaded.options, collectUnsupportedTracks: true })
  let targetActionReference: Array<{ id: string; world: number[] }>
  try {
    const targetActionSample = new Map(targetAdapter.sample(0, 0.05).map((bone) => [bone.id, bone.world]))
    targetActionReference = profile.bones.map((bone) => {
      const sourceUuid = targetLoaded.profileNodeUUIDs.get(bone.id)
      const adapterId = sourceUuid ? targetAdapter.nodeIdsBySourceUUID.get(sourceUuid) : undefined
      const world = adapterId ? targetActionSample.get(adapterId) : undefined
      assert.ok(world, `target Action reference resolves ${bone.name}`)
      return { id: bone.id, world: [...world] }
    })
  } finally { targetAdapter.dispose() }
  const referencePose = {
    type: 'bbs.universal-reference-pose', version: 1, coordinateSpace: 'scene-meters-v1',
    sourceFingerprint: profile.fingerprint, targetFingerprint: profile.fingerprint,
    source: { kind: 'rest', actionIndex: null, timeSeconds: null, bones: referenceBones },
    target: { kind: 'action', actionIndex: 0, timeSeconds: 0.05, bones: targetActionReference },
  }
  const mappingId = randomUUID()
  const mapping = { id: mappingId, sourceProfileId: profileId, targetProfileId: profileId,
    sourceFingerprint: profile.fingerprint, targetFingerprint: profile.fingerprint,
    pairs: profile.bones.map((bone) => ({ role: `mixamo65:${bone.name.split(':').pop()}`, sourceBoneId: bone.id, targetBoneId: bone.id, enabled: true })), ignored: [] }
  const calibration = (alignmentRotation: [number, number, number, number]) => ({
    type: 'bbs.universal-calibration', version: 1, engine: 'universal', algorithmVersion: 'universal-1',
    sourceFingerprint: profile.fingerprint, targetFingerprint: profile.fingerprint, chainMode: 'world-average',
    alignmentRotation, corrections: [], rootTranslationPolicy: 'preserve', rootTranslationScale: 1,
  })
  const identity: [number, number, number, number] = [0, 0, 0, 1]
  const saved = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'skeleton.mapping.set',
    args: { mapping, calibration: calibration(identity), referencePose } })
  project = await readUnifiedProject(projectId)
  const args = { sourceAssetId: assetId, targetAssetId: assetId, mappingId, actionIndex: 0, fps: 30 }
  const firstPlan = await planProjectNormalization(project, args)
  assert.equal(firstPlan.ready, true, firstPlan.issues.join(','))
  assert.equal(firstPlan.calibrationMode, 'universal-v1')
  const firstOutput = await stageProjectNormalization(project, args, firstPlan.planSha256)

  const quarterTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).toArray() as [number, number, number, number]
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: saved.revision, command: 'skeleton.mapping.set',
    args: { mapping, calibration: calibration(quarterTurn), referencePose } })
  project = await readUnifiedProject(projectId)
  const secondPlan = await planProjectNormalization(project, args)
  assert.equal(secondPlan.ready, true, secondPlan.issues.join(','))
  assert.notEqual(secondPlan.planSha256, firstPlan.planSha256)
  assert.notEqual(secondPlan.calibrationSha256, firstPlan.calibrationSha256)
  const secondOutput = await stageProjectNormalization(project, args, secondPlan.planSha256)
  assert.notEqual(createHash('sha256').update(secondOutput.bytes).digest('hex'), createHash('sha256').update(firstOutput.bytes).digest('hex'))
})

function makeGlb(document: Record<string, unknown>): Buffer {
  const json = Buffer.from(JSON.stringify(document))
  const padding = (4 - json.length % 4) % 4
  const chunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)])
  const result = Buffer.alloc(20 + chunk.length)
  result.write('glTF', 0, 'ascii')
  result.writeUInt32LE(2, 4)
  result.writeUInt32LE(result.length, 8)
  result.writeUInt32LE(chunk.length, 12)
  result.writeUInt32LE(0x4e4f534a, 16)
  chunk.copy(result, 20)
  return result
}

function makeGlbWithBinary(document: Record<string, unknown>, binary: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify(document))
  const jsonPadding = (4 - json.length % 4) % 4
  const binaryPadding = (4 - binary.length % 4) % 4
  const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)])
  const binaryChunk = Buffer.concat([binary, Buffer.alloc(binaryPadding)])
  const result = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binaryChunk.length)
  result.write('glTF', 0, 'ascii'); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8)
  result.writeUInt32LE(jsonChunk.length, 12); result.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(result, 20)
  const binHeader = 20 + jsonChunk.length
  result.writeUInt32LE(binaryChunk.length, binHeader); result.writeUInt32LE(0x004e4942, binHeader + 4); binaryChunk.copy(result, binHeader + 8)
  return result
}

function glbWithSkin(): Buffer {
  return makeGlb({
    asset: { version: '2.0' },
    nodes: [{ name: 'root', children: [1] }, { name: 'spine', translation: [0, 1, 0] }],
    scenes: [{ nodes: [0] }], scene: 0,
    skins: [{ joints: [0, 1], skeleton: 0 }],
  })
}

function glbModelVariant(input: Uint8Array, tag: string): Buffer {
  const jsonLength = Buffer.from(input.buffer, input.byteOffset, input.byteLength).readUInt32LE(12)
  const document = JSON.parse(Buffer.from(input.buffer, input.byteOffset + 20, jsonLength).toString('utf8').trim()) as Record<string, unknown>
  document.meshes = [{}]; document.extras = { fixture: tag }
  const encoded = Buffer.from(JSON.stringify(document)), padded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 0x20)])
  const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength), tail = source.subarray(20 + jsonLength)
  const output = Buffer.alloc(12 + padded.length + tail.length)
  source.copy(output, 0, 0, 12); output.writeUInt32LE(output.length, 8); output.writeUInt32LE(padded.length, 12); output.writeUInt32LE(0x4e4f534a, 16)
  padded.copy(output, 20); tail.copy(output, 20 + padded.length)
  return output
}

function glbWithoutSkin(): Buffer {
  return makeGlb({ asset: { version: '2.0' }, nodes: [{ name: 'unrigged_prop' }] })
}

test('GLB skeleton import rejects cyclic joint ancestry before traversal can hang', () => {
  const bytes = makeGlb({ asset: { version: '2.0' },
    nodes: [{ name: 'a', children: [1] }, { name: 'b', children: [0] }], skins: [{ joints: [0, 1] }] })
  assert.throws(() => buildImportedAsset({ id: randomUUID(), name: 'cycle.glb', bytes,
    byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, 'glb'), /hierarchy cycle/)
})

test('GLB matrix rest transforms produce the same profile as equivalent TRS and reject shear/mixed encoding', () => {
  const position = [2, 3, -4], rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7), scale = [2, 2, 2]
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position), rotation, new THREE.Vector3(...scale)).toArray()
  function imported(node: Record<string, unknown>) {
    const bytes = makeGlb({ asset: { version: '2.0' }, nodes: [{ name: 'Hips', ...node }], skins: [{ joints: [0] }] })
    return buildImportedAsset({ id: randomUUID(), name: 'matrix.glb', bytes, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, 'glb')
  }
  const fromMatrix = imported({ matrix }).skeleton!, fromTrs = imported({ translation: position, rotation: rotation.toArray(), scale }).skeleton!
  assert.equal(fromMatrix.fingerprint, fromTrs.fingerprint)
  const rest = fromMatrix.bones[0]!.rest as { position: number[]; rotation: number[]; scale: number[] }
  assert.deepEqual(rest.position, position)
  assert.ok(new THREE.Quaternion().fromArray(rest.rotation).angleTo(rotation) < 1e-6)
  assert.throws(() => imported({ matrix, translation: position }), /mixed matrix/)
  assert.throws(() => imported({ translation: 'invalid' }), /malformed TRS/)
  const shear = new THREE.Matrix4(); shear.elements[4] = 0.5
  assert.throws(() => imported({ matrix: shear.toArray() }), /shear/)
  assert.throws(() => imported({ matrix: new THREE.Matrix4().makeScale(0, 1, 1).toArray() }), /invertible/)
})

function glbWithAnimatedSkin(): Buffer {
  const binary = Buffer.alloc(32)
  binary.writeFloatLE(0, 0); binary.writeFloatLE(1, 4)
  binary.writeFloatLE(0, 8); binary.writeFloatLE(1, 12); binary.writeFloatLE(0, 16)
  binary.writeFloatLE(0, 20); binary.writeFloatLE(2, 24); binary.writeFloatLE(0, 28)
  return makeGlbWithBinary({
    asset: { version: '2.0' },
    nodes: [{ name: 'root', children: [1] }, { name: 'hips', translation: [0, 1, 0] }],
    scenes: [{ nodes: [0] }], scene: 0, skins: [{ joints: [0, 1], skeleton: 0 }], buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }, { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3', min: [0, 1, 0], max: [0, 2, 0] }],
    animations: [{ name: 'Walk', samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] }],
  }, binary)
}

function glbAnimationOnly(): Buffer {
  const binary = Buffer.alloc(32)
  binary.writeFloatLE(0, 0); binary.writeFloatLE(1, 4)
  binary.writeFloatLE(0, 8); binary.writeFloatLE(1, 12); binary.writeFloatLE(0, 16)
  binary.writeFloatLE(0, 20); binary.writeFloatLE(2, 24); binary.writeFloatLE(0, 28)
  return makeGlbWithBinary({
    asset: { version: '2.0' }, nodes: [{ name: 'root', children: [1] }, { name: 'spine', translation: [0, 1, 0] }],
    scenes: [{ nodes: [0] }], scene: 0, buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }, { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3', min: [0, 1, 0], max: [0, 2, 0] }],
    animations: [{ name: 'Walk', samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] }],
  }, binary)
}

function glbWithMinecraft20Skeleton(): Buffer {
  const bones: Array<{ name: string; parent: string | null }> = [
    { name: 'anchor', parent: null }, { name: 'body', parent: 'anchor' }, { name: 'low_body', parent: 'body' },
    { name: 'head', parent: 'low_body' }, { name: 'left_arm', parent: 'low_body' }, { name: 'low_left_arm', parent: 'left_arm' },
    { name: 'low_left_arm.end', parent: 'low_left_arm' }, { name: 'right_arm', parent: 'low_body' }, { name: 'low_right_arm', parent: 'right_arm' },
    { name: 'low_right_arm.end', parent: 'low_right_arm' }, { name: 'left_leg', parent: 'body' }, { name: 'low_left_leg', parent: 'left_leg' },
    { name: 'right_leg', parent: 'body' }, { name: 'low_leg_right', parent: 'right_leg' },
  ]
  const indices = new Map(bones.map((bone, index) => [bone.name, index]))
  const nodes = bones.map(({ name }) => ({ name, children: [] as number[] }))
  bones.forEach(({ parent }, index) => { if (parent) nodes[indices.get(parent)!]!.children.push(index) })
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, nodes, skins: [{ joints: bones.map((_, index) => index), skeleton: 0 }] }))
  const chunk = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)])
  const result = Buffer.alloc(20 + chunk.length)
  result.write('glTF', 0, 'ascii'); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8)
  result.writeUInt32LE(chunk.length, 12); result.writeUInt32LE(0x4e4f534a, 16); chunk.copy(result, 20)
  return result
}

test('asset.import stores verified GLB bytes and a content-derived skeleton profile atomically', async () => {
  const created = await executeUnifiedCommand({
    requestId: randomUUID(), command: 'project.create',
    args: { name: 'Asset import test', scene: makeEmptyDraft('Asset import test', 30, 90, { fov: 50, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }) },
  })
  const projectId = String(created.result.projectId)
  const bytes = glbWithSkin()
  const upload = await stageAssetUpload('C:\\private\\rig.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  assert.equal(upload.name, 'rig.glb')

  const request = { requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'auto' } }
  const response = await executeUnifiedCommand(request)
  assert.equal(response.revision, 1)
  assert.equal((response.result.skeletonIds as string[]).length, 1)
  const project = await readUnifiedProject(projectId)
  const assetId = (response.result.assetIds as string[])[0]!
  const asset = project.assets[assetId as keyof typeof project.assets]!
  assert.ok(project.skeletons[(response.result.skeletonIds as string[])[0]!])
  assert.equal(Object.values(project.skeletons)[0]?.bones.length, 2)
  assert.equal(Object.values(project.skeletons)[0]?.family, 'custom-preserved')
  assert.deepEqual((await resolveUnifiedAssetFile(project, assetId, 'source')).bytes, bytes)
  assert.equal((await executeUnifiedCommand(request)).revision, 1)

  const inspected = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'rig.inspect', args: { assetId, skeletonProfileId: (response.result.skeletonIds as string[])[0] } })
  assert.equal(inspected.revision, 1)
  assert.equal(inspected.result.sourceSha256, asset.source.sha256)
  assert.equal((inspected.result.jointIds as string[]).length, 2)
  assert.equal((inspected.result.graph as { bones: unknown[] }).bones.length, 3)
  assert.ok((inspected.result.profileBoneLinks as Array<{ status: string; adapterNodeId: string }>).every((link) => link.status === 'matched' && link.adapterNodeId))
  assert.equal((await readUnifiedProject(projectId)).revision, 1)
  for (const args of [
    { sourceAssetId: assetId, targetAssetId: assetId, mappingId: 'missing', actionIndex: 0, fps: 30 },
    { sourceAssetId: assetId, targetAssetId: assetId, mappingId: 'missing', actionIndex: 0, fps: 0 },
    { sourceAssetId: assetId, targetAssetId: assetId, mappingId: 'missing', actionIndex: 0, fps: 30, rootTranslationScale: 21 },
  ]) {
    await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'rig.normalization.plan', args }),
      (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  }
  assert.equal((await readUnifiedProject(projectId)).revision, 1)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'rig.inspect', args: { assetId: 'missing' } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')

  const skeletonId = (response.result.skeletonIds as string[])[0]!
  const fingerprint = project.skeletons[skeletonId]!.fingerprint
  const added = await executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: 1, command: 'character.add',
    args: { assetId, skeletonId, name: 'Imported Rig', transform: { position: { x: 2, y: 0, z: -1 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
  })
  assert.equal(added.revision, 2)
  const withCharacter = await readUnifiedProject(projectId)
  const character = withCharacter.characters[String(added.result.characterId)]!
  assert.equal(character.nodeId, added.result.nodeId)
  assert.equal(withCharacter.scene.content.nodes.find((node) => node.id === character.nodeId)?.metadata?.characterId, character.id)
  assert.equal(withCharacter.scene.content.nodes.find((node) => node.id === character.nodeId)?.metadata?.modelUrl, `/api/unified/projects/${projectId}/assets/${encodeURIComponent(assetId)}/source`)

  const duplicateUpload = await stageAssetUpload('renamed.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const duplicate = await executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: 2, command: 'asset.import', args: { files: [duplicateUpload.id], format: 'auto' },
  })
  assert.equal(duplicate.revision, 2)
  assert.deepEqual(duplicate.result.skeletonIds, [skeletonId])
  assert.equal((await readUnifiedProject(projectId)).skeletons[skeletonId]!.fingerprint, fingerprint)
})

test('GLTF skeleton links use node identity when bone labels are duplicated', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Duplicate bone labels', scene: makeEmptyDraft('Duplicate bone labels', 30, 90) } })
  const projectId = String(created.result.projectId)
  const bytes = makeGlb({ asset: { version: '2.0' }, nodes: [{ name: 'Joint', children: [1] }, { name: 'Joint' }],
    scenes: [{ nodes: [0] }], scene: 0, skins: [{ joints: [0, 1], skeleton: 0 }] })
  const upload = await stageAssetUpload('duplicate-joints.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'glb' } })
  const assetId = String((imported.result.assetIds as string[])[0]!)
  const inspection = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'rig.inspect', args: { assetId } })
  const links = inspection.result.profileBoneLinks as Array<{ profileBoneId: string; adapterNodeId: string | null; status: string }>
  assert.equal(links.length, 2)
  assert.ok(links.every((link) => link.status === 'matched' && link.adapterNodeId))
  assert.notEqual(links[0]!.adapterNodeId, links[1]!.adapterNodeId)
})

test('asset.import rejects a model rebind report that is not bound to a complete GLB result', async () => {
  const created = await executeUnifiedCommand({
    requestId: randomUUID(), command: 'project.create',
    args: { name: 'Invalid rebind report', scene: makeEmptyDraft('Invalid rebind report', 30, 90, { fov: 50, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }) },
  })
  const projectId = String(created.result.projectId)
  const bytes = glbWithSkin()
  const upload = await stageAssetUpload('rebind.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import',
    args: { files: [upload.id], format: 'glb', modelRebindReport: { schema: 'bbs-model-rebind-report', outputSha256: upload.sha256 } } }),
  (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  assert.equal((await readUnifiedProject(projectId)).revision, 0)
})

test('asset.import persists a hash-bound Model+Rig+Animation rebind report as an asset derivative', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create',
    args: { name: 'Persist rebind report', scene: makeEmptyDraft('Persist rebind report', 30, 90) } })
  const projectId = String(created.result.projectId), worlds = new Map<string, THREE.Matrix4>()
  const rig = { fingerprint: 'report-fixture', bones: MIXAMO65_BONE_PARENTS.map(([name, parent]) => {
    const world = (parent ? worlds.get(parent)!.clone() : new THREE.Matrix4()).multiply(new THREE.Matrix4().makeTranslation(0, parent ? 0.1 : 1, 0))
    worlds.set(name, world)
    return { id: name, name, parentId: parent, restWorld: world.toArray() }
  }) }
  const frames = bakeUniversalRetargetFrames(createUniversalRetargeter(rig, rig, rig.bones.map((bone) => ({ sourceBoneId: bone.id, targetBoneId: bone.id, enabled: true }))),
    () => rig.bones.map((bone) => ({ id: bone.id, world: bone.restWorld })), { startFrame: 0, endFrame: 3, fps: 30 })
  const sourceBytes = glbModelVariant(universalFramesToGlb(rig, rig.bones.map((bone) => bone.id), frames, 'Report fixture'), 'source')
  const sourceUpload = await stageAssetUpload('source.glb', new ReadableStream({ start(controller) { controller.enqueue(sourceBytes); controller.close() } }))
  const sourceImport = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [sourceUpload.id], format: 'glb' } })
  const beforeMapping = await readUnifiedProject(projectId), profileId = String((sourceImport.result.skeletonIds as string[])[0]!)
  const profile = beforeMapping.skeletons[profileId]!, sourceAssetId = String((sourceImport.result.assetIds as string[])[0]!)
  const roleByName = new Map(MIXAMO65_BONE_PARENTS.map(([name]) => [name.toLowerCase(), name]))
  const mappingId = randomUUID(), mapping = { id: mappingId, sourceProfileId: profile.id, targetProfileId: profile.id,
    sourceFingerprint: profile.fingerprint, targetFingerprint: profile.fingerprint,
    pairs: profile.bones.map((bone) => ({ sourceBoneId: bone.id, targetBoneId: bone.id, enabled: true, role: `mixamo65:${roleByName.get(bone.name.split(':').at(-1)!.toLowerCase()) ?? bone.name}` })), ignored: [] }
  const saved = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'skeleton.mapping.set',
    args: { mapping, calibration: createRetargetCalibration(profile.fingerprint, profile.fingerprint) } })
  const motionId = String((sourceImport.result.motionIds as string[])[0]!)
  const outputBytes = glbModelVariant(universalFramesToGlb(rig, rig.bones.map((bone) => bone.id), frames, 'Report fixture'), 'output')
  const outputUpload = await stageAssetUpload('rebound.glb', new ReadableStream({ start(controller) { controller.enqueue(outputBytes); controller.close() } }))
  const report = { schema: 'bbs-model-rebind-report', version: 1, producer: 'studio-client', outputSha256: outputUpload.sha256,
    sourceAssetId, sourceSha256: sourceUpload.sha256, sourceProfileId: profile.id, sourceFingerprint: profile.fingerprint,
    targetProfileId: profile.id, targetFingerprint: profile.fingerprint, mappingId, motionId, actionName: 'Report fixture', durationSeconds: 0.1,
    weightedSourceJoints: 65, ownerCount: 65, vertices: 3, targetJoints: 65, maxRestError: 0,
    meshes: [{ mesh: 'Body', vertices: 3, droppedWeight: 0, affectedVertices: 0 }], renamedSourceNodes: [] }
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: saved.revision, command: 'asset.import',
    args: { files: [outputUpload.id], format: 'glb', modelRebindReport: report } })
  const stored = imported.result.modelRebindReports as Array<{ assetId: string; variant: string; sha256: string }>
  assert.equal(stored.length, 1)
  const project = await readUnifiedProject(projectId), asset = project.assets[stored[0]!.assetId as `sha256:${string}`]!
  assert.equal(asset.derivatives[stored[0]!.variant]!.sha256, stored[0]!.sha256)
  assert.deepEqual(JSON.parse((await resolveUnifiedAssetFile(project, asset.id, stored[0]!.variant)).bytes.toString('utf8')), report)
})

test('asset.import records GLB rig animation as an assignable target-profile Motion', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create',
    args: { name: 'Animated GLB import', scene: makeEmptyDraft('Animated GLB import', 30, 90, { fov: 50, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }) } })
  const projectId = String(created.result.projectId)
  const modelUpload = await stageAssetUpload('target-rig.glb', new ReadableStream({ start(controller) { controller.enqueue(glbWithSkin()); controller.close() } }))
  const modelImport = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [modelUpload.id], format: 'glb' } })
  let project = await readUnifiedProject(projectId)
  const targetAssetId = (modelImport.result.assetIds as string[])[0]!
  const targetProfileId = (modelImport.result.skeletonIds as string[])[0]!
  const targetCharacter = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'character.add', args: { assetId: targetAssetId, skeletonId: targetProfileId, name: 'Assignment target' } })
  const targetCharacterId = String(targetCharacter.result.characterId)
  const bytes = glbAnimationOnly()
  const upload = await stageAssetUpload('normalized-motion.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 2, command: 'asset.import', args: { files: [upload.id], format: 'glb', skeletonProfileId: targetProfileId } })
  project = await readUnifiedProject(projectId)
  const motionId = (imported.result.motionIds as string[])[0]!
  const motion = project.motions[motionId]!
  assert.equal(motion.evaluator, 'topview-0.1.8')
  assert.equal(motion.durationSeconds, 1)
  assert.equal(motion.skeletonId, targetProfileId)
  assert.equal(project.assets[motion.assetId]!.kind, 'motion')
  assert.equal((project.extensions.retargetMotionMetadata as Record<string, { name: string; clipIndex: number; nativeFingerprint: { kind: string } }>)[motionId]!.name, 'Walk')
  assert.equal((project.extensions.retargetMotionMetadata as Record<string, { name: string; clipIndex: number; nativeFingerprint: { kind: string } }>)[motionId]!.nativeFingerprint.kind, 'gltf')
  assert.equal((await resolveUnifiedAssetFile(project, motion.assetId, 'source')).bytes.compare(bytes), 0)
  const placed = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'motion.place', args: { motionId, characterId: targetCharacterId, sourceLengthSeconds: 1 } })
  assert.equal(placed.revision, 4)
  project = await readUnifiedProject(projectId)
  const clip = project.scene.content.timeline.animation.motionClips.find((item) => item.motion.assetId === motionId)
  assert.equal(clip?.target.nodeId, project.characters[targetCharacterId]!.nodeId)
})

test('scene.apply removes an unreferenced Character transactionally and blocks deletion with a live camera reference', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Character delete test', scene: makeEmptyDraft('Character delete test', 30, 90, { fov: 50, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }) } })
  const projectId = String(created.result.projectId)
  const upload = await stageAssetUpload('actor.glb', new ReadableStream({ start(controller) { controller.enqueue(glbWithSkin()); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'glb' } })
  const assetId = String((imported.result.assetIds as string[])[0])
  const skeletonId = String((imported.result.skeletonIds as string[])[0])
  const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'character.add', args: { assetId, skeletonId, name: 'Actor' } })
  const characterId = String(added.result.characterId)
  const nodeId = String(added.result.nodeId)
  const project = await readUnifiedProject(projectId)
  const fcurves = FCurveSet.empty()
  fcurves.upsertKey(nodeId, 'transform.position', 0, 0, 1)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 2, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: project.scene, fcurves: fcurves.encode() }] } })
  const removed = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'scene.apply', args: { operations: [{ type: 'node.delete', nodeId }] } })
  assert.deepEqual(removed.result.removedCharacterIds, [characterId])
  const cleaned = await readUnifiedProject(projectId)
  assert.equal(Object.keys(cleaned.characters).length, 0)
  assert.deepEqual((cleaned.extensions.topview!.fcurves as { fcurves: unknown[] }).fcurves, [])

  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 4, command: 'history.undo', args: {} })
  const restored = await readUnifiedProject(projectId)
  assert.ok(restored.characters[characterId])
  const referencedScene = structuredClone(restored.scene)
  const camera = referencedScene.content.nodes.find((node) => node.type === 'camera')!
  camera.camera!.lookAtTarget = { nodeId }
  referencedScene.content.nodes = referencedScene.content.nodes.filter((node) => node.id !== nodeId)
  await assert.rejects(executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: 5, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: referencedScene, fcurves: null }] },
  }), (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED' && /still have camera/.test(error.message))
  assert.equal((await readUnifiedProject(projectId)).revision, 5)
})

test('scene.apply batches native transform, flags and rename operations atomically', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Scene operation batch', scene: makeEmptyDraft('Scene operation batch', 30, 90, { fov: 50, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }) } })
  const projectId = String(created.result.projectId)
  const initial = await readUnifiedProject(projectId)
  const camera = initial.scene.content.nodes.find((node) => node.type === 'camera')!
  const original = structuredClone(camera)
  const updated = await executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: 0, command: 'scene.apply', args: { operations: [
      { type: 'node.transform.patch', nodeId: camera.id, position: { x: 3 } },
      { type: 'node.flags.set', nodeId: camera.id, visible: false, locked: true },
      { type: 'node.rename', nodeId: camera.id, name: 'Main Camera' },
    ] },
  })
  assert.equal(updated.revision, 1)
  const changed = (await readUnifiedProject(projectId)).scene.content.nodes.find((node) => node.id === camera.id)!
  assert.equal(changed.transform.position.x, 3)
  assert.equal(changed.visible, false)
  assert.equal(changed.locked, true)
  assert.equal(changed.name, 'Main Camera')

  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'history.undo', args: {} })
  const restored = (await readUnifiedProject(projectId)).scene.content.nodes.find((node) => node.id === camera.id)!
  assert.deepEqual(restored, original)
  await assert.rejects(executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: 2, command: 'scene.apply', args: { operations: [
      { type: 'node.transform.patch', nodeId: camera.id, position: { x: 9 } },
      { type: 'node.flags.set', nodeId: camera.id, visible: 'false' },
    ] },
  }), (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  assert.equal((await readUnifiedProject(projectId)).revision, 2)
  assert.deepEqual((await readUnifiedProject(projectId)).scene.content.nodes.find((node) => node.id === camera.id), original)

  const grouped = structuredClone((await readUnifiedProject(projectId)).scene)
  const transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
  grouped.content.nodes.push(
    { id: 'root-group', type: 'group', name: 'Root', visible: true, locked: false, transform, children: ['nested-group'] },
    { id: 'nested-group', type: 'group', name: 'Nested', visible: true, locked: false, transform, parentId: 'root-group' },
  )
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 2, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: grouped, fcurves: null }] } })
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'scene.apply', args: { operations: [{ type: 'node.delete', nodeId: 'root-group' }] } })
  assert.deepEqual((await readUnifiedProject(projectId)).scene.content.nodes.map((node) => node.id), [camera.id])
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 4, command: 'history.undo', args: {} })
  assert.ok((await readUnifiedProject(projectId)).scene.content.nodes.some((node) => node.id === 'nested-group'))
})

test('scene.apply clones Character identity, MotionBinding, native clips and FCurves with Undo', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Scene clone', scene: makeEmptyDraft('Scene clone', 30, 90) } })
  const projectId = String(created.result.projectId)
  const upload = await stageAssetUpload('clone-actor.glb', new ReadableStream({ start(controller) { controller.enqueue(glbWithSkin()); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'glb' } })
  const assetId = String((imported.result.assetIds as string[])[0])
  const skeletonId = String((imported.result.skeletonIds as string[])[0])
  const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'character.add', args: { assetId, skeletonId, name: 'Actor' } })
  const sourceCharacterId = String(added.result.characterId)
  const sourceNodeId = String(added.result.nodeId)
  const project = await readUnifiedProject(projectId)
  const digest = createHash('sha256').update('motion-fixture').digest('hex')
  const motionAssetId = `sha256:${digest}`
  const blob = { path: `assets/${digest}.fbx`, sha256: digest, mediaType: 'application/octet-stream', byteLength: 14 }
  project.assets[motionAssetId] = {
    id: motionAssetId, kind: 'motion', displayName: 'Walk', source: blob, derivatives: {},
    provenance: { sourceKey: 'test-fixture', sourceVersion: '1', sourceHash: digest, original: blob }, license: null, dependencies: [],
  }
  const motionId = randomUUID()
  const clipId = 'source-motion-clip'
  project.motions[motionId] = { id: motionId, assetId: motionAssetId, skeletonId, durationSeconds: 2, sourceFps: 30, sourceClip: blob, evaluator: 'topview-0.1.8', edit: null, derivedFrom: null }
  project.scene.content.timeline.animation.motionClips.push({
    id: clipId, source: 'library', sourceDuration: 2, frameStart: 0, frameEnd: 60,
    target: { type: 'character', nodeId: sourceNodeId }, playback: { version: 1, speed: 1, loop: false, loopMode: 'none' },
    motion: { assetId: motionAssetId, name: 'Walk', source: 'library', sourceRig: 'mixamorig', url: 'walk.fbx', inPlace: true, loop: false, speed: 1, time: 0 },
  })
  project.bindings[clipId] = {
    clipId, characterId: sourceCharacterId, motionId, sourceStartSeconds: 0, sourceLengthSeconds: 2,
    reverse: false, fadeInSeconds: 0, fadeOutSeconds: 0, rootPolicy: 'in-place', alignment: 'origin',
  }
  const fcurves = FCurveSet.empty()
  fcurves.upsertKey(sourceNodeId, 'transform.position', 0, 0, 0)
  project.extensions.topview!.fcurves = fcurves.encode()
  writeFileSync(path.join(projectsDir, projectId, 'project.json'), JSON.stringify(project))
  assert.ok((await readUnifiedProject(projectId)).bindings[clipId])

  const cloned = await executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: 2, command: 'scene.apply', args: { operations: [{ type: 'node.clone', nodeId: sourceNodeId, delta: { position: [1, 0, 0] } }] },
  })
  const cloneMap = (cloned.result.cloneMaps as Array<{ nodeIdMap: Record<string, string>; clipIdMap: Record<string, string>; characterIdMap: Record<string, string> }>)[0]!
  const nodeId = cloneMap.nodeIdMap[sourceNodeId]!
  const characterId = cloneMap.characterIdMap[sourceCharacterId]!
  const clonedProject = await readUnifiedProject(projectId)
  const clone = clonedProject.scene.content.nodes.find((node) => node.id === nodeId)!
  const clipCloneId = cloneMap.clipIdMap[clipId]!
  assert.equal(clone.metadata?.characterId, characterId)
  assert.equal(clonedProject.characters[characterId]?.nodeId, nodeId)
  assert.equal(clonedProject.scene.content.timeline.animation.motionClips.find((clip) => clip.id === clipCloneId)?.target.nodeId, nodeId)
  assert.equal(clonedProject.bindings[clipCloneId]?.characterId, characterId)
  assert.equal(FCurveSet.parse(clonedProject.extensions.topview!.fcurves).tracksForNode(nodeId)[0]?.keys[0]?.value, 1)

  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'history.undo', args: {} })
  const restored = await readUnifiedProject(projectId)
  assert.equal(restored.characters[characterId], undefined)
  assert.ok(restored.bindings[clipId])

  const localClone = duplicateDocumentNodes({
    document: restored.scene, fcurves: restored.extensions.topview?.fcurves ?? null, selectedIds: [sourceNodeId],
  })
  const localCloneNodeId = localClone.nodeIdMap[sourceNodeId]!
  const localCloneClipId = localClone.clipIdMap[clipId]!
  const autosaved = await executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: restored.revision, command: 'scene.apply',
    args: { operations: [{ type: 'document.replace', document: localClone.document, fcurves: localClone.fcurves }] },
  })
  const autosavedProject = await readUnifiedProject(projectId)
  const localCloneCharacterId = String(autosavedProject.scene.content.nodes.find((node) => node.id === localCloneNodeId)?.metadata?.characterId)
  assert.ok(localCloneCharacterId && localCloneCharacterId !== sourceCharacterId)
  assert.equal(autosavedProject.characters[localCloneCharacterId]?.nodeId, localCloneNodeId)
  assert.equal(autosavedProject.bindings[localCloneClipId]?.characterId, localCloneCharacterId)
  assert.ok(FCurveSet.parse(autosavedProject.extensions.topview!.fcurves).tracksForNode(localCloneNodeId).length)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: autosaved.revision, command: 'history.undo', args: {} })
  const afterAutosaveUndo = await readUnifiedProject(projectId)
  assert.equal(afterAutosaveUndo.characters[localCloneCharacterId], undefined)
  assert.equal(afterAutosaveUndo.bindings[localCloneClipId], undefined)
})

test('scene.apply preserves world transforms when reparenting across rotated nonuniform groups and rejects keyed nodes', async () => {
  const scene = makeEmptyDraft('Scene reparent', 30, 90)
  const identity = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
  const groupA = { id: 'group-a', type: 'group' as const, name: 'A', visible: true, locked: false,
    transform: { position: { x: 4, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 25 }, scale: { x: 2, y: 1, z: 0.5 } }, children: ['box'] }
  const groupB = { id: 'group-b', type: 'group' as const, name: 'B', visible: true, locked: false,
    transform: { position: { x: -3, y: 2, z: 1 }, rotation: { x: 0, y: 0, z: 25 }, scale: { x: 0.5, y: 2, z: 1 } } }
  const box = { id: 'box', type: 'primitive' as const, name: 'Box', visible: true, locked: false, parentId: groupA.id,
    transform: { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    primitive: { kind: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } } }
  scene.content.nodes.push(groupA, groupB, box)
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Scene reparent', scene } })
  const projectId = String(created.result.projectId)
  const asMatrix = (transform: typeof identity) => {
    const object = new THREE.Object3D()
    object.position.set(transform.position.x, transform.position.y, transform.position.z)
    object.rotation.set(THREE.MathUtils.degToRad(transform.rotation.x), THREE.MathUtils.degToRad(transform.rotation.y), THREE.MathUtils.degToRad(transform.rotation.z))
    object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z)
    object.updateMatrix()
    return object.matrix.clone()
  }
  const before = asMatrix(groupA.transform).multiply(asMatrix(box.transform))
  const moved = await executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: 0, command: 'scene.apply', args: { operations: [{ type: 'node.reparent', nodeId: box.id, parentId: groupB.id }] },
  })
  const afterProject = await readUnifiedProject(projectId)
  const movedBox = afterProject.scene.content.nodes.find((node) => node.id === box.id)!
  const movedParent = afterProject.scene.content.nodes.find((node) => node.id === groupB.id)!
  const after = asMatrix(movedParent.transform).multiply(asMatrix(movedBox.transform))
  assert.ok(after.elements.every((value, index) => Math.abs(value - before.elements[index]!) < 1e-6))
  assert.equal(movedBox.parentId, groupB.id)
  assert.deepEqual(afterProject.scene.content.nodes.find((node) => node.id === groupA.id)?.children, [])
  assert.deepEqual(movedParent.children, [box.id])

  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: moved.revision, command: 'history.undo', args: {} })
  const restored = await readUnifiedProject(projectId)
  assert.equal(restored.scene.content.nodes.find((node) => node.id === box.id)?.parentId, groupA.id)
  const keyed = FCurveSet.empty()
  keyed.upsertKey(box.id, 'transform.position', 0, 0, 1)
  restored.extensions.topview!.fcurves = keyed.encode()
  writeFileSync(path.join(projectsDir, projectId, 'project.json'), JSON.stringify(restored))
  await assert.rejects(executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: moved.revision + 1, command: 'scene.apply', args: { operations: [{ type: 'node.reparent', nodeId: box.id, parentId: null }] },
  }), (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  assert.equal((await readUnifiedProject(projectId)).revision, moved.revision + 1)
})

test('asset.import recognizes a Minecraft20 GLB profile only with its expected semantic hierarchy', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Minecraft20 profile test', scene: makeEmptyDraft('Minecraft20 profile test', 30, 90) } })
  const projectId = String(created.result.projectId)
  const upload = await stageAssetUpload('minecraft20.glb', new ReadableStream({ start(controller) { controller.enqueue(glbWithMinecraft20Skeleton()); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'glb' } })
  const profileId = (imported.result.skeletonIds as string[])[0]!
  const profile = (await readUnifiedProject(projectId)).skeletons[profileId]!
  assert.equal(profile.family, 'minecraft20')
  assert.equal(profile.bones.length, 14)
})

test('asset.import persists a validated Z-up source basis through profiles and Character metadata', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Z-up import test', scene: makeEmptyDraft('Z-up import test', 30, 90) } })
  const projectId = String(created.result.projectId)
  const bytes = glbWithSkin()
  const upload = await stageAssetUpload('z-up.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const basis = [1, 0, 0, 0, 0, 1, 0, -1, 0]
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'glb', basis: [2, 0, 0, 0, 1, 0, 0, 0, 1] } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'glb', basis } })
  const assetId = String((imported.result.assetIds as string[])[0])
  const skeletonId = String((imported.result.skeletonIds as string[])[0])
  const project = await readUnifiedProject(projectId)
  assert.deepEqual(project.skeletons[skeletonId]!.basisToScene, basis)
  assert.deepEqual(project.extensions.assetImportModels?.[assetId], { format: 'gltf', metersPerUnit: 1, basisToScene: basis })
  assert.deepEqual((await resolveUnifiedAssetFile(project, assetId, 'source')).bytes, bytes)
  const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'character.add', args: { assetId, skeletonId, name: 'Z-up actor' } })
  const characterNode = (await readUnifiedProject(projectId)).scene.content.nodes.find((node) => node.id === added.result.nodeId)!
  assert.deepEqual(characterNode.metadata?.modelBasisToScene, basis)
  const evaluated = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 0 } })
  const samples = evaluated.result.skeletonSamples as Array<{ bones: Array<{ name: string; worldMatrix: number[] }> }>
  assert.equal(samples.length, 1, JSON.stringify(evaluated.result))
  const bones = samples[0]!.bones
  const spine = bones.find((bone) => bone.name === 'spine')!
  assert.ok(Math.abs(spine.worldMatrix[14]! + 1) < 1e-6, JSON.stringify(spine))
  const prop = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 2, command: 'prop.add', args: { assetId, name: 'Z-up prop' } })
  const propNode = (await readUnifiedProject(projectId)).scene.content.nodes.find((node) => node.id === prop.result.nodeId)!
  assert.deepEqual(propNode.metadata?.modelBasisToScene, basis)
})

test('prop.add places an unrigged model without creating Character or Skeleton records and is undoable', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Unrigged prop test', scene: makeEmptyDraft('Unrigged prop test', 30, 90) } })
  const projectId = String(created.result.projectId)
  const upload = await stageAssetUpload('table.glb', new ReadableStream({ start(controller) { controller.enqueue(glbWithoutSkin()); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'glb' } })
  const assetId = (imported.result.assetIds as string[])[0]!
  const initial = await readUnifiedProject(projectId)
  assert.equal(initial.assets[assetId as keyof typeof initial.assets]!.kind, 'model')
  assert.deepEqual(imported.result.skeletonIds, [])
  assert.equal(Object.keys(initial.characters).length, 0)

  const request = { requestId: randomUUID(), projectId, expectedRevision: 1, command: 'prop.add', args: {
    assetId, name: 'Table', transform: { position: { x: 2, y: 0, z: -1 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  } }
  const dryRun = await executeUnifiedCommand({ ...request, requestId: randomUUID(), dryRun: true })
  assert.equal(dryRun.revision, 1)
  assert.equal(dryRun.result.valid, true)
  const added = await executeUnifiedCommand(request)
  assert.equal(added.revision, 2)
  const nodeId = String(added.result.nodeId)
  let project = await readUnifiedProject(projectId)
  const prop = project.scene.content.nodes.find((node) => node.id === nodeId)!
  assert.equal(prop.type, 'prop')
  assert.equal(prop.metadata?.assetId, assetId)
  assert.equal(prop.metadata?.modelUrl, `/api/unified/projects/${projectId}/assets/${encodeURIComponent(assetId)}/source`)
  assert.deepEqual(prop.transform.position, { x: 2, y: 0, z: -1 })
  assert.equal(Object.keys(project.characters).length, 0)
  assert.equal(Object.keys(project.skeletons).length, 0)

  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 2, command: 'history.undo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).scene.content.nodes.some((node) => node.id === nodeId), false)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'history.redo', args: {} })
  project = await readUnifiedProject(projectId)
  assert.equal(project.scene.content.nodes.find((node) => node.id === nodeId)?.type, 'prop')
})

test('unsupported import leaves the committed project unchanged', async () => {
  const created = await executeUnifiedCommand({
    requestId: randomUUID(), command: 'project.create',
    args: { name: 'Unsupported import test', scene: makeEmptyDraft('Unsupported import test', 30, 90) },
  })
  const projectId = String(created.result.projectId)
  const upload = await stageAssetUpload('motion.fbx', new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('not parsed here')); controller.close() } }))
  await assert.rejects(executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'auto' },
  }), (error: unknown) => error instanceof UnifiedStoreError && error.code === 'UNSUPPORTED_CAPABILITY')
  assert.equal((await readUnifiedProject(projectId)).revision, 0)
})


test('self-contained glTF imports while external resource paths are rejected', async () => {
  const created = await executeUnifiedCommand({
    requestId: randomUUID(), command: 'project.create',
    args: { name: 'glTF import test', scene: makeEmptyDraft('glTF import test', 30, 90) },
  })
  const projectId = String(created.result.projectId)
  const embedded = await stageAssetUpload('scene.gltf', new ReadableStream({ start(controller) {
    controller.enqueue(Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'data:application/octet-stream;base64,AA==', byteLength: 1 }] })))
    controller.close()
  } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [embedded.id], format: 'auto' } })
  assert.equal(imported.revision, 1)

  const external = await stageAssetUpload('external.gltf', new ReadableStream({ start(controller) {
    controller.enqueue(Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: '../outside.bin', byteLength: 1 }] })))
    controller.close()
  } }))
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'asset.import', args: { files: [external.id], format: 'auto' } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'UNSUPPORTED_CAPABILITY')
  assert.equal((await readUnifiedProject(projectId)).revision, 1)
})

test('glTF import keeps separate skeleton profiles and routes Actions by node identity despite duplicate labels', async () => {
  const document = {
    asset: { version: '2.0' },
    nodes: [
      { name: 'Root', children: [1, 2] }, { name: 'Joint' }, { name: 'Joint' },
    ],
    skins: [{ joints: [1] }, { joints: [2] }],
    accessors: [{ count: 2, min: [0], max: [1] }, {}],
    animations: [
      { name: 'Rig A', samplers: [{ input: 0, output: 1 }], channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }] },
      { name: 'Rig B', samplers: [{ input: 0, output: 1 }], channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }] },
      { name: 'Shared root action', samplers: [{ input: 0, output: 1 }], channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }] },
    ],
  }
  const bytes = Buffer.from(JSON.stringify(document))
  const imported = buildImportedAsset({ id: randomUUID(), name: 'two-rigs.gltf', bytes, byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') }, 'gltf')
  assert.equal(imported.skeletonProfiles?.length, 2)
  assert.notEqual(imported.skeletonProfiles?.[0]?.id, imported.skeletonProfiles?.[1]?.id)
  assert.deepEqual(imported.motions.map((item) => item.name), ['Rig A', 'Rig B'])
  assert.equal(imported.motions[0]!.motion.skeletonId, imported.skeletonProfiles![0]!.id)
  assert.equal(imported.motions[1]!.motion.skeletonId, imported.skeletonProfiles![1]!.id)
  assert.equal(imported.issues?.[0]?.code, 'GLTF_ACTION_SKELETON_AMBIGUOUS')
  assert.equal(imported.issues?.[0]?.actionIndex, 2)
  assert.deepEqual(imported.skeletonProfiles?.map((profile) => profile.bones.map((bone) => bone.name)), [['Root', 'Joint'], ['Root', 'Joint']])

  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Two rig import', scene: makeEmptyDraft('Two rig import', 30, 90) } })
  const projectId = String(created.result.projectId)
  const upload = await stageAssetUpload('two-rigs.gltf', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const response = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'gltf' } })
  assert.equal((response.result.skeletonIds as string[]).length, 2)
  assert.equal((response.result.issues as Array<{ code: string }>)[0]?.code, 'GLTF_ACTION_SKELETON_AMBIGUOUS')
  assert.equal((response.result.issues as Array<{ actionIndex?: number }>)[0]?.actionIndex, 2)
  const project = await readUnifiedProject(projectId)
  assert.equal(Object.values(project.skeletons).filter((profile) => profile.provenance.sourceHash === upload.sha256).length, 2)
  assert.deepEqual(Object.values(project.motions).map((motion) => motion.skeletonId).sort(), Object.values(project.skeletons).map((profile) => profile.id).sort())
})

test('rig inspection requires an explicit profile when one source has multiple profiles', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Profile choice', scene: makeEmptyDraft('Profile choice', 30, 90) } })
  const projectId = String(created.result.projectId), bytes = glbWithSkin()
  const upload = await stageAssetUpload('profile-choice.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id] } })
  const project = await readUnifiedProject(projectId), assetId = `sha256:${upload.sha256}`
  const profile = Object.values(project.skeletons).find((candidate) => candidate.provenance.sourceHash === upload.sha256)!
  const second = { ...structuredClone(profile), id: randomUUID(), fingerprint: createHash('sha256').update('second profile identity').digest('hex') }
  project.skeletons[second.id] = second
  const inspection = await inspectProjectRig(project, assetId, undefined, second.id)
  assert.equal(inspection.skeletonProfileId, second.id)
  await assert.rejects(inspectProjectRig(project, assetId), /Choose one of the imported skeleton profiles/)
})

test('motion.place adds the selected imported clip and binding to shared history', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Motion placement', scene: makeEmptyDraft('Motion placement', 30, 90) } })
  const projectId = String(created.result.projectId)
  const modelBytes = glbWithSkin()
  const upload = await stageAssetUpload('character.glb', new ReadableStream({ start(controller) { controller.enqueue(modelBytes); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id] } })
  const project = await readUnifiedProject(projectId)
  const assetId = String((imported.result.assetIds as string[])[0])
  const skeletonId = String((imported.result.skeletonIds as string[])[0])
  const mismatchedSkeletonId = randomUUID()
  project.skeletons[mismatchedSkeletonId] = { ...structuredClone(project.skeletons[skeletonId]!), id: mismatchedSkeletonId, fingerprint: createHash('sha256').update('different skeleton profile').digest('hex') }
  const motionIds = [randomUUID(), randomUUID(), randomUUID()]
  const sourceBytes = Buffer.from('fixture fbx bytes')
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex')
  const source = { path: `assets/${sourceHash}/walk.fbx`, sha256: sourceHash, mediaType: 'application/vnd.autodesk.fbx', byteLength: sourceBytes.byteLength }
  const original = { ...source, path: `originals/${sourceHash}/walk.fbx` }
  project.assets[`sha256:${sourceHash}`] = {
    id: `sha256:${sourceHash}`, kind: 'motion', displayName: 'walk', source, derivatives: {},
    provenance: { sourceKey: 'fbx', sourceVersion: 'test', sourceHash, original }, license: null, dependencies: [],
  }
  const motionMetadata: Record<string, { name: string; clipIndex: number }> = {}
  for (const [clipIndex, motionId] of motionIds.entries()) {
    project.motions[motionId] = {
      id: motionId, assetId: `sha256:${sourceHash}`, skeletonId, durationSeconds: 1.5, sourceFps: 30,
      sourceClip: original, evaluator: 'retarget-9.12', edit: null, derivedFrom: null,
    }
    motionMetadata[motionId] = { name: clipIndex === 2 ? 'Walk' : `Clip ${clipIndex + 1}`, clipIndex: clipIndex === 2 ? 4 : clipIndex }
  }
  const motionId = motionIds[2]!
  project.extensions.retargetMotionMetadata = motionMetadata
  writeFileSync(path.join(projectsDir, projectId, 'project.json'), JSON.stringify(project))

  const character = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'character.add', args: { assetId, skeletonId, name: 'Actor' } })
  const characterId = String(character.result.characterId)
  const mismatchedCharacter = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 2, command: 'character.add', args: { assetId, skeletonId: mismatchedSkeletonId, name: 'Different rig' } })
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'motion.place', args: { motionId, characterId: String(mismatchedCharacter.result.characterId) } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'PROFILE_MISMATCH')
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'motion.place', args: { motionId, characterId, frameStart: -1 } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'motion.place', args: { motionId, characterId, speed: 0 } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'motion.place', args: { motionId, characterId, sourceStartSeconds: 1.25, sourceLengthSeconds: 0.5 } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  const placement = { motionId, characterId, frameStart: 15, sourceStartSeconds: 0.25, sourceLengthSeconds: 0.75, speed: 2, loop: true, reverse: true }
  const dryRun = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, dryRun: true, command: 'motion.place', args: placement })
  assert.equal(dryRun.result.valid, true)
  const placed = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'motion.place', args: placement })
  const clipId = String(placed.result.clipId)
  const after = await readUnifiedProject(projectId)
  const clip = after.scene.content.timeline.animation.motionClips.find((entry) => entry.id === clipId)!
  assert.equal(clip.frameStart, 15)
  assert.equal(clip.frameEnd - clip.frameStart + 1, 11)
  assert.equal(clip.motion.clipIndex, 4)
  assert.equal(clip.motion.assetId, motionId)
  assert.equal(clip.playback.speed, 2)
  assert.equal(clip.motion.speed, 2)
  assert.equal(clip.playback.loop, true)
  assert.equal(clip.motion.loop, true)
  assert.equal(clip.motion.time, 0.25)
  assert.equal(clip.motion.sourceLengthSeconds, 0.75)
  assert.equal(clip.motion.reverse, true)
  assert.equal(clip.sourceDuration, 1.5)
  assert.equal(after.bindings[clipId]?.characterId, characterId)
  assert.equal(after.bindings[clipId]?.sourceStartSeconds, 0.25)
  assert.equal(after.bindings[clipId]?.sourceLengthSeconds, 0.75)
  assert.equal(after.bindings[clipId]?.reverse, true)

  const editedScene = structuredClone(after.scene)
  const editedClip = editedScene.content.timeline.animation.motionClips.find((entry) => entry.id === clipId)!
  editedClip.motion.time = 0.5
  editedClip.motion.sourceLengthSeconds = 0.5
  editedClip.motion.reverse = false
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 4, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: editedScene, fcurves: after.extensions.topview?.fcurves ?? null }] } })
  assert.equal((await readUnifiedProject(projectId)).bindings[clipId]?.sourceStartSeconds, 0.5)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 5, command: 'history.undo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).bindings[clipId]?.sourceStartSeconds, 0.25)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 6, command: 'history.redo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).bindings[clipId]?.sourceStartSeconds, 0.5)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 7, command: 'history.undo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).bindings[clipId]?.sourceStartSeconds, 0.25)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 8, command: 'history.undo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).bindings[clipId], undefined)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 9, command: 'history.redo', args: {} })
  assert.ok((await readUnifiedProject(projectId)).bindings[clipId])

  const editedBinding = { ...after.bindings[clipId]!, motionId: motionIds[0]!, sourceStartSeconds: 0.5, sourceLengthSeconds: 1, reverse: false }
  const editArgs = { binding: editedBinding, clipPatch: { frameStart: 40, frameEnd: 69, playback: { speed: 1, loop: false } } }
  const editRequest = { requestId: randomUUID(), projectId, expectedRevision: 10, command: 'motion.binding.set', args: editArgs }
  for (const args of [
    { ...editArgs, binding: { ...editedBinding, unknown: 1 } },
    { ...editArgs, binding: { ...editedBinding, sourceLengthSeconds: 2 } },
    { ...editArgs, clipPatch: { frameStart: 40, frameEnd: 39 } },
    { ...editArgs, clipPatch: { playback: { speed: null } } },
    { ...editArgs, clipPatch: { playback: { loopMode: 'ping-pong' } } },
  ]) await assert.rejects(executeUnifiedCommand({ ...editRequest, requestId: randomUUID(), args }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  await assert.rejects(executeUnifiedCommand({ ...editRequest, requestId: randomUUID(), args: { ...editArgs, binding: { ...editedBinding, fadeInSeconds: 1 } } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'UNSUPPORTED_CAPABILITY')
  await assert.rejects(executeUnifiedCommand({ ...editRequest, requestId: randomUUID(), args: { ...editArgs, binding: { ...editedBinding, characterId: String(mismatchedCharacter.result.characterId) } } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'PROFILE_MISMATCH')
  const previewEdit = await executeUnifiedCommand({ ...editRequest, requestId: randomUUID(), dryRun: true })
  assert.equal(previewEdit.result.clipId, clipId)
  assert.equal((await readUnifiedProject(projectId)).revision, 10)
  const appliedEdit = await executeUnifiedCommand(editRequest)
  assert.equal(appliedEdit.revision, 11)
  assert.deepEqual(await executeUnifiedCommand(editRequest), appliedEdit)
  const edited = await readUnifiedProject(projectId)
  assert.deepEqual(edited.bindings[clipId], editedBinding)
  assert.equal(edited.scene.content.timeline.animation.motionClips.length, 1)
  const changedClip = edited.scene.content.timeline.animation.motionClips[0]!
  assert.equal(changedClip.id, clipId)
  assert.deepEqual([changedClip.frameStart, changedClip.frameEnd, changedClip.motion.clipIndex], [40, 69, 0])
  assert.deepEqual([changedClip.motion.time, changedClip.motion.sourceLengthSeconds, changedClip.motion.reverse], [0.5, 1, false])
  assert.deepEqual([changedClip.playback.speed, changedClip.motion.speed, changedClip.playback.loop, changedClip.motion.loop], [1, 1, false, false])
  await assert.rejects(executeUnifiedCommand({ ...editRequest, requestId: randomUUID() }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'REVISION_CONFLICT')
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 11, command: 'history.undo', args: {} })
  assert.deepEqual((await readUnifiedProject(projectId)).bindings[clipId], after.bindings[clipId])
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 12, command: 'history.redo', args: {} })
  assert.deepEqual((await readUnifiedProject(projectId)).bindings[clipId], editedBinding)
  await executeUnifiedCommand({ ...editRequest, requestId: randomUUID(), expectedRevision: 13, args: { binding: editedBinding, clipPatch: { frameStart: 80 } } })
  assert.deepEqual((await readUnifiedProject(projectId)).scene.content.timeline.animation.motionClips.map((item) => [item.frameStart, item.frameEnd]), [[80, 109]])
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 14, command: 'motion.place', args: { motionId, characterId, frameStart: 110 } })
  await assert.rejects(executeUnifiedCommand({ ...editRequest, requestId: randomUUID(), expectedRevision: 15, args: { binding: editedBinding, clipPatch: { frameEnd: 110 } } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  assert.equal((await readUnifiedProject(projectId)).revision, 15)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 15, command: 'scene.apply', args: { operations: [{ type: 'node.flags.set', nodeId: character.result.nodeId, locked: true }] } })
  await assert.rejects(executeUnifiedCommand({ ...editRequest, requestId: randomUUID(), expectedRevision: 16 }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
})

test('asset.relink restores missing immutable bytes only when the content hash matches', async () => {
  const created = await executeUnifiedCommand({
    requestId: randomUUID(), command: 'project.create',
    args: { name: 'Relink test', scene: makeEmptyDraft('Relink test', 30, 90) },
  })
  const projectId = String(created.result.projectId)
  const bytes = glbWithSkin()
  const upload = await stageAssetUpload('rig.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id] } })
  const assetId = (imported.result.assetIds as string[])[0]!
  const project = await readUnifiedProject(projectId)
  const asset = project.assets[assetId as keyof typeof project.assets]!
  for (const ref of [asset.source, asset.provenance.original]) rmSync(path.join(projectsDir, projectId, ...ref.path.split('/')), { force: true })

  const relinkUpload = await stageAssetUpload('restored.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const restored = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'asset.relink', args: { assetId, file: relinkUpload.id } })
  assert.equal(restored.revision, 2)
  assert.equal(restored.result.restored, true)
  assert.deepEqual((await resolveUnifiedAssetFile(await readUnifiedProject(projectId), assetId, 'source')).bytes, bytes)

  const wrongUpload = await stageAssetUpload('wrong.glb', new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('different')); controller.close() } }))
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 2, command: 'asset.relink', args: { assetId: 'toString', file: wrongUpload.id } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'ASSET_MISSING')
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 2, command: 'asset.relink', args: { assetId, file: wrongUpload.id } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'ASSET_MISSING')
  assert.equal((await readUnifiedProject(projectId)).revision, 2)
})

test('Mixamo FBX import persists its source skeleton and clip motion', { skip: process.env.BBS_TEST_MIXAMO_FBX && existsSync(process.env.BBS_TEST_MIXAMO_FBX) ? false : 'External FBX fixture missing; set BBS_TEST_MIXAMO_FBX to an existing file' }, async () => {
  const created = await executeUnifiedCommand({
    requestId: randomUUID(), command: 'project.create',
    args: { name: 'Mixamo FBX import test', scene: makeEmptyDraft('Mixamo FBX import test', 30, 90, { fov: 50, position: { x: 1, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }) },
  })
  const projectId = String(created.result.projectId)
  const bytes = readFileSync(process.env.BBS_TEST_MIXAMO_FBX!)
  const upload = await stageAssetUpload('Mixamo.fbx', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const request = { requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'fbx', unitMeters: 0.01 } }
  const imported = await executeUnifiedCommand(request)
  assert.equal(imported.revision, 1)
  const project = await readUnifiedProject(projectId)
  const assetId = (imported.result.assetIds as string[])[0]!
  const motionId = (imported.result.motionIds as string[])[0]!
  const skeletonId = (imported.result.skeletonIds as string[])[0]!
  assert.equal(project.assets[assetId as keyof typeof project.assets]!.kind, 'model')
  assert.deepEqual(imported.result.issues, [])
  assert.deepEqual(project.extensions.assetImportModels?.[assetId], { format: 'fbx', metersPerUnit: 0.01, basisToScene: [1, 0, 0, 0, 1, 0, 0, 0, 1] })
  assert.equal(project.skeletons[skeletonId]!.family, 'mixamo65')
  assert.equal(project.skeletons[skeletonId]!.bones.length, 65)
  assert.equal(project.skeletons[skeletonId]!.metersPerUnit, 0.01)
  assert.equal(project.motions[motionId]!.sourceFps, 30)
  assert.ok(project.motions[motionId]!.durationSeconds > 0)
  assert.deepEqual((await resolveUnifiedAssetFile(project, assetId, 'source')).bytes, bytes)
  assert.equal((project.extensions.retargetMotionMetadata?.[motionId] as { name: string }).name, 'mixamo.com')

  const repeated = await stageAssetUpload('renamed.fbx', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const duplicate = await executeUnifiedCommand({ ...request, requestId: randomUUID(), expectedRevision: 1, args: { files: [repeated.id], format: 'fbx', unitMeters: 0.01 } })
  assert.equal(duplicate.revision, 1)
  assert.deepEqual(duplicate.result.motionIds, [motionId])

  const undone = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'history.undo', args: {} })
  assert.equal(undone.revision, 2)
  assert.equal(Object.keys((await readUnifiedProject(projectId)).motions).length, 0)
  const redone = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 2, command: 'history.redo', args: {} })
  assert.equal(redone.revision, 3)
  const restored = await readUnifiedProject(projectId)
  assert.ok(restored.motions[motionId])
  assert.deepEqual((await resolveUnifiedAssetFile(restored, assetId, 'source')).bytes, bytes)
  const character = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'character.add', args: { assetId, skeletonId, name: 'FBX Actor' } })
  const characterId = String(character.result.characterId)
  const added = await readUnifiedProject(projectId)
  const node = added.scene.content.nodes.find((item) => item.id === character.result.nodeId)!
  assert.equal(node.metadata?.modelFormat, 'fbx')
  assert.equal(node.metadata?.modelUnitMeters, 0.01)
  assert.equal(node.metadata?.preserveMaterials, true)
  assert.equal(node.metadata?.rig, 'direct')
  const geometryCheck = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 0, checks: ['grounding'] } })
  const grounding = (geometryCheck.result.checks as Record<string, { status: string; nodes: Array<{ nodeId: string; status: string; bottomOffset: number }> }>).grounding!
  assert.equal(grounding.status, 'complete')
  assert.equal(grounding.nodes[0]!.nodeId, node.id)
  assert.ok(['grounded', 'floating', 'penetrating'].includes(grounding.nodes[0]!.status))
  assert.equal(Number.isFinite(grounding.nodes[0]!.bottomOffset), true)
  assert.equal(geometryCheck.revision, 4)
  const render = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 4, command: 'scene.render', args: {
    frames: [0], cameraNodeIds: ['camera_1'], width: 64, height: 64, viewportAspect: 1, outputDirectory: { kind: 'client-directory', id: randomUUID() },
  } })
  let renderJob = await getUnifiedJob(String(render.result.jobId), projectId)
  for (let attempt = 0; attempt < 120 && !['succeeded', 'failed', 'cancelled'].includes(renderJob.state); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    renderJob = await getUnifiedJob(String(render.result.jobId), projectId)
  }
  assert.equal(renderJob.state, 'succeeded', JSON.stringify(renderJob))
  const renderedFrame = renderJob.result!.files.find((file) => file.name === 'camera-0-frame-0.png')!
  const renderedBytes = (await readUnifiedJobFile(renderJob.jobId, projectId, renderedFrame.id))!.bytes
  assert.deepEqual([...renderedBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const invalidUnitScene = structuredClone(added.scene)
  invalidUnitScene.content.nodes.find((item) => item.id === node.id)!.metadata!.modelUnitMeters = 1
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 4, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: invalidUnitScene, fcurves: added.extensions.topview?.fcurves ?? null }] } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  const placed = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 4, command: 'motion.place', args: { motionId, characterId, sourceStartSeconds: 0.25, sourceLengthSeconds: 1, reverse: true } })
  assert.ok((await readUnifiedProject(projectId)).bindings[String(placed.result.clipId)])
  const prop = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 5, command: 'prop.add', args: { assetId, name: 'FBX prop' } })
  assert.equal((await readUnifiedProject(projectId)).scene.content.nodes.find((item) => item.id === prop.result.nodeId)?.metadata?.modelUnitMeters, 0.01)
  const beforeEdit = await readUnifiedProject(projectId)
  const clipId = String(placed.result.clipId)
  const binding = { ...beforeEdit.bindings[clipId]!, rootPolicy: 'in-place' }
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 6, command: 'motion.binding.set', args: { binding } })
  const inPlace = await readUnifiedProject(projectId)
  const rootBone = inPlace.skeletons[skeletonId]!.bones.find((bone) => bone.id === inPlace.skeletons[skeletonId]!.rootBoneId)!
  assert.deepEqual(inPlace.scene.content.timeline.animation.motionClips[0]!.motion.rootMotion, { policy: 'in-place', boneName: rootBone.name, alignment: 'continue' })
  const invalidRootScene = structuredClone(inPlace.scene)
  invalidRootScene.content.timeline.animation.motionClips[0]!.motion.rootMotion!.boneName = 'not-the-profile-root'
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 7, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: invalidRootScene, fcurves: null }] } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  delete invalidRootScene.content.timeline.animation.motionClips[0]!.motion.rootMotion
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 7, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: invalidRootScene, fcurves: null }] } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 7, command: 'history.undo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).bindings[clipId]!.rootPolicy, 'skeletal')
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 8, command: 'history.redo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).bindings[clipId]!.rootPolicy, 'in-place')
  const trajectoryBinding = { ...binding, rootPolicy: 'trajectory', alignment: 'origin' }
  const trajectoryCommand = { requestId: randomUUID(), projectId, expectedRevision: 9, command: 'motion.binding.set', args: { binding: trajectoryBinding } }
  await executeUnifiedCommand({ ...trajectoryCommand, requestId: randomUUID(), dryRun: true })
  assert.equal((await readUnifiedProject(projectId)).revision, 9)
  await executeUnifiedCommand(trajectoryCommand)
  const trajectory = await readUnifiedProject(projectId)
  assert.equal(trajectory.bindings[clipId]!.alignment, 'origin')
  assert.equal(trajectory.scene.content.timeline.animation.motionClips[0]!.motion.rootMotion!.policy, 'trajectory')
  assert.equal(trajectory.scene.content.timeline.animation.motionClips[0]!.motion.inPlace, false)
  const overlapping = structuredClone(trajectory)
  const duplicateClip = structuredClone(overlapping.scene.content.timeline.animation.motionClips[0]!)
  duplicateClip.id = 'overlapping-clip'
  overlapping.scene.content.timeline.animation.motionClips.push(duplicateClip)
  assert.equal(validateProject(overlapping), false)
  const excessiveLoops = structuredClone(trajectory)
  excessiveLoops.scene.content.timeline.animation.motionClips[0]!.playback.loop = true
  excessiveLoops.scene.content.timeline.animation.motionClips[0]!.motion.sourceLengthSeconds = 1e-300
  assert.equal(validateProject(excessiveLoops), false)
  const headless = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 0 } })
  assert.deepEqual(headless.result.issues, [])
  assert.equal(headless.result.transformSpace, 'authored-placement')
  const skeletonSamples = headless.result.skeletonSamples as Array<{ nodeId: string; bones: unknown[]; trajectoryMatrix: number[] }>
  assert.equal(skeletonSamples.length, 1)
  assert.equal(skeletonSamples[0]!.nodeId, node.id)
  assert.equal(skeletonSamples[0]!.bones.length, 65)
  assert.ok(skeletonSamples[0]!.trajectoryMatrix.every(Number.isFinite))
  const range = { startFrame: 0, endFrame: 29, sampleFps: 20 }
  const rangeSamples = []
  for await (const sample of sampleProjectSkeletonRange(trajectory, range, [characterId])) rangeSamples.push(sample)
  assert.equal(rangeSamples.length, 21)
  assert.equal(rangeSamples.at(-1)!.frame, 30)
  assert.equal(rangeSamples.at(-1)!.side, 'left')
  assert.ok(rangeSamples.every((sample) => sample.sourceRevision === 10 && sample.skeletonSamples[0]!.bones.length === 65))
  const cameraProject = structuredClone(trajectory)
  const camera = structuredClone(makeEmptyDraft('Trajectory camera test', 30, 90, { fov: 50, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }).content.nodes[0]!)
  camera.id = 'trajectory-camera'
  cameraProject.scene.content.nodes.push(camera)
  camera.camera!.subject = { nodeId: node.id, distance: 5, offset: { x: 0, y: 2, z: 5 }, lookAtOffset: { x: 0, y: 1, z: 0 }, follow: true, followRotation: true }
  cameraProject.scene.content.editorial = { version: 1, activeSequenceId: 'camera-sequence', sequences: [{ id: 'camera-sequence', clips: [
    { id: 'camera-shot', cameraNodeId: camera.id, sourceFrameStart: 0, sourceFrameEnd: 29 },
  ] }] }
  const cameraSamples = []
  for await (const sample of sampleProjectCameraSequence(cameraProject, 'camera-sequence', 20, 16 / 9)) cameraSamples.push(sample)
  assert.equal(cameraSamples.length, rangeSamples.length)
  for (const sample of cameraSamples) {
    const source = rangeSamples.find((item) => item.frame === sample.sourceFrame && item.side === sample.side)!.skeletonSamples[0]!
    const yaw = Math.atan2(source.actorWorldMatrix[8]!, source.actorWorldMatrix[10]!)
    assert.ok(Math.abs(sample.position[0]! - (source.actorWorldMatrix[12]! + 5 * Math.sin(yaw))) < 1e-6)
    assert.ok(Math.abs(sample.position[1]! - (source.actorWorldMatrix[13]! + 2)) < 1e-6)
    assert.ok(Math.abs(sample.position[2]! - (source.actorWorldMatrix[14]! + 5 * Math.cos(yaw))) < 1e-6)
    assert.ok(Math.abs(sample.lookAt[0]! - source.actorWorldMatrix[12]!) < 1e-6)
    assert.ok(Math.abs(sample.lookAt[1]! - (source.actorWorldMatrix[13]! + 1)) < 1e-6)
    assert.ok(Math.abs(sample.lookAt[2]! - source.actorWorldMatrix[14]!) < 1e-6)
  }
  assert.ok(Math.abs(cameraSamples[0]!.position[0]! - cameraSamples.at(-1)!.position[0]!) > 0.01 || Math.abs(cameraSamples[0]!.position[2]! - cameraSamples.at(-1)!.position[2]!) > 0.01)
  const filmArgs = { characterIds: [characterId], sequenceId: 'camera-sequence', range: { startFrame: 0, endFrame: 29 }, viewportAspect: 16 / 9 }
  const filmBefore = JSON.stringify(cameraProject)
  const prepared = await sampleProjectFilm(cameraProject, filmArgs)
  assert.equal(prepared.kind, 'film-sampling-input')
  assert.equal(prepared.sourceRevision, cameraProject.revision)
  assert.equal(prepared.durationTicks, 20)
  assert.equal(prepared.sourceSha256, createHash('sha256').update(filmBefore).digest('hex'))
  assert.equal(prepared.sourceHashes[assetId], createHash('sha256').update(bytes).digest('hex'))
  assert.equal(prepared.frames.length, 21)
  assert.deepEqual(prepared.frames.map((frame) => frame.skeletons), rangeSamples.map((frame) => frame.skeletonSamples))
  assert.equal(prepared.cameras.length, 1)
  assert.equal(JSON.stringify(cameraProject), filmBefore)
  const sourceProfile = cameraProject.skeletons[prepared.models[0]!.skeletonId]!
  const restWorld = new Map<string, THREE.Matrix4>()
  const sceneScale = new THREE.Matrix4().makeScale(sourceProfile.metersPerUnit, sourceProfile.metersPerUnit, sourceProfile.metersPerUnit)
  const bobjBones = sourceProfile.bones.map((bone) => {
    const rest = bone.rest as { position: number[]; rotation: number[]; scale: number[] }
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...rest.position), new THREE.Quaternion(...rest.rotation), new THREE.Vector3(...rest.scale))
    const parent = bone.parentId === null ? null : sourceProfile.bones.find((item) => item.id === bone.parentId)!
    const modelWorld = parent ? restWorld.get(parent.name)!.clone().multiply(local) : local
    restWorld.set(bone.name, modelWorld)
    const world = sceneScale.clone().multiply(modelWorld)
    return { name: bone.name, parent: parent?.name ?? null,
      bobjRestMatrixRowMajor: Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, column) => world.elements[column * 4 + row]!)).flat() }
  })
  const baked = bakeProjectFilmPoseTracks(prepared, new Map([[assetId, { modelId: 'unified/test-model', bones: bobjBones }]]))
  assert.equal(baked.length, 1)
  assert.equal(baked[0]!.characterId, characterId)
  assert.equal(baked[0]!.poseTracks.length, sourceProfile.bones.length)
  assert.ok(baked[0]!.poseTracks.every((track) => track.keyframes.length === 21 && track.keyframes.every((key) => [...key.t, ...key.s, ...key.r, ...key.r2].every(Number.isFinite))))
  assert.throws(() => preflightProjectFilm(cameraProject, { ...filmArgs, characterIds: [characterId, characterId] }), /unique/)
  assert.throws(() => preflightProjectFilm(cameraProject, { ...filmArgs, range: { startFrame: 0, endFrame: 28 } }), /20 Hz/)
  assert.throws(() => preflightProjectFilm(cameraProject, { ...filmArgs, range: { startFrame: 0, endFrame: 59 } }), /exactly/)
  const cutProject = structuredClone(cameraProject)
  cutProject.scene.content.editorial!.sequences[0]!.clips = [
    { id: 'left-shot', cameraNodeId: camera.id, sourceFrameStart: 0, sourceFrameEnd: 14 },
    { id: 'right-shot', cameraNodeId: camera.id, sourceFrameStart: 15, sourceFrameEnd: 29 },
  ]
  const cuts = await sampleProjectFilm(cutProject, filmArgs)
  assert.deepEqual(cuts.cameras.map((clip) => [clip.startTick, clip.durationTicks]), [[0, 10], [10, 10]])
  assert.deepEqual(cuts.frames, prepared.frames)
  cutProject.scene.content.editorial!.sequences[0]!.clips[1]!.sourceFrameStart = 16
  assert.throws(() => preflightProjectFilm(cutProject, filmArgs), /contiguously/)
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(sampleProjectFilm(cameraProject, filmArgs, cancelled.signal), { name: 'AbortError' })
  const immutableInput = structuredClone(cameraProject)
  const immutableArgs = structuredClone(filmArgs)
  const inFlight = sampleProjectFilm(immutableInput, immutableArgs)
  immutableInput.revision += 1
  immutableArgs.range.endFrame = 0
  assert.equal((await inFlight).sourceSha256, prepared.sourceSha256)
  let fullRangeCount = 0
  for await (const sample of sampleProjectSkeletonRange(trajectory, { startFrame: 0, endFrame: 89, sampleFps: 20 }, [characterId])) {
    assert.equal(sample.skeletonSamples[0]!.bones.length, 65)
    fullRangeCount++
  }
  assert.equal(fullRangeCount, 61)
  assert.equal((await readUnifiedProject(projectId)).revision, 10)
  const keyedSnapshot = structuredClone(trajectory)
  keyedSnapshot.extensions.topview!.fcurves = FCurveSet.persist(null, { [node.id]: { position: [{ id: 'actor-key', frame: 0, value: [5, 0, 0], interpolation: 'linear' }] } })
  const keyedRange = sampleProjectSkeletonRange(keyedSnapshot, range, [characterId])
  const keyedFirst = await keyedRange.next()
  assert.equal(keyedFirst.value!.skeletonSamples[0]!.placementMatrix[12], 5)
  await keyedRange.return(undefined)
  for (const ids of [[], [characterId, characterId], ['unknown-character']]) {
    await assert.rejects(async () => { for await (const sample of sampleProjectSkeletonRange(trajectory, range, ids)) assert.fail(String(sample.frame)) }, /Character IDs/)
  }
  const sourceFile = path.join(projectsDir, projectId, trajectory.assets[assetId]!.source.path)
  rmSync(sourceFile)
  try {
    const unavailable = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 0 } })
    assert.deepEqual(unavailable.result.skeletonSamples, [])
    assert.ok((unavailable.result.issues as Array<{ code: string }>).some((issue) => issue.code === 'SKELETON_EVALUATION_UNAVAILABLE'))
    assert.equal(JSON.stringify(unavailable).includes(projectsDir), false)
    assert.equal((await readUnifiedProject(projectId)).revision, 10)
    const checkUnavailable = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 0, checks: ['grounding'] } })
    const checkResult = (checkUnavailable.result.checks as Record<string, { status: string }>).grounding!
    assert.equal(checkResult.status, 'unavailable')
    assert.ok((checkUnavailable.result.issues as Array<{ code: string }>).some((issue) => issue.code === 'CHECK_UNAVAILABLE'))
    await assert.rejects(async () => { for await (const sample of sampleProjectSkeletonRange(trajectory, range, [characterId])) assert.fail(String(sample.frame)) }, /cannot be evaluated/)
    await assert.rejects(sampleProjectFilm(cameraProject, filmArgs), /CPU-evaluable/)
  } finally { writeFileSync(sourceFile, bytes) }
  const conflicting = structuredClone(trajectory.scene)
  conflicting.content.nodes.push({ id: 'root-path', type: 'path', name: 'Root path', visible: true, locked: false, transform: structuredClone(node.transform) })
  conflicting.content.timeline.animation.pathMotionClips.push({ id: 'root-path-clip', status: 'active', locked: false, source: 'user', target: { type: 'character', nodeId: node.id },
    pathNodeId: 'root-path', pathName: 'Root path', pathLength: 1, pathStartPercent: 0, pathEndPercent: 100, direction: 'forward', facing: 'path-tangent',
    frameStart: 0, frameEnd: 29, playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 30 }, derivedSource: { motionClipId: clipId } })
  const conflictRequest = { requestId: randomUUID(), projectId, expectedRevision: 10, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: conflicting, fcurves: null }] } }
  for (const dryRun of [true, false]) await assert.rejects(executeUnifiedCommand({ ...conflictRequest, requestId: randomUUID(), dryRun }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'ROOT_MOTION_CONFLICT')
  assert.equal((await readUnifiedProject(projectId)).revision, 10)
  conflicting.content.timeline.animation.pathMotionClips[0]!.derivedSource = { source: 'independent-user-path' }
  await executeUnifiedCommand({ ...conflictRequest, requestId: randomUUID(), dryRun: true })
})
