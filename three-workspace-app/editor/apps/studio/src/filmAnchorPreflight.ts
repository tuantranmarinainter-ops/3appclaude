import { readVfxCueExtension, evaluateAttachedVfxCue } from './vfxCues'
import { resolveFilmEffectsPolicy } from './filmEffectsPolicy'
import { Vector3 } from 'three'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import type { FilmSamplingArgs } from './unifiedFilmSampling'
import { filmSceneWorldMatrices } from './filmSceneWorld'
import { projectFilmAnchor } from './filmAnchorProject'
import { applyFilmWorldAnchor } from './filmWorldAnchor'

export interface FilmAnchorPlacement { min: number[]; max: number[]; nearestActorDistance?: number }
/** Sample exported object origins over the complete range; includes backdrop/camera motion. */
export function filmAnchorPlacement(project: UnifiedProject, args: FilmSamplingArgs) {
  const start = args.range?.startFrame ?? project.scene.content.timeline.frameStart
  const end = args.range?.endFrame ?? project.scene.content.timeline.frameEnd
  const fps = project.scene.content.timeline.fps
  const ticks = (end - start + 1) / fps * 20
  if (!Number.isFinite(ticks) || ticks < 1 || ticks > 255) return undefined
  const resolved = projectFilmAnchor(project, args.worldAnchor, start, args.characterIds, args.propIds)
  const characters = args.characterIds.map((id) => project.characters[id]?.nodeId).filter((id): id is string => !!id)
  const sequence = project.scene.content.editorial?.sequences.find((s) => s.id === args.sequenceId)
  const cameras = [...new Set(sequence?.clips.filter((c) => c.sourceFrameStart <= end && c.sourceFrameEnd >= start).map((c) => c.cameraNodeId) ?? [])]
  const nodeIds = [...new Set([...characters, ...(args.propIds ?? []), ...cameras])]
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  let nearest = Infinity, below = false, far = false
  const cues = resolveFilmEffectsPolicy(args.effectsPolicy).mode === 'omit' ? [] : readVfxCueExtension(project).cues
  for (let tick = 0; tick <= Math.ceil(ticks); tick++) {
    const frame = Math.min(end, start + tick * fps / 20)
    const matrices = filmSceneWorldMatrices(project, frame)
    for (const cue of cues.filter((cue) => cue.frameStart <= frame && cue.frameEnd >= frame)) {
      // Bone-attached cues require async CPU skeleton evidence; their node origin is an estimate.
      const pose = cue.attachNodeId ? evaluateAttachedVfxCue(cue, matrices(cue.attachNodeId).toArray()).position : cue.position
      const point = { ...pose }
      applyFilmWorldAnchor({ actors: [], cameras: [] }, resolved, [point])
      for (const [axis, n] of [point.x, point.y, point.z].entries()) { min[axis] = Math.min(min[axis]!, n); max[axis] = Math.max(max[axis]!, n) }
    }
    for (const id of nodeIds) {
      const position = new Vector3().setFromMatrixPosition(matrices(id))
      const point = { x: position.x, y: position.y, z: position.z }
      applyFilmWorldAnchor({ actors: [{ transformSamples: [point] }], cameras: [] }, resolved)
      const xyz = [point.x, point.y, point.z]
      for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis]!, xyz[axis]!); max[axis] = Math.max(max[axis]!, xyz[axis]!) }
      if (characters.includes(id) || args.propIds?.includes(id)) {
        const distance = Math.hypot(...xyz.map((n, axis) => n - resolved.destination[axis]!))
        if (characters.includes(id)) nearest = Math.min(nearest, distance)
        below ||= point.y < resolved.destination[1]! - 1
        far ||= distance > 64
      }
    }
  }
  if (!min.every(Number.isFinite)) return undefined
  return { placement: { min, max, ...(Number.isFinite(nearest) ? { nearestActorDistance: nearest } : {}) } as FilmAnchorPlacement, below, far }
}
