/**
 * K5 measurement (docs/CLIP-BLEND-TASK-2026-11-02.md sections 4.2, 5.3, 9, 10.3) on COPIES only.
 *
 *   pnpm --filter @topview/3d-builder exec tsx <abs>/apps/studio/scripts/measureClipBlendK5.mts \
 *     --projects S:/Claude/w01-samples/clip-blend-k5-projects --library S:/Claude/w01-samples/clip-blend-lib [--out report.json]
 *
 * Writes into the project copy (shot package, merged clip, undo) and into the library copy. Never point it at a real
 * project folder or library: both are required arguments and the script refuses paths that look like the real ones.
 * Flow: sample the pre-merge blended poses -> shot.export over Go Xua's blend chain -> return the baked GLB UNEDITED
 * through shot.result.import with a name/description -> sample the merged clip -> compare -> history.undo -> hash.
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { Matrix4, Quaternion, Vector3 } from 'three'

const { values } = parseArgs({ options: { projects: { type: 'string' }, library: { type: 'string' }, project: { type: 'string' }, out: { type: 'string' } } })
const projects = values.projects?.replaceAll('\\', '/'), library = values.library?.replaceAll('\\', '/')
if (!projects || !library) throw new TypeError('Pass --projects and --library (COPIES)')
if (/\/(w01-library|tap15v3|test-all6-projects|clip-blend-projects)(\/|$)/i.test(projects + '/') || /^[a-z]:\/w01-library/i.test(library) || /\/w01-library(\/|$)/i.test(library)) throw new TypeError('Refusing to use a real project or library folder')
process.env.BBS_UNIFIED_PROJECTS_DIR = projects
process.env.W01_LIBRARY = library
const projectId = values.project ?? 'e901aadb-453f-4f69-b6f7-8eceda1f41f3'
const characterId = '49199c34-e125-4c4b-8f35-baf6a1945a5d'

const { executeUnifiedCommand, readUnifiedProject } = await import('../src/unifiedProjectStore.ts')
const { createShotPackage, saveShotExport } = await import('../src/shotExchange.ts')
const { sampleProjectSkeletonRange } = await import('../src/unifiedSkeletonEvaluation.ts')
const { stageAssetUpload } = await import('../src/unifiedAssetFiles.ts')
const { jsonBytes, sha256, zipPackage } = await import('../src/shotPackage.ts')
const { getAction, resolveCharacter } = await import('../../../packages/library/index.ts')

const hashProject = (project: unknown) => {
  const copy = JSON.parse(JSON.stringify(project)) as Record<string, unknown>
  delete copy.revision; delete copy.updatedAt
  return createHash('sha256').update(JSON.stringify(copy)).digest('hex')
}

async function samples(project: Awaited<ReturnType<typeof readUnifiedProject>>, start: number, end: number) {
  const out: Array<{ frame: number; bones: Array<{ name: string; position: Vector3; rotation: Quaternion }> }> = []
  for await (const sample of sampleProjectSkeletonRange(project, { startFrame: start, endFrame: end, sampleFps: 30 }, [characterId])) {
    if (sample.side !== 'right') continue
    out.push({ frame: sample.frame, bones: sample.skeletonSamples[0]!.bones.map((bone) => {
      const matrix = new Matrix4().fromArray(bone.worldMatrix), position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
      matrix.decompose(position, rotation, scale)
      return { name: bone.name, position, rotation }
    }) })
  }
  return out
}

const project0 = await readUnifiedProject(projectId)
const hash0 = hashProject(project0)
const node = project0.characters[characterId]!.nodeId
const chainBefore = project0.scene.content.timeline.animation.motionClips.filter((c) => c.target.nodeId === node).map((c) => ({ id: c.id, frameStart: c.frameStart, frameEnd: c.frameEnd, blendIn: c.playback.blendIn ?? null }))
const A = chainBefore.find((c) => !c.blendIn)!, B = chainBefore.find((c) => c.blendIn)!
const start = A.frameStart, end = Math.max(A.frameEnd, B.frameEnd)
const before = await samples(project0, start, end)

const result: Record<string, unknown> = { projectId, chainBefore, range: [start, end], hashBefore: hash0 }

// 1. Shot export over a range strictly inside the chain; the exporter widens it to the whole chain.
const requested = { frameStart: A.frameStart + 10, frameEnd: B.frameEnd - 10 }
const built = await createShotPackage(project0, { cameraNodeId: 'user_cam_uf9phu05', ...requested, editableCharacterIds: [characterId] })
await saveShotExport(project0, built)
const shotCharacter = built.shot.characters.find((c) => c.characterId === characterId)!
result.shotRange = built.shot.frameRange
result.requestedRange = [requested.frameStart, requested.frameEnd]

// 2. Return unedited (App 3 would hand back the same animation) with a merged-clip name/description.
const bytes = Buffer.from(built.files[shotCharacter.glb]!)
const newId = randomUUID(), glbHash = sha256(bytes)
const manifest = JSON.parse(Buffer.from(built.files[shotCharacter.manifest]!).toString())
manifest.glbSha256 = glbHash
manifest.actions = [{ ...manifest.actions[0], uuid: newId, originalActionUuid: shotCharacter.actionUuid }]
const resultJson = { version: '1.0.0', shotId: built.shot.shotId, baseShotSha256: sha256(built.files['shot.json']!), edits: [{ characterId, originalActionUuid: shotCharacter.actionUuid, newActionUuid: newId, glb: 'edit.glb', manifest: 'edit.json', glbSha256: glbHash,
  placementKeys: [{ frame: built.shot.frameRange[0], position: shotCharacter.placement.position, yawDegrees: shotCharacter.placement.yawDegrees }] }] }
const zip = zipPackage({ 'result.json': jsonBytes(resultJson), 'edit.glb': bytes, 'edit.json': jsonBytes(manifest) })
const upload = await stageAssetUpload('result.zip', new ReadableStream({ start(controller) { controller.enqueue(zip); controller.close() } }))
const mergeName = 'Gộp thử K5', mergeDescription = 'Gộp thử từ hai clip Gỗ Xưa, trộn 15 khung, khóa chân'
const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: project0.revision, command: 'shot.result.import',
  args: { file: upload.id, shotId: built.shot.shotId, merge: { name: mergeName, description: mergeDescription } } })
const project1 = await readUnifiedProject(projectId)
const clipsAfter = project1.scene.content.timeline.animation.motionClips.filter((c) => c.target.nodeId === node)
result.importResult = imported.result
result.clipsAfter = clipsAfter.map((c) => ({ id: c.id, frameStart: c.frameStart, frameEnd: c.frameEnd, assetId: c.motion.assetId, name: c.motion.name, blendIn: c.playback.blendIn ?? null }))
result.originalMotionsKept = [A, B].map((c) => !!project1.motions[project0.bindings[c.id]!.motionId])

// 3. Library copy: new Action under the current character with the chosen name and description.
const saved = getAction({ actionUuid: newId })
result.library = { uuid: saved.uuid, name: saved.name, nameVi: saved.nameVi, notes: saved.notes, ownerCharId: saved.ownerCharId, status: saved.status, version: saved.version,
  characterName: resolveCharacter(saved.ownerCharId!).name }

// 4. Merged clip poses vs pre-merge blended poses.
const after = await samples(project1, start, end)
let maxMm = 0, maxDeg = 0, worst = '', compared = 0
for (let i = 0; i < before.length; i++) {
  for (let b = 0; b < before[i]!.bones.length; b++) {
    const x = before[i]!.bones[b]!, y = after[i]!.bones[b]!
    const mm = x.position.distanceTo(y.position) * 1000
    const deg = 2 * Math.acos(Math.min(1, Math.abs(x.rotation.dot(y.rotation)))) * 180 / Math.PI
    compared++
    if (mm > maxMm) { maxMm = mm; worst = `${x.name}@${before[i]!.frame}` }
    if (deg > maxDeg) maxDeg = deg
  }
}
// Root at the first frame of the merged Action (relative-root convention check, section 10.3).
const hips = before[0]!.bones[0]!, hipsAfter = after[0]!.bones[0]!
result.poseCompare = { frames: before.length, bones: before[0]!.bones.length, compared, maxMm, maxDeg, worstPosition: worst,
  rootBone: hips.name, firstFrameRootPosition: hips.position.toArray(), firstFrameRootPositionAfter: hipsAfter.position.toArray() }

// 5. One Undo restores the exact pre-merge project.
const undone = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: project1.revision, command: 'history.undo', args: {} })
const project2 = await readUnifiedProject(projectId)
result.undo = { revisionBefore: project0.revision, revisionAfterImport: project1.revision, revisionAfterUndo: project2.revision, command: undone.result ?? null,
  hashAfterUndo: hashProject(project2), identical: hashProject(project2) === hash0 }
const restored = project2.scene.content.timeline.animation.motionClips.filter((c) => c.target.nodeId === node).map((c) => ({ id: c.id, frameStart: c.frameStart, frameEnd: c.frameEnd, blendIn: c.playback.blendIn ?? null }))
result.clipsAfterUndo = restored

const pass = maxMm <= 2 && maxDeg <= 0.5 && result.undo && (result.undo as { identical: boolean }).identical
result.verdict = pass ? 'PASS' : 'FAIL'
const text = JSON.stringify(result, null, 2)
console.log(text)
if (values.out) writeFileSync(path.resolve(values.out), text)
void readFileSync
