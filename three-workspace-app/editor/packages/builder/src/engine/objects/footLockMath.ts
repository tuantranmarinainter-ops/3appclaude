import * as THREE from 'three'

/** Điểm gốc của nhân vật trên mặt phẳng sàn (không gian actor, Y hướng lên) và hướng yaw (rad) quanh trục Y. */
export interface RootPoint { x: number; z: number; yaw: number }

export interface RootAlignment {
  /** Góc xoay yaw (rad) áp lên clip sau. */
  yaw: number
  /** Dời sau khi xoay, theo X/Z của không gian actor. */
  tx: number
  tz: number
  /** Khoảng cách giữa điểm gốc đầu clip sau (chưa căn) và điểm gốc clip trước, đơn vị actor. */
  distance: number
  yawDegrees: number
}

/** yaw của vector nằm ngang (x, z): Ry(yaw) đưa +Z về (sin, cos). */
export function yawOf(x: number, z: number): number {
  return Math.atan2(x, z)
}

function wrapPi(angle: number): number {
  let a = angle % (2 * Math.PI)
  if (a > Math.PI) a -= 2 * Math.PI
  else if (a <= -Math.PI) a += 2 * Math.PI
  return a
}

/**
 * Căn cứng clip sau (B) theo clip trước (A): xoay yaw quanh gốc rồi dời sao cho điểm gốc của B
 * trùng điểm gốc của A và hướng B trùng hướng A tại khung bắt đầu trộn.
 */
export function alignRoot(a: RootPoint, b: RootPoint): RootAlignment {
  const yaw = wrapPi(a.yaw - b.yaw)
  const c = Math.cos(yaw), s = Math.sin(yaw)
  const rx = b.x * c + b.z * s
  const rz = -b.x * s + b.z * c
  return {
    yaw,
    tx: a.x - rx,
    tz: a.z - rz,
    distance: Math.hypot(a.x - b.x, a.z - b.z),
    yawDegrees: THREE.MathUtils.radToDeg(yaw),
  }
}

/** Ma trận cứng T = Dời(tx,0,tz) · Ry(yaw), áp lên điểm trong không gian actor. */
export function alignmentMatrix(alignment: Pick<RootAlignment, 'yaw' | 'tx' | 'tz'>): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeRotationY(alignment.yaw)
  m.setPosition(alignment.tx, 0, alignment.tz)
  return m
}

export function isIdentityAlignment(alignment: Pick<RootAlignment, 'yaw' | 'tx' | 'tz'>): boolean {
  return Math.abs(alignment.yaw) < 1e-12 && Math.abs(alignment.tx) < 1e-12 && Math.abs(alignment.tz) < 1e-12
}

export interface PlantOptions {
  /** Tốc độ ngang tối đa (đơn vị actor / giây) để coi là đứng yên. */
  maxSpeed: number
  /** Độ cao tối đa của điểm thấp nhất bàn chân so với sàn rest (đơn vị actor). */
  maxHeight: number
}

export function isFootPlanted(speed: number, height: number, options: PlantOptions): boolean {
  return speed <= options.maxSpeed && height <= options.maxHeight
}

/** Gom các cờ liên tiếp true thành khoảng [đầu, cuối] (chỉ số mẫu, đóng). */
export function plantedRuns(flags: readonly boolean[]): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let start = -1
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i]
    if (on && start < 0) start = i
    if (!on && start >= 0) { runs.push([start, i - 1]); start = -1 }
  }
  return runs
}

/** Độ mạnh khóa (0..1) tại khung `frame`: 1 trong [start,end], nhả smootherstep (6t^5-15t^4+10t^3, jerk nhỏ) trong `ease` khung kế tiếp, 0 ngoài đó. */
export function lockStrength(frame: number, start: number, end: number, ease: number): number {
  if (frame < start) return 0
  if (frame <= end) return 1
  if (!(ease > 0) || frame >= end + ease) return 0
  const t = (frame - end) / ease
  return 1 - t * t * t * (t * (t * 6 - 15) + 10)
}

/**
 * IK 2 xương: vị trí gối mới để cổ chân chạm `target`, giữ độ dài đùi/cẳng, giữ hướng gập hiện tại.
 * Mục tiêu ngoài tầm với bị kẹp (chân duỗi thẳng về phía mục tiêu).
 */
export function solveKnee(hip: THREE.Vector3, knee: THREE.Vector3, ankle: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 | null {
  const l1 = knee.distanceTo(hip)
  const l2 = ankle.distanceTo(knee)
  if (!(l1 > 1e-9) || !(l2 > 1e-9)) return null
  const toTarget = target.clone().sub(hip)
  const raw = toTarget.length()
  if (!(raw > 1e-9)) return null
  const dir = toTarget.divideScalar(raw)
  const d = Math.min(Math.max(raw, Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6)
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)
  const sinA = Math.sqrt(1 - cosA * cosA)
  const pole = knee.clone().sub(hip)
  pole.addScaledVector(dir, -pole.dot(dir))
  if (pole.lengthSq() < 1e-12) {
    // Chân đang thẳng: gập về phía trước (+Z actor) nếu có thể.
    pole.set(0, 0, 1).addScaledVector(dir, -dir.z)
    if (pole.lengthSq() < 1e-12) pole.set(1, 0, 0).addScaledVector(dir, -dir.x)
  }
  pole.normalize()
  return hip.clone().addScaledVector(dir, l1 * cosA).addScaledVector(pole, l1 * sinA)
}
