import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { CameraSequenceSample, SkeletonFrameSample } from '@topview/3d-builder/skeleton'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { getEditSequence } from '@topview/3d-builder/evaluate'
import { FILM_MODEL_FACING_OFFSET } from './filmManifest'
import { cameraSamplesToFilm } from './filmCamera'
import { projectEvaluationScene, sampleProjectCameraSequence, sampleProjectSkeletonRange } from './unifiedSkeletonEvaluation'
import { turnFilmSkeletonsByRotationKeys } from './unifiedFilmSampling'

export interface BbsCameraKey {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
  verticalFovDegrees: number
}

export interface BbsActorSample {
  x: number
  y: number
  z: number
  yaw: number
  pitch?: number
}

/** Three.js values for local preview; broker responses should serialize position/quaternion with toArray(). */
export interface BbsCameraThreePose {
  position: Vector3
  quaternion: Quaternion
  fov: number
  aspect: number
  near: number
}

export interface FilmFrameRectangle {
  x: number
  y: number
  width: number
  height: number
}

const radians = Math.PI / 180

function finite(value: number): boolean {
  return Number.isFinite(value)
}

/** Reconstruct the Three.js camera pose represented by a BBS Film camera keyframe. */
export function bbsCameraToThree(key: BbsCameraKey, aspect: number): BbsCameraThreePose {
  if (!key || ![key.x, key.y, key.z, key.yaw, key.pitch, key.roll, key.verticalFovDegrees, aspect].every(finite)) {
    throw new TypeError('BBS camera key and aspect must contain finite numbers')
  }
  if (aspect <= 0 || key.verticalFovDegrees <= 0 || key.verticalFovDegrees >= 180) {
    throw new RangeError('BBS camera aspect must be positive and vertical FOV must be in (0, 180) degrees')
  }

  // cameraSamplesToFilm stores the inverse BBS view rotation. Its yaw already includes BBS's +180 convention.
  const worldRotation = new Matrix4()
    .makeRotationZ(key.roll * radians)
    .multiply(new Matrix4().makeRotationX(key.pitch * radians))
    .multiply(new Matrix4().makeRotationY(key.yaw * radians))
    .invert()
  return {
    position: new Vector3(key.x, key.y, key.z),
    quaternion: new Quaternion().setFromRotationMatrix(worldRotation).normalize(),
    fov: key.verticalFovDegrees,
    aspect,
    near: 0.05,
  }
}

/** Reconstruct the App 2 actor world matrix as a Three.js Matrix4 from the BBS film transform sample. */
export function bbsActorToThree(sample: BbsActorSample): Matrix4 {
  if (!sample || ![sample.x, sample.y, sample.z, sample.yaw, sample.pitch ?? 0].every(finite)) {
    throw new TypeError('BBS actor sample must contain finite transform values')
  }
  const appYaw = sample.yaw - FILM_MODEL_FACING_OFFSET
  const rotation = new Quaternion().setFromEuler(new Euler((sample.pitch ?? 0) * radians, -appYaw * radians, 0, 'YXZ'))
  return new Matrix4().compose(new Vector3(sample.x, sample.y, sample.z), rotation, new Vector3(1, 1, 1))
}

/** Return the largest centered rectangle with the requested aspect ratio inside a viewport. */
export function filmFrameRect(viewW: number, viewH: number, aspect: number): FilmFrameRectangle {
  if (![viewW, viewH, aspect].every(finite) || viewW <= 0 || viewH <= 0 || aspect <= 0) {
    throw new RangeError('Viewport dimensions and film aspect must be positive finite numbers')
  }
  let width = viewW
  let height = width / aspect
  if (height > viewH) {
    height = viewH
    width = height * aspect
  }
  return { x: (viewW - width) / 2, y: (viewH - height) / 2, width, height }
}

export interface BbsPreviewOptions {
  sequenceId: string
  frames: number[]
  viewportAspect: number
  characterIds?: string[]
  propIds?: string[]
}

