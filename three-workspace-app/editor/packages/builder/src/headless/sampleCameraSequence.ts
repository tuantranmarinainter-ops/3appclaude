import * as THREE from 'three'
import type { DirectorDocument } from '../contract/types'
import { cameraNumericAspect } from '../contract/cameraAspect'
import type { SceneOverlays } from '../evaluate/sceneFromDocument'
import { sceneFromDocument } from '../evaluate/sceneFromDocument'
import { createFrameSnapshot, evaluateFrame } from '../evaluate/evaluateFrame'
import { getEditSequence, getClipDurationFrames, validateEditorial } from '../evaluate/editSequence'
import { applyEvaluatedCamera } from '../engine/objects/cameraTransform'

export interface CameraSequenceSample {
  shotId: string
  cameraNodeId: string
  sourceFrame: number
  shotTimeSeconds: number
  sequenceTimeSeconds: number
  side: 'left' | 'right'
  position: number[]
  quaternion: number[]
  lookAt: number[]
  verticalFov: number
  aspect: number
  near: number
  far: number
}

/** Each shot owns its left endpoint; adjacent cuts retain both poses at the same sequence time. */
export function* sampleCameraSequence(document: DirectorDocument, sequenceId: string, sampleFps: number, viewportAspect: number, overlays?: SceneOverlays): Generator<CameraSequenceSample> {
  const issues = validateEditorial(document, { sequenceId, requireClips: true })
  const sequence = getEditSequence(document, sequenceId)
  const fps = document.content.timeline.fps
  if (issues.length || !sequence || !Number.isFinite(fps) || fps <= 0 || !Number.isFinite(sampleFps) || sampleFps <= 0 || !Number.isFinite(viewportAspect) || viewportAspect <= 0) {
    throw new RangeError('Invalid camera sequence, FPS or viewport aspect')
  }
  let totalFrames = 0
  for (const shot of sequence.clips) {
    const node = document.content.nodes.find((node) => node.id === shot.cameraNodeId)!
    const settings = node.camera
    const aspect = cameraNumericAspect(settings, document.content.aspectRatio, viewportAspect)
    if (!settings || settings.projection !== 'perspective' || !(aspect > 0) || !Number.isFinite(aspect) || !(settings.near > 0) || !(settings.far > settings.near)) {
      throw new TypeError('Camera export requires a valid perspective camera')
    }
    const targets = [settings.subject?.nodeId, settings.lookAtTarget?.nodeId]
    if (!overlays?.resolveEffectiveWorldSubjects && document.content.timeline.animation.motionClips.some((clip) => targets.includes(clip.target.nodeId) && clip.motion.rootMotion?.policy === 'trajectory')) {
      throw new TypeError('Camera trajectory target requires effective-world subject evaluation before export')
    }
    const frames = getClipDurationFrames(shot)
    totalFrames += frames
    if (!Number.isSafeInteger(totalFrames) || !Number.isSafeInteger(shot.sourceFrameEnd + 1) || !Number.isSafeInteger(Math.ceil(frames / fps * sampleFps))) {
      throw new RangeError('Camera sample count exceeds numerical precision')
    }
  }
  const scene = sceneFromDocument(document, overlays)
  const snapshot = createFrameSnapshot()
  let sequenceOffset = 0
  for (const shot of sequence.clips) {
    const node = document.content.nodes.find((node) => node.id === shot.cameraNodeId)!
    const settings = node.camera!
    const aspect = cameraNumericAspect(settings, document.content.aspectRatio, viewportAspect)
    const camera = new THREE.PerspectiveCamera(settings.fov, aspect, settings.near, Math.min(settings.far, 2000))
    const lookAt = new THREE.Vector3(settings.lookAt.x, settings.lookAt.y, settings.lookAt.z)
    const duration = getClipDurationFrames(shot) / fps
    const count = Math.ceil(duration * sampleFps)
    for (let i = 0; i <= count; i++) {
      const endpoint = i === count
      const time = endpoint ? duration : i / sampleFps
      if (!endpoint && time >= duration) continue
      const side = endpoint ? 'left' as const : 'right' as const
      const sourceFrame = endpoint ? shot.sourceFrameEnd + 1 : shot.sourceFrameStart + time * fps
      evaluateFrame({ ...scene, exportSampleBoundary: side }, sourceFrame, snapshot)
      const transform = snapshot.transforms.get(node.id)!
      applyEvaluatedCamera(camera, lookAt, transform, node.transform.rotation)
      const values = [...camera.position.toArray(), ...camera.quaternion.toArray(), ...lookAt.toArray(), camera.fov]
      if (!values.every(Number.isFinite) || !(camera.fov > 0 && camera.fov < 180)) throw new RangeError('Invalid evaluated camera pose or FOV')
      yield { shotId: shot.id, cameraNodeId: node.id, sourceFrame, shotTimeSeconds: time,
        sequenceTimeSeconds: sequenceOffset + time, side, position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
        lookAt: lookAt.toArray(), verticalFov: camera.fov, aspect, near: camera.near, far: camera.far }
    }
    sequenceOffset += duration
  }
}
