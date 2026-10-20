import { LoadingManager, Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createSkeletonEvaluator, sampleSkeletonRange, sampleCameraSequence, type SkeletonFrameSample, type SkeletonSampleRange } from '@topview/3d-builder/skeleton'
import type { FrameSnapshot } from '@topview/3d-builder/evaluate'
import { FCurveSet, fbxSourceBones, sceneFromDocument } from '@topview/3d-builder/evaluate'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { resolveProjectBlob, resolveUnifiedAssetFile } from './unifiedAssetFiles'

export function projectEvaluationScene(project: UnifiedProject) {
  const raw = project.extensions.topview?.fcurves
  return sceneFromDocument(project.scene, { fcurves: raw == null ? null : FCurveSet.parse(raw),
    userKeys: FCurveSet.parseUserKeys(raw), userKeysEnabled: true })
}

export async function* sampleProjectCameraSequence(project: UnifiedProject, sequenceId: string, sampleFps: number, viewportAspect: number) {
  const scene = projectEvaluationScene(project)
  const overlays = { fcurves: scene.fcurves, userKeys: scene.userKeys, userKeysEnabled: scene.userKeysEnabled }
  const sequence = project.scene.content.editorial?.sequences.find((item) => item.id === sequenceId)
  const cameraTargets = new Set<string>()
  for (const shot of sequence?.clips ?? []) {
    const camera = project.scene.content.nodes.find((node) => node.id === shot.cameraNodeId)?.camera
    if (camera?.subject?.follow) cameraTargets.add(camera.subject.nodeId)
    if (camera?.lookAtTarget?.nodeId) cameraTargets.add(camera.lookAtTarget.nodeId)
  }
  const trajectoryTargets = new Set(project.scene.content.timeline.animation.motionClips
    .filter((clip) => cameraTargets.has(clip.target.nodeId) && clip.motion.rootMotion?.policy === 'trajectory')
    .map((clip) => clip.target.nodeId))
  if (!trajectoryTargets.size) {
    for (const sample of sampleCameraSequence(project.scene, sequenceId, sampleFps, viewportAspect, overlays)) yield { sourceRevision: project.revision, ...sample }
    return
  }

  const characters = Object.entries(project.characters).filter(([, character]) => trajectoryTargets.has(character.nodeId))
  if (new Set(characters.map(([, character]) => character.nodeId)).size !== trajectoryTargets.size) {
    throw new TypeError('Camera trajectory subjects require a shared Character source')
  }
  const selected = { ...project, characters: Object.fromEntries(characters) }
  const { models, motions, issues } = await loadProjectSkeletonInputs(selected)
  if (issues.length || models.size !== characters.length) throw new TypeError('Camera trajectory subjects require CPU-evaluable source assets')
  const evaluator = createSkeletonEvaluator(selected.scene, models, motions)
  const matrix = new Matrix4(), position = new Vector3(), rotation = new Quaternion(), scale = new Vector3(), forward = new Vector3(0, 0, 1)
  try {
    for (const sample of sampleCameraSequence(project.scene, sequenceId, sampleFps, viewportAspect, {
      ...overlays,
      resolveEffectiveWorldSubjects(snapshot) {
        for (const subject of evaluator.evaluate(snapshot)) {
          if (!trajectoryTargets.has(subject.nodeId)) continue
          const transform = snapshot.transforms.get(subject.nodeId)
          if (!transform) continue
          matrix.fromArray(subject.actorWorldMatrix).decompose(position, rotation, scale)
          transform.position.x = position.x; transform.position.y = position.y; transform.position.z = position.z
          forward.set(0, 0, 1).applyQuaternion(rotation)
          if (Math.hypot(forward.x, forward.z) > 1e-9) transform.rotation.y = Math.atan2(forward.x, forward.z) * 180 / Math.PI
          transform.rotation.x = 0; transform.rotation.z = 0
        }
      },
    })) yield { sourceRevision: project.revision, ...sample }
  } finally { evaluator.dispose() }
}

