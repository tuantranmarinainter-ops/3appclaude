import type { EditSequence, EditSequenceClip } from '@topview/3d-builder/evaluate'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'

export type SceneReviewStatus = 'pending' | 'ok' | 'note'

export interface SceneReviewShot {
  status: SceneReviewStatus
  note: string
  sourceRevision: number
  updatedAt: string
  /** Persisted source snapshot; additive metadata keeps review checks pure after reload. */
  sourceSignature?: string
}

export interface SceneReviewExtension {
  version: 1
  sequenceId: string
  shots: Record<string, SceneReviewShot>
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  const object = record(value)
  if (!object) return value
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, ordered(object[key])]))
}

function stableJson(value: unknown): string {
  return JSON.stringify(ordered(value))
}

function clipRange(clip: EditSequenceClip): [number, number] {
  return [Math.min(clip.sourceFrameStart, clip.sourceFrameEnd), Math.max(clip.sourceFrameStart, clip.sourceFrameEnd)]
}

function overlaps(value: unknown, start: number, end: number): boolean {
  const item = record(value)
  return !!item && typeof item.frameStart === 'number' && typeof item.frameEnd === 'number' &&
    item.frameStart <= end && item.frameEnd >= start
}

function relevantCurveKeys(raw: unknown, start: number, end: number): unknown {
  const curve = record(raw)
  if (!curve || !Array.isArray(curve.k)) return null
  const keys = curve.k.filter((key) => Array.isArray(key) && typeof key[0] === 'number') as unknown[][]
  const before = keys.filter((key) => (key[0] as number) < start).at(-1)
  const after = keys.find((key) => (key[0] as number) > end)
  const inside = keys.filter((key) => (key[0] as number) >= start && (key[0] as number) <= end)
  const relevant = [before, ...inside, after].filter((key): key is unknown[] => key !== undefined)
  return relevant.length ? { ...curve, k: relevant } : null
}

function relevantFcurves(value: unknown, start: number, end: number, nodeIds: Set<string>): unknown {
  const curves = record(value)
  if (!curves) return value
  const raw = curves.fcurves
  const relevant = Array.isArray(raw)
    ? raw.filter((curve) => {
      const track = record(curve)
      return Array.isArray(track?.t) && typeof track.t[1] === 'string' && nodeIds.has(track.t[1])
    }).map((curve) => relevantCurveKeys(curve, start, end)).filter((curve) => curve !== null)
    : raw
  const userKeys = record(curves.userKeys)
  const selectedUserKeys: Record<string, unknown> = {}
  if (userKeys) {
    for (const [nodeId, tracks] of Object.entries(userKeys)) {
      if (!nodeIds.has(nodeId)) continue
      const trackRecord = record(tracks)
      if (!trackRecord) continue
      const selected: Record<string, unknown> = {}
      for (const [prop, rawKeys] of Object.entries(trackRecord)) {
        if (!Array.isArray(rawKeys)) continue
        const keys = rawKeys.filter((key) => record(key) && typeof (key as Record<string, unknown>).frame === 'number') as Array<Record<string, unknown>>
        const before = keys.filter((key) => (key.frame as number) < start).at(-1)
        const after = keys.find((key) => (key.frame as number) > end)
        const inside = keys.filter((key) => (key.frame as number) >= start && (key.frame as number) <= end)
        const chosen = [before, ...inside, after].filter((key): key is Record<string, unknown> => key !== undefined)
        if (chosen.length) selected[prop] = chosen
      }
      if (Object.keys(selected).length) selectedUserKeys[nodeId] = selected
    }
  }
  return { ...curves, fcurves: relevant, userKeys: selectedUserKeys }
}

function sequenceFor(project: UnifiedProject, sequenceId: string): EditSequence | undefined {
  return project.scene.content.editorial?.sequences.find((sequence) => sequence.id === sequenceId)
}

