import type { UnifiedProject } from '@bbs/animation-workspace-shared'

export interface AssignActionItem {
  uuid: string
  name: string
  nameVi?: string
  category?: string
  favorite?: boolean
  ownerCharId?: string | null
  rig: string
  status?: string
  durationSeconds?: number
}

export interface AssignNodeOption {
  nodeId: string
  name: string
  characterId: string
  libraryCharacterId: string | null
}

/** Character nodes of the scene with their library link state, in scene order. */
export function assignNodeOptions(project: UnifiedProject): AssignNodeOption[] {
  const byNode = new Map(Object.values(project.characters).map((character) => [character.nodeId, character]))
  return project.scene.content.nodes
    .filter((node) => node.type === 'character')
    .flatMap((node) => {
      const character = byNode.get(node.id)
      if (!character) return []
      const libraryCharacterId = typeof node.metadata?.libraryCharacterId === 'string' ? node.metadata.libraryCharacterId : null
      return [{ nodeId: node.id, name: node.name, characterId: character.id, libraryCharacterId }]
    })
}

/** Favorites first (N1 ★), then by display name. */
export function sortAssignActions(actions: readonly AssignActionItem[]): AssignActionItem[] {
  return [...actions].sort((a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false) || (a.nameVi || a.name).localeCompare(b.nameVi || b.name, 'vi'))
}

/**
 * Start frame of the shot (editorial clip of the active sequence) that contains the
 * current frame — the "chặn đầu của shot" placement of N1. Falls back to the first
 * shot, then to the timeline start when the project has no editorial sequence yet.
 */
export function shotStartFrame(project: UnifiedProject, currentFrame: number): number {
  const editorial = project.scene.content.editorial
  const sequence = editorial?.sequences.find((item) => item.id === editorial.activeSequenceId) ?? editorial?.sequences[0]
  if (!sequence?.clips.length) return Math.max(0, project.scene.content.timeline.frameStart)
  const containing = sequence.clips.find((clip) => currentFrame >= clip.sourceFrameStart && currentFrame <= clip.sourceFrameEnd)
  return (containing ?? sequence.clips[0]!).sourceFrameStart
}

/** [start, end] frames (inclusive) of the shot that contains `currentFrame`, or null without an editorial sequence. */
export function shotRange(project: UnifiedProject, currentFrame: number): { start: number; end: number } | null {
  const editorial = project.scene.content.editorial
  const sequence = editorial?.sequences.find((item) => item.id === editorial.activeSequenceId) ?? editorial?.sequences[0]
  if (!sequence?.clips.length) return null
  const shot = sequence.clips.find((clip) => currentFrame >= clip.sourceFrameStart && currentFrame <= clip.sourceFrameEnd) ?? sequence.clips[0]!
  return { start: shot.sourceFrameStart, end: shot.sourceFrameEnd }
}

export interface FrameSpan { frameStart: number; frameEnd: number; target: { nodeId: string } }

/** Frames an Action occupies when placed (same rounding as the server). */
export function actionFrames(durationSeconds: number | undefined, fps: number): number {
  return Math.max(1, Math.round((durationSeconds ?? 0) * fps))
}

/** True when [start, start+length-1] touches a clip of the node (inclusive rule, as on the server). */
export function isRangeOccupied(clips: readonly FrameSpan[], nodeId: string, start: number, length: number, ignoreIndex = -1): boolean {
  const end = start + length - 1
  return clips.some((clip, index) => index !== ignoreIndex && clip.target.nodeId === nodeId && clip.frameStart <= end && clip.frameEnd >= start)
}

/**
 * Free start frame nearest to `from` where `length` frames fit between the node's clips.
 * With `range` the whole placement must stay inside it. Null when nothing fits.
 */
export function findFreeStart(clips: readonly FrameSpan[], nodeId: string, from: number, length: number, range?: { start: number; end: number } | null): number | null {
  const lo = Math.max(0, range?.start ?? 0)
  const own = clips.filter((clip) => clip.target.nodeId === nodeId)
  const candidates = new Set<number>([from, lo])
  for (const clip of own) { candidates.add(clip.frameEnd + 1); candidates.add(clip.frameStart - length) }
  let best: number | null = null
  for (const start of candidates) {
    if (!Number.isSafeInteger(start) || start < lo) continue
    if (range && start + length - 1 > range.end) continue
    if (isRangeOccupied(clips, nodeId, start, length)) continue
    if (best === null || Math.abs(start - from) < Math.abs(best - from) || Math.abs(start - from) === Math.abs(best - from) && start > best) best = start
  }
  return best
}

/** First frame after the node's last clip (0 without clips). */
export function frameAfterLastClip(clips: readonly FrameSpan[], nodeId: string): number {
  return Math.max(0, ...clips.filter((clip) => clip.target.nodeId === nodeId).map((clip) => clip.frameEnd + 1))
}

const ERROR_VI: Record<string, string> = {
  PROFILE_MISMATCH: 'Động tác này không khớp bộ xương của nhân vật. Hãy chọn động tác của chính nhân vật hoặc để thư viện chuyển đổi.',
  CONVERSION_REQUIRED: 'Động tác cần được chuyển đổi cho nhân vật này trước khi gán.',
  ASSET_MISSING: 'Không tìm thấy dữ liệu của động tác trong thư viện.',
  NOT_FOUND: 'Không tìm thấy nhân vật, động tác hoặc clip. Hãy mở lại cảnh rồi thử lại.',
  REVISION_CONFLICT: 'Cảnh vừa được sửa ở nơi khác. Hãy thử lại.',
  ROOT_MOTION_CONFLICT: 'Động tác này xung đột chuyển động gốc với clip đang có.',
}

/** Vietnamese message for a failed library request; server text is kept when it is already readable. */
export function describeAssignError(status: number, body: { error?: string; code?: string } | null, fallback: string): string {
  const message = body?.error?.trim()
  const vietnamese = message && /[ăâêôơưđáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]/i.test(message)
  if (message && vietnamese) return message
  const known = body?.code ? ERROR_VI[body.code] : undefined
  if (known) return message ? `${known} (${message})` : known
  return message ? `${fallback}: ${message}` : `${fallback} (mã ${status})`
}
