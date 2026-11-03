import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { defaultMergedClipInfo } from './shotChain'

/**
 * App 3 "1 khung · Cả cảnh" (S4, phía host App 2): hàm thuần, không React, không fetch.
 */

/** Tên + mô tả mặc định của clip gộp cho một nhân vật: các clip của node nhân vật chạm khoảng shot, theo thứ tự thời gian. */
export function sceneMergeDefaults(project: UnifiedProject, characterId: string, frameRange: readonly [number, number]): { name: string; description: string } {
  const nodeId = project.characters[characterId]?.nodeId
  const [a, b] = frameRange
  const clips = project.scene.content.timeline.animation.motionClips
    .filter((clip) => clip.target.nodeId === nodeId && clip.frameStart <= b && clip.frameEnd >= a)
    .sort((x, y) => x.frameStart - y.frameStart || x.frameEnd - y.frameEnd)
  return defaultMergedClipInfo(clips as never)
}

/** characterId của các nhân vật đã sửa trong result.json (duy nhất, giữ thứ tự xuất hiện). */
export function editedCharacterIds(resultJson: unknown): string[] {
  const edits = (resultJson as { edits?: unknown } | null | undefined)?.edits
  if (!Array.isArray(edits)) return []
  const ids: string[] = []
  for (const edit of edits) {
    const id = (edit as { characterId?: unknown } | null)?.characterId
    if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** Thông báo khi server nới khoảng shot; null nếu không đổi. */
export function widenedStatus(requested: readonly [number, number], actual: readonly [number, number]): string | null {
  if (requested[0] === actual[0] && requested[1] === actual[1]) return null
  return `Đã nới khoảng ${requested[0]}–${requested[1]} → ${actual[0]}–${actual[1]} để phủ trọn clip.`
}
