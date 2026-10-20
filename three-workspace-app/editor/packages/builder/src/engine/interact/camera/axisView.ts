import * as THREE from 'three'

export type EditorViewDirection = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'

const ROTATIONS: Record<EditorViewDirection, [number, number, number]> = {
  front: [0, 0, 0],
  back: [0, Math.PI, 0],
  left: [0, -Math.PI / 2, 0],
  right: [0, Math.PI / 2, 0],
  top: [-Math.PI / 2, 0, 0],
  bottom: [Math.PI / 2, 0, 0],
}

/** 保持观察中心与距离，垂直视角显式指定旋转以避免 lookAt 的极点歧义。 */
export function axisViewPose(direction: EditorViewDirection, center: THREE.Vector3, distance: number) {
  const rotation = new THREE.Euler(...ROTATIONS[direction], 'YXZ')
  const quaternion = new THREE.Quaternion().setFromEuler(rotation)
  const position = new THREE.Vector3(0, 0, Math.max(distance, 0.001))
    .applyQuaternion(quaternion).add(center)
  return { position, quaternion }
}
