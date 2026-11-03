import { motionBlendInOf, motionBlendPartner, motionOverlapsValid } from '@topview/3d-builder/evaluate'

/**
 * K5: một shot của App 3 phủ được (a) một MotionClip hoặc (b) một chuỗi clip nối nhau bằng vùng trộn (blendIn hợp lệ).
 * Hàm thuần dùng chung cho server (shotExchange) và bảng điều khiển (client) để hai nơi báo cùng một lỗi.
 */
export interface ShotChainClip {
  id: string
  frameStart: number
  frameEnd: number
  target: { nodeId: string }
  playback: { blendIn?: unknown } & Record<string, unknown>
  motion: { name?: string; assetId?: string }
}

export type ShotCoverage<T extends ShotChainClip = ShotChainClip> =
  | { ok: true; kind: 'single'; clips: [T]; span: [number, number] }
  | { ok: true; kind: 'chain'; clips: T[]; span: [number, number] }
  | { ok: false; message: string; suggestions: Array<[number, number]> }

const clipLabel = (clip: ShotChainClip) => `${clip.motion.name?.trim() || clip.id} (${clip.frameStart}–${clip.frameEnd})`

/**
 * `clip` nối tiếp `previous` khi: (a) có vùng trộn hợp lệ trỏ về `previous`, hoặc (b) không trộn nhưng bắt đầu
 * ngay tại / ngay sau khung cuối của `previous` (liền nhau, không hở, không chồng).
 */
function continues(sorted: readonly ShotChainClip[], previous: ShotChainClip, clip: ShotChainClip, adjacent = true): boolean {
  if (motionBlendInOf(clip as never)) return (motionBlendPartner(sorted as never, clip as never) as unknown) === previous
  return adjacent && clip.frameStart >= previous.frameEnd && clip.frameStart <= previous.frameEnd + 1
}

/** Các chuỗi clip nối nhau (vùng trộn hoặc liền nhau) của một nhân vật, theo thứ tự thời gian. */
export function blendChains<T extends ShotChainClip>(nodeClips: readonly T[]): T[][] {
  const sorted = [...nodeClips].sort((a, b) => a.frameStart - b.frameStart || a.frameEnd - b.frameEnd)
  const chains: T[][] = []
  for (const clip of sorted) {
    const tail = chains.at(-1)
    if (tail && continues(sorted, tail.at(-1)!, clip)) tail.push(clip)
    else chains.push([clip])
  }
  return chains
}

/** Khoảng mặc định khi chọn nhân vật: từ đầu clip đầu tới cuối clip cuối của chuỗi dài nhất. */
export function characterShotSpan<T extends ShotChainClip>(nodeClips: readonly T[]): [number, number] | null {
  const spans = shotRangeSuggestions(nodeClips)
  if (!spans.length) return null
  return spans.reduce((best, span) => (span[1] - span[0] > best[1] - best[0] ? span : best))
}

/** Khoảng gợi ý cho người dùng: mỗi chuỗi (hoặc clip lẻ) là một khoảng hợp lệ. */
export function shotRangeSuggestions<T extends ShotChainClip>(nodeClips: readonly T[]): Array<[number, number]> {
  return blendChains(nodeClips).map((chain) => [chain[0]!.frameStart, Math.max(...chain.map((clip) => clip.frameEnd))] as [number, number])
}

/**
 * Quyết định cách phủ khoảng [start, end] của nhân vật `characterName`:
 *  - một clip phủ trọn -> single;
 *  - nhiều clip nối nhau (vùng trộn hoặc liền nhau) và phủ trọn -> chain (span = từ đầu clip đầu tới cuối clip cuối);
 *  - còn lại -> lỗi tiếng Việt nêu clip hiện có và khoảng gợi ý.
 */
