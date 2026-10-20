import { createHash } from 'node:crypto'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { validateProject } from '@bbs/animation-workspace-shared'
import { validateEditorial } from '@topview/3d-builder/evaluate'
import type { CameraSequenceSample, SkeletonFrameSample } from '@topview/3d-builder/skeleton'
import { cameraSamplesToFilm } from './filmCamera'
import { bakeFilmPoseTracks } from './filmPoseBake'
import { sampleProjectCameraSequence, sampleProjectSkeletonRange } from './unifiedSkeletonEvaluation'

export interface FilmSamplingArgs {
  characterIds: string[]
  sequenceId: string
  range: { startFrame: number; endFrame: number }
  viewportAspect: number
}

const TICK_RATE = 20
const MAX_TICKS = 255 // The pinned worker accepts at most 256 keys, including the endpoint.
const MAX_BONE_SAMPLES = 32768

function fail(message: string): never { throw new TypeError(message) }

/** Metadata preflight only; decoding and hash verification still happen before sampling. */
export function preflightProjectFilm(project: UnifiedProject, args: FilmSamplingArgs) {
  if (!validateProject(project)) fail('Film sampling requires a valid shared project')
  const { characterIds, sequenceId, range, viewportAspect } = args
  if (!Array.isArray(characterIds) || !characterIds.length || characterIds.length > 64 || new Set(characterIds).size !== characterIds.length ||
      characterIds.some((id) => typeof id !== 'string' || !Object.hasOwn(project.characters, id))) fail('Select 1-64 unique existing Characters')
  const timeline = project.scene.content.timeline
  if (!range || !Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) ||
      range.startFrame < timeline.frameStart || range.endFrame > timeline.frameEnd || range.endFrame < range.startFrame ||
      !Number.isFinite(viewportAspect) || viewportAspect <= 0) fail('Invalid Film range or viewport aspect')
  const ticks = (range.endFrame - range.startFrame + 1) / timeline.fps * TICK_RATE
  if (!Number.isFinite(ticks) || Math.abs(ticks - Math.round(ticks)) > 1e-7 || ticks < 1 || ticks > MAX_TICKS) fail('Film range must end on the 20 Hz grid and contain 1-255 ticks')
  if (typeof sequenceId !== 'string' || validateEditorial(project.scene, { sequenceId, requireClips: true }).length) fail('Film requires a valid camera sequence')
  const sequence = project.scene.content.editorial?.sequences.find((item) => item.id === sequenceId)
  if (!sequence || sequence.clips.length > 3) fail('Film currently supports 1-3 camera shots')
  let nextFrame = range.startFrame
  for (const shot of sequence.clips) {
    // Replay channels have one value per tick, so discontinuous editorial source cuts need a separate bake.
    if (shot.sourceFrameStart !== nextFrame) fail('Film shots must cover the selected source range contiguously in order')
    nextFrame = shot.sourceFrameEnd + 1
    const cutTick = (nextFrame - range.startFrame) / timeline.fps * TICK_RATE
    if (Math.abs(cutTick - Math.round(cutTick)) > 1e-7) fail('Film camera cuts must lie on the 20 Hz grid')
    const camera = project.scene.content.nodes.find((node) => node.id === shot.cameraNodeId)?.camera
    if (camera?.projection !== 'perspective') fail('Film requires perspective cameras')
  }
  if (nextFrame !== range.endFrame + 1) fail('Film shots must cover the selected source range exactly')
  let boneCount = 0
  const models = characterIds.map((id) => {
    const character = project.characters[id]!
    const profile = project.skeletons[character.skeletonId]!
    const node = project.scene.content.nodes.find((node) => node.id === character.nodeId)!
    const asset = project.assets[character.assetId]!
    if (node.metadata?.rig !== 'direct' || node.character?.animation?.posePresetId) fail('Film sampling requires an imported direct rig without an unresolved library pose')
    if (!['application/vnd.autodesk.fbx', 'model/gltf-binary'].includes(asset.source.mediaType)) fail('Film model conversion currently requires FBX or GLB source bytes')
    if (profile.bones.length > 512 || profile.bones.some((bone) => !/^[A-Za-z0-9_.-]{1,128}$/.test(bone.name))) fail('Film model bone names or count exceed the BOBJ worker profile')
    if (profile.metersPerUnit !== node.metadata?.modelUnitMeters) fail('Film Character units disagree with its Skeleton Profile')
    boneCount += profile.bones.length
    return { characterId: id, nodeId: character.nodeId, name: node.name, assetId: character.assetId, skeletonId: profile.id,
      source: asset.source, metersPerUnit: profile.metersPerUnit, basisToScene: profile.basisToScene, skeletonFingerprint: profile.fingerprint,
      sourceBones: profile.bones.map(({ id: boneId, name, parentId, rest }) => ({ id: boneId, name, parentId, rest })) }
  })
  if (boneCount * (Math.round(ticks) + 1) > MAX_BONE_SAMPLES) fail('Film range exceeds the in-memory bone sample budget; shorten the range or select fewer Characters')
  return { durationTicks: Math.round(ticks), models }
}

