import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { findInvalidMotionOverlaps, motionBlendInOf, motionBlendPartner } from '@topview/3d-builder/evaluate'
import { blendLockText, blendOffsetText, getBlendStatus } from '@topview/3d-builder/skeleton'

/**
 * K4: vùng trộn clip (iClone) trong khoảng xuất Film. Film nướng đúng tư thế đã trộn (cùng đường lấy mẫu với App 2),
 * nên preflight chỉ cần liệt kê các vùng này cho người dùng và chặn chồng clip không hợp lệ.
 */
export interface FilmBlendZone {
  characterId: string
  nodeId: string
  name: string
  clipId: string
  partnerId: string
  /** Khung timeline: vùng trộn là [frameStart, frameEnd] (frameEnd tính cả khung cuối). */
  frameStart: number
  frameEnd: number
  frames: number
  curve: 'smooth' | 'linear'
  mirror: boolean
  phaseOffsetSeconds: number
}

type Range = { startFrame: number; endFrame: number }

export function listFilmBlendZones(project: UnifiedProject, characterIds: readonly string[], range?: Range): FilmBlendZone[] {
  const clips = project.scene.content.timeline.animation.motionClips
  const zones: FilmBlendZone[] = []
  for (const characterId of characterIds) {
    const character = project.characters[characterId]
    if (!character) continue
    const nodeClips = clips.filter((clip) => clip.target.nodeId === character.nodeId)
    for (const clip of nodeClips) {
      const blend = motionBlendInOf(clip)
      const partner = blend ? motionBlendPartner(nodeClips, clip) : null
      if (!blend || !partner) continue
      const frameStart = clip.frameStart, frameEnd = clip.frameStart + blend.frames - 1
      if (range && (frameEnd < range.startFrame || frameStart > range.endFrame)) continue
      zones.push({ characterId, nodeId: character.nodeId, name: character.name, clipId: clip.id, partnerId: partner.id, frameStart, frameEnd,
        frames: blend.frames, curve: blend.curve, mirror: blend.mirror === true, phaseOffsetSeconds: blend.phaseOffsetSeconds ?? 0 })
    }
  }
  return zones.sort((a, b) => a.frameStart - b.frameStart || a.clipId.localeCompare(b.clipId))
}

/** "Gỗ Xưa: trộn 44–58 (15 khung), khóa chân, đảo chân" (+ chi tiết khóa chân khi đã lấy mẫu). */
export function blendZoneText(zone: FilmBlendZone, fps: number, detail = false): string {
  const parts = [`trộn ${zone.frameStart}–${zone.frameEnd} (${zone.frames} khung)`, 'khóa chân']
  if (zone.mirror) parts.push('đảo chân')
  if (zone.phaseOffsetSeconds) parts.push(`khớp nhịp ${zone.phaseOffsetSeconds.toFixed(2).replace('.', ',')} s`)
  if (detail) {
    const status = getBlendStatus(zone.clipId)
    const lock = blendLockText(status, fps), offset = blendOffsetText(status)
    if (lock) parts.push(lock.charAt(0).toLowerCase() + lock.slice(1))
    if (offset) parts.push(offset.charAt(0).toLowerCase() + offset.slice(1))
  }
  return `${zone.name}: ${parts.join(', ')}`
}

export interface FilmBlendOverlapIssue { characterId: string; nodeId: string; name: string; earlierId: string; laterId: string; reason: 'no-blend' | 'triple'; frame: number }

/** Cặp clip chồng nhau không phải vùng trộn hợp lệ (không có blendIn, hoặc 3 clip) chạm khoảng xuất. */
export function invalidFilmMotionOverlaps(project: UnifiedProject, characterIds: readonly string[], range?: Range): FilmBlendOverlapIssue[] {
  const clips = project.scene.content.timeline.animation.motionClips
  const byId = new Map(clips.map((clip) => [clip.id, clip]))
  const out: FilmBlendOverlapIssue[] = []
  for (const characterId of characterIds) {
    const character = project.characters[characterId]
    if (!character) continue
    const nodeClips = clips.filter((clip) => clip.target.nodeId === character.nodeId)
    for (const item of findInvalidMotionOverlaps(nodeClips)) {
      const later = byId.get(item.laterId)!, earlier = byId.get(item.earlierId)!
      const start = later.frameStart, end = Math.min(earlier.frameEnd, later.frameEnd)
      if (range && (end < range.startFrame || start > range.endFrame)) continue
      out.push({ characterId, nodeId: character.nodeId, name: character.name, earlierId: item.earlierId, laterId: item.laterId, reason: item.reason, frame: Math.max(start, range?.startFrame ?? start) })
    }
  }
  return out
}