/** `adjacent: false` = chỉ nối bằng vùng trộn (dùng cho nhân vật không được sửa trong shot, giữ như trước). */
export function planShotCoverage<T extends ShotChainClip>(allClips: readonly T[], nodeId: string, start: number, end: number, characterName: string, options: { adjacent?: boolean } = {}): ShotCoverage<T> {
  const nodeClips = allClips.filter((clip) => clip.target.nodeId === nodeId)
  const suggestions = shotRangeSuggestions(nodeClips)
  const suggestText = suggestions.length ? ` Khoảng hợp lệ: ${suggestions.map(([a, b]) => `${a}–${b}`).join(', ')}.` : ''
  const fail = (reason: string): ShotCoverage<T> => ({ ok: false, suggestions, message: `Nhân vật ${characterName} cần đúng một MotionClip phủ hết frame ${start}–${end} (hoặc một chuỗi clip nối nhau): ${reason}${suggestText}` })
  const overlapping = nodeClips.filter((clip) => clip.frameStart <= end && clip.frameEnd >= start)
  // Clip liền kề dùng chung khung biên (0–22 rồi 22–76): clip chỉ chạm đúng khung đầu/cuối của khoảng
  // không tính nếu một clip khác đã phủ khung đó và đi tiếp vào trong khoảng.
  const touching = overlapping.filter((clip) => !(
    (clip.frameEnd === start && start < end && overlapping.some((other) => other !== clip && other.frameStart <= start && other.frameEnd > start))
    || (clip.frameStart === end && start < end && overlapping.some((other) => other !== clip && other.frameEnd >= end && other.frameStart < end))
  )).sort((a, b) => a.frameStart - b.frameStart)
  const existing = nodeClips.length ? [...nodeClips].sort((a, b) => a.frameStart - b.frameStart).map(clipLabel).join(', ') : 'chưa có clip nào trên timeline'
  if (!touching.length) return fail(`không có clip nào trong khoảng này; clip hiện có: ${existing}.`)
  if (touching.length === 1) {
    const only = touching[0]!
    if (only.frameStart <= start && only.frameEnd >= end) return { ok: true, kind: 'single', clips: [only], span: [start, end] }
    return fail(`khoảng này vượt ra ngoài clip ${clipLabel(only)}; clip hiện có: ${existing}.`)
  }
  if (!motionOverlapsValid(nodeClips as never)) return fail(`các clip chồng nhau chưa hợp lệ (ba clip chồng nhau, hoặc clip chồng mà không có vùng trộn); clip hiện có: ${existing}.`)
  const sortedNode = [...nodeClips].sort((a, b) => a.frameStart - b.frameStart || a.frameEnd - b.frameEnd)
  for (let i = 1; i < touching.length; i++) {
    const previous = touching[i - 1]!, clip = touching[i]!
    if (!continues(sortedNode, previous, clip, options.adjacent ?? true)) {
      return fail(`khoảng này đi qua chỗ hở giữa ${clipLabel(previous)} và ${clipLabel(clip)}. Kéo clip sau sát hoặc đè lên clip trước rồi mở lại shot, hoặc chọn khoảng không có chỗ hở.`)
    }
  }
  const first = touching[0]!, last = touching.reduce((a, b) => (b.frameEnd > a.frameEnd ? b : a))
  if (first.frameStart > start || last.frameEnd < end) return fail(`khoảng này vượt ra ngoài chuỗi clip ${first.frameStart}–${last.frameEnd}.`)
  return { ok: true, kind: 'chain', clips: touching, span: [first.frameStart, last.frameEnd] }
}

/** Tên và mô tả mặc định của hộp thoại "Lưu clip gộp". */
export function defaultMergedClipInfo(clips: ReadonlyArray<ShotChainClip & { playback: { blendIn?: { frames?: number; mirror?: boolean } } }>): { name: string; description: string } {
  const names = clips.map((clip) => clip.motion.name?.trim() || clip.id)
  const frames = clips.slice(1).map((clip) => clip.playback.blendIn?.frames ?? 0).filter((n) => n > 0)
  const mirrored = clips.some((clip) => clip.playback.blendIn?.mirror === true)
  const parts = clips.map((clip, i) => `${names[i]} (khung ${clip.frameStart}–${clip.frameEnd})`).join(' + ')
  const join = frames.length ? `trộn ${frames.join(' + ')} khung, khóa chân${mirrored ? ', đảo chân' : ''}` : 'nối liền'
  return {
    name: names.join(' + '),
    description: `Gộp từ ${parts}, ${join}`,
  }
}
