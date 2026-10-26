import { randomUUID } from 'node:crypto'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { createFrameSnapshot, evaluateFrame } from '@topview/3d-builder/evaluate'
import { projectEvaluationScene } from './unifiedSkeletonEvaluation'
import { readVfxCueExtension } from './vfxCues'
import { readAudioCueExtension } from './audioCues'

export interface EpisodeMetadata { id: string; name: string; order: number; sourceProjectId: string; sourceShotId: string }
export function readEpisode(project: Pick<UnifiedProject, 'extensions'>): EpisodeMetadata | undefined {
  const value = project.extensions.episode as unknown as EpisodeMetadata | undefined
  return value && typeof value.id === 'string' && typeof value.name === 'string' && Number.isSafeInteger(value.order) && value.order > 0 ? value : undefined
}
export interface SplitShotPlan { project: UnifiedProject; shotId: string; sourceRange: { startFrame: number; endFrame: number }; warnings: string[] }

/** Pure slicing: never edits the source project or its asset bytes. */
export function planSplitShots(source: UnifiedProject, args: { sequenceId?: string; shotIds?: string[]; episodeName?: string }, ids: string[] = [], audioDurations: ReadonlyMap<string, number> = new Map()): SplitShotPlan[] {
  const editorial = source.scene.content.editorial
  const sequence = editorial?.sequences.find((item) => item.id === (args.sequenceId ?? editorial.activeSequenceId)) ?? (!args.sequenceId ? editorial?.sequences[0] : undefined)
  if (!sequence?.clips.length) throw new TypeError('Không tìm thấy danh sách shot trong dự án.')
  if (args.shotIds && (!args.shotIds.length || new Set(args.shotIds).size !== args.shotIds.length || args.shotIds.some((id) => !sequence.clips.some((shot) => shot.id === id)))) throw new TypeError('Danh sách shot không hợp lệ.')
  const episodeName = args.episodeName?.trim() || source.name
  // Editorial lists can be out of time order (Tập 15 keeps shot_01 last): episode order follows the timeline and the
  // shot number (name, set_NN/shotIndex matching) comes from the shot id, never from the list position.
  const shotTimeline = [...sequence.clips].sort((a, b) => a.sourceFrameStart - b.sourceFrameStart)
  const shotNumber = (shot: typeof sequence.clips[number]) => { const match = /(\d+)\s*$/.exec(shot.id); return match ? Number(match[1]) : shotTimeline.indexOf(shot) + 1 }
  const selected = shotTimeline.filter((shot) => !args.shotIds || args.shotIds.includes(shot.id))
  const outputIds = selected.map((_, index) => ids[index] ?? randomUUID())
  const episodeId = outputIds[0]!
  const animation = source.scene.content.timeline.animation
  const raw = (source.extensions.topview?.fcurves ?? (animation.fcurves.length ? { version: 1, encoding: 'compact-v1', fcurves: animation.fcurves } : null)) as { fcurves?: Array<{ t: string | string[]; k: unknown[][]; [key: string]: unknown }>; userKeys?: Record<string, Record<string, Array<{ frame: number; [key: string]: unknown }>>> } | null
  const overlaps = (clip: { frameStart: number; frameEnd: number }, start: number, end: number) => clip.frameStart <= end && clip.frameEnd >= start
  return selected.map((shot, selectedIndex) => {
    const start = shot.sourceFrameStart, end = shot.sourceFrameEnd, order = shotNumber(shot), episodeOrder = shotTimeline.indexOf(shot) + 1
    const warnings: string[] = [], keep = new Set<string>([shot.cameraNodeId])
    const assignedElsewhere = (node: UnifiedProject['scene']['content']['nodes'][number]) => {
      const metadata = node.metadata ?? {}
      const set = /(?:^|[^a-z])set[_ -]?(\d+)/i.exec(`${node.id} ${node.name ?? ''}`)
      return typeof metadata.shotId === 'string' && metadata.shotId !== shot.id || typeof metadata.shotIndex === 'number' && metadata.shotIndex !== order || !!set && Number(set[1]) !== order
    }
    for (const clip of [...animation.motionClips, ...animation.pathMotionClips, ...animation.cameraMotionClips]) if (overlaps(clip, start, end)) { const node = source.scene.content.nodes.find((node) => node.id === clip.target.nodeId); if (node && !assignedElsewhere(node) && node.visible !== false && (node.type !== 'camera' || node.id === shot.cameraNodeId)) keep.add(clip.target.nodeId) }
    for (const node of source.scene.content.nodes) {
      const metadata = node.metadata ?? {}
      const set = /(?:^|[^a-z])set[_ -]?(\d+)/i.exec(`${node.id} ${node.name ?? ''}`)
      const linked = metadata.shotId === shot.id || metadata.shotIndex === order || set && Number(set[1]) === order
      const hasMotion = animation.motionClips.some((clip) => clip.target.nodeId === node.id)
      if (!assignedElsewhere(node) && (linked || !set && node.type !== 'camera' && node.type !== 'path' && !hasMotion && node.visible !== false)) keep.add(node.id)
    }
    for (const curve of raw?.fcurves ?? []) {
      const id = Array.isArray(curve.t) ? curve.t[1]! : curve.t
      const node = source.scene.content.nodes.find((node) => node.id === id)
      if (node && assignedElsewhere(node) || node?.visible === false || node?.type === 'camera' && id !== shot.cameraNodeId) continue
      if (curve.k.some((key) => Number(key[0]) >= start && Number(key[0]) <= end)) keep.add(id)
    }
    for (const [id, tracks] of Object.entries(raw?.userKeys ?? {})) {
      const node = source.scene.content.nodes.find((node) => node.id === id)
      if (!node || assignedElsewhere(node) || node.visible === false || node.type === 'camera' && id !== shot.cameraNodeId) continue
      if (Object.values(tracks).some((keys) => keys.some((key) => key.frame <= end))) keep.add(id)
    }
    const vfx = readVfxCueExtension(source).cues.filter((cue) => overlaps(cue, start, end))
    for (const cue of vfx) if (cue.attachNodeId) keep.add(cue.attachNodeId)
    // Retain reference closure: hierarchy, camera subjects, paths and attachments.
    let changed = true
    while (changed) {
      const size = keep.size
      for (const node of source.scene.content.nodes.filter((node) => keep.has(node.id))) {
        for (const id of [node.parentId, node.camera?.subject?.nodeId, node.camera?.lookAtTarget?.nodeId]) if (id) keep.add(id)
      }
      for (const clip of animation.pathMotionClips) if (keep.has(clip.target.nodeId) && overlaps(clip, start, end)) keep.add(clip.pathNodeId)
      changed = size !== keep.size
    }
    const project = structuredClone(source)
    project.projectId = outputIds[selectedIndex]!; project.revision = 0
    project.name = `${episodeName} · Shot ${String(order).padStart(2, '0')}`.slice(0, 120)
    project.extensions.episode = { id: episodeId, name: episodeName, order: episodeOrder, sourceProjectId: source.projectId, sourceShotId: shot.id } satisfies EpisodeMetadata
    project.scene.content.nodes = project.scene.content.nodes.filter((node) => keep.has(node.id))
    for (const node of project.scene.content.nodes) if (node.children) node.children = node.children.filter((id) => keep.has(id))
    project.scene.content.activeShotCameraNodeId = shot.cameraNodeId
    project.scene.content.editorial = { version: 1, activeSequenceId: sequence.id, sequences: [{ ...structuredClone(sequence), clips: [{ ...structuredClone(shot), sourceFrameStart: 0, sourceFrameEnd: end - start }] }] }
    const timeline = project.scene.content.timeline
    timeline.frameStart = 0; timeline.frameEnd = end - start; timeline.usePreviewRange = false
    const nextAnimation = timeline.animation
    const keptClips = animation.motionClips.filter((clip) => keep.has(clip.target.nodeId) && overlaps(clip, start, end))
    nextAnimation.motionClips = []
    project.bindings = {}
    for (const original of keptClips) {
      if (original.frameStart < start || original.frameEnd > end) warnings.push(`Clip ${original.id} vắt qua ranh giới shot — đã cắt theo khoảng.`)
      const clip = structuredClone(original), first = Math.max(start, clip.frameStart), last = Math.min(end, clip.frameEnd)
      if (clip.playback.loop || clip.motion.rootMotion?.policy === 'trajectory') {
        // Loop phase and trajectory alignment are measured from the original start. Leading timing support
        // is intentionally outside the playable [0, end-start] timeline, just like bracketing curve keys.
        clip.frameStart -= start; clip.frameEnd = last - start
        nextAnimation.motionClips.push(clip)
        if (source.bindings[clip.id]) project.bindings[clip.id] = { ...structuredClone(source.bindings[clip.id]!), fadeOutSeconds: original.frameEnd > end ? 0 : source.bindings[clip.id]!.fadeOutSeconds }
        if (clip.frameStart < 0) warnings.push(`Clip ${clip.id}: giữ mốc thời gian nguồn trước khung 0 để bảo toàn vòng lặp/root motion.`)
        continue
      }
      const speed = clip.playback.speed, sourceStart = clip.motion.time, length = clip.motion.sourceLengthSeconds ?? clip.sourceDuration - sourceStart
      let cursor = first, part = 0
      while (cursor <= last + 1e-7) {
        if (!(speed > 0) || !(length > 0)) throw new TypeError('Clip có tốc độ hoặc thời lượng không hợp lệ.')
        const elapsed = (cursor - original.frameStart) / timeline.fps * speed
        const phase = clip.playback.loop ? elapsed % length : Math.min(elapsed, length)
        const remaining = Math.max(0, length - phase)
        const next = structuredClone(clip)
        next.id = part ? `${clip.id}-split-${part}` : clip.id
        const stop = clip.playback.loop && remaining > 1e-7 ? Math.min(last + 1, cursor + remaining / speed * timeline.fps) : last + 1
        next.frameStart = cursor - start; next.frameEnd = stop - start - 1
        next.playback.loop = false; next.motion.loop = false
        next.motion.time = clip.motion.reverse ? sourceStart : sourceStart + phase
        next.motion.sourceLengthSeconds = Math.max(1e-8, remaining)
        if (!remaining && clip.motion.reverse) { next.motion.time = sourceStart; next.motion.sourceLengthSeconds = 1e-8 }
        nextAnimation.motionClips.push(next)
        const binding = source.bindings[clip.id]
        if (binding) project.bindings[next.id] = { ...structuredClone(binding), clipId: next.id, sourceStartSeconds: next.motion.time, sourceLengthSeconds: next.motion.sourceLengthSeconds, fadeInSeconds: cursor === original.frameStart ? binding.fadeInSeconds : 0, fadeOutSeconds: stop - 1 === original.frameEnd ? binding.fadeOutSeconds : 0 }
        cursor = stop; part++
        if (part > 10000) throw new TypeError('Clip có quá nhiều vòng lặp để tách an toàn.')
      }
    }
    // Keep the two support keys around each cut; this preserves Bezier handles and held values exactly.
    const support = <T>(keys: T[], frame: (key: T) => number): T[] => {
      const sorted = [...keys].sort((a, b) => frame(a) - frame(b))
      const before = sorted.filter((key) => frame(key) < start).at(-1), after = sorted.find((key) => frame(key) > end)
      return [...(before ? [before] : []), ...sorted.filter((key) => frame(key) >= start && frame(key) <= end), ...(after ? [after] : [])]
    }
    const fcurves = (raw?.fcurves ?? []).filter((curve) => keep.has(Array.isArray(curve.t) ? curve.t[1]! : curve.t)).map((curve) => ({ ...structuredClone(curve), k: support(curve.k, (key) => Number(key[0])).map((key) => key.map((value, index) => index === 0 ? Number(value) - start : (index === 4 || index === 5) && value && typeof value === 'object' ? { ...value, x: Number((value as { x: number }).x) - start } : value)) }))
    const userKeys = Object.fromEntries(Object.entries(raw?.userKeys ?? {}).filter(([id]) => keep.has(id)).map(([id, tracks]) => [id, Object.fromEntries(Object.entries(tracks).map(([prop, keys]) => [prop, support(keys, (key) => key.frame).map((key) => ({ ...structuredClone(key), frame: key.frame - start }))]))]))
    // Procedural paths/cameras depend on their original span. Bake only those nodes at source FPS.
    const procedural = new Set([...animation.pathMotionClips, ...animation.cameraMotionClips].filter((clip) => keep.has(clip.target.nodeId) && overlaps(clip, start, end)).map((clip) => clip.target.nodeId))
    const evaluation = projectEvaluationScene(source), snapshot = createFrameSnapshot()
    for (const nodeId of procedural) {
      const tracks: Record<string, Array<{ frame: number; [key: string]: unknown }>> = {}
      for (let frame = start; frame <= end; frame++) {
        evaluateFrame(evaluation, frame, snapshot)
        const transform = snapshot.transforms.get(nodeId)
        if (!transform) continue
        for (const property of ['position', 'rotation', 'scale'] as const) (tracks[property] ??= []).push({ frame: frame - start, value: [transform[property].x, transform[property].y, transform[property].z], interpolation: 'linear' })
        if (transform.lookAt) (tracks.lookAt ??= []).push({ frame: frame - start, value: [transform.lookAt.x, transform.lookAt.y, transform.lookAt.z], interpolation: 'linear' })
        if (transform.fov !== undefined) (tracks.fov ??= []).push({ frame: frame - start, value: [transform.fov], interpolation: 'linear' })
      }
      userKeys[nodeId] = tracks
      const camera = project.scene.content.nodes.find((node) => node.id === nodeId)?.camera
      if (camera) { if (camera.subject) camera.subject.follow = false; delete camera.lookAtTarget }
      warnings.push(`Nút ${nodeId}: chuyển đường đi/chuyển động camera thành keyframe ở ${timeline.fps} fps.`)
    }
    nextAnimation.pathMotionClips = []; nextAnimation.cameraMotionClips = []; nextAnimation.motionTransitions = []
    nextAnimation.fcurves = []; delete nextAnimation.fcurvesRef
    project.extensions.topview = { ...project.extensions.topview, fcurves: { version: 1, encoding: 'compact-v1', fcurves, userKeys } }
    for (const node of project.scene.content.nodes) if (typeof node.metadata?.modelUrl === 'string') node.metadata.modelUrl = node.metadata.modelUrl.replace(`/api/unified/projects/${source.projectId}/`, `/api/unified/projects/${project.projectId}/`)
    for (const clip of nextAnimation.motionClips) clip.motion.url = clip.motion.url.replace(`/api/unified/projects/${source.projectId}/`, `/api/unified/projects/${project.projectId}/`)
    for (const cue of vfx) if (cue.frameStart < start) warnings.push(`Hiệu ứng ${cue.id} bắt đầu trước shot — được phát lại từ đầu; chưa bảo toàn tuổi hiệu ứng tại điểm cắt.`)
    project.extensions.vfxCues = { version: 1, cues: vfx.map((cue) => ({ ...cue, frameStart: Math.max(start, cue.frameStart) - start, frameEnd: Math.min(end, cue.frameEnd) - start })) }
    const audio = readAudioCueExtension(source).cues.filter((cue) => cue.frameStart <= end && Math.min((cue.frameEnd ?? Infinity) + 1, cue.frameStart + ((audioDurations.get(cue.assetId) ?? 0) - (cue.offsetSeconds ?? 0)) * timeline.fps) > start)
    project.extensions.audioCues = { version: 1, cues: audio.map((cue) => ({ ...cue, frameStart: Math.max(start, cue.frameStart) - start, frameEnd: Math.min(end, cue.frameEnd ?? end) - start, offsetSeconds: (cue.offsetSeconds ?? 0) + Math.max(0, start - cue.frameStart) / timeline.fps })) }
    project.characters = Object.fromEntries(Object.entries(project.characters).filter(([, item]) => keep.has(item.nodeId)))
    const motions = new Set(Object.values(project.bindings).map((binding) => binding.motionId))
    for (const clip of nextAnimation.motionClips) motions.add(clip.motion.assetId)
    let expanded = true
    while (expanded) { const size = motions.size; for (const id of [...motions]) { const parent = project.motions[id]?.derivedFrom; if (parent) motions.add(parent) } expanded = motions.size !== size }
    project.motions = Object.fromEntries(Object.entries(project.motions).filter(([id]) => motions.has(id)))
    const assets = new Set<string>([...Object.values(project.characters).map((character) => character.assetId), ...Object.values(project.motions).map((motion) => motion.assetId), ...audio.map((cue) => cue.assetId)])
    for (const node of project.scene.content.nodes) if (typeof node.metadata?.assetId === 'string') assets.add(node.metadata.assetId)
    expanded = true
    while (expanded) { const size = assets.size; for (const id of [...assets]) for (const dep of project.assets[id as keyof typeof project.assets]?.dependencies ?? []) assets.add(dep); expanded = size !== assets.size }
    project.assets = Object.fromEntries(Object.entries(project.assets).filter(([id]) => assets.has(id)))
    const skeletons = new Set(Object.values(project.characters).map((character) => character.skeletonId))
    for (const motion of Object.values(project.motions)) skeletons.add(motion.skeletonId)
    project.skeletons = Object.fromEntries(Object.entries(project.skeletons).filter(([id]) => skeletons.has(id)))
    project.mappings = {}; project.retargetSessions = {}; project.origins = []
    return { project, shotId: shot.id, sourceRange: { startFrame: start, endFrame: end }, warnings }
  })
}
