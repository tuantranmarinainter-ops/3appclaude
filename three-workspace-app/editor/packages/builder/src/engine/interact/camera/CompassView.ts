import * as THREE from 'three'
import { axisViewPose, type EditorViewDirection } from './axisView'

/** Only explicit compass selection activates this editor-only projection. */
export class CompassView {
  readonly camera = new THREE.OrthographicCamera()
  direction: EditorViewDirection | null = null
  readonly center = new THREE.Vector3()
  private width = 1
  private height = 1

  fit(direction: EditorViewDirection, bounds: THREE.Box3, aspect: number, perspective: THREE.PerspectiveCamera): void {
    const box = bounds.isEmpty()
      ? new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1))
      : bounds
    box.getCenter(this.center)
    const pose = axisViewPose(direction, this.center, 1)
    const inverse = pose.quaternion.clone().invert()
    const local = new THREE.Box3()
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        local.expandByPoint(new THREE.Vector3(x, y, z).sub(this.center).applyQuaternion(inverse))
      }
    }
    const size = local.getSize(new THREE.Vector3())
    this.width = Math.max(size.x, 1) * 2
    this.height = Math.max(size.y, 1) * 2
    this.camera.zoom = 1
    this.camera.quaternion.copy(pose.quaternion)
    this.camera.layers.mask = perspective.layers.mask
    this.resize(aspect)
    const distance = Math.max(size.z / 2 + 1, (this.camera.top - this.camera.bottom) / (2 * Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2))))
    this.camera.position.set(0, 0, distance).applyQuaternion(pose.quaternion).add(this.center)
    this.camera.near = 0.01
    this.camera.far = distance + size.z / 2 + 10
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld(true)
    this.direction = direction
    perspective.position.copy(this.camera.position)
    perspective.quaternion.copy(this.camera.quaternion)
    perspective.updateMatrixWorld(true)
  }

  resize(aspect: number): void {
    const height = Math.max(this.height, this.width / Math.max(0.01, aspect))
    this.camera.left = -height * aspect / 2
    this.camera.right = height * aspect / 2
    this.camera.top = height / 2
    this.camera.bottom = -height / 2
    this.camera.updateProjectionMatrix()
  }

  exit(): void {
    this.direction = null
  }
}
