import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { createFrameSnapshot, evaluateFrame } from '@topview/3d-builder/evaluate'
import { evaluateProjectSkeletons, projectEvaluationScene, sampleProjectSkeletonRange } from './unifiedSkeletonEvaluation'
import { turnFilmSkeletonsByRotationKeys, type FilmSamplingArgs } from './unifiedFilmSampling'

export interface VfxCue {
  id: string
  effect: string
  frameStart: number
  frameEnd: number
  position: { x: number; y: number; z: number }
  yaw: number
  scale: number
  attachNodeId?: string
  attachBone?: string
  /** BBS FS playback: 'auto' (default) starts the effect when the Film reaches frameStart; 'manual' leaves it paused for the user to start. */
  play?: 'auto' | 'manual'
}

export interface VfxCueExtension { version: 1; cues: VfxCue[] }

export interface VfxFilmEffect {
  effect: string
  x: number
  y: number
  z: number
  yaw: number
  scale: number
  startTick: number
  endTick: number
  play?: 'manual'
}

const EFFECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const CUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MAX_CUES = 2048
const MAX_VFX_ATTACHMENT_SAMPLES = 32768
const EPSILON = 1e-7

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }

function safeVector(value: unknown): value is { x: number; y: number; z: number } {
  return record(value) && Object.keys(value).length === 3 && ['x', 'y', 'z'].every((axis) => finite(value[axis])) &&
    ['x', 'y', 'z'].every((axis) => Math.abs(value[axis] as number) <= 1_000_000)
}

function normalizeYaw(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180
  return Math.abs(normalized) < 1e-10 ? 0 : normalized
}

