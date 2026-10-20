import type * as THREE from 'three'
import type { Vec3 } from '../../contract/types'
import type { TransformValue } from '../../evaluate/FrameSnapshot'
import { manualCameraLookAt, sameCameraAim } from '../../evaluate/camera/cameraAim'

/** Shared by the viewport and CPU camera sampling, including authored roll. */
export function applyEvaluatedCamera(camera: THREE.PerspectiveCamera, lookAt: THREE.Vector3, xf: TransformValue, authoredRotation?: Vec3): void {
  const toRadians = Math.PI / 180
  camera.position.set(xf.position.x, xf.position.y, xf.position.z)
  if (xf.lookAt) lookAt.set(xf.lookAt.x, xf.lookAt.y, xf.lookAt.z)
  if (xf.useEuler) camera.rotation.set(toRadians * xf.rotation.x, toRadians * xf.rotation.y, toRadians * xf.rotation.z)
  else {
    camera.lookAt(lookAt)
    if (authoredRotation && xf.lookAt && sameCameraAim(xf.position, xf.lookAt, manualCameraLookAt(xf.position, authoredRotation, 1))) {
      camera.rotation.set(toRadians * authoredRotation.x, toRadians * authoredRotation.y, toRadians * authoredRotation.z)
    }
  }
  const fov = xf.fov ?? camera.fov
  if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix() }
  camera.updateMatrixWorld()
}
