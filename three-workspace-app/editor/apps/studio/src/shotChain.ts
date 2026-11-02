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

/** Các chuỗi clip nối nhau bằng vùng trộn hợp lệ của một nhân vật, theo thứ tự thời gian. */
export function blendChains<T extends ShotChainClip>(nodeClips: readonly T[]): T[][] {
  const sorted = [...nodeClips].sort((a, b) => a.frameStart - b.frameStart || a.frameEnd - b.frameEnd)
  const chains: T[][] = []
  for (const clip of sorted) {
    const partner = motionBlendInOf(clip as never) ? motionBlendPartner(sorted as never, clip as never) as T | null : null
    const tail = chains.at(-1)
    if (partner && tail && tail.at(-1) === partner) tail.push(clip)
    else chains.push([clip])
  }
  return chains
}

/** Khoảng gợi ý cho người dùng: mỗi chuỗi (hoặc clip lẻ) là một khoảng hợp lệ. */
export function shotRangeSuggestions<T extends ShotChainClip>(nodeClips: readonly T[]): Array<[number, number]> {
  return blendChains(nodeClips).map((chain) => [chain[0]!.frameStart, Math.max(...chain.map((clip) => clip.frameEnd))] as [number, number])
}

/**
 * Quyết định cách phủ khoảng [start, end] của nhân vật `characterName`:
 *  - một clip phủ trọn -> single;
 *  - nhiều clip nối nhau bằng blendIn hợp lệ và phủ trọn -> chain (span = từ đầu clip đầu tới cuối clip cuối);
 *  - còn lại -> lỗi tiếng Việt nêu clip hiện có và khoảng gợi ý.
 */
export function planShotCoverage<T extends ShotChainClip>(allClips: readonly T[], nodeId: string, start: number, end: number, characterName: string): ShotCoverage<T> {
  const nodeClips = allClips.filter((clip) => clip.target.nodeId === nodeId)
  const suggestions = shotRangeSuggestions(nodeClips)
  const suggestText = suggestions.length ? ` Khoảng hợp lệ: ${suggestions.map(([a, b]) => `${a}–${b}`).join(', ')}.` : ''
  const fail = (reason: string): ShotCoverage<T> => ({ ok: false, suggestions, message: `Nhân vật ${characterName} cần đúng một MotionClip phủ hết frame ${start}–${end} (hoặc một chuỗi clip nối nhau bằng vùng trộn): ${reason}${suggestText}` })
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
  for (let i = 1; i < touching.length; i++) {
    const previous = touching[i - 1]!, clip = touching[i]!
    const partner = motionBlendInOf(clip as never) ? motionBlendPartner(nodeClips as never, clip as never) : null
    if ((partner as unknown) !== previous) {
      return fail(`khoảng này đi qua các clip chưa nối bằng vùng trộn: ${clipLabel(previous)} và ${clipLabel(clip)}. Kéo clip sau đè lên clip trước (hoặc chuột phải "Trộn với clip trước") rồi mở lại shot, hoặc chọn khoảng nằm trong một clip.`)
    }
  }
  const first = touching[0]!, last = touching.reduce((a, b) => (b.frameEnd > a.frameEnd ? b : a))
  if (first.frameStart > start || last.frameEnd < end) return fail(`khoảng này vượt ra ngoài chuỗi clip đã trộn ${first.frameStart}–${last.frameEnd}.`)
  return { ok: true, kind: 'chain', clips: touching, span: [first.frameStart, last.frameEnd] }
}

/** Tên và mô tả mặc định của hộp thoại "Lưu clip gộp". */
export function defaultMergedClipInfo(clips: ReadonlyArray<ShotChainClip & { playback: { blendIn?: { frames?: number; mirror?: boolean } } }>): { name: string; description: string } {
  const names = clips.map((clip) => clip.motion.name?.trim() || clip.id)
  const frames = clips.slice(1).map((clip) => clip.playback.blendIn?.frames ?? 0)
  const mirrored = clips.some((clip) => clip.playback.blendIn?.mirror === true)
  const parts = clips.map((clip, i) => `${names[i]} (khung ${clip.frameStart}–${clip.frameEnd})`).join(' + ')
  return {
    name: names.join(' + '),
    description: `Gộp từ ${parts}, trộn ${frames.join(' + ')} khung, khóa chân${mirrored ? ', đảo chân' : ''}`,
  }
}