function canonicalBoneName(value: string): string {
  return value.split(':').at(-1)!.replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function validateCueValue(value: unknown, timeline: { frameStart: number; frameEnd: number }, nodes: UnifiedProject['scene']['content']['nodes']): value is VfxCue {
  if (!record(value) || Object.keys(value).some((key) => !['id', 'effect', 'frameStart', 'frameEnd', 'position', 'yaw', 'scale', 'attachNodeId', 'attachBone', 'play'].includes(key))) return false
  if (typeof value.id !== 'string' || !CUE_ID.test(value.id) || typeof value.effect !== 'string' || !EFFECT_ID.test(value.effect) ||
      !Number.isSafeInteger(value.frameStart) || !Number.isSafeInteger(value.frameEnd) ||
      (value.frameStart as number) < timeline.frameStart || (value.frameEnd as number) > timeline.frameEnd || (value.frameStart as number) > (value.frameEnd as number) ||
      !safeVector(value.position) || !finite(value.yaw) || Math.abs(value.yaw) > 360_000 ||
      !finite(value.scale) || value.scale < 0.001 || value.scale > 1000 ||
      (value.play !== undefined && value.play !== 'auto' && value.play !== 'manual')) return false

  if (value.attachNodeId !== undefined) {
    if (typeof value.attachNodeId !== 'string' || !nodes.some((node) => node.id === value.attachNodeId && node.type !== 'camera' && node.type !== 'path')) return false
  }
  if (value.attachBone !== undefined) {
    if (typeof value.attachBone !== 'string' || !value.attachBone.trim() || value.attachNodeId === undefined) return false
  }
  return true
}

export function readVfxCueExtension(project: Pick<UnifiedProject, 'extensions' | 'scene' | 'characters' | 'skeletons'>): VfxCueExtension {
  const raw = project.extensions.vfxCues
  if (raw === undefined) return { version: 1, cues: [] }
  if (!record(raw) || Object.keys(raw).some((key) => !['version', 'cues'].includes(key)) || raw.version !== 1 || !Array.isArray(raw.cues) || raw.cues.length > MAX_CUES) {
    throw new TypeError('project.extensions.vfxCues must be version 1 with at most 2048 cues')
  }
  const timeline = project.scene.content.timeline
  if (!raw.cues.every((cue) => validateCueValue(cue, timeline, project.scene.content.nodes)) ||
      new Set(raw.cues.map((cue) => (cue as VfxCue).id)).size !== raw.cues.length) {
    throw new TypeError('project.extensions.vfxCues contains an invalid or duplicate cue')
  }
  for (const cue of raw.cues as VfxCue[]) {
    if (cue.attachBone) validateAttachedBone(project, cue.attachNodeId!, cue.attachBone)
  }
  return structuredClone(raw) as unknown as VfxCueExtension
}

export function validateAttachedBone(project: Pick<UnifiedProject, 'scene' | 'characters' | 'skeletons'>, nodeId: string, boneName: string): void {
  const node = project.scene.content.nodes.find((item) => item.id === nodeId && item.type === 'character')
  const character = Object.values(project.characters).find((item) => item.nodeId === nodeId)
  const profile = character && project.skeletons[character.skeletonId]
  if (!node || !character || !profile) throw new TypeError('attachBone requires an imported Character with a Skeleton Profile')
  const canonical = canonicalBoneName(boneName)
  const matches = profile.bones.filter((bone) => canonicalBoneName(bone.name) === canonical)
  if (!canonical || matches.length !== 1) throw new TypeError(`attachBone must match one real bone in the Character profile: ${boneName}`)
}

export function makeVfxCue(project: UnifiedProject, input: unknown, id: string): VfxCue {
  if (!record(input) || Object.keys(input).some((key) => !['effect', 'frameStart', 'frameEnd', 'position', 'yaw', 'scale', 'attachNodeId', 'attachBone', 'play'].includes(key))) {
    throw new TypeError('Cue fields are invalid')
  }
  const cue = { ...input, id } as unknown
  if (!validateCueValue(cue, project.scene.content.timeline, project.scene.content.nodes)) throw new TypeError('Cue values are invalid or outside the project timeline')
  if (typeof (cue as VfxCue).attachBone === 'string') validateAttachedBone(project, (cue as VfxCue).attachNodeId!, (cue as VfxCue).attachBone!)
  return structuredClone(cue as VfxCue)
}

export function updateVfxCue(project: UnifiedProject, current: VfxCue, patch: unknown): VfxCue {
  if (!record(patch) || Object.keys(patch).some((key) => !['effect', 'frameStart', 'frameEnd', 'position', 'yaw', 'scale', 'attachNodeId', 'attachBone', 'play'].includes(key)) || !Object.keys(patch).length) {
    throw new TypeError('Cue update requires one or more editable fields')
  }
  const normalizedPatch = structuredClone(patch) as Record<string, unknown>
  const next = { ...current, id: current.id } as VfxCue
  if (normalizedPatch.attachNodeId === null) {
    delete next.attachNodeId
    delete next.attachBone
    delete normalizedPatch.attachNodeId
  }
  if (normalizedPatch.attachBone === null) {
    delete next.attachBone
    delete normalizedPatch.attachBone
  }
  Object.assign(next, normalizedPatch)
  if (!validateCueValue(next, project.scene.content.timeline, project.scene.content.nodes)) throw new TypeError('Cue values are invalid or outside the project timeline')
  if (typeof next.attachBone === 'string') validateAttachedBone(project, next.attachNodeId!, next.attachBone)
  return next
}

export function frameToFilmTick(frame: number, startFrame: number, fps: number): number {
  if (![frame, startFrame, fps].every(Number.isFinite) || fps <= 0) throw new TypeError('Frame and FPS must be finite and FPS must be positive')
  return (frame - startFrame) * 20 / fps
}

export class VfxCueExportError extends Error {
  readonly code = 'UNSUPPORTED_CAPABILITY'
}

function transformMatrix(position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }): Matrix4 {
  const euler = new Euler(rotation.x * Math.PI / 180, rotation.y * Math.PI / 180, rotation.z * Math.PI / 180, 'XYZ')
  return new Matrix4().compose(new Vector3(position.x, position.y, position.z), new Quaternion().setFromEuler(euler), new Vector3(scale.x, scale.y, scale.z))
}

function nodeWorldMatrix(project: UnifiedProject, transforms: Map<string, { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } }>, nodeId: string): Matrix4 {
  const byId = new Map(project.scene.content.nodes.map((node) => [node.id, node]))
  const chain = [] as typeof project.scene.content.nodes[number][]
  const visited = new Set<string>()
  let node = byId.get(nodeId)
  while (node) {
    if (visited.has(node.id)) throw new VfxCueExportError(`VFX attachment ${nodeId} has a parent cycle`)
    visited.add(node.id); chain.unshift(node)
    node = node.parentId ? byId.get(node.parentId) : undefined
  }
  const world = new Matrix4()
  for (const item of chain) {
    const transform = transforms.get(item.id) ?? item.transform
    world.multiply(transformMatrix(transform.position, transform.rotation, transform.scale))
  }
  return world
}