function sourceSnapshot(project: UnifiedProject, sequenceId: string, clip: EditSequenceClip): unknown {
  const [start, end] = clipRange(clip)
  const content = project.scene.content
  const timeline = content.timeline
  const visibleNodes = content.nodes.filter((node) => node.type !== 'camera' || node.id === clip.cameraNodeId)
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id))
  const relevantCharacters = Object.fromEntries(Object.entries(project.characters).filter(([, character]) => visibleNodeIds.has(character.nodeId)))
  const referencedAssets = new Set<string>()
  for (const character of Object.values(relevantCharacters)) referencedAssets.add(character.assetId)
  for (const node of visibleNodes) {
    const assetId = record(node.metadata)?.assetId
    if (typeof assetId === 'string') referencedAssets.add(assetId)
  }
  const cameraMotion = timeline.animation.cameraMotionClips.filter((item) => overlaps(item, start, end) && item.target.nodeId === clip.cameraNodeId)
  const motionClips = timeline.animation.motionClips.filter((item) => overlaps(item, start, end) && visibleNodeIds.has(item.target.nodeId))
  const pathMotion = timeline.animation.pathMotionClips.filter((item) => overlaps(item, start, end) && visibleNodeIds.has(item.target.nodeId) && visibleNodeIds.has(item.pathNodeId))
  const referencedMotions = Object.fromEntries(motionClips.map((item) => {
    const motionData = record(item.motion)
    const motionId = project.bindings[item.id]?.motionId ?? (typeof motionData?.assetId === 'string' ? motionData.assetId : item.id)
    const motion = project.motions[motionId]
    if (motion) {
      referencedAssets.add(motion.assetId)
      return [motionId, { motion, asset: project.assets[motion.assetId], skeleton: project.skeletons[motion.skeletonId] }]
    }
    return [motionId, null]
  }))
  const vfx = record(project.extensions.vfxCues)
  const cues = Array.isArray(vfx?.cues) ? vfx.cues.filter((cue) => {
    const item = record(cue)
    return !!item && typeof item.frameStart === 'number' && typeof item.frameEnd === 'number' && item.frameStart <= end && item.frameEnd >= start &&
      (typeof item.attachNodeId !== 'string' || visibleNodeIds.has(item.attachNodeId))
  }) : []
  const fcurves = project.extensions.topview?.fcurves
  return {
    sequenceId,
    clip,
    // All static scene nodes and global environment settings may be visible in any shot.
    nodes: visibleNodes,
    environment: content.environment,
    settings: content.settings,
    aspectRatio: content.aspectRatio,
    timeline: {
      fps: timeline.fps,
      fcurves: relevantFcurves({ fcurves: timeline.animation.fcurves }, start, end, visibleNodeIds),
      cameraMotionClips: cameraMotion.filter((item) => item.target.nodeId === clip.cameraNodeId),
      motionClips,
      pathMotionClips: pathMotion,
    },
    fcurves: relevantFcurves(fcurves, start, end, visibleNodeIds),
    vfxCues: cues,
    characters: relevantCharacters,
    motions: referencedMotions,
    bindings: Object.fromEntries(motionClips.map((item) => [item.id, project.bindings[item.id]])),
    assets: Object.fromEntries([...referencedAssets].sort().map((id) => [id, project.assets[id as keyof typeof project.assets]])),
    filmFrame: project.extensions.filmFrame,
  }
}

function signature(project: UnifiedProject, sequenceId: string, clip: EditSequenceClip): string {
  return stableJson(sourceSnapshot(project, sequenceId, clip))
}

function selectedClip(project: UnifiedProject, sequenceId: string, clipId: string): EditSequenceClip | undefined {
  return sequenceFor(project, sequenceId)?.clips.find((clip) => clip.id === clipId)
}

export function planReviewFrames(project: UnifiedProject, sequenceId: string): Array<{ clipId: string; frames: number[] }> {
  const sequence = sequenceFor(project, sequenceId)
  if (!sequence) return []
  return sequence.clips.map((clip) => {
    const [start, end] = clipRange(clip)
    const span = end - start
    return {
      clipId: clip.id,
      frames: [0.15, 0.5, 0.85].map((ratio) => Math.round(start + span * ratio)),
    }
  })
}

export function reviewStatusFor(project: UnifiedProject, clipId: string): SceneReviewShot {
  const extension = project.extensions.sceneReview as unknown as SceneReviewExtension | undefined
  const empty: SceneReviewShot = { status: 'pending', note: '', sourceRevision: project.revision, updatedAt: '' }
  if (!extension || extension.version !== 1 || typeof extension.sequenceId !== 'string') return empty
  const shot = extension.shots?.[clipId]
  if (!shot || !['pending', 'ok', 'note'].includes(shot.status)) return empty
  const clip = selectedClip(project, extension.sequenceId, clipId)
  if (shot.status === 'ok' && (!clip || !shot.sourceSignature || shot.sourceSignature !== signature(project, extension.sequenceId, clip))) {
    return { ...shot, status: 'pending' }
  }
  return shot
}

export function reviewStatusForSequence(project: UnifiedProject, sequenceId: string, clipId: string): SceneReviewShot {
  const extension = project.extensions.sceneReview as unknown as SceneReviewExtension | undefined
  if (extension?.sequenceId !== sequenceId) return { status: 'pending', note: '', sourceRevision: project.revision, updatedAt: '' }
  return reviewStatusFor(project, clipId)
}

export function makeSceneReviewShot(project: UnifiedProject, sequenceId: string, clipId: string, status: SceneReviewStatus, note: string, updatedAt = new Date().toISOString()): SceneReviewShot {
  const clip = selectedClip(project, sequenceId, clipId)
  if (!clip) throw new Error('Clip does not belong to the selected editorial sequence')
  return { status, note, sourceRevision: project.revision, updatedAt, sourceSignature: signature(project, sequenceId, clip) }
}

export function emptySceneReview(sequenceId: string): SceneReviewExtension {
  return { version: 1, sequenceId, shots: {} }
}