export interface FilmActorSample {
  tick: number
  sourceFrame: number
  side: 'left' | 'right'
  skeletons: SkeletonFrameSample[]
}

/** Converter input, not a native Film manifest: bone matrices retain their source conventions. */
export async function sampleProjectFilm(project: UnifiedProject, args: FilmSamplingArgs, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const snapshot = structuredClone(project)
  const options = structuredClone(args)
  const preflight = preflightProjectFilm(snapshot, options)
  const sourceHashes = Object.fromEntries(preflight.models.map((model) => [model.assetId, model.source.sha256]))
  const selectedNodes = new Set(preflight.models.map((model) => model.nodeId))
  const dependencyNodes = new Set(selectedNodes)
  const sequence = snapshot.scene.content.editorial!.sequences.find((item) => item.id === options.sequenceId)!
  for (const shot of sequence.clips) {
    const camera = snapshot.scene.content.nodes.find((node) => node.id === shot.cameraNodeId)!.camera!
    const targets = [camera.subject?.follow ? camera.subject.nodeId : undefined, camera.lookAtTarget?.nodeId]
    for (const clip of snapshot.scene.content.timeline.animation.motionClips) {
      if (targets.includes(clip.target.nodeId) && clip.motion.rootMotion?.policy === 'trajectory') dependencyNodes.add(clip.target.nodeId)
    }
  }
  for (const character of Object.values(snapshot.characters)) {
    if (dependencyNodes.has(character.nodeId)) sourceHashes[character.assetId] = snapshot.assets[character.assetId]!.source.sha256
  }
  for (const clip of snapshot.scene.content.timeline.animation.motionClips) {
    if (!dependencyNodes.has(clip.target.nodeId)) continue
    const motion = snapshot.motions[clip.motion.assetId]
    if (!motion) fail('Film motion source is missing')
    const asset = snapshot.assets[motion.assetId]!
    sourceHashes[motion.assetId] = asset.source.sha256
  }
  const cameraSamples: CameraSequenceSample[] = []
  for await (const sample of sampleProjectCameraSequence(snapshot, options.sequenceId, TICK_RATE, options.viewportAspect)) {
    signal?.throwIfAborted()
    cameraSamples.push(sample)
  }
  const camera = cameraSamplesToFilm(cameraSamples)
  if (camera.durationTicks !== preflight.durationTicks) fail('Camera and Character durations disagree')
  const frames: FilmActorSample[] = []
  for await (const sample of sampleProjectSkeletonRange(snapshot, { ...options.range, sampleFps: TICK_RATE }, options.characterIds)) {
    signal?.throwIfAborted()
    const tick = sample.timeSeconds * TICK_RATE
    if (Math.abs(tick - frames.length) > 1e-7 || sample.skeletonSamples.length !== preflight.models.length ||
        new Set(sample.skeletonSamples.map((item) => item.nodeId)).size !== preflight.models.length ||
        sample.skeletonSamples.some((item) => !selectedNodes.has(item.nodeId))) fail('Film skeleton sampler returned an incomplete grid')
    frames.push({ tick: frames.length, sourceFrame: sample.frame, side: sample.side, skeletons: sample.skeletonSamples })
  }
  signal?.throwIfAborted()
  if (frames.length !== preflight.durationTicks + 1 || frames.at(-1)?.side !== 'left') fail('Film skeleton sampler omitted the terminal left sample')
  return {
    schemaVersion: 1 as const, kind: 'film-sampling-input' as const, targetVersion: '2.4' as const,
    projectId: snapshot.projectId, sourceRevision: snapshot.revision,
    sourceSha256: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), sourceHashes,
    sampleFps: TICK_RATE, range: options.range, sequenceId: options.sequenceId,
    ...preflight, cameras: camera.cameras, aspect: camera.aspect, frames,
  }
}

/** Join converted BOBJ profiles to the immutable samples and bake editable channels per Character. */
export function bakeProjectFilmPoseTracks(input: Awaited<ReturnType<typeof sampleProjectFilm>>, convertedModels: ReadonlyMap<string, { modelId: string; bones: Array<{ name: string; sourceName?: string; parent: string | null; bobjRestMatrixRowMajor: number[] }> }>) {
  return input.models.map((model) => {
    const converted = convertedModels.get(model.assetId)
    if (!converted) fail(`Converted BOBJ profile is missing for Character ${model.characterId}`)
    const samples = input.frames.map((frame) => {
      const skeleton = frame.skeletons.find((item) => item.nodeId === model.nodeId)
      if (!skeleton) fail(`Film sample is missing Character ${model.characterId}`)
      return { tick: frame.tick, skeleton }
    })
    return { characterId: model.characterId, modelId: converted.modelId,
      poseTracks: bakeFilmPoseTracks(model.sourceBones, model.metersPerUnit, converted, samples, model.basisToScene) }
  })
}