/** Evaluate an attached scene node, including its parent transforms, at one source frame. */
export function evaluateVfxNodeWorldMatrix(project: UnifiedProject, nodeId: string, frame: number): number[] {
  if (!Number.isFinite(frame) || !project.scene.content.nodes.some((node) => node.id === nodeId)) throw new TypeError(`VFX attachment node does not exist at frame ${frame}`)
  const scene = projectEvaluationScene(project)
  const snapshot = createFrameSnapshot()
  evaluateFrame(scene, frame, snapshot)
  return nodeWorldMatrix(project, snapshot.transforms, nodeId).toArray()
}

export interface EvaluatedVfxCuePose {
  cue: VfxCue
  position: { x: number; y: number; z: number }
  yaw: number
  scale: number
}

/** Resolve active cues at one editor frame, including CPU-evaluated Character root or bone attachments. */
export async function evaluateVfxCuesAtFrame(project: UnifiedProject, frame: number, signal?: AbortSignal,
  sampledSkeletons?: Map<string, { actorWorldMatrix: number[]; bones: Array<{ name: string; worldMatrix: number[] }> }>): Promise<EvaluatedVfxCuePose[]> {
  if (!Number.isFinite(frame) || frame < project.scene.content.timeline.frameStart || frame > project.scene.content.timeline.frameEnd) {
    throw new TypeError('VFX cue frame must be inside the project timeline')
  }
  const cues = readVfxCueExtension(project).cues.filter((cue) => cue.frameStart <= frame && cue.frameEnd >= frame)
  if (!cues.length) return []
  signal?.throwIfAborted()
  const activeNodeIds = [...new Set(cues.map((cue) => cue.attachNodeId).filter((value): value is string => typeof value === 'string'))]
  const characterIds = [...new Set(activeNodeIds.flatMap((nodeId) => Object.values(project.characters).filter((character) => character.nodeId === nodeId).map((character) => character.id)))]
  const boneCount = characterIds.reduce((sum, id) => sum + (project.skeletons[project.characters[id]!.skeletonId]?.bones.length ?? MAX_VFX_ATTACHMENT_SAMPLES + 1), 0)
  if (boneCount + activeNodeIds.length > MAX_VFX_ATTACHMENT_SAMPLES) throw new VfxCueExportError(`VFX frame evaluation exceeds the ${MAX_VFX_ATTACHMENT_SAMPLES} sample host limit`)
  const scene = projectEvaluationScene(project)
  const snapshot = createFrameSnapshot()
  evaluateFrame(scene, frame, snapshot)
  const skeletons = sampledSkeletons ?? new Map<string, { actorWorldMatrix: number[]; bones: Array<{ name: string; worldMatrix: number[] }> }>()
  if (characterIds.length && !sampledSkeletons) {
    const selected = { ...project, characters: Object.fromEntries(characterIds.map((id) => [id, project.characters[id]!])) }
    const sample = await evaluateProjectSkeletons(selected, snapshot)
    signal?.throwIfAborted()
    if (sample.issues.length) throw new VfxCueExportError(`VFX Character attachment could not be CPU-evaluated at frame ${frame}: ${sample.issues[0]!.message}`)
    turnFilmSkeletonsByRotationKeys(scene, { frame, side: 'right', skeletonSamples: sample.skeletonSamples })
    for (const skeleton of sample.skeletonSamples) skeletons.set(skeleton.nodeId, skeleton)
  }
  const result: EvaluatedVfxCuePose[] = []
  for (const cue of cues) {
    signal?.throwIfAborted()
    let matrix: number[] | undefined
    if (cue.attachNodeId) {
      const character = Object.values(project.characters).find((item) => item.nodeId === cue.attachNodeId)
      if (character) {
        const skeleton = skeletons.get(cue.attachNodeId)
        if (cue.attachBone) {
          const canonical = canonicalBoneName(cue.attachBone)
          const matches = skeleton?.bones.filter((bone) => canonicalBoneName(bone.name) === canonical) ?? []
          if (matches.length !== 1) throw new VfxCueExportError(`VFX cue ${cue.id} bone ${cue.attachBone} could not be CPU-evaluated at frame ${frame}`)
          matrix = matches[0]!.worldMatrix
        } else matrix = skeleton?.actorWorldMatrix
      } else matrix = nodeWorldMatrix(project, snapshot.transforms, cue.attachNodeId).toArray()
      if (!matrix) throw new VfxCueExportError(`VFX cue ${cue.id} attachment ${cue.attachNodeId} could not be CPU-evaluated at frame ${frame}`)
      result.push({ cue, ...evaluateAttachedVfxCue(cue, matrix) })
    } else result.push({ cue, position: structuredClone(cue.position), yaw: normalizeYaw(cue.yaw), scale: cue.scale })
  }
  return result
}

