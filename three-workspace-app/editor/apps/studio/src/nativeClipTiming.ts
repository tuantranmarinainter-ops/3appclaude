import type { UnifiedProject } from '@bbs/animation-workspace-shared'

// The native derivative already contains the Lab's speed, reverse and loop.
export function applyBakedClipTiming(project: UnifiedProject, clipId: string, duration: number): void {
  const timeline = project.scene.content.timeline
  const clip = timeline.animation.motionClips.find(item => item.id === clipId)
  if (!clip || !Number.isFinite(duration) || duration <= 0) throw new Error('Clip hoặc thời lượng bản chỉnh không hợp lệ.')
  const frameEnd = clip.frameStart + Math.max(1, Math.round(duration * timeline.fps)) - 1
  if (frameEnd > timeline.frameEnd) throw new Error('Bản chỉnh vượt thời lượng cảnh; hãy tăng thời lượng cảnh trước khi lưu.')
  if (timeline.animation.motionClips.some(other => other.id !== clipId && other.target.nodeId === clip.target.nodeId && other.frameStart <= frameEnd && other.frameEnd >= clip.frameStart)) throw new Error('Bản chỉnh chồng lên clip khác của nhân vật.')
  clip.frameEnd = frameEnd
  clip.playback.speed = 1
  clip.playback.loop = false
  Object.assign(clip.motion, { time: 0, sourceLengthSeconds: duration, speed: 1, loop: false, reverse: false })
  Object.assign(project.bindings[clipId], { sourceStartSeconds: 0, sourceLengthSeconds: duration, reverse: false, fadeInSeconds: 0, fadeOutSeconds: 0 })
}
