import type { MotionClip } from '../contract/types'
import { motionBlendInOf, motionBlendPartner } from './clips'

const halfOpenOverlap = (a: MotionClip, b: MotionClip) => a.frameStart < b.frameEnd && b.frameStart < a.frameEnd

/**
 * Mọi cặp clip chồng nhau (cùng nhân vật) phải là cặp trộn hợp lệ (clip sau có blendIn trỏ đúng clip trước,
 * vùng chồng nằm trong vùng trộn) và không có 3 clip chồng nhau cùng lúc.
 */
export function motionOverlapsValid(clips: readonly MotionClip[]): boolean {
  const byNode = new Map<string, MotionClip[]>()
  for (const clip of clips) {
    const list = byNode.get(clip.target.nodeId)
    if (list) list.push(clip)
    else byNode.set(clip.target.nodeId, [clip])
  }
  for (const list of byNode.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i]
        const y = list[j]
        if (!halfOpenOverlap(x, y)) continue
        const [a, b] = x.frameStart <= y.frameStart ? [x, y] : [y, x]
        if (a.frameStart === b.frameStart) return false
        const blend = motionBlendInOf(b)
        if (!blend || motionBlendPartner(list, b) !== a) return false
        if (a.frameEnd > b.frameStart + blend.frames - 1) return false
        for (let k = j + 1; k < list.length; k++) {
          if (halfOpenOverlap(list[k], x) && halfOpenOverlap(list[k], y)) return false
        }
      }
    }
  }
  return true
}

export interface InvalidMotionOverlap {
  nodeId: string
  /** Clip trước / sau (theo frameStart); với `triple`, hai clip đầu của bộ ba chồng nhau. */
  earlierId: string
  laterId: string
  reason: 'no-blend' | 'triple'
}

/**
 * K4: cùng quy tắc với `motionOverlapsValid` nhưng liệt kê các cặp sai (cho preflight xuất film):
 * `no-blend` = hai clip chồng nhau mà không có blendIn hợp lệ trỏ đúng clip trước (hoặc vùng chồng vượt vùng trộn);
 * `triple` = ba clip chồng nhau cùng lúc.
 */
export function findInvalidMotionOverlaps(clips: readonly MotionClip[]): InvalidMotionOverlap[] {
  const byNode = new Map<string, MotionClip[]>()
  for (const clip of clips) {
    const list = byNode.get(clip.target.nodeId)
    if (list) list.push(clip)
    else byNode.set(clip.target.nodeId, [clip])
  }
  const found: InvalidMotionOverlap[] = []
  for (const [nodeId, list] of byNode) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i]
        const y = list[j]
        if (!halfOpenOverlap(x, y)) continue
        const [a, b] = x.frameStart <= y.frameStart ? [x, y] : [y, x]
        const blend = a.frameStart === b.frameStart ? null : motionBlendInOf(b)
        if (!blend || motionBlendPartner(list, b) !== a || a.frameEnd > b.frameStart + blend.frames - 1) {
          found.push({ nodeId, earlierId: a.id, laterId: b.id, reason: 'no-blend' })
          continue
        }
        for (let k = j + 1; k < list.length; k++) {
          if (halfOpenOverlap(list[k], x) && halfOpenOverlap(list[k], y)) found.push({ nodeId, earlierId: a.id, laterId: b.id, reason: 'triple' })
        }
      }
    }
  }
  return found
}

