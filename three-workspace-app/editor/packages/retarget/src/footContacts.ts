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
  mask.forEach((yes, i) => { if (!yes) return; const last = ranges.at(-1); if (last && last[1] === i - 1) last[1] = i; else ranges.push([i, i]) })
  return ranges
}
