import { CAMERA_FOV_MAX, CAMERA_FOV_MIN } from '../../data/cameraLibrary'

/** 全画幅竖边。草稿里的垂直视角按这个高度换成焦距（毫米）。 */
export const SENSOR_HEIGHT_MM = 24

function focalFromFov(fovDeg: number): number {
  const half = (fovDeg * Math.PI) / 360
  return (SENSOR_HEIGHT_MM / 2) / Math.tan(half)
}

/** 对应垂直视角 120°–12°，数值越小画面越广。 */
export const FOCAL_LENGTH_MIN = Math.floor(focalFromFov(CAMERA_FOV_MAX) * 10) / 10
export const FOCAL_LENGTH_MAX = Math.ceil(focalFromFov(CAMERA_FOV_MIN) * 10) / 10

export function fovToFocalLength(fovDeg: number): number {
  if (!Number.isFinite(fovDeg) || fovDeg <= 0) return FOCAL_LENGTH_MAX
  return focalFromFov(fovDeg)
}

export function focalLengthToFov(focalMm: number): number {
  const mm = Number.isFinite(focalMm) && focalMm > 0 ? focalMm : FOCAL_LENGTH_MIN
  const half = Math.atan((SENSOR_HEIGHT_MM / 2) / mm)
  const fov = (half * 360) / Math.PI
  return Math.min(CAMERA_FOV_MAX, Math.max(CAMERA_FOV_MIN, fov))
}
