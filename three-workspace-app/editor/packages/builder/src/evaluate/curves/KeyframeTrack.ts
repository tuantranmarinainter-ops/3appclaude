// 通用关键帧轨道（扩展功能）：任意节点的 position/rotation/scale，相机额外 lookAt/fov。
// 作为 clip 求值之后的覆写层（可在 UI 开关）。linear / smooth(smoothstep) 插值，端点 constant 外推。

export type TrackProp = 'position' | 'rotation' | 'scale' | 'lookAt' | 'fov'
/** Keyframe segment easing. Legacy `smooth` equals ease-in-out (smoothstep). */
export type Interpolation = 'linear' | 'smooth' | 'ease-in-out' | 'ease-in' | 'ease-out'

export const KEYFRAME_EASINGS = ['ease-in-out', 'ease-in', 'ease-out', 'linear'] as const
export type KeyframeEasing = (typeof KEYFRAME_EASINGS)[number]

/** Map stored interpolation (incl. legacy smooth) to UI / write-back easing. */
export function toKeyframeEasing(interp: Interpolation | string | undefined): KeyframeEasing {
  if (interp === 'ease-in' || interp === 'ease-out' || interp === 'linear') return interp
  // smooth / ease-in-out / unknown -> ease-in-out
  return 'ease-in-out'
}

function applyInterpolation(interp: Interpolation | string | undefined, t: number): number {
  switch (interp) {
    case 'smooth':
      // legacy smoothstep: keep exact prior behavior for existing keys
      return t * t * (3 - 2 * t)
    case 'ease-in-out':
      // match CameraRig quadratic ease-in-out
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)
    case 'ease-in':
      return t * t
    case 'ease-out':
      return 1 - (1 - t) * (1 - t)
    case 'linear':
    default:
      return t
  }
}

export interface Keyframe {
  id: string
  frame: number
  value: number[] // [x,y,z] 或 [v]（fov）
  interpolation: Interpolation
}

export type UserKeys = Record<string, Partial<Record<TrackProp, Keyframe[]>>>

const _sortedCache = new WeakMap<Keyframe[], Keyframe[]>()

function sortedKeyframes(kfs: Keyframe[]): Keyframe[] {
  let sorted = _sortedCache.get(kfs)
  if (sorted) return sorted
  sorted = kfs.slice().sort((a, b) => a.frame - b.frame)
  _sortedCache.set(kfs, sorted)
  return sorted
}

/** Extrapolation past key range.
 *  - true: constant hold both ends (default; cameras)
 *  - false: only sample inside [first, last]; outside return false
 *  - 'hold-after': hold after last (Constant Hold); before first still return false
 */
export type KeyframeExtrapolate = boolean | 'hold-after'

export function sampleKeyframesInto(
  kfs: Keyframe[],
  frame: number,
  out: number[],
  extrapolate: KeyframeExtrapolate = true,
): boolean {
  if (kfs.length === 0) return false
  return sampleSortedInto(sortedKeyframes(kfs), frame, out, extrapolate)
}

/** 未变化轴向的判定阈值（度）。小于它视为「没动」，插值时钉死，避免欧拉分解的浮点噪声。 */
const EULER_AXIS_EPS_DEG = 1e-3

/** 把角度折到离 ref 最近的等价值（±360° 的整数倍）。 */
function wrapNearDeg(v: number, ref: number): number {
  return v - 360 * Math.round((v - ref) / 360)
}

/**
 * 把一个 XYZ 欧拉角（度）对齐到离 prev 最近的等价表示，保证「只转了一根轴」的意图不被
 * 欧拉分解的多解性扭曲。
 *
 * 同一个朝向有两组 XYZ 欧拉表示：(x, y, z) 与 (x+180, 180−y, z+180)。绕 Y 转超过 90° 时，
 * Three.js 从四元数 / 矩阵读回来的是后一组，例如纯 Y 150° 读成 (180, 30, 180)。
 * 若直接逐分量插值，(0,0,0) → (180,30,180) 的中间帧 X、Z 会从 0 摆到 180，看上去像
 * 「改 Y 联动了 X/Z」。这里在两组表示里挑与 prev 欧氏距离最小的那组，X/Z 再折到最近的
 * 360° 等价值（pitch / roll 不做整圈翻转）；Y 保持用户写入的圈数。
 * 与 prev 差异小于阈值的轴向直接钉成 prev 的值。
 */
