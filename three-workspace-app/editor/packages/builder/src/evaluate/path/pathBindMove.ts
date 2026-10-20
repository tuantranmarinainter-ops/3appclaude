import type { DirectorDocument, Vec3 } from '../../contract/types'

const MOVE_EPS = 1e-4

/** 当前帧被用户轨迹约束的对象。派生走位只是关键帧的另一种写法，不算绑定。 */
export function userPathBindingAtFrame(
  doc: DirectorDocument | null | undefined,
  nodeId: string,
  frame: number,
): boolean {
  if (!doc) return false
  const node = doc.content.nodes.find((item) => item.id === nodeId)
  if (!node || (node.type !== 'character' && node.type !== 'prop' && node.type !== 'camera' && node.type !== 'primitive')) {
    return false
  }
  return doc.content.timeline.animation.pathMotionClips.some((clip) => {
    if (clip.lockedReason === 'derived-from-keyframes') return false
    if (clip.target.nodeId !== nodeId) return false
    return frame >= clip.frameStart && frame <= clip.frameEnd
  })
}

export function positionMoved(
  start: Vec3 | readonly number[] | null | undefined,
  end: Vec3 | readonly number[] | null | undefined,
): boolean {
  const a = readVec(start)
  const b = readVec(end)
  if (!a || !b) return false
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return dx * dx + dy * dy + dz * dz > MOVE_EPS * MOVE_EPS
}

function readVec(value: Vec3 | readonly number[] | null | undefined): [number, number, number] | null {
  if (!value) return null
  if ('x' in value) return [value.x, value.y, value.z]
  if (value.length < 3) return null
  return [value[0], value[1], value[2]]
}