export function evaluateAttachedVfxCue(cue: VfxCue, matrixValues: number[]) {
  const matrix = new Matrix4().fromArray(matrixValues)
  const position = new Vector3().fromArray([cue.position.x, cue.position.y, cue.position.z]).applyMatrix4(matrix)
  const rotation = new Quaternion(), scale = new Vector3(), origin = new Vector3()
  matrix.decompose(origin, rotation, scale)
  if (scale.x <= 0 || scale.y <= 0 || scale.z <= 0) throw new VfxCueExportError(`VFX cue ${cue.id} is attached to a mirrored node transform, which effects.json cannot represent`)
  const yaw = normalizeYaw(new Euler().setFromQuaternion(rotation, 'YXZ').y * 180 / Math.PI + cue.yaw)
  if (Math.max(Math.abs(scale.x - scale.y), Math.abs(scale.y - scale.z)) > 1e-4) {
    throw new VfxCueExportError(`VFX cue ${cue.id} is attached to a non-uniformly scaled node, which effects.json cannot represent`)
  }
  return { position: { x: position.x, y: position.y, z: position.z }, yaw, scale: cue.scale * scale.x }
}

function samePose(a: ReturnType<typeof evaluateAttachedVfxCue>, b: ReturnType<typeof evaluateAttachedVfxCue>): boolean {
  const yawDelta = Math.abs(normalizeYaw(a.yaw - b.yaw))
  return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z) <= 1e-4 && yawDelta <= 1e-4 && Math.abs(a.scale - b.scale) <= 1e-4
}

/**
 * The repository's BBS effects sidecar consumer is external and exposes only one transform per interval.
 * Export therefore accepts attached cues only when their evaluated transform is constant for the interval.
 * Preview and project evaluation still follow an attached node/bone frame by frame.
 */