async function loadProjectSkeletonInputs(project: UnifiedProject) {
  const issues: Array<{ code: string; path: string; message: string }> = []
  const sources = new Map<string, Promise<Object3D>>()
  function load(assetId: string) {
    let pending = sources.get(assetId)
    if (!pending) {
      pending = (async () => {
        const source = await resolveUnifiedAssetFile(project, assetId, 'source')
        const manager = new LoadingManager()
        manager.setURLModifier((url) => {
          if (url.startsWith('data:')) return url
          throw new TypeError('Headless asset resources must be embedded')
        })
        const buffer = Uint8Array.from(source.bytes).buffer
        if (source.mediaType === 'application/vnd.autodesk.fbx') return new FBXLoader(manager).parse(buffer, '')
        if (['model/gltf-binary', 'model/gltf+json'].includes(source.mediaType)) {
          const gltf = await new GLTFLoader(manager).parseAsync(buffer, '')
          gltf.scene.animations = gltf.animations
          return gltf.scene
        }
        throw new TypeError('Unsupported skeleton source format')
      })()
      sources.set(assetId, pending)
    }
    return pending
  }
  const models = new Map<string, Object3D>()
  const motions = new Map<string, { group: Object3D; clipIndex: number }>()
  async function loadMotion(motion: UnifiedProject['motions'][string]) {
    if (motion.evaluator !== 'animation-1.31.8') return load(motion.assetId)
    const source = await resolveProjectBlob(project.projectId, motion.sourceClip)
    const manager = new LoadingManager()
    manager.setURLModifier((url) => {
      if (url.startsWith('data:')) return url
      throw new TypeError('Headless asset resources must be embedded')
    })
    const gltf = await new GLTFLoader(manager).parseAsync(Uint8Array.from(source).buffer, '')
    gltf.scene.animations = gltf.animations
    return gltf.scene
  }
  for (const character of Object.values(project.characters)) {
    const node = project.scene.content.nodes.find((item) => item.id === character.nodeId)
    if (node?.metadata?.rig !== 'direct') {
      issues.push({ code: 'SKELETON_EVALUATION_UNAVAILABLE', path: `characters.${character.id}`, message: 'CPU evaluation currently requires an imported direct rig.' })
      continue
    }
    if (node.character?.animation?.posePresetId) {
      issues.push({ code: 'POSE_LIBRARY_UNAVAILABLE', path: `characters.${character.id}`, message: 'This pose requires a library record that is not loaded into the CPU evaluator.' })
      continue
    }
    try {
      const model = await load(character.assetId)
      const sourceBones = fbxSourceBones(model)
      const profile = project.skeletons[character.skeletonId]!
      const names = new Set(sourceBones.map((bone) => bone.name))
      if (sourceBones.length !== profile.bones.length || profile.bones.some((bone) => !names.has(bone.name))) throw new TypeError('Model skeleton does not match the profile')
      const required = project.scene.content.timeline.animation.motionClips.filter((clip) => clip.target.nodeId === node.id)
      for (const clip of required) {
        if (motions.has(clip.motion.assetId)) continue
        const motion = project.motions[clip.motion.assetId]
        if (!motion) throw new TypeError('Motion source is unavailable')
        const group = await loadMotion(motion)
        const clipIndex = clip.motion.clipIndex ?? 0
        if (!group.animations[clipIndex]) throw new TypeError('Motion clip index is unavailable')
        motions.set(clip.motion.assetId, { group, clipIndex })
      }
      models.set(node.id, model)
    } catch {
      issues.push({ code: 'SKELETON_EVALUATION_UNAVAILABLE', path: `characters.${character.id}`, message: 'The verified source could not be decoded on the CPU; relink missing assets or convert unsupported textures/compression locally.' })
    }
  }
  return { models, motions, issues }
}

export async function evaluateProjectSkeletons(project: UnifiedProject, snapshot: FrameSnapshot) {
  const { models, motions, issues } = await loadProjectSkeletonInputs(project)
  for (const command of snapshot.motionPlayback) if (!models.has(command.nodeId) && !Object.values(project.characters).some((character) => character.nodeId === command.nodeId)) {
    issues.push({ code: 'SKELETON_EVALUATION_UNAVAILABLE', path: `nodes.${command.nodeId}`, message: 'This legacy Character has no shared model/profile source binding.' })
  }
  let skeletonSamples: SkeletonFrameSample[] = []
  if (models.size) {
    let evaluator: ReturnType<typeof createSkeletonEvaluator> | undefined
    try { evaluator = createSkeletonEvaluator(project.scene, models, motions); skeletonSamples = evaluator.evaluate(snapshot) }
    catch { issues.push({ code: 'SKELETON_EVALUATION_UNAVAILABLE', path: 'skeletonSamples', message: 'The native skeleton evaluator could not sample this frame.' }) }
    finally { evaluator?.dispose() }
  }
  return { skeletonSamples, issues }
}

/** Converter input only: all selected sources must be available before the first sample is emitted. */
export async function* sampleProjectSkeletonRange(project: UnifiedProject, range: SkeletonSampleRange, characterIds: readonly string[]) {
  if (!characterIds.length || new Set(characterIds).size !== characterIds.length || characterIds.some((id) => !Object.hasOwn(project.characters, id))) {
    throw new TypeError('Select unique existing Character IDs for range sampling')
  }
  const selected = { ...project, characters: Object.fromEntries(characterIds.map((id) => [id, project.characters[id]!])) }
  const { models, motions, issues } = await loadProjectSkeletonInputs(selected)
  if (issues.length || models.size !== characterIds.length) throw new TypeError('Selected Characters cannot be evaluated; relink sources or resolve unsupported capabilities first')
  const evaluator = createSkeletonEvaluator(selected.scene, models, motions)
  try {
    const scene = projectEvaluationScene(project)
    for (const sample of sampleSkeletonRange(scene, range, evaluator.evaluate)) yield { sourceRevision: project.revision, ...sample }
  } finally { evaluator.dispose() }
}
