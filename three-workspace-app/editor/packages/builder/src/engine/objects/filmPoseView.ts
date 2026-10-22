import * as THREE from 'three'

const D2R = Math.PI / 180
export interface FilmPoseViewScene {
  nodes: readonly { id: string; transform: { rotation: { x: number; y: number; z: number } } }[]
  timeline: { animation: {
    motionClips: readonly { target: { nodeId: string }; frameStart: number; frameEnd: number }[]
    pathMotionClips: readonly { target?: { nodeId: string }; facing: string }[]
  } }
  fcurves?: { evalScalar(nodeId: string, path: string, axis: number, frame: number): number | null } | null
}

/** Return the exact world-space turn used by Film export, without touching evaluated data. */
export function filmPoseViewDelta(
  scene: FilmPoseViewScene,
  nodeId: string,
  frame: number,
  side: 'left' | 'right' | undefined,
  placement: THREE.Matrix4,
): THREE.Matrix4 | null {
  const fcurves = scene.fcurves
  if (!fcurves) return null
  const { motionClips, pathMotionClips } = scene.timeline.animation
  const owns = (start: number, end: number) => side === 'left'
    ? frame > start && frame <= end + 1
    : frame >= start && frame < end + 1
  if (!motionClips.some((clip) => clip.target.nodeId === nodeId && owns(clip.frameStart, clip.frameEnd))) return null
  if (pathMotionClips.some((clip) => clip.target?.nodeId === nodeId && clip.facing === 'path-tangent')) return null
  const node = scene.nodes.find((item) => item.id === nodeId)
  if (!node) return null
  const { x, y, z } = node.transform.rotation
  const fromEuler = [x, y, z]
  const toEuler = [...fromEuler]
  let turned = false
  for (let axis = 0; axis < 3; axis++) {
    const value = fcurves.evalScalar(nodeId, 'transform.rotation', axis, frame)
    if (value !== null && value !== fromEuler[axis]) {
      toEuler[axis] = value
      turned = true
    }
  }
  if (!turned) return null
  const from = new THREE.Quaternion().setFromEuler(new THREE.Euler(fromEuler[0]! * D2R, fromEuler[1]! * D2R, fromEuler[2]! * D2R))
  const to = new THREE.Quaternion().setFromEuler(new THREE.Euler(toEuler[0]! * D2R, toEuler[1]! * D2R, toEuler[2]! * D2R))
  const turn = new THREE.Matrix4().makeRotationFromQuaternion(from.invert().multiply(to))
  return placement.clone().multiply(turn).multiply(placement.clone().invert())
}

/** Convert a world turn back into the character placement's local space. */
export function filmPoseViewLocalTurn(delta: THREE.Matrix4, placement: THREE.Matrix4): THREE.Matrix4 {
  return placement.clone().invert().multiply(delta).multiply(placement)
}
