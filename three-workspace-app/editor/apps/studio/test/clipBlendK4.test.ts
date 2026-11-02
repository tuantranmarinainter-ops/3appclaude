import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { createFrameSnapshot, evaluateFrame } from '@topview/3d-builder/evaluate'
import { validateProject, type UnifiedProject } from '@bbs/animation-workspace-shared'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore.ts'
import { stageAssetUpload } from '../src/unifiedAssetFiles.ts'
import { inspectProjectFilm } from '../src/unifiedFilmSampling.ts'
import { filmPreflight } from '../src/filmPreflight.ts'
import { blendZoneText, invalidFilmMotionOverlaps, listFilmBlendZones } from '../src/filmBlendZones.ts'
import { planSplitShots } from '../src/splitShots.ts'
import { projectEvaluationScene } from '../src/unifiedSkeletonEvaluation.ts'

const projectsDir = mkdtempSync(path.join(tmpdir(), 'bbs-clip-blend-k4-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
test.after(() => rmSync(projectsDir, { recursive: true, force: true }))
const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const builtin = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')

type Clip = UnifiedProject['scene']['content']['timeline']['animation']['motionClips'][number]
function clip(id: string, nodeId: string, start: number, end: number, blendIn?: Record<string, unknown>): Clip {
  return { id, source: 'semantic', sourceDuration: 3, frameStart: start, frameEnd: end, target: { type: 'node', nodeId },
    playback: { version: 1, speed: 1, loop: false, loopMode: 'repeat', ...(blendIn ? { blendIn } : {}) },
    motion: { assetId: id, name: id, source: 'official', sourceRig: 'mixamorig', url: '/library/action', inPlace: true, loop: false, speed: 1, time: 0 } } as unknown as Clip
}

async function actorProject(endFrame: number) {
  const scene = makeEmptyDraft('Clip blend K4', 30, endFrame, { fov: 50, position: { x: 1, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } })
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Clip blend K4', scene } })
  const projectId = String(created.projectId)
  const staged = await stageAssetUpload('k4.glb', new ReadableStream({ start(controller) { controller.enqueue(readFileSync(builtin)); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [staged.id], format: 'glb' } })
  const assetId = (imported.result.assetIds as string[])[0]!, skeletonId = (imported.result.skeletonIds as string[])[0]!
  const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: imported.revision, command: 'character.add', args: { assetId, skeletonId, name: 'Gỗ Xưa' } })
  const project = await readUnifiedProject(projectId)
  const characterId = String(added.result.characterId)
  const next = structuredClone(project.scene)
  next.content.editorial = { version: 1, activeSequenceId: 'seq', sequences: [{ id: 'seq', clips: [{ id: 'shot-1', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: endFrame }] }] }
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: added.revision, command: 'scene.apply', args: {
    operations: [{ type: 'document.replace', document: next, fcurves: project.extensions.topview?.fcurves ?? null }] } })
  const saved = await readUnifiedProject(projectId)
  return { project: saved, characterId, nodeId: saved.characters[characterId]!.nodeId }
}

function withClips(project: UnifiedProject, clips: Clip[]) {
  const copy = structuredClone(project)
  copy.scene.content.timeline.animation.motionClips = clips
  return copy
}

const blend = (frames: number, extra: Record<string, unknown> = {}) => ({ frames, curve: 'smooth', footLock: true, ...extra })

