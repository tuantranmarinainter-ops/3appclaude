import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { axisViewPose, type EditorViewDirection } from '../interact/camera/axisView'

describe('compass view directions', () => {
  const directions: [EditorViewDirection, [number, number, number]][] = [
    ['front', [0, 0, 1]], ['back', [0, 0, -1]],
    ['left', [-1, 0, 0]], ['right', [1, 0, 0]],
    ['top', [0, 1, 0]], ['bottom', [0, -1, 0]],
  ]
  for (const [direction, offset] of directions) {
    test(`${direction} keeps the center and distance and faces the center`, () => {
      const center = new THREE.Vector3(2, 3, -4)
      const pose = axisViewPose(direction, center, 7)
      const expected = new THREE.Vector3(...offset).multiplyScalar(7).add(center)
      expect(pose.position.distanceTo(expected)).toBeLessThan(1e-10)
      expect(pose.position.distanceTo(center)).toBeCloseTo(7)
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.quaternion)
      expect(forward.distanceTo(center.clone().sub(pose.position).normalize())).toBeLessThan(1e-10)
      expect(new THREE.Vector3(1, 0, 0).applyQuaternion(pose.quaternion).length()).toBeCloseTo(1)
    })
  }
  test('vertical views have a stable screen-up direction', () => {
    for (const [direction, z] of [['top', -1], ['bottom', 1]] as const) {
      const pose = axisViewPose(direction, new THREE.Vector3(), 5)
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.quaternion)
      expect(up.z).toBeCloseTo(z)
      expect(up.x).toBeCloseTo(0)
    }
  })
})
