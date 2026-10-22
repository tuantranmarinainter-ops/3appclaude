import type { CameraSequenceSample } from '@topview/3d-builder/headless'

export interface FilmCameraKeyframe {
  tick: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
  verticalFovDegrees: number
}

export interface FilmCameraClip {
  id: string
  startTick: number
  durationTicks: number
  keyframes: FilmCameraKeyframe[]
}

export interface FilmCameraConversion {
  cameras: FilmCameraClip[]
  durationTicks: number
  aspect: number
}

const degrees = 180 / Math.PI
const floatMax = 3.4028234663852886e38

function finite(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= floatMax
}

function vector(value: number[], size: number): boolean {
  return Array.isArray(value) && value.length === size && Array.from(value).every(finite)
}

function tickAt(seconds: number): number {
  const ticks = seconds * 20
  const tick = Math.round(ticks)
  // Tolerate floating-point accumulation, never quantize an off-grid cut.
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(tick) || tick > 1_000_000 || Math.abs(ticks - tick) > 1e-8) {
    throw new RangeError('Camera times must lie on the integral 20 Hz tick grid')
  }
  return tick
}

function unwrap(angle: number, previous: number): number {
  return angle + 360 * Math.round((previous - angle) / 360)
}

function cameraAngles(quaternion: number[], previous?: FilmCameraKeyframe) {
  if (!vector(quaternion, 4)) throw new RangeError('Camera quaternion must have four finite components')
  const length = Math.hypot(...quaternion)
  if (Math.abs(length - 1) > 1e-6) throw new RangeError('Camera quaternion must be unit length')
  const [x, y, z, w] = quaternion.map((value) => value / length)
  // Three world forward (-Z) and up (+Y), independent of quaternion sign.
  const dx = -2 * (x * z + w * y), dy = 2 * (w * x - y * z), dz = 2 * (x * x + y * y) - 1
  const ux = 2 * (x * y - w * z), uy = 1 - 2 * (x * x + z * z), uz = 2 * (y * z + w * x)
  const horizontal = Math.hypot(dx, dz)
  let yaw = horizontal > 1e-12 ? Math.atan2(-dx, dz) * degrees : previous?.yaw ?? 0
  let pitch = -Math.atan2(dy, horizontal) * degrees
  const sy = Math.sin(yaw / degrees), cy = Math.cos(yaw / degrees)
  const sp = Math.sin(pitch / degrees), cp = Math.cos(pitch / degrees)
  // View = Rz(roll) Rx(pitch) Ry(mcYaw + 180); project up onto its unrolled basis.
  let roll = Math.atan2(-ux * cy - uz * sy, -ux * sy * sp + uy * cp + uz * cy * sp) * degrees
  // yaw above is Minecraft's (0 looks along +Z). BBS camera clips store yaw + 180: Position.apply sets
  // rotation.y = yaw and CameraController hands Minecraft yaw = rotation.y - 180 (verified in BBS FS 2.7).
  yaw += 180
  if (!previous) yaw = unwrap(yaw, 0)
  if (previous) {
    const primary = [unwrap(yaw, previous.yaw), unwrap(pitch, previous.pitch), unwrap(roll, previous.roll)]
    // The equivalent Euler branch avoids a 180-degree yaw/roll jump when crossing a pole.
    const alternate = [unwrap(yaw + 180, previous.yaw), unwrap(180 - pitch, previous.pitch), unwrap(roll + 180, previous.roll)]
    const distance = (angles: number[]) => (angles[0] - previous.yaw) ** 2 + (angles[1] - previous.pitch) ** 2 + (angles[2] - previous.roll) ** 2
    ;[yaw, pitch, roll] = distance(alternate) < distance(primary) ? alternate : primary
  }
  return { yaw, pitch, roll }
}

/** Convert complete 20 Hz shots to BBS FS 2.4 manifest clips; angles and vertical FOV are degrees. */
export function cameraSamplesToFilm(samples: Iterable<CameraSequenceSample>): FilmCameraConversion {
  const cameras: FilmCameraClip[] = []
  const ids = new Set<string>()
  let camera: FilmCameraClip | undefined
  let cameraNodeId = ''
  let ended = false
  let durationTicks = 0
  let aspect: number | undefined

  for (const sample of samples) {
    if (!sample || typeof sample.shotId !== 'string' || !sample.shotId.trim() || sample.shotId.length > 128 ||
        typeof sample.cameraNodeId !== 'string' || !sample.cameraNodeId.trim()) {
      throw new TypeError('Camera sample requires a valid shotId and cameraNodeId')
    }
    if (sample.side !== 'left' && sample.side !== 'right') throw new TypeError('Invalid camera sample side')
    if (!vector(sample.position, 3) || !vector(sample.lookAt, 3) || !finite(sample.sourceFrame) || sample.sourceFrame < 0 ||
        !finite(sample.near) || !finite(sample.far) || sample.near <= 0 || sample.far <= sample.near) {
      throw new RangeError('Camera sample requires finite position, lookAt, sourceFrame and valid near/far planes')
    }
    if (!finite(sample.verticalFov) || sample.verticalFov <= 0 || sample.verticalFov >= 180) {
      throw new RangeError('Camera vertical FOV must be in (0,180) degrees')
    }
    if (!finite(sample.aspect) || sample.aspect <= 0 || (aspect !== undefined && sample.aspect !== aspect)) {
      throw new RangeError('Camera aspect must be positive, finite and the same throughout the Film')
    }
    aspect = sample.aspect
    const tick = tickAt(sample.shotTimeSeconds)
    const sequenceTick = tickAt(sample.sequenceTimeSeconds)
    if (!camera || sample.shotId !== camera.id) {
      if (camera && !ended) throw new RangeError('Each camera shot requires a left endpoint before the next shot')
      if (ids.has(sample.shotId)) throw new RangeError('Camera shot IDs must be unique')
      if (cameras.length === 3) throw new RangeError('Film worker supports at most 3 camera shots')
      if (tick !== 0 || sample.side !== 'right' || sequenceTick !== durationTicks) {
        throw new RangeError('Camera shots must start at local tick zero and be contiguous from sequence tick zero')
      }
      camera = { id: sample.shotId, startTick: durationTicks, durationTicks: 0, keyframes: [] }
      cameras.push(camera)
      ids.add(sample.shotId)
      cameraNodeId = sample.cameraNodeId
      ended = false
    }
    if (ended) throw new RangeError('Camera shot has samples after its left endpoint')
    if (sample.cameraNodeId !== cameraNodeId) throw new RangeError('Camera node cannot change within a shot')
    if (camera.keyframes.length === 256) throw new RangeError('Film worker supports at most 256 samples per camera shot, including the endpoint')
    if (tick !== camera.keyframes.length || sequenceTick !== camera.startTick + tick) {
      throw new RangeError('Camera samples must be consecutive at 20 Hz with matching shot and sequence times')
    }
    const angles = cameraAngles(sample.quaternion, camera.keyframes[camera.keyframes.length - 1])
    camera.keyframes.push({ tick, x: sample.position[0], y: sample.position[1], z: sample.position[2], ...angles, verticalFovDegrees: sample.verticalFov })
    if (sample.side === 'left') {
      camera.durationTicks = tick
      durationTicks = sequenceTick
      ended = true
    }
  }
  if (!camera || aspect === undefined) throw new RangeError('Film requires at least one camera shot')
  if (!ended) throw new RangeError('Each camera shot requires a left endpoint')
  return { cameras, durationTicks, aspect }
}
