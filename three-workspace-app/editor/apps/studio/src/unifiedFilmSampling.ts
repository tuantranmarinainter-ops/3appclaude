import { createHash } from 'node:crypto'
import { Euler, Matrix4, PropertyBinding, Quaternion, Vector3 } from 'three'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { validateProject } from '@bbs/animation-workspace-shared'
import { validateEditorial } from '@topview/3d-builder/evaluate'
import type { CameraSequenceSample, SkeletonFrameSample } from '@topview/3d-builder/skeleton'
import { cameraSamplesToFilm } from './filmCamera'
import { bakeFilmPoseTracks } from './filmPoseBake'
import { projectEvaluationScene, sampleProjectCameraSequence, sampleProjectSkeletonRange } from './unifiedSkeletonEvaluation'

export interface FilmSamplingArgs {
  characterIds: string[]
  /** Film content to include. Omitted values preserve the historical Characters-only export. */
  content?: 'characters' | 'backdrops' | 'both'
  /** Static scene backdrops (prop nodes) to carry into the Film as unanimated model actors. */
  propIds?: string[]
  sequenceId: string
  range: { startFrame: number; endFrame: number }
  viewportAspect: number
}

const TICK_RATE = 20
const MAX_TICKS = 255 // The pinned worker accepts at most 256 keys, including the endpoint.
const MAX_BONE_SAMPLES = 32768

export interface FilmSamplingIssue { code: string; message: string; characterId?: string; propId?: string }
export interface FilmSamplingInspection {
  issues: FilmSamplingIssue[]
  durationTicks?: number
  content?: 'characters' | 'backdrops' | 'both'
  characterIds?: string[]
  propIds?: string[]
  boneSampleCount?: number
  models: ReturnType<typeof filmSourceBones> extends never ? never[] : Array<{
    characterId: string; nodeId: string; name: string; assetId: string; skeletonId: string
    source: UnifiedProject['assets'][keyof UnifiedProject['assets']]['source']; metersPerUnit: number; basisToScene: number[]; skeletonFingerprint: string
    sourceBones: ReturnType<typeof filmSourceBones>
  }>
}

function fail(message: string): never { throw new TypeError(message) }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function resolveContentSelection(project: UnifiedProject, args: FilmSamplingArgs) {
  const content = args.content ?? (args.propIds?.length ? 'both' : 'characters')
  if (!['characters', 'backdrops', 'both'].includes(content)) fail('content must be characters, backdrops, or both')
  if (content === 'backdrops' && args.characterIds.length) fail('Backdrop-only Film content cannot include Characters')
  const characterIds = content === 'backdrops' ? [] : args.characterIds
  if (!Array.isArray(characterIds) || (content !== 'backdrops' && !characterIds.length) || characterIds.length > 64 ||
      new Set(characterIds).size !== characterIds.length || characterIds.some((id) => typeof id !== 'string' || !Object.hasOwn(project.characters, id))) {
    fail(content === 'backdrops' ? 'Backdrop-only Film content cannot include Characters' : 'Select 1-64 unique existing Characters')
  }
  const props = project.scene.content.nodes.filter((node) => node.type === 'prop' && typeof node.metadata?.assetId === 'string')
  const propIds = content === 'characters' ? (args.propIds ?? []) : (args.propIds ?? props.map((node) => node.id))
  if (!Array.isArray(propIds) || propIds.length > 64 || new Set(propIds).size !== propIds.length ||
      propIds.some((id) => typeof id !== 'string' || !props.some((node) => node.id === id))) fail('propIds must select up to 64 unique model props in this scene')
  if (content === 'characters' && propIds.length) fail('Characters-only Film content cannot include backdrops')
  if (content === 'backdrops' && !propIds.length) fail('Backdrop-only Film content requires at least one backdrop prop')
  let backdropBoneCount = 0
  for (const id of propIds) {
    const node = props.find((item) => item.id === id)!
    if ([node.transform.scale.x, node.transform.scale.y, node.transform.scale.z].some((value) => Math.abs(value - 1) > 1e-6)) fail(`Prop ${node.name} must use unit scale; bake its size into the model first`)
    if (Math.abs(node.transform.rotation.x) > 1e-6 || Math.abs(node.transform.rotation.z) > 1e-6) fail(`Prop ${node.name} may only turn around the vertical axis in a Film`)
    const assetId = node.metadata!.assetId as string
    const asset = project.assets[assetId as keyof typeof project.assets]
    if (!asset || asset.kind !== 'model') fail(`Backdrop ${node.name} is not a model asset`)
    const byAsset = project.extensions.assetSkeletonFingerprints
    const fingerprints = isRecord(byAsset) ? byAsset[assetId] : undefined
    if (fingerprints !== undefined) {
      if (!Array.isArray(fingerprints) || fingerprints.length !== 1 || typeof fingerprints[0] !== 'string') fail(`Backdrop ${node.name} must have exactly one imported rig profile to calculate its Film bone budget`)
      const profiles = Object.values(project.skeletons).filter((profile) => profile.fingerprint === fingerprints[0])
      if (profiles.length !== 1) fail(`Backdrop ${node.name} rig profile is missing; reimport the model before exporting`)
      const count = filmSourceBones(profiles[0]!.bones).length
      if (!count || count > 512) fail(`Backdrop ${node.name} exceeds the BOBJ worker bone limit`)
      backdropBoneCount += count
    } else {
      const importModels = project.extensions.assetImportModels
      if (!isRecord(importModels) || !isRecord(importModels[assetId])) fail(`Cannot determine the Film bone count for backdrop ${node.name}; reimport the model before exporting`)
      // Studio's importer records static models without skeleton fingerprints; the pinned converter creates one root bone.
      backdropBoneCount += 1
    }
  }
  return { content, characterIds, propIds, backdropBoneCount }
}

