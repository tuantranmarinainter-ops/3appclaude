// 机位平移时，把该机位上的运镜整段跟着挪：曲线和程序化 source 都加同一个位移，
// 片段之间的相对运动（升降、摇移、环绕半径）保持不变。只改位置和看点，不改 fov / 预设参数。
// 机位旋转时，绕当前机位把同一批点转过去，使轨迹相对相机的朝向保持不变。滚转不改变视线，不转轨迹。
import type { BakedCurve, CameraMotionClip, DirectorDocument, DraftNode, Vec3 } from '../../contract/types'
import { cameraPositionDragMoved } from './cameraMotionExclusive'
import { evaluateCameraPose } from './CameraRig'

const AXIS = ['x', 'y', 'z'] as const

function addVec(v: Vec3, delta: Vec3): Vec3 {
  return { x: v.x + delta.x, y: v.y + delta.y, z: v.z + delta.z }
}

function isVec3(value: unknown): value is Vec3 {
  if (!value || typeof value !== 'object') return false
  const v = value as Vec3
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
}

function shiftPath(path: Record<string, unknown>, delta: Vec3): Record<string, unknown> {
  const points = path.points
  if (!Array.isArray(points)) return path
  return {
    ...path,
    points: points.map((point) => (isVec3(point) ? addVec(point, delta) : point)),
  }
}

function translateSource(source: unknown, delta: Vec3): unknown {
  if (!source || typeof source !== 'object') return source
  const src = source as Record<string, unknown>
  const next: Record<string, unknown> = { ...src }
  for (const key of ['startPosition', 'pivot', 'startLookAt', 'lookAtTarget']) {
    const value = next[key]
    if (isVec3(value)) next[key] = addVec(value, delta)
  }
  if (next.positionPath && typeof next.positionPath === 'object') {
    next.positionPath = shiftPath(next.positionPath as Record<string, unknown>, delta)
  }
  if (next.lookAt && typeof next.lookAt === 'object') {
    const look = next.lookAt as Record<string, unknown>
    if (look.path && typeof look.path === 'object') {
      next.lookAt = { ...look, path: shiftPath(look.path as Record<string, unknown>, delta) }
    }
  }
  if (next.targetFallback && typeof next.targetFallback === 'object') {
    const fallback = next.targetFallback as Record<string, unknown>
    if (isVec3(fallback.position)) {
      next.targetFallback = { ...fallback, position: addVec(fallback.position, delta) }
    }
  }
  const target = next.target
  if (target && typeof target === 'object') {
    const point = target as Record<string, unknown>
    if (point.type === 'point' && isVec3(point.point)) {
      next.target = { ...point, point: addVec(point.point, delta) }
    }
  }
  return next
}

function translateClip(clip: CameraMotionClip, delta: Vec3): CameraMotionClip {
  const curves = clip.motion.curves.map((curve) => {
    if (curve.group !== 'position' && curve.group !== 'lookAt') return curve
    const axis = AXIS[curve.arrayIndex]
    if (!axis) return curve
    const offset = delta[axis]
    return {
      ...curve,
      keyframes: curve.keyframes.map((key) => ({ ...key, value: key.value + offset })),
    }
  })
  return {
    ...clip,
    motion: {
      ...clip.motion,
      curves,
      source: translateSource(clip.motion.source, delta),
    },
  }
}

/** 该机位全部运镜片段的位置 / 看点加上 delta。没有对应片段时不动数组。 */
export function translateCameraMotionClips(
  doc: DirectorDocument,
  cameraId: string,
  delta: Vec3,
): void {
  const anim = doc.content.timeline.animation
  if (!anim.cameraMotionClips.some((clip) => clip.target.nodeId === cameraId)) return
  anim.cameraMotionClips = anim.cameraMotionClips.map((clip) =>
    clip.target.nodeId === cameraId ? translateClip(clip, delta) : clip,
  )
}

export interface RebasedCameraPose {
  position: Vec3
  lookAt: Vec3
}

/**
 * 把机位上的运镜预设锚定到 `worldPos`（当前帧落在这里），运动方式不变。
 * 静态机位一起平移，片段外不会跳回旧位置。位移可以忽略时返回 null，不改文档。
 */
