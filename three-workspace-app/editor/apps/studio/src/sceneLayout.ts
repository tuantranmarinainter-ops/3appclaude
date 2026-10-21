import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { createFrameSnapshot, evaluateFrame, sceneBasisMatrix } from '@topview/3d-builder/evaluate'
import type { SkeletonProfile, UnifiedProject } from '@bbs/animation-workspace-shared'
import { evaluateProjectSkeletons, projectEvaluationScene } from './unifiedSkeletonEvaluation'

const canonical = (name: string) => name.split(':').pop()!.replace(/^mixamorig[0-9]*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
const xyz = (v: { x: number; y: number; z: number }) => new Vector3(v.x, v.y, v.z)
const yaw = (q: Quaternion) => {
  const forward = new Vector3(0, 0, 1).applyQuaternion(q)
  return (Math.hypot(forward.x, forward.z) > 1e-8 ? Math.atan2(forward.x, forward.z) : 2 * Math.atan2(q.y, q.w)) * 180 / Math.PI
}

/** Profile TRS is in source units, including source ancestors; no mesh or animation keys are needed. */
export function restLayoutDimensions(profile: SkeletonProfile | undefined) {
  if (!profile) return null
  const matrices = new Map<string, Matrix4>(), pending = new Set<string>()
  const bones = new Map(profile.bones.map(b => [b.id, b]))
  const world = (id: string): Matrix4 => {
    const cached = matrices.get(id); if (cached) return cached
    const bone = bones.get(id)
    if (!bone || pending.has(id)) throw new TypeError('Layout profile has a missing parent or cycle')
    pending.add(id)
    const rest = bone.rest as { position: number[]; rotation: number[]; scale: number[] }
    if (!rest || ![rest.position, rest.rotation, rest.scale].every(Array.isArray) || rest.position.length !== 3 || rest.rotation.length !== 4 || rest.scale.length !== 3 || [...rest.position, ...rest.rotation, ...rest.scale].some(v => !Number.isFinite(v))) throw new TypeError('Layout profile has invalid rest transforms')
    const local = new Matrix4().compose(new Vector3().fromArray(rest.position), new Quaternion().fromArray(rest.rotation), new Vector3().fromArray(rest.scale))
    const result = bone.parentId ? world(bone.parentId).clone().multiply(local) : local
    matrices.set(id, result); pending.delete(id); return result
  }
  const basis = sceneBasisMatrix(profile.basisToScene).multiply(new Matrix4().makeScale(profile.metersPerUnit, profile.metersPerUnit, profile.metersPerUnit))
  const points = profile.bones.map(b => ({ name: canonical(b.name), position: new Vector3().setFromMatrixPosition(basis.clone().multiply(world(b.id))) }))
  const hips = points.find(b => ['hips', 'pelvis', 'body'].includes(b.name))
  if (!hips) return null
  const feet = points.filter(b => /(?:foot|toebase|toeend|lowleftleg|lowlegright)$/.test(b.name))
  const floor = feet.length ? Math.min(...feet.map(b => b.position.y)) : 0
  const height = hips.position.y - floor
  return height > 0 && Number.isFinite(height) ? { hipsHeightMeters: height, hipsHeightReference: feet.length ? 'rest-feet' : 'rest-origin' } : null
}

/** Compact, read-only scene facts for AI consumers; raw geometry, keys and private asset references never leave this view. */
export async function readSceneLayout(project: UnifiedProject, args: Record<string, unknown>) {
  const timeline = project.scene.content.timeline, frame = args.frame === undefined ? timeline.frameStart : args.frame
  if (Object.keys(args).some(k => k !== 'frame') || typeof frame !== 'number' || !Number.isFinite(frame) || frame < timeline.frameStart || frame > timeline.frameEnd) throw new TypeError('scene.layout.read accepts only a finite frame within the timeline')
  const scene = projectEvaluationScene(project), snapshot = createFrameSnapshot()
  evaluateFrame(scene, frame, snapshot)
  const evaluated = await evaluateProjectSkeletons(project, snapshot)
  const skeletons = new Map(evaluated.skeletonSamples.map(s => [s.nodeId, s]))
  const trajectoryTargets = new Set(project.scene.content.timeline.animation.motionClips
    .filter(clip => clip.motion.rootMotion?.policy === 'trajectory').map(clip => clip.target.nodeId))
  // Resolve camera.subject bindings against the same trajectory positions the renderer uses.
  if (trajectoryTargets.size) evaluateFrame({ ...scene, resolveEffectiveWorldSubjects(current) {
    for (const sample of skeletons.values()) {
      if (!trajectoryTargets.has(sample.nodeId)) continue
      const t = current.transforms.get(sample.nodeId); if (!t) continue
      const p = new Vector3(), q = new Quaternion(), s = new Vector3()
      new Matrix4().fromArray(sample.actorWorldMatrix).decompose(p, q, s)
      t.position = { x: p.x, y: p.y, z: p.z }; t.rotation = { x: 0, y: yaw(q), z: 0 }
    }
  } }, frame, snapshot)
  const nodes = new Map(project.scene.content.nodes.map(n => [n.id, n]))
  const matrices = new Map<string, Matrix4>(), visiting = new Set<string>()
  const placement = (id: string): Matrix4 => {
    const cached = matrices.get(id); if (cached) return cached
    const node = nodes.get(id), t = snapshot.transforms.get(id)
    if (!node || !t || visiting.has(id)) throw new TypeError('Layout scene has missing or cyclic transforms')
    visiting.add(id)
    const matrix = new Matrix4().compose(xyz(t.position), new Quaternion().setFromEuler(new Euler(t.rotation.x * Math.PI / 180, t.rotation.y * Math.PI / 180, t.rotation.z * Math.PI / 180)), xyz(t.scale))
    const result = node.parentId ? placement(node.parentId).clone().multiply(matrix) : matrix
    visiting.delete(id); matrices.set(id, result); return result
  }
  const active = new Map(snapshot.motionPlayback.map(c => [c.clipId, c]))
  const characters = project.scene.content.nodes.filter(n => n.type === 'character').map(node => {
    const character = Object.values(project.characters).find(c => c.nodeId === node.id)
    const sample = skeletons.get(node.id), p = new Vector3(), q = new Quaternion(), scale = new Vector3()
    const matrix = sample ? new Matrix4().fromArray(sample.actorWorldMatrix) : placement(node.id)
    matrix.decompose(p, q, scale)
    let dimensions: ReturnType<typeof restLayoutDimensions> = null
    try { dimensions = restLayoutDimensions(character ? project.skeletons[character.skeletonId] : undefined) } catch { /* Missing/invalid profiles are reported as unavailable facts. */ }
    return { id: character?.id ?? node.id, nodeId: node.id, name: node.name, visible: node.visible,
      position: { x: p.x, y: p.y, z: p.z }, yawDegrees: yaw(q), positionSource: sample ? 'evaluated' : 'authored-placement',
      hipsHeightMeters: dimensions ? dimensions.hipsHeightMeters * Math.abs(scale.y) : null,
      hipsHeightReference: dimensions?.hipsHeightReference ?? 'unavailable',
      clips: timeline.animation.motionClips.filter(c => c.target.nodeId === node.id).map(c => ({ id: c.id, motionId: c.motion.assetId, name: c.motion.name,
        frameStart: c.frameStart, frameEnd: c.frameEnd, active: active.has(c.id), timeSeconds: active.get(c.id)?.timeSeconds ?? null,
        speed: c.playback.speed, loop: c.playback.loop, reverse: c.motion.reverse ?? false, rootPolicy: c.motion.rootMotion?.policy ?? 'skeletal' })) }
  })
  const cameras = project.scene.content.nodes.filter(n => n.type === 'camera').map(node => {
    const t = snapshot.transforms.get(node.id)!, p = new Vector3(), q = new Quaternion(), scale = new Vector3()
    placement(node.id).decompose(p, q, scale)
    const look = t.useEuler || !t.lookAt ? new Vector3(0, 0, -1).applyQuaternion(q).add(p) : xyz(t.lookAt)
    return { id: node.id, name: node.name, visible: node.visible, position: { x: p.x, y: p.y, z: p.z },
      lookAt: { x: look.x, y: look.y, z: look.z }, fovYDegrees: t.fov ?? node.camera?.fov ?? 50,
      clips: timeline.animation.cameraMotionClips.filter(c => c.target.nodeId === node.id).map(c => ({ id: c.id, name: c.motion.label, frameStart: c.frameStart, frameEnd: c.frameEnd, active: frame >= c.frameStart && frame <= c.frameEnd })),
      shots: (project.scene.content.editorial?.sequences ?? []).flatMap(sequence => sequence.clips.filter(c => c.cameraNodeId === node.id).map(c => ({ id: c.id, sequenceId: sequence.id, frameStart: c.sourceFrameStart, frameEnd: c.sourceFrameEnd }))) }
  })
  return { sourceRevision: project.revision, frame, frameRange: { start: timeline.frameStart, end: timeline.frameEnd, fps: timeline.fps },
    units: 'meters', yawUnits: 'degrees', characters, cameras,
    issues: evaluated.issues.map(({ code, path }) => ({ code, path })) }
}