type ProfileBone = UnifiedProject['skeletons'][string]['bones'][number]
type RestTRS = { position: number[]; rotation: number[]; scale: number[] }
/**
 * Bones the Film pipeline bakes, named like the runtime samples and the Blender converter's `sourceName` (three.js
 * sanitized: `mixamorig:Hips` → `mixamorigHips`). A leading chain of non-deform root nodes (GLB armature object such as
 * `FEMALE_ADULT_Armature`) is not exported as a BOBJ bone, so its rest transform is folded into the first real bone.
 */
export function filmSourceBones(bones: readonly ProfileBone[]) {
  const children = new Map<string | null, ProfileBone[]>()
  for (const bone of bones) children.set(bone.parentId, [...(children.get(bone.parentId) ?? []), bone])
  const dropped = new Set<string>()
  let carried = new Matrix4()
  let roots = children.get(null) ?? []
  while (roots.length === 1 && roots[0]!.deform === false && (children.get(roots[0]!.id)?.length ?? 0) > 0) {
    const rest = roots[0]!.rest as RestTRS
    carried = carried.clone().multiply(new Matrix4().compose(new Vector3().fromArray(rest.position), new Quaternion().fromArray(rest.rotation), new Vector3().fromArray(rest.scale)))
    dropped.add(roots[0]!.id)
    roots = children.get(roots[0]!.id) ?? []
  }
  const kept = bones.filter((bone) => !dropped.has(bone.id)).map(({ id, name, parentId, rest }) => {
    if (parentId === null || !dropped.has(parentId)) return { id, name: PropertyBinding.sanitizeNodeName(name), parentId, rest }
    const r = rest as RestTRS, local = carried.clone().multiply(new Matrix4().compose(new Vector3().fromArray(r.position), new Quaternion().fromArray(r.rotation), new Vector3().fromArray(r.scale)))
    const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3(); local.decompose(position, rotation, scale)
    return { id, name: PropertyBinding.sanitizeNodeName(name), parentId: null, rest: { position: position.toArray(), rotation: rotation.toArray(), scale: scale.toArray() } }
  })
  if (new Set(kept.map((bone) => bone.name)).size !== kept.length) fail('Film bone names collide after normalization')
  return kept
}