export function rebaseCameraMotionsToPosition(
  doc: DirectorDocument,
  camera: DraftNode,
  worldPos: Vec3,
  frame: number,
): RebasedCameraPose | null {
  if (!camera.camera) return null
  const clips = doc.content.timeline.animation.cameraMotionClips
  if (!clips.some((clip) => clip.target.nodeId === camera.id)) return null
  const before = evaluateCameraPose(camera, clips, frame, doc.content.timeline.fps)
  const delta = {
    x: worldPos.x - before.position[0],
    y: worldPos.y - before.position[1],
    z: worldPos.z - before.position[2],
  }
  if (!cameraPositionDragMoved(before.position, [worldPos.x, worldPos.y, worldPos.z])) return null
  translateCameraMotionClips(doc, camera.id, delta)
  camera.transform.position = addVec(camera.transform.position, delta)
  if (!camera.camera.lookAtTarget?.nodeId) {
    camera.camera.lookAt = addVec(camera.camera.lookAt, delta)
  }
  const after = evaluateCameraPose(
    camera,
    doc.content.timeline.animation.cameraMotionClips,
    frame,
    doc.content.timeline.fps,
  )
  return {
    position: { x: after.position[0], y: after.position[1], z: after.position[2] },
    lookAt: { x: after.lookAt[0], y: after.lookAt[1], z: after.lookAt[2] },
  }
}

interface Quat {
  x: number
  y: number
  z: number
  w: number
}