export function alignEulerDeg(prev: readonly number[], cur: readonly number[]): number[] {
  const px = prev[0] ?? 0
  const py = prev[1] ?? 0
  const pz = prev[2] ?? 0
  const cx = cur[0] ?? 0
  const cy = cur[1] ?? 0
  const cz = cur[2] ?? 0
  const direct = [wrapNearDeg(cx, px), cy, wrapNearDeg(cz, pz)]
  const flipped = [wrapNearDeg(cx + 180, px), wrapNearDeg(180 - cy, py), wrapNearDeg(cz + 180, pz)]
  const cost = (v: number[]) => (v[0] - px) ** 2 + (v[1] - py) ** 2 + (v[2] - pz) ** 2
  const best = cost(flipped) < cost(direct) ? flipped : direct
  if (Math.abs(best[0] - px) < EULER_AXIS_EPS_DEG) best[0] = px
  if (Math.abs(best[1] - py) < EULER_AXIS_EPS_DEG) best[1] = py
  if (Math.abs(best[2] - pz) < EULER_AXIS_EPS_DEG) best[2] = pz
  return best
}

const _eulerCache = new WeakMap<Keyframe[], Keyframe[]>()

/** 按帧升序，依次把每个键对齐到前一个键，让整条旋转轨道在欧拉表示上连续。 */
function continuousEulerKeyframes(kfs: Keyframe[]): Keyframe[] {
  let out = _eulerCache.get(kfs)
  if (out) return out
  const sorted = sortedKeyframes(kfs)
  out = []
  for (let i = 0; i < sorted.length; i++) {
    const k = sorted[i]
    if (i === 0 || k.value.length < 3) {
      out.push(k)
      continue
    }
    const prev = out[i - 1]
    out.push({ ...k, value: alignEulerDeg(prev.value, k.value) })
  }
  _eulerCache.set(kfs, out)
  return out
}

/**
 * 旋转（欧拉角，度）关键帧采样：先把轨道连续化（见 alignEulerDeg），再逐分量插值。
 * 只改了一根轴时，其余两轴在整段过渡里严格保持关键帧的值。
 */
export function sampleEulerKeyframesInto(
  kfs: Keyframe[],
  frame: number,
  out: number[],
  extrapolate: KeyframeExtrapolate = true,
): boolean {
  if (kfs.length === 0) return false
  return sampleSortedInto(continuousEulerKeyframes(kfs), frame, out, extrapolate)
}

function sampleSortedInto(
  sorted: Keyframe[],
  frame: number,
  out: number[],
  extrapolate: KeyframeExtrapolate,
): boolean {
  const write = (src: number[]) => {
    const n = Math.max(src.length, out.length)
    for (let i = 0; i < n; i++) out[i] = src[i] ?? 0
  }
  if (frame <= sorted[0].frame) {
    // Before first: hold only when extrapolate===true; false/'hold-after' fall through.
    if (extrapolate !== true && frame < sorted[0].frame) return false
    write(sorted[0].value)
    return true
  }
  const last = sorted[sorted.length - 1]
  if (frame >= last.frame) {
    // 末键之后始终钉住最后一键，避免播完弹回打键前的静态值
    write(last.value)
    return true
  }
  let i = 0
  while (i < sorted.length - 2 && sorted[i + 1].frame < frame) i++
  const a = sorted[i]
  const b = sorted[i + 1]
  const span = b.frame - a.frame
  let t = span > 0 ? (frame - a.frame) / span : 0
  t = applyInterpolation(a.interpolation, t)
  const dims = Math.max(a.value.length, b.value.length, out.length)
  for (let j = 0; j < dims; j++) {
    const av = a.value[j] ?? 0
    out[j] = av + ((b.value[j] ?? av) - av) * t
  }
  return true
}

export function sampleKeyframes(kfs: Keyframe[], frame: number): number[] | null {
  if (kfs.length === 0) return null
  const dims = kfs[0]?.value.length ?? 0
  const out = new Array<number>(dims)
  return sampleKeyframesInto(kfs, frame, out) ? out : null
}

export function makeKeyframe(frame: number, value: number[]): Keyframe {
  return {
    id: `kf_${Math.random().toString(36).slice(2, 10)}`,
    frame: Math.round(frame),
    value: [...value],
    // 新建关键帧默认平滑缓动（与 Inspector 回退值、fcurves 新键 bezier 无手柄一致）
    interpolation: 'ease-in-out',
  }
}
