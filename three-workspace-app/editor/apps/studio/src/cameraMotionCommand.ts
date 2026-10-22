import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { bakeCameraMotionClip, CAMERA_MOTIONS, createFrameSnapshot, evaluateFrame, type CameraMotionPreset } from '@topview/3d-builder/evaluate'
import { projectEvaluationScene } from './unifiedSkeletonEvaluation'

const COMMAND_ADD_KEYS = ['cameraNodeId', 'presetId', 'frameStart', 'durationFrames', 'targetNodeId', 'config']
const CONFIG_RANGES: Record<string, readonly [number, number]> = {
  strength: [0, 1],
  angleDeg: [-360, 360],
  distance: [0.1, 3],
  fovDelta: [-40, 40],
  height: [-2, 2],
}

export type CameraMotionCommandResult =
  | { type: 'add'; clip: NonNullable<ReturnType<typeof bakeCameraMotionClip>['clip']> }
  | { type: 'remove'; clipId: string }

function fail(message: string): never { throw new TypeError(message) }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function findNode(project: UnifiedProject, nodeId: string) {
  return project.scene.content.nodes.find((node) => node.id === nodeId)
}

export function prepareCameraMotionAdd(project: UnifiedProject, args: unknown): CameraMotionCommandResult {
  if (!isRecord(args) || Object.keys(args).some((key) => !COMMAND_ADD_KEYS.includes(key)) ||
      typeof args.cameraNodeId !== 'string' || !args.cameraNodeId.trim() || typeof args.presetId !== 'string' || !args.presetId.trim() ||
      !Number.isSafeInteger(args.frameStart) || (args.frameStart as number) < project.scene.content.timeline.frameStart ||
      args.durationFrames !== undefined && (!Number.isSafeInteger(args.durationFrames) || (args.durationFrames as number) < 1) ||
      args.targetNodeId !== undefined && (typeof args.targetNodeId !== 'string' || !args.targetNodeId.trim()) ||
      args.config !== undefined && !isRecord(args.config)) fail('camera.motion.add requires a camera, preset, frameStart, and optional durationFrames, targetNodeId and config')

  const cameraNodeId = args.cameraNodeId as string
  const presetId = args.presetId as string
  const frameStart = args.frameStart as number
  const cameraNode = findNode(project, cameraNodeId)
  if (!cameraNode || cameraNode.type !== 'camera' || !cameraNode.camera) fail(`Camera node not found: ${cameraNodeId}`)
  const preset = CAMERA_MOTIONS.find((item) => item.id === presetId)
  if (!preset) fail(`Camera motion preset not found: ${presetId}`)

  let targetNode: ReturnType<typeof findNode> | undefined
  if (args.targetNodeId !== undefined) {
    targetNode = findNode(project, args.targetNodeId as string)
    if (!targetNode) fail(`Camera motion target node not found: ${args.targetNodeId as string}`)
  } else {
    const priorTargetId = [...project.scene.content.timeline.animation.cameraMotionClips].reverse()
      .find((clip) => clip.target.nodeId === cameraNodeId)?.motion.metadata?.targetNodeId
    const priorTarget = typeof priorTargetId === 'string' ? findNode(project, priorTargetId) : undefined
    const boundId = cameraNode.camera.subject?.nodeId
    const boundTarget = typeof boundId === 'string' ? findNode(project, boundId) : undefined
    targetNode = priorTarget?.type === 'character' ? priorTarget : boundTarget?.type === 'character' ? boundTarget : undefined
  }

  const config: Record<string, number> = {}
  if (args.config !== undefined) {
    for (const [key, value] of Object.entries(args.config)) {
      const range = CONFIG_RANGES[key]
      if (!range || !finiteNumber(value) || value < range[0] || value > range[1]) {
        fail(`Invalid camera motion config value: ${key}`)
      }
      config[key] = value
    }
  }

  const fps = project.scene.content.timeline.fps
  const durationMs = args.durationFrames === undefined
    ? preset.defaultConfig.durationMs
    : (args.durationFrames as number) * 1000 / fps
  const frameEnd = frameStart + Math.max(1, Math.round(durationMs * fps / 1000))
  if (!Number.isSafeInteger(frameEnd) || frameEnd > project.scene.content.timeline.frameEnd) fail('Camera motion clip exceeds the timeline range')
  const bakeConfig = { ...config, ...(args.durationFrames === undefined ? {} : { durationMs }) }
  const snapshot = createFrameSnapshot()
  evaluateFrame(projectEvaluationScene(project), frameStart, snapshot)
  const cameraPose = snapshot.transforms.get(cameraNodeId)
  if (!cameraPose) fail(`Camera node has no evaluated pose at frame ${frameStart}`)
  const targetPose = targetNode ? snapshot.transforms.get(targetNode.id) : undefined
  const bakeTarget = targetNode && targetPose
    ? { ...targetNode, transform: { ...targetNode.transform, position: { ...targetPose.position }, rotation: { ...targetPose.rotation } } }
    : targetNode
  const bakeCamera = {
    ...cameraNode,
    transform: { ...cameraNode.transform, position: { ...cameraPose.position } },
    camera: { ...cameraNode.camera, lookAt: { ...(cameraPose.lookAt ?? cameraNode.camera.lookAt) }, fov: cameraPose.fov ?? cameraNode.camera.fov },
  }
  const baked = bakeCameraMotionClip(
    preset as CameraMotionPreset,
    { cameraNode: bakeCamera, ...(bakeTarget ? { targetNode: bakeTarget } : {}), doc: project.scene },
    frameStart,
    bakeConfig,
  )
  if (!baked.ok || !baked.clip) fail(`Camera motion could not be baked: ${baked.reason ?? 'unknown bake error'}`)

  // The baker intentionally includes optional properties with undefined values. Strip those
  // before storing the clip because the unified project wire contract accepts JSON only.
  const clip = JSON.parse(JSON.stringify(baked.clip)) as typeof baked.clip
  const timeline = project.scene.content.timeline
  if (clip.frameEnd > timeline.frameEnd) fail('Camera motion clip exceeds the timeline range')
  const overlaps = project.scene.content.timeline.animation.cameraMotionClips.some((existing) =>
    existing.target.nodeId === cameraNodeId && existing.frameStart <= clip.frameEnd && existing.frameEnd >= clip.frameStart)
  if (overlaps) fail('Camera motion clip overlaps an existing clip on this camera')
  return { type: 'add', clip }
}

export function prepareCameraMotionRemove(project: UnifiedProject, args: unknown): CameraMotionCommandResult {
  if (!isRecord(args) || Object.keys(args).some((key) => key !== 'clipId') ||
      typeof args.clipId !== 'string' || !args.clipId.trim()) fail('camera.motion.remove requires only a clipId')
  const clipId = args.clipId as string
  if (!project.scene.content.timeline.animation.cameraMotionClips.some((clip) => clip.id === clipId)) {
    fail(`Camera motion clip not found: ${clipId}`)
  }
  return { type: 'remove', clipId }
}
