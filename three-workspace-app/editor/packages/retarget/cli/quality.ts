/** Foot contact / root quality metrics on the written GLB (measure + warn only; motion is never changed). */
export const CONTACT_HEIGHT_METERS = 0.03
export const CONTACT_MAX_VERTICAL_SPEED = 0.3
const HIPS_BELOW_RATIO = 0.25, HIPS_ABOVE_RATIO = 2, PENETRATION_METERS = 0.05, SLIDE_METERS = 0.15, SLIDE_MIN_CONTACT_FRAMES = 10

export interface QualityWarning { code: string; message: string; suggestion?: string }
type Side = 'left' | 'right'
const FOOT_JOINTS: Record<Side, readonly [string, string]> = { left: ['LeftToeBase', 'LeftFoot'], right: ['RightToeBase', 'RightFoot'] }
const SIDES: readonly Side[] = ['left', 'right']
interface FootSample { y: number; joint: string; time: number; xz: Record<string, readonly [number, number]> }

/**
 * Streams the 30 FPS world-space joint positions (meters, Y up) of one Action. Per leg the "lowest point" is the lower of
 * ToeBase/Foot; contact = within 3 cm of the Action's floor estimate with |vy| <= 0.3 m/s. Slide sums the XZ travel of that
 * point between consecutive contact frames, using the same joint in both frames so a heel→toe hand-over is not slide.
 */
export class QualityMeter {
  private readonly feet: Record<Side, FootSample[]> = { left: [], right: [] }
  private minHips = Infinity; private maxHips = -Infinity; private minY = Infinity

  push(pose: ReadonlyMap<string, readonly number[]>, time: number) {
    for (const p of pose.values()) this.minY = Math.min(this.minY, p[1]!)
    const hips = pose.get('Hips'); if (hips) { this.minHips = Math.min(this.minHips, hips[1]!); this.maxHips = Math.max(this.maxHips, hips[1]!) }
    for (const side of SIDES) {
      let best: FootSample | undefined
      const xz: Record<string, readonly [number, number]> = {}
      for (const joint of FOOT_JOINTS[side]) {
        const p = pose.get(joint); if (!p) continue
        xz[joint] = [p[0]!, p[2]!]
        if (!best || p[1]! < best.y) best = { y: p[1]!, joint, time, xz }
      }
      if (best) this.feet[side].push(best)
    }
  }

  finish(hipsRestHeight: number, suggestedRootScale: number | null) {
    const lows = SIDES.flatMap((side) => this.feet[side].map((sample) => sample.y))
    const groundY = lows.length ? Math.min(...lows) : 0
    const contactFrames = { left: 0, right: 0 }, footSlideMeters = { left: 0, right: 0 }
    let footSlideMaxSpeed = 0
    for (const side of SIDES) {
      const samples = this.feet[side]
      const contact = samples.map((sample, index) => {
        const a = samples[Math.max(0, index - 1)]!, b = samples[Math.min(samples.length - 1, index + 1)]!
        const vy = b.time > a.time ? (b.y - a.y) / (b.time - a.time) : 0
        return sample.y - groundY <= CONTACT_HEIGHT_METERS && Math.abs(vy) <= CONTACT_MAX_VERTICAL_SPEED
      })
      contactFrames[side] = contact.filter(Boolean).length
      for (let index = 1; index < samples.length; index++) {
        if (!contact[index] || !contact[index - 1]) continue
        const prev = samples[index - 1]!, cur = samples[index]!, was = prev.xz[cur.joint], now = cur.xz[cur.joint]
        if (!was || !now) continue
        const distance = Math.hypot(now[0] - was[0], now[1] - was[1])
        footSlideMeters[side] += distance; footSlideMaxSpeed = Math.max(footSlideMaxSpeed, distance / (cur.time - prev.time))
      }
    }
    const penetrationMeters = Number.isFinite(this.minY) ? Math.max(0, -this.minY) : 0
    const warnings: QualityWarning[] = []
    const rootScale = suggestedRootScale ? `--root-scale ${suggestedRootScale.toFixed(3)}` : '--root-scale <targetHipsHeight / sourceHipsHeight>'
    if (this.minHips < HIPS_BELOW_RATIO * hipsRestHeight) warnings.push({ code: 'HIPS_BELOW_GROUND',
      message: `Hips drop to ${this.minHips.toFixed(2)} m (< ${(HIPS_BELOW_RATIO * hipsRestHeight).toFixed(2)} m, 25% of rest height ${hipsRestHeight.toFixed(2)} m)`,
      suggestion: `Root travel is copied in meters; try ${rootScale}` })
    if (this.maxHips > HIPS_ABOVE_RATIO * hipsRestHeight) warnings.push({ code: 'HIPS_TOO_HIGH',
      message: `Hips rise to ${this.maxHips.toFixed(2)} m (> ${(HIPS_ABOVE_RATIO * hipsRestHeight).toFixed(2)} m, 2x rest height ${hipsRestHeight.toFixed(2)} m)`,
      suggestion: `Root travel is copied in meters; try ${rootScale}` })
    if (penetrationMeters > PENETRATION_METERS) warnings.push({ code: 'FEET_PENETRATE', message: `Joints go ${penetrationMeters.toFixed(2)} m below y=0 (> ${PENETRATION_METERS} m)`,
      suggestion: `Check the root scale (${rootScale}) or the source ground level` })
    const slide = Math.max(footSlideMeters.left, footSlideMeters.right)
    if (slide > SLIDE_METERS && Math.max(contactFrames.left, contactFrames.right) >= SLIDE_MIN_CONTACT_FRAMES) warnings.push({ code: 'FOOT_SLIDE',
      message: `Planted foot slides ${slide.toFixed(2)} m over ${Math.max(contactFrames.left, contactFrames.right)} contact frames (max ${footSlideMaxSpeed.toFixed(2)} m/s)`,
      suggestion: `Root travel does not match the legs; try ${rootScale} or --root in-place (foot lock/IK is not applied)` })
    return { groundY, contactFrames, footSlideMeters, footSlideMaxSpeed, penetrationMeters, warnings }
  }
}

/** Groups per-Action warnings by code: affected Action count + up to 3 example names. */
export function summarizeQuality(perAction: ReadonlyArray<{ name: string; quality?: { warnings: QualityWarning[] } }>) {
  const groups = new Map<string, { code: string; message: string; suggestion?: string; actions: number; examples: string[] }>()
  for (const item of perAction) for (const warning of item.quality?.warnings ?? []) {
    const group = groups.get(warning.code) ?? { code: warning.code, message: warning.message, ...(warning.suggestion ? { suggestion: warning.suggestion } : {}), actions: 0, examples: [] }
    group.actions++; if (group.examples.length < 3) group.examples.push(item.name)
    groups.set(warning.code, group)
  }
  return { warnings: [...groups.values()] }
}