/** Structured metadata validation shared by the preflight UI and the throwing export API. */
export function inspectProjectFilm(project: UnifiedProject, args: FilmSamplingArgs, options: { includePropBudget?: boolean; propBoneCounts?: Record<string, number> } = {}): FilmSamplingInspection {
  const issues: FilmSamplingIssue[] = []
  const add = (code: string, message: string, characterId?: string, propId?: string) => { if (!issues.some((item) => item.code === code && item.characterId === characterId && item.propId === propId)) issues.push({ code, message, ...(characterId ? { characterId } : {}), ...(propId ? { propId } : {}) }) }
  if (!args || typeof args !== 'object') return { issues: [{ code: 'ARGUMENTS_INVALID', message: 'Film sampling arguments are invalid' }], models: [] }
  if (!validateProject(project)) return { issues: [{ code: 'PROJECT_INVALID', message: 'Film sampling requires a valid shared project' }], models: [] }
  const { sequenceId, range, viewportAspect } = args
  let selection: ReturnType<typeof resolveContentSelection> | undefined
  try { selection = resolveContentSelection(project, args) }
  catch (cause) { add('CONTENT_SELECTION_INVALID', cause instanceof Error ? cause.message : 'Invalid Film content selection') }
  const characterIds = selection?.characterIds ?? []
  if (!selection && args.content !== 'backdrops') add('CHARACTER_SELECTION_INVALID', 'Select 1-64 unique existing Characters')
  const timeline = project.scene.content.timeline
  const validRange = !!range && Number.isSafeInteger(range.startFrame) && Number.isSafeInteger(range.endFrame) &&
    range.startFrame >= timeline.frameStart && range.endFrame <= timeline.frameEnd && range.endFrame >= range.startFrame &&
    Number.isFinite(viewportAspect) && viewportAspect > 0
  if (!validRange) add('RANGE_INVALID', 'Invalid Film range or viewport aspect')
  const ticks = validRange ? (range.endFrame - range.startFrame + 1) / timeline.fps * TICK_RATE : NaN
  const gridValid = Number.isFinite(ticks) && Math.abs(ticks - Math.round(ticks)) <= 1e-7 && ticks >= 1
  if (!gridValid || ticks > MAX_TICKS) add('TICK_LIMIT', 'Film range must end on the 20 Hz grid and contain 1-255 ticks')
  const durationTicks = gridValid ? Math.round(ticks) : undefined
  const sequenceValid = typeof sequenceId === 'string' && validateEditorial(project.scene, { sequenceId, requireClips: true }).length === 0
  if (!sequenceValid) add('SEQUENCE_INVALID', 'Film requires a valid camera sequence')
  const sequence = sequenceValid ? project.scene.content.editorial?.sequences.find((item) => item.id === sequenceId) : undefined
  if (!sequence || sequence.clips.length > 3) add('CAMERA_LIMIT', 'Film currently supports 1-3 camera shots')
  if (sequence && validRange) {
    let nextFrame = range.startFrame
    for (const shot of sequence.clips) {
      if (shot.sourceFrameStart !== nextFrame) add('SEQUENCE_GAP', 'Film shots must cover the selected source range contiguously in order')
      nextFrame = shot.sourceFrameEnd + 1
      const cutTick = (nextFrame - range.startFrame) / timeline.fps * TICK_RATE
      if (Math.abs(cutTick - Math.round(cutTick)) > 1e-7) add('CAMERA_CUT_GRID', 'Film camera cuts must lie on the 20 Hz grid')
      const camera = project.scene.content.nodes.find((node) => node.id === shot.cameraNodeId)?.camera
      if (camera?.projection !== 'perspective') add('CAMERA_PROJECTION', 'Film requires perspective cameras')
    }
    if (nextFrame !== range.endFrame + 1) add('SEQUENCE_COVERAGE', 'Film shots must cover the selected source range exactly')
  }
  const models: FilmSamplingInspection['models'] = []
  let boneCount = selection?.backdropBoneCount ?? 0
  if (selection) for (const id of characterIds) {
    const character = project.characters[id]!
    const profile = project.skeletons[character.skeletonId]!
    const node = project.scene.content.nodes.find((item) => item.id === character.nodeId)!
    const asset = project.assets[character.assetId]!
    let modelValid = true
    if (node.metadata?.rig !== 'direct' || node.character?.animation?.posePresetId) { add('RIG_UNSUPPORTED', 'Film sampling requires an imported direct rig without an unresolved library pose', id); modelValid = false }
    if (!['application/vnd.autodesk.fbx', 'model/gltf-binary'].includes(asset.source.mediaType)) { add('MODEL_FORMAT_UNSUPPORTED', 'Film model conversion currently requires FBX or GLB source bytes', id); modelValid = false }
    let sourceBones: ReturnType<typeof filmSourceBones> = []
    if (profile.bones.length > 512) { add('BONE_PROFILE_INVALID', 'Film model bone names or count exceed the BOBJ worker profile', id); modelValid = false }
    else {
      try {
        sourceBones = filmSourceBones(profile.bones)
        if (sourceBones.some((bone) => !/^[A-Za-z0-9_.-]{1,128}$/.test(bone.name))) { add('BONE_PROFILE_INVALID', 'Film model bone names or count exceed the BOBJ worker profile', id); modelValid = false }
      } catch (error) { add('BONE_PROFILE_INVALID', error instanceof Error ? error.message : 'Film bone names collide after normalization', id); modelValid = false }
    }
    if (profile.metersPerUnit !== node.metadata?.modelUnitMeters) { add('MODEL_UNITS_INVALID', 'Film Character units disagree with its Skeleton Profile', id); modelValid = false }
    boneCount += profile.bones.length
    if (modelValid) models.push({ characterId: id, nodeId: character.nodeId, name: node.name, assetId: character.assetId, skeletonId: profile.id,
      source: asset.source, metersPerUnit: profile.metersPerUnit, basisToScene: profile.basisToScene, skeletonFingerprint: profile.fingerprint, sourceBones })
  }
  if (!selection && options.includePropBudget && Array.isArray(args.propIds)) {
    for (const propId of args.propIds) {
      const prop = project.scene.content.nodes.find((node) => node.id === propId && node.type === 'prop' && typeof node.metadata?.assetId === 'string')
      const assetId = typeof prop?.metadata?.assetId === 'string' ? prop.metadata.assetId : undefined
      const count = assetId ? options.propBoneCounts?.[assetId] : undefined
      if (!prop || !assetId) continue
      if (!Number.isSafeInteger(count) || count! < 1) add('PROP_BONE_COUNT_UNAVAILABLE', 'Could not determine a selected backdrop model bone count from its source profile', undefined, propId)
      else boneCount += count!
    }
  }
  const boneSampleCount = durationTicks === undefined ? undefined : boneCount * (durationTicks + 1)
  if (boneSampleCount !== undefined && boneSampleCount > MAX_BONE_SAMPLES) add('BONE_BUDGET', 'Film range exceeds the in-memory bone sample budget; shorten the range or select fewer Characters or backdrops')
  return { issues, durationTicks, models, ...(selection ? { content: selection.content, characterIds: selection.characterIds, propIds: selection.propIds, boneSampleCount } : {}) }
}

