import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { createFrameSnapshot, evaluateFrame } from '@topview/3d-builder/evaluate'
import { validateProject, type UnifiedProject } from '@bbs/animation-workspace-shared'
import { executeUnifiedCommand, readUnifiedProject, listUnifiedProjects } from '../src/unifiedProjectStore'
import { planSplitShots } from '../src/splitShots'
import { projectEvaluationScene } from '../src/unifiedSkeletonEvaluation'
import { encodeWav16, MIX_RATE, filmAudioSchedule, mixAudio } from '../src/audioCues'

const temp = mkdtempSync(path.join(tmpdir(), 'split-shots-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = temp
test.after(() => rmSync(temp, { recursive: true, force: true }))
function fixture(): UnifiedProject {
  const scene = makeEmptyDraft('Tập 15', 30, 89, { fov: 50, position: { x: 1, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } })
  const camera = scene.content.nodes[0]!
  const actor = { id: 'actor', name: 'Actor', type: 'character' as const, visible: true, locked: false, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, metadata: {} }
  scene.content.nodes.push(actor)
  scene.content.editorial = { version: 1, activeSequenceId: 'episode', sequences: [{ id: 'episode', clips: [0, 1, 2].map((i) => ({ id: `shot-${i + 1}`, cameraNodeId: camera.id, sourceFrameStart: i * 30, sourceFrameEnd: i * 30 + 29 })) }] }
  scene.content.timeline.animation.motionClips = [{ id: 'crossing', source: 'semantic', sourceDuration: 2, frameStart: 10, frameEnd: 54, target: { type: 'node', nodeId: actor.id }, playback: { version: 1, speed: 1.5, loop: false, loopMode: 'repeat' }, motion: { assetId: 'legacy-motion', name: 'Action', source: 'official', sourceRig: 'mixamorig', url: '/library/action', inPlace: true, loop: false, speed: 1.5, time: 0.1, sourceLengthSeconds: 0.7 } }]
  return { type: 'three-workspace-project', version: 1, projectId: randomUUID(), revision: 0, name: 'Tập 15', scene, assets: {}, characters: {}, motions: {}, bindings: {}, skeletons: {}, mappings: {}, retargetSessions: {}, origins: [], extensions: { topview: { fcurves: { version: 1, encoding: 'compact-v1', fcurves: [{ id: 'position', t: ['node', actor.id], p: 'transform.position', i: 0, k: [[0, 0, 'bezier', 'a', null, { x: 10, y: 20 }], [89, 40, 'bezier', 'b', { x: 70, y: 5 }]] }] } } } }
}
function sample(project: UnifiedProject, frame: number) { const snapshot = createFrameSnapshot(); evaluateFrame(projectEvaluationScene(project), frame, snapshot); return snapshot }

test('three shot slicing preserves source, exact curve interpolation and crossing clip source phase', () => {
  for (const reverse of [false, true]) for (const loop of [false, true]) {
    const source = fixture(), clip = source.scene.content.timeline.animation.motionClips[0]!
    clip.motion.reverse = reverse; clip.playback.loop = loop
    const before = JSON.stringify(source), plans = planSplitShots(source, {})
    assert.equal(plans.length, 3); assert.equal(JSON.stringify(source), before)
    assert.deepEqual(plans.map((plan) => plan.project.scene.content.timeline.frameStart), [0, 0, 0])
    assert.equal(plans[2]!.project.scene.content.timeline.animation.motionClips.length, 0)
    for (const plan of plans) {
      assert.equal(validateProject(plan.project), true)
      for (let frame = 0; frame <= 29; frame++) {
        const original = sample(source, frame + plan.sourceRange.startFrame), split = sample(plan.project, frame)
        if (split.transforms.has('actor')) assert.ok(Math.abs(original.transforms.get('actor')!.position.x - split.transforms.get('actor')!.position.x) < 1e-7)
        const expected = original.motionPlayback[0], actual = split.motionPlayback[0]
        assert.equal(Boolean(actual), Boolean(expected))
        if (actual && expected) assert.ok(Math.abs(actual.timeSeconds - expected.timeSeconds) < 1e-6, `${reverse}/${loop}/${frame}: ${actual.timeSeconds} != ${expected.timeSeconds}`)
      }
    }
    assert.ok(plans[1]!.warnings.some((warning) => warning.includes('crossing')))
  }
})

test('store split leaves source bytes unchanged, shares audio inode, reports and replays idempotently', async () => {
  const source = fixture(), root = path.join(temp, source.projectId)
  const bytes = encodeWav16(new Float32Array(MIX_RATE * 2).fill(0.2)), sha256 = createHash('sha256').update(bytes).digest('hex')
  const ref = { path: `assets/${sha256}/source.wav`, sha256, byteLength: bytes.length, mediaType: 'audio/wav' }, assetId = `sha256:${sha256}` as const
  source.assets[assetId] = { id: assetId, kind: 'other', displayName: 'Voice', source: ref, derivatives: {}, provenance: { sourceKey: 'test', sourceVersion: '1', sourceHash: sha256, original: ref }, license: null, dependencies: [] }
  source.extensions.audioCues = { version: 1, cues: [{ id: 'voice', kind: 'voice', assetId, frameStart: 15, gainDb: 0 }] }
  source.extensions.vfxCues = { version: 1, cues: [{ id: 'fx', effect: 'spark', frameStart: 25, frameEnd: 35, position: { x: 0, y: 0, z: 0 }, yaw: 0, scale: 1, attachNodeId: 'actor' }] }
  mkdirSync(path.dirname(path.join(root, ref.path)), { recursive: true }); writeFileSync(path.join(root, ref.path), bytes)
  writeFileSync(path.join(root, 'project.json'), JSON.stringify(source, null, 2) + '\n')
  const before = readFileSync(path.join(root, 'project.json'))
  const envelope = { requestId: randomUUID(), projectId: source.projectId, expectedRevision: 0, command: 'project.splitShots', args: {} }
  const result = await executeUnifiedCommand(envelope), reports = result.result.projects as Array<{ projectId: string; newAssetBytes: number }>
  assert.deepEqual(readFileSync(path.join(root, 'project.json')), before)
  assert.equal(reports.length, 3); assert.equal(reports[1]!.newAssetBytes, 0)
  const second = await readUnifiedProject(reports[1]!.projectId)
  assert.equal(statSync(path.join(root, ref.path)).ino, statSync(path.join(temp, second.projectId, ref.path)).ino)
  const audio = second.extensions.audioCues.cues as Array<{ frameStart: number; offsetSeconds: number; frameEnd: number }>
  assert.equal(audio[0]!.frameStart, 0); assert.equal(audio[0]!.offsetSeconds, 0.5); assert.equal(audio[0]!.frameEnd, 29)
  const effects = second.extensions.vfxCues.cues as Array<{ frameStart: number; frameEnd: number }>
  assert.deepEqual(effects.map((cue) => [cue.frameStart, cue.frameEnd]), [[0, 5]])
  assert.deepEqual(await executeUnifiedCommand(envelope), result)
  const episodeId = String(second.extensions.episode.id)
  assert.equal(episodeId, reports[0]!.projectId)
  assert.equal((await listUnifiedProjects()).filter((row) => row.episode?.id === episodeId).length, 3)
  const repeated = await executeUnifiedCommand({ ...envelope, requestId: randomUUID() })
  const repeatedIds = (repeated.result.projects as Array<{ projectId: string }>).map((report) => report.projectId)
  assert.notEqual(repeatedIds[0], episodeId)
  const repeatedProject = await readUnifiedProject(repeatedIds[1]!)
  assert.equal(repeatedProject.extensions.episode.id, repeatedIds[0])
  const grouped = await listUnifiedProjects()
  assert.equal(grouped.filter((row) => row.episode?.id === episodeId).length, 3)
  assert.equal(grouped.filter((row) => row.episode?.id === repeatedIds[0]).length, 3)
  assert.ok((repeated.result.projects as Array<{ warnings: string[] }>)[1]!.warnings.some((message) => message.includes('tuổi hiệu ứng')))
  const resplit = await executeUnifiedCommand({ requestId: randomUUID(), projectId: repeatedIds[1], expectedRevision: 0, command: 'project.splitShots', args: {} })
  const resplitId = (resplit.result.projects as Array<{ projectId: string }>)[0]!.projectId
  assert.equal((await readUnifiedProject(resplitId)).extensions.episode.id, resplitId)
  assert.notEqual(resplitId, repeatedIds[0])
  const schedule = filmAudioSchedule([{ id: 'trim', kind: 'voice', assetId, frameStart: 0, offsetSeconds: 0.5, frameEnd: 14, gainDb: 0 }], new Map([[assetId, 2]]), 0, 29, 30, () => 'voice')
  assert.equal(schedule[0]!.offsetSeconds, 0.5)
  const mix = mixAudio([{ id: 'trim', kind: 'voice', assetId, frameStart: 0, offsetSeconds: 0.5, frameEnd: 14, gainDb: 0 }], new Map([[assetId, new Float32Array(MIX_RATE * 2).fill(0.2)]]), 0, 29, 30)
  assert.ok(mix[0]! > 0); assert.equal(mix[MIX_RATE * 0.75], 0)
  const delayed = mixAudio([{ id: 'delayed', kind: 'voice', assetId, frameStart: 15, offsetSeconds: 0.25, frameEnd: 29, gainDb: 0 }], new Map([[assetId, new Float32Array(MIX_RATE * 2).fill(0.2)]]), 0, 29, 30)
  assert.equal(delayed[MIX_RATE * 0.4], 0); assert.ok(delayed[MIX_RATE * 0.6]! > 0)
})


test('selection retains user-key-only actor, hierarchy and shot set, excluding other cameras and hidden nodes', () => {
  const source = fixture(), template = structuredClone(source.scene.content.nodes.find((node) => node.id === 'actor')!)
  source.scene.content.nodes.push({ ...structuredClone(source.scene.content.nodes[0]!), id: 'other-camera' }, { ...template, id: 'set_01', type: 'prop', name: 'set_01' }, { ...template, id: 'set_02', type: 'prop', name: 'set_02' }, { ...template, id: 'hidden', visible: false }, { ...template, id: 'group', type: 'group', children: ['actor', 'set_01'] })
  source.scene.content.nodes.find((node) => node.id === 'actor')!.parentId = 'group'
  source.extensions.topview.fcurves = { version: 1, encoding: 'compact-v1', fcurves: [{ id: 'other', t: ['node', 'other-camera'], p: 'camera.fov', i: 0, k: [[70, 50, 'linear', 'x']] }], userKeys: { actor: { position: [{ id: 'key', frame: 60, value: [4, 0, 0], interpolation: 'linear' }] } } }
  const [plan] = planSplitShots(source, { shotIds: ['shot-3'] })
  const ids = plan!.project.scene.content.nodes.map((node) => node.id)
  assert.ok(ids.includes('actor')); assert.ok(ids.includes('group'))
  assert.ok(!ids.includes('other-camera')); assert.ok(!ids.includes('hidden')); assert.ok(!ids.includes('set_01')); assert.ok(!ids.includes('set_02'))
  assert.deepEqual(plan!.project.scene.content.nodes.find((node) => node.id === 'group')!.children, ['actor'])
  assert.equal(plan!.project.extensions.episode.order, 3)
  assert.throws(() => planSplitShots(source, { shotIds: ['missing'] }), /shot/)
})

test('episode export plans ordered project snapshots on the 20 Hz grid and rejects off-grid cuts', async () => {
  const source = fixture(), root = path.join(temp, source.projectId)
  const bytes = Buffer.from('planning-only-model'), sha256 = createHash('sha256').update(bytes).digest('hex')
  const ref = { path: `assets/${sha256}/source.glb`, sha256, byteLength: bytes.length, mediaType: 'model/gltf-binary' }, assetId = `sha256:${sha256}` as const
  const provenance = { sourceKey: 'test', sourceVersion: '1', sourceHash: sha256, original: ref }
  source.assets[assetId] = { id: assetId, kind: 'model', displayName: 'Model', source: ref, derivatives: {}, provenance, license: null, dependencies: [] }
  const skeletonId = randomUUID(), characterId = randomUUID()
  source.skeletons[skeletonId] = { id: skeletonId, family: 'custom-preserved', bones: [{ id: 'root', name: 'root', parentId: null, rest: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, deform: true }], rootBoneId: 'root', metersPerUnit: 1, basisToScene: [1, 0, 0, 0, 1, 0, 0, 0, 1], fingerprint: sha256, nativeFingerprint: null, provenance }
  source.characters[characterId] = { id: characterId, assetId, nodeId: 'actor', skeletonId, name: 'Actor' }
  source.scene.content.nodes.find((node) => node.id === 'actor')!.metadata = { rig: 'direct', modelUnitMeters: 1 }
  mkdirSync(path.dirname(path.join(root, ref.path)), { recursive: true }); writeFileSync(path.join(root, ref.path), bytes); writeFileSync(path.join(root, 'project.json'), JSON.stringify(source))
  assert.equal(validateProject(source), true)
  const split = await executeUnifiedCommand({ requestId: randomUUID(), projectId: source.projectId, expectedRevision: 0, command: 'project.splitShots', args: {} })
  const ids = (split.result.projects as Array<{ projectId: string }>).map((report) => report.projectId)
  const planned = await executeUnifiedCommand({ requestId: randomUUID(), projectId: ids[1], expectedRevision: 0, command: 'episode.export', args: { name: 'tap15' }, dryRun: true })
  assert.deepEqual((planned.result.series as Array<{ projectId: string }>).map((segment) => segment.projectId), ids)
  assert.deepEqual((planned.result.series as Array<{ startTick: number; endTick: number }>).map((segment) => [segment.startTick, segment.endTick]), [[0, 20], [20, 40], [40, 60]])
  await assert.rejects(() => executeUnifiedCommand({ requestId: randomUUID(), projectId: ids[0], expectedRevision: 0, command: 'episode.export', args: { name: 'tap15', effectsPolicy: { mode: 'include', target: { runtime: 'bbs-fs-2.7', aaaRendererAvailable: true, compatibleAddonConfirmed: true, gameDir: temp } } }, dryRun: true }), (error: unknown) => (error as { code?: string }).code === 'VALIDATION_FAILED')
  const invalid = await readUnifiedProject(ids[1]!)
  invalid.scene.content.timeline.frameEnd = 28; invalid.scene.content.editorial!.sequences[0]!.clips[0]!.sourceFrameEnd = 28
  writeFileSync(path.join(temp, invalid.projectId, 'project.json'), JSON.stringify(invalid))
  await assert.rejects(() => executeUnifiedCommand({ requestId: randomUUID(), projectId: ids[0], expectedRevision: 0, command: 'episode.export', args: { name: 'tap15' }, dryRun: true }), /20 Hz|20 Hz grid|20/)
})