function dotVec(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function lengthVec(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

function unitVec(v: Vec3): Vec3 | null {
  const len = lengthVec(v)
  if (len < 1e-8) return null
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

function normalizeQuat(q: Quat): Quat {
  const len = Math.hypot(q.x, q.y, q.z, q.w) || 1
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len }
}

/** 把单位向量 a 转到 b 的最短旋转。两者几乎同向时返回 null。 */
function quatFromUnitVectors(a: Vec3, b: Vec3): Quat | null {
  const dot = Math.max(-1, Math.min(1, dotVec(a, b)))
  if (dot > 1 - 1e-8) return null
  if (dot < -1 + 1e-8) {
    let axis = crossVec(a, { x: 1, y: 0, z: 0 })
    if (lengthVec(axis) < 1e-6) axis = crossVec(a, { x: 0, y: 1, z: 0 })
    const u = unitVec(axis)
    if (!u) return null
    return { x: u.x, y: u.y, z: u.z, w: 0 }
  }
  return normalizeQuat({ ...crossVec(a, b), w: 1 + dot })
}

function rotateVec(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  }
}

function rotatePoint(q: Quat, pivot: Vec3, point: Vec3): Vec3 {
  return addVec(pivot, rotateVec(q, {
    x: point.x - pivot.x,
    y: point.y - pivot.y,
    z: point.z - pivot.z,
  }))
}

function rotatePath(path: Record<string, unknown>, q: Quat, pivot: Vec3): Record<string, unknown> {
  const points = path.points
  if (!Array.isArray(points)) return path
  return {
    ...path,
    points: points.map((point) => (isVec3(point) ? rotatePoint(q, pivot, point) : point)),
  }
}

function rotateSource(source: unknown, q: Quat, pivot: Vec3): unknown {
  if (!source || typeof source !== 'object') return source
  const src = source as Record<string, unknown>
  const next: Record<string, unknown> = { ...src }
  for (const key of ['startPosition', 'pivot', 'startLookAt', 'lookAtTarget']) {
    const value = next[key]
    if (isVec3(value)) next[key] = rotatePoint(q, pivot, value)
  }
  if (isVec3(next.axis)) next.axis = rotateVec(q, next.axis)
  if (next.positionPath && typeof next.positionPath === 'object') {
    next.positionPath = rotatePath(next.positionPath as Record<string, unknown>, q, pivot)
  }
  if (next.lookAt && typeof next.lookAt === 'object') {
    const look = next.lookAt as Record<string, unknown>
    if (look.path && typeof look.path === 'object') {
      next.lookAt = { ...look, path: rotatePath(look.path as Record<string, unknown>, q, pivot) }
    }
  }
  if (next.targetFallback && typeof next.targetFallback === 'object') {
    const fallback = next.targetFallback as Record<string, unknown>
    if (isVec3(fallback.position)) {
      next.targetFallback = { ...fallback, position: rotatePoint(q, pivot, fallback.position) }
    }
  }
  const target = next.target
  if (target && typeof target === 'object') {
    const point = target as Record<string, unknown>
    if (point.type === 'point' && isVec3(point.point)) {
      next.target = { ...point, point: rotatePoint(q, pivot, point.point) }
    }
  }
  return next
}

function valueAt(curve: BakedCurve | undefined, time: number, fallback: number): number {
  const key = curve?.keyframes.find((item) => item.time === time)
  return key ? key.value : fallback
}

function rotateCurveGroup(
  curves: BakedCurve[],
  group: 'position' | 'lookAt',
  q: Quat,
  pivot: Vec3,
  fallback: Vec3,
): BakedCurve[] {
  const axes = [0, 1, 2].map((index) => curves.find((curve) => curve.group === group && curve.arrayIndex === index))
  const times = new Set<number>()
  for (const curve of axes) {
    if (!curve) continue
    for (const key of curve.keyframes) times.add(key.time)
  }
  if (times.size === 0) return curves
  const rotated = new Map<number, Vec3>()
  for (const time of times) {
    rotated.set(time, rotatePoint(q, pivot, {
      x: valueAt(axes[0], time, fallback.x),
      y: valueAt(axes[1], time, fallback.y),
      z: valueAt(axes[2], time, fallback.z),
    }))
  }
  return curves.map((curve) => {
    if (curve.group !== group) return curve
    const axis = AXIS[curve.arrayIndex]
    if (!axis) return curve
    return {
      ...curve,
      keyframes: curve.keyframes.map((key) => {
        const point = rotated.get(key.time)
        return point ? { ...key, value: point[axis] } : key
      }),
    }
  })
}

function rotateClip(clip: CameraMotionClip, q: Quat, pivot: Vec3, fallbackPosition: Vec3, fallbackLook: Vec3): CameraMotionClip {
  const positioned = rotateCurveGroup(clip.motion.curves, 'position', q, pivot, fallbackPosition)
  const curves = rotateCurveGroup(positioned, 'lookAt', q, pivot, fallbackLook)
  return {
    ...clip,
    motion: {
      ...clip.motion,
      curves,
      source: rotateSource(clip.motion.source, q, pivot),
    },
  }
}

/**
 * 绕 `pivot`（当前机位）把该机位的运镜转过去，使旧视线 `fromLook` 对齐新视线 `toLook`。
 * 控制点、曲线和环绕 source 一起转；yaw / 升降幅度 / fov / 预设不变。视线没变时返回 false。
 * 静态机位同步旋转，片段外不会留在旧方向上。
 */
export function rotateCameraMotionsByAim(
  doc: DirectorDocument,
  camera: DraftNode,
  pivot: Vec3,
  fromLook: Vec3,
  toLook: Vec3,
): boolean {
  if (!camera.camera) return false
  const fromDir = unitVec({ x: fromLook.x - pivot.x, y: fromLook.y - pivot.y, z: fromLook.z - pivot.z })
  const toDir = unitVec({ x: toLook.x - pivot.x, y: toLook.y - pivot.y, z: toLook.z - pivot.z })
  if (!fromDir || !toDir) return false
  const q = quatFromUnitVectors(fromDir, toDir)
  if (!q) return false
  const anim = doc.content.timeline.animation
  if (anim.cameraMotionClips.some((clip) => clip.target.nodeId === camera.id)) {
    const fallbackLook = camera.camera.lookAt
    anim.cameraMotionClips = anim.cameraMotionClips.map((clip) =>
      clip.target.nodeId === camera.id
        ? rotateClip(clip, q, pivot, camera.transform.position, fallbackLook)
        : clip,
    )
  }
  camera.transform.position = rotatePoint(q, pivot, camera.transform.position)
  if (!camera.camera.lookAtTarget?.nodeId) {
    camera.camera.lookAt = rotatePoint(q, pivot, camera.camera.lookAt)
  }
  return true
}