/** Metadata preflight only; decoding and hash verification still happen before sampling. */
export function preflightProjectFilm(project: UnifiedProject, args: FilmSamplingArgs) {
  const inspection = inspectProjectFilm(project, args)
  if (inspection.issues.length || inspection.durationTicks === undefined || inspection.models.length !== inspection.characterIds?.length) fail(inspection.issues[0]?.message ?? 'Film sampling metadata is incomplete')
  return { durationTicks: inspection.durationTicks, models: inspection.models, content: inspection.content!, characterIds: inspection.characterIds!, propIds: inspection.propIds!, boneSampleCount: inspection.boneSampleCount! }
}

export interface FilmActorSample {
  tick: number
  sourceFrame: number
  side: 'left' | 'right'
  skeletons: SkeletonFrameSample[]
}

const D2R = Math.PI / 180

/**
 * App 2 (Topview) ignores a Character's rotation keys while a motion clip plays; its golden frames pin that. The Film
 * export turns the actor by those keys anyway, so a Character can turn during an Action in BBS FS. The turn is the
 * change from the evaluated (static) root rotation to the keyed one, applied in world space to the placement, actor and
 * every bone, which keeps the pose relative to the actor intact. Derived paths that face along the path own the yaw.
 */
export function turnFilmSkeletonsByRotationKeys(scene: ReturnType<typeof projectEvaluationScene>,
  sample: { frame: number; side: 'left' | 'right'; skeletonSamples: SkeletonFrameSample[] }) {
  const fcurves = scene.fcurves
  if (!fcurves) return
  const { motionClips, pathMotionClips } = scene.timeline.animation
  const { frame, side } = sample
  const owns = (start: number, end: number) => side === 'left' ? frame > start && frame <= end + 1 : frame >= start && frame < end + 1
  for (const skeleton of sample.skeletonSamples) {
    const nodeId = skeleton.nodeId
    if (!motionClips.some((clip) => clip.target.nodeId === nodeId && owns(clip.frameStart, clip.frameEnd))) continue
    if (pathMotionClips.some((clip) => clip.target?.nodeId === nodeId && clip.facing === 'path-tangent')) continue
    const node = scene.nodes.find((item) => item.id === nodeId)
    if (!node) continue
    const { x, y, z } = node.transform.rotation
    const keyed = [x, y, z]
    let turned = false
    for (let axis = 0; axis < 3; axis++) {
      const value = fcurves.evalScalar(nodeId, 'transform.rotation', axis, frame)
      if (value !== null && value !== keyed[axis]) { keyed[axis] = value; turned = true }
    }
    if (!turned) continue
    const from = new Quaternion().setFromEuler(new Euler(x * D2R, y * D2R, z * D2R))
    const to = new Quaternion().setFromEuler(new Euler(keyed[0]! * D2R, keyed[1]! * D2R, keyed[2]! * D2R))
    const placement = new Matrix4().fromArray(skeleton.placementMatrix)
    const delta = placement.clone().multiply(new Matrix4().makeRotationFromQuaternion(from.invert().multiply(to))).multiply(placement.clone().invert())
    const turn = (matrix: number[]) => new Matrix4().fromArray(matrix).premultiply(delta).toArray()
    skeleton.placementMatrix = turn(skeleton.placementMatrix)
    skeleton.actorWorldMatrix = turn(skeleton.actorWorldMatrix)
    for (const bone of skeleton.bones) bone.worldMatrix = turn(bone.worldMatrix)
  }
}

