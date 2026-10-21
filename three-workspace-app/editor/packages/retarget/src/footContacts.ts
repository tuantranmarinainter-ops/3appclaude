export const CONTACT_HEIGHT_METERS = 0.03
export const CONTACT_MAX_VERTICAL_SPEED = 0.3

/** Shared by the quality report and IK: the same sample indices define contact in both paths. */
export function contactMask(samples: readonly { y: number; time: number }[], groundY: number): boolean[] {
  return samples.map((sample, index) => {
    const a = samples[Math.max(0, index - 1)]!, b = samples[Math.min(samples.length - 1, index + 1)]!
    const vy = b.time > a.time ? (b.y - a.y) / (b.time - a.time) : 0
    return sample.y - groundY <= CONTACT_HEIGHT_METERS && Math.abs(vy) <= CONTACT_MAX_VERTICAL_SPEED
  })
}
export function contactRanges(mask: readonly boolean[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  mask.forEach((yes, i) => { if (!yes) return; const last = ranges[ranges.length - 1]; if (last && last[1] === i - 1) last[1] = i; else ranges.push([i, i]) })
  return ranges
}

export interface FootContactSample {
  y: number
  joint: string
  time: number
  xz: Record<string, readonly [number, number]>
}
/** Lowest ToeBase/Foot point; keep the current joint in both frames at heel/toe hand-over. */
export function measureFootContact(samples: readonly FootContactSample[], groundY: number) {
  const mask = contactMask(samples, groundY)
  let slideMeters = 0, maxSpeed = 0
  for (let i = 1; i < samples.length; i++) {
    if (!mask[i] || !mask[i - 1]) continue
    const current = samples[i]!, previous = samples[i - 1]!, a = previous.xz[current.joint], b = current.xz[current.joint]
    if (!a || !b) continue
    const distance = Math.hypot(b[0] - a[0], b[1] - a[1])
    slideMeters += distance
    maxSpeed = Math.max(maxSpeed, distance / (current.time - previous.time))
  }
  return { contactFrames: mask.filter(Boolean).length, contactRanges: contactRanges(mask), slideMeters, maxSpeed }
}