export async function buildVfxEffectsForFilm(project: UnifiedProject, args: Pick<FilmSamplingArgs, 'range'>, signal?: AbortSignal): Promise<VfxFilmEffect[]> {
  const extension = readVfxCueExtension(project)
  const fps = project.scene.content.timeline.fps
  const { startFrame, endFrame } = args.range
  // Film preflight treats both source endpoints as inclusive: 0..29 at 30 fps is 20 ticks.
  const duration = (endFrame - startFrame + 1) * 20 / fps
  if (![startFrame, endFrame, fps, duration].every(Number.isFinite) || endFrame < startFrame || Math.abs(duration - Math.round(duration)) > 1e-7) {
    throw new TypeError('Film range must align to the 20 Hz VFX tick grid')
  }
  const durationTicks = Math.round(duration)
  const overlapping = extension.cues.flatMap((cue) => {
    const startTick = Math.max(0, frameToFilmTick(cue.frameStart, startFrame, fps))
    const endTick = Math.min(durationTicks, frameToFilmTick(cue.frameEnd, startFrame, fps))
    return cue.frameStart <= endFrame && cue.frameEnd >= startFrame && startTick <= endTick + EPSILON
      ? [{ cue, startTick, endTick }] : []
  })
  if (!overlapping.length) return []

  const attachedNodeIds = [...new Set(overlapping.map(({ cue }) => cue.attachNodeId).filter((value): value is string => typeof value === 'string'))]
  const characterIds = [...new Set(attachedNodeIds.flatMap((nodeId) => Object.values(project.characters).filter((character) => character.nodeId === nodeId).map((character) => character.id)))]
  const framesByCue = new Map<string, number[]>()
  const allFrames = new Set<number>()
  for (const { cue, startTick, endTick } of overlapping) {
    const clippedStartFrame = Math.max(cue.frameStart, startFrame)
    const clippedEndFrame = Math.min(cue.frameEnd, endFrame)
    const samples = new Set<number>([clippedStartFrame, clippedEndFrame])
    const firstTick = Math.max(0, Math.ceil(startTick - EPSILON))
    const lastTick = Math.min(durationTicks, Math.floor(endTick + EPSILON))
    for (let tick = firstTick; tick <= lastTick; tick++) {
      const frame = startFrame + tick * fps / 20
      if (frame >= clippedStartFrame - EPSILON && frame <= clippedEndFrame + EPSILON) samples.add(frame)
    }
    framesByCue.set(cue.id, [...samples].sort((a, b) => a - b))
    for (const frame of samples) allFrames.add(frame)
  }
  const attachmentNodeCount = attachedNodeIds.length
  const bonesPerSample = characterIds.reduce((sum, id) => {
    const character = project.characters[id]!
    const profile = project.skeletons[character.skeletonId]
    return sum + (profile?.bones.length ?? MAX_VFX_ATTACHMENT_SAMPLES + 1)
  }, 0)
  // The CPU range evaluator visits the complete Film grid, even when only a short cue overlaps it.
  const gridFrameCount = durationTicks + 1 // includes the evaluator's terminal left-limit sample
  const boundaryFrameCount = [...allFrames].filter((frame) => {
    const tick = frameToFilmTick(frame, startFrame, fps)
    return Math.abs(tick - Math.round(tick)) > EPSILON
  }).length
  const boneSamples = bonesPerSample * (characterIds.length ? gridFrameCount + boundaryFrameCount : 0)
  const nodeSamples = attachmentNodeCount * allFrames.size
  if (boneSamples + nodeSamples > MAX_VFX_ATTACHMENT_SAMPLES) {
    throw new VfxCueExportError(`VFX attachment sampling needs ${boneSamples + nodeSamples} bone/node samples, above the ${MAX_VFX_ATTACHMENT_SAMPLES} sample host limit; reduce attached Characters or shorten the export`)
  }
  const posesByCueAndFrame = new Map<string, Map<number, EvaluatedVfxCuePose>>()
  const skeletonsByFrame = new Map<number, Map<string, { actorWorldMatrix: number[]; bones: Array<{ name: string; worldMatrix: number[] }> }>>()
  if (characterIds.length) {
    const scene = projectEvaluationScene(project)
    for await (const sample of sampleProjectSkeletonRange(project, { startFrame, endFrame, sampleFps: 20 }, characterIds)) {
      signal?.throwIfAborted()
      const tick = Math.round(frameToFilmTick(sample.frame, startFrame, fps))
      const canonicalFrame = startFrame + tick * fps / 20
      if (!allFrames.has(canonicalFrame)) continue
      turnFilmSkeletonsByRotationKeys(scene, sample)
      skeletonsByFrame.set(canonicalFrame, new Map(sample.skeletonSamples.map((skeleton) => [skeleton.nodeId, skeleton])))
    }
  }
  for (const frame of [...allFrames].sort((a, b) => a - b)) {
    signal?.throwIfAborted()
    const sampled = skeletonsByFrame.get(frame)
    const poses = await evaluateVfxCuesAtFrame(project, frame, signal, sampled)
    for (const pose of poses) {
      let byFrame = posesByCueAndFrame.get(pose.cue.id)
      if (!byFrame) { byFrame = new Map(); posesByCueAndFrame.set(pose.cue.id, byFrame) }
      byFrame.set(frame, pose)
    }
  }

  const output: VfxFilmEffect[] = []
  for (const { cue, startTick, endTick } of overlapping) {
    let firstPose: ReturnType<typeof evaluateAttachedVfxCue> | undefined
    for (const frame of framesByCue.get(cue.id) ?? []) {
      const pose = cue.attachNodeId
        ? posesByCueAndFrame.get(cue.id)?.get(frame) ?? (() => { throw new VfxCueExportError(`VFX cue ${cue.id} attachment could not be evaluated at source frame ${frame}`) })()
        : { cue, position: structuredClone(cue.position), yaw: normalizeYaw(cue.yaw), scale: cue.scale }
      if (!firstPose) firstPose = pose
      else if (!samePose(firstPose, pose)) {
        throw new VfxCueExportError(`VFX cue ${cue.id} follows a moving attachment, but effects.json supports only one transform per cue interval; detach it or shorten the cue to a static interval`)
      }
    }
    if (!firstPose) continue
    output.push({ effect: cue.effect, x: firstPose.position.x, y: firstPose.position.y, z: firstPose.position.z,
      yaw: firstPose.yaw, scale: firstPose.scale, startTick, endTick, ...(cue.play === 'manual' ? { play: 'manual' as const } : {}) })
  }
  return output
}