test('K4 preflight lists valid blend zones, does not error, and errors for overlaps without blendIn or with three clips', async () => {
  const { project, characterId, nodeId } = await actorProject(149)
  const args = { characterIds: [characterId], sequenceId: 'seq', range: { startFrame: 0, endFrame: 149 }, viewportAspect: 16 / 9 }
  const evidence = { assetAvailability: {}, footSamples: { [characterId]: [{ frame: 0, leftY: 0, rightY: 0, actorWorldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] } }

  const valid = withClips(project, [clip('A', nodeId, 0, 58), clip('B', nodeId, 44, 134, blend(15, { mirror: true }))])
  assert.deepEqual(listFilmBlendZones(valid, [characterId], args.range).map((z) => [z.clipId, z.frameStart, z.frameEnd, z.frames, z.mirror]), [['B', 44, 58, 15, true]])
  assert.equal(blendZoneText(listFilmBlendZones(valid, [characterId])[0]!, 30), 'Gỗ Xưa: trộn 44–58 (15 khung), khóa chân, đảo chân')
  assert.deepEqual(invalidFilmMotionOverlaps(valid, [characterId], args.range), [])
  assert.ok(!inspectProjectFilm(valid, args).issues.some((entry) => entry.code === 'MOTION_OVERLAP_INVALID'))
  const report = filmPreflight(valid, { ...args, ...evidence })
  assert.ok(!report.errors.some((entry) => /OVERLAP/.test(entry.code)), JSON.stringify(report.errors))
  const zoneWarning = report.warnings.find((entry) => entry.code === 'CLIP_BLEND_ZONE')!
  assert.ok(zoneWarning.message.vi.includes('Gỗ Xưa: trộn 44–58 (15 khung), khóa chân, đảo chân'))
  assert.equal(zoneWarning.clipId, 'B')
  // A zone outside the exported range is not listed.
  assert.equal(filmPreflight(valid, { ...args, ...evidence, range: { startFrame: 90, endFrame: 149 } }).warnings.some((entry) => entry.code === 'CLIP_BLEND_ZONE'), false)

  const noBlend = withClips(project, [clip('A', nodeId, 0, 58), clip('B', nodeId, 44, 134)])
  assert.equal(invalidFilmMotionOverlaps(noBlend, [characterId], args.range)[0]?.reason, 'no-blend')
  assert.ok(inspectProjectFilm(noBlend, args).issues.some((entry) => entry.code === 'MOTION_OVERLAP_INVALID'))
  const bad = filmPreflight(noBlend, { ...args, ...evidence })
  const overlapError = bad.errors.find((entry) => entry.code === 'FILM_MOTION_OVERLAP_INVALID')!
  assert.ok(overlapError.message.vi.startsWith('Gỗ Xưa:'))

  // Touching clips (frameEnd of A == frameStart of B) are the long-standing layout, never an overlap error.
  const touching = withClips(project, [clip('A', nodeId, 0, 58), clip('B', nodeId, 58, 134)])
  assert.deepEqual(invalidFilmMotionOverlaps(touching, [characterId], args.range), [])

  const triple = withClips(project, [clip('A', nodeId, 0, 58), clip('B', nodeId, 40, 100, blend(19)), clip('C', nodeId, 45, 134, blend(14))])
  assert.ok(invalidFilmMotionOverlaps(triple, [characterId], args.range).length > 0)
  assert.ok(filmPreflight(triple, { ...args, ...evidence }).errors.some((entry) => entry.code === 'FILM_MOTION_OVERLAP_INVALID'))
})

test('K4 splitShots keeps a blend zone intact when a shot cut falls inside it, and drops a stale blendIn', async () => {
  const { project, characterId, nodeId } = await actorProject(89)
  void characterId
  const source = withClips(project, [clip('A', nodeId, 0, 59), clip('B', nodeId, 40, 89, blend(20))])
  source.scene.content.editorial = { version: 1, activeSequenceId: 'ep', sequences: [{ id: 'ep', clips: [
    { id: 'shot-1', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 44 },
    { id: 'shot-2', cameraNodeId: 'camera_1', sourceFrameStart: 45, sourceFrameEnd: 89 }] }] }
  const before = JSON.stringify(source)
  const plans = planSplitShots(source, {})
  assert.equal(JSON.stringify(source), before, 'source is not mutated')
  const snapshotOf = (p: UnifiedProject, frame: number) => { const s = createFrameSnapshot(); evaluateFrame(projectEvaluationScene(p), frame, s); return s }
  const summary = (s: ReturnType<typeof snapshotOf>) => s.motionPlayback.map((c) => [c.clipId, +c.timeSeconds.toFixed(9), +(c.weight ?? 1).toFixed(9)])
  for (const plan of plans) {
    assert.equal(validateProject(plan.project), true)
    assert.ok(plan.warnings.some((w) => w.includes('vùng trộn')), 'cut-through warning')
    const length = plan.sourceRange.endFrame - plan.sourceRange.startFrame
    for (let f = 0; f <= length; f++) {
      assert.deepEqual(summary(snapshotOf(plan.project, f)), summary(snapshotOf(source, f + plan.sourceRange.startFrame)), `${plan.shotId} frame ${f}`)
    }
  }
  // Frames 40..59 are blended in the original, and both halves reproduce two playbacks there.
  assert.equal(snapshotOf(plans[1]!.project, 5).motionPlayback.length, 2)

  // A shot that no longer contains the earlier clip must not keep a dangling blendIn.
  const late = withClips(project, [clip('A', nodeId, 0, 59), clip('B', nodeId, 40, 89, blend(20))])
  late.scene.content.editorial = { version: 1, activeSequenceId: 'ep', sequences: [{ id: 'ep', clips: [
    { id: 'shot-1', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 59 },
    { id: 'shot-2', cameraNodeId: 'camera_1', sourceFrameStart: 60, sourceFrameEnd: 89 }] }] }
  const tail = planSplitShots(late, {})[1]!.project.scene.content.timeline.animation.motionClips
  assert.equal(tail.length, 1)
  assert.equal(tail[0]!.playback.blendIn, undefined)
})