/** Converter input, not a native Film manifest: bone matrices retain their source conventions. */
export async function sampleProjectFilm(project: UnifiedProject, args: FilmSamplingArgs, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const snapshot = structuredClone(project)
  const preflight = preflightProjectFilm(snapshot, args)
  const options = { ...structuredClone(args), content: preflight.content, characterIds: preflight.characterIds, propIds: preflight.propIds }
  const sourceHashes = Object.fromEntries(preflight.models.map((model) => [model.assetId, model.source.sha256]))
  for (const propId of options.propIds) {
    const node = snapshot.scene.content.nodes.find((item) => item.id === propId && item.type === 'prop')!
    const assetId = node.metadata!.assetId as string
    sourceHashes[assetId] = snapshot.assets[assetId as keyof typeof snapshot.assets]!.source.sha256
  }
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
  if (camera.durationTicks !== preflight.durationTicks) fail('Camera and Film durations disagree')
  const frames: FilmActorSample[] = []
  const scene = projectEvaluationScene(snapshot)
  if (options.characterIds.length) {
    for await (const sample of sampleProjectSkeletonRange(snapshot, { ...options.range, sampleFps: TICK_RATE }, options.characterIds)) {
      signal?.throwIfAborted()
      const tick = sample.timeSeconds * TICK_RATE
      if (Math.abs(tick - frames.length) > 1e-7 || sample.skeletonSamples.length !== preflight.models.length ||
          new Set(sample.skeletonSamples.map((item) => item.nodeId)).size !== preflight.models.length ||
          sample.skeletonSamples.some((item) => !selectedNodes.has(item.nodeId))) fail('Film skeleton sampler returned an incomplete grid')
      turnFilmSkeletonsByRotationKeys(scene, sample)
      frames.push({ tick: frames.length, sourceFrame: sample.frame, side: sample.side, skeletons: sample.skeletonSamples })
    }
  } else {
    for (let tick = 0; tick <= preflight.durationTicks; tick++) {
      signal?.throwIfAborted()
      frames.push({ tick, sourceFrame: options.range.startFrame + tick * snapshot.scene.content.timeline.fps / TICK_RATE,
        side: tick === preflight.durationTicks ? 'left' : 'right', skeletons: [] })
    }
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