/** Read-only BBS preview samples. `frames` are source frames selected by the editorial clips. */
export async function sampleBbsPreview(project: UnifiedProject, options: BbsPreviewOptions) {
  const sequence = getEditSequence(project.scene, options.sequenceId)
  if (!sequence) throw new RangeError('Sequence does not exist')
  const fps = project.scene.content.timeline.fps
  if (!Number.isFinite(fps) || fps <= 0 || !sequence.clips.length) {
    throw new RangeError('Sequence has no valid frame range')
  }
  const characterIds = options.characterIds ?? Object.keys(project.characters)
  const propIds = options.propIds ?? project.scene.content.nodes.filter((node) => node.type === 'prop').map((node) => node.id)
  const cameraSamples: CameraSequenceSample[] = []
  for await (const sample of sampleProjectCameraSequence(project, options.sequenceId, 20, options.viewportAspect)) cameraSamples.push(sample)
  const cameraFilm = cameraSamplesToFilm(cameraSamples)
  const scene = projectEvaluationScene(project)
  const resolutions = options.frames.map((frame) => {
    let matches = sequence.clips.filter((clip) => frame >= clip.sourceFrameStart && frame <= clip.sourceFrameEnd)
    if (!matches.length) matches = sequence.clips.filter((clip) => frame === clip.sourceFrameEnd + 1 &&
      !sequence.clips.some((item) => item.sourceFrameStart === frame))
    if (matches.length !== 1) throw new RangeError(matches.length ? `Frame ${frame} maps to multiple editorial clips` : `Frame ${frame} is outside the editorial sequence`)
    const clip = matches[0]!
    const tick = Math.round((frame - clip.sourceFrameStart) / fps * 20)
    return { frame, clip, tick }
  })
  const requestedTicks = new Map<string, Set<number>>()
  for (const item of resolutions) {
    const ticks = requestedTicks.get(item.clip.id) ?? new Set<number>()
    ticks.add(item.tick)
    requestedTicks.set(item.clip.id, ticks)
  }
  const skeletonByClipTick = new Map<string, { frame: number; side: 'left' | 'right'; skeletons: SkeletonFrameSample[] }>()
  if (characterIds.length) {
    for (const clip of sequence.clips) {
      const ticks = requestedTicks.get(clip.id)
      if (!ticks?.size) continue
      const maxTick = Math.max(...ticks)
      for await (const sample of sampleProjectSkeletonRange(project,
        { startFrame: clip.sourceFrameStart, endFrame: clip.sourceFrameEnd, sampleFps: 20 }, characterIds)) {
        const sampleTick = Math.round(sample.timeSeconds * 20)
        if (ticks.has(sampleTick)) {
          turnFilmSkeletonsByRotationKeys(scene, sample)
          skeletonByClipTick.set(`${clip.id}:${sampleTick}`, { frame: sample.frame, side: sample.side, skeletons: sample.skeletonSamples })
        }
        if (sampleTick >= maxTick) break
      }
    }
  }
  const frames = []
  for (const resolution of resolutions) {
    const { frame: requestedFrame, clip, tick } = resolution
    const cameraSample = cameraSamples.find((sample) => sample.shotId === clip.id && Math.round(sample.shotTimeSeconds * 20) === tick && sample.side === 'right') ??
      cameraSamples.find((sample) => sample.shotId === clip.id && Math.round(sample.shotTimeSeconds * 20) === tick && sample.side === 'left')
    if (!cameraSample) throw new RangeError(`No camera sample for 20 Hz tick ${tick}`)
    const cameraClip = cameraFilm.cameras.find((clip) => clip.id === cameraSample.shotId)
    const cameraKey = cameraClip?.keyframes[tick]
    if (!cameraKey) throw new RangeError(`Converted camera sample is missing for ${cameraSample.shotId}`)
    const camera = bbsCameraToThree(cameraKey, cameraFilm.aspect)
    const actorSample = skeletonByClipTick.get(`${clip.id}:${tick}`)
    const skeletonSamples = actorSample?.skeletons ?? []
    const actors: Array<{ characterId: string; propId?: never; worldMatrix: number[]; bones: Array<{ name: string; worldMatrix: number[] }> } |
      { propId: string; characterId?: never; worldMatrix: number[]; bones: Array<{ name: string; worldMatrix: number[] }> }> = []
    for (const skeleton of skeletonSamples) {
      const character = Object.values(project.characters).find((item) => item.nodeId === skeleton.nodeId)
      if (character) actors.push({ characterId: character.id, worldMatrix: skeleton.actorWorldMatrix,
        bones: skeleton.bones.map((bone) => ({ name: bone.name, worldMatrix: bone.worldMatrix })) })
    }
    for (const propId of propIds) {
      const node = project.scene.content.nodes.find((item) => item.id === propId && item.type === 'prop')
      if (!node) throw new RangeError(`Prop ${propId} does not exist`)
      const { position, rotation } = node.transform
      const { scale } = node.transform
      if ([scale.x, scale.y, scale.z].some((value) => Math.abs(value - 1) > 1e-6)) throw new RangeError(`Prop ${node.name} must use unit scale`)
      if (Math.abs(rotation.x) > 1e-6 || Math.abs(rotation.z) > 1e-6) throw new RangeError(`Prop ${node.name} may only turn around the vertical axis`)
      const worldMatrix = bbsActorToThree({ x: position.x, y: position.y, z: position.z,
        yaw: FILM_MODEL_FACING_OFFSET - rotation.y }).toArray()
      actors.push({ propId, worldMatrix, bones: [] })
    }
    if (actorSample && Math.abs(actorSample.frame - cameraSample.sourceFrame) > 1e-7) throw new RangeError(`Camera and actor samples differ at ${clip.id} tick ${tick}`)
    frames.push({ frame: requestedFrame, tick, sourceFrame: cameraSample.sourceFrame, side: cameraSample.side,
      shot: clip.id, shotId: clip.id, camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov, aspect: camera.aspect, near: camera.near }, actors })
  }
  return { sequenceId: options.sequenceId, sourceRevision: project.revision, sampleFps: 20, frames }
}
