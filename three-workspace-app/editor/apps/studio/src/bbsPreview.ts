import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { FILM_MODEL_FACING_OFFSET } from './filmManifest'

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
