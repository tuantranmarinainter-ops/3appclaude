import { Bone, LoadingManager, Matrix4, PropertyBinding } from 'three'
import type { Object3D } from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createThreeRigAdapter } from '@bbs/retarget'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { fbxSourceBones } from '@topview/3d-builder/evaluate'
import { sceneBasisMatrix } from '@topview/3d-builder/evaluate'
import { glbTargetFingerprint, resolveProjectBlob, resolveUnifiedAssetFile } from './unifiedAssetFiles'

export async function loadProjectRig(project: UnifiedProject, assetId: string, motionId?: string, skeletonProfileId?: string) {
  const asset = project.assets[assetId as keyof typeof project.assets]
  if (!asset) throw new TypeError('Select an existing imported asset')
  const motion = motionId ? project.motions[motionId] : undefined
  if (motionId && (!motion || motion.assetId !== assetId)) throw new TypeError('Motion does not reference the selected source asset')
  const derivative = motion?.evaluator === 'animation-1.31.8'
  const profiles = motionId ? [project.skeletons[motion!.skeletonId]].filter((profile) => !!profile) : Object.values(project.skeletons).filter((profile) => profile.provenance.sourceHash === asset.source.sha256)
  const selected = skeletonProfileId ? profiles.find((candidate) => candidate.id === skeletonProfileId) : profiles.length === 1 ? profiles[0] : undefined
  if (!selected) throw new TypeError(profiles.length ? 'Choose one of the imported skeleton profiles for rig inspection' : 'Rig inspection could not find a skeleton profile for this asset')
  const profile = selected
  const source = derivative ? { bytes: await resolveProjectBlob(project.projectId, motion!.sourceClip), mediaType: motion!.sourceClip.mediaType } : await resolveUnifiedAssetFile(project, assetId, 'source')
  const sourceSha256 = derivative ? motion!.sourceClip.sha256 : asset.source.sha256
  if (derivative && !['model/gltf-binary', 'model/gltf+json'].includes(source.mediaType)) throw new TypeError('Native Motion derivative must be GLB/glTF')
  const manager = new LoadingManager()
  manager.setURLModifier((url) => { if (url.startsWith('data:')) return url; throw new TypeError('Rig resources must be embedded; external resources require local conversion') })
  const buffer = Uint8Array.from(source.bytes).buffer
  const sourceNodeUUIDs = new Map<string, string>()
  let group: Object3D | null = null
  if (source.mediaType === 'application/vnd.autodesk.fbx') {
    group = new FBXLoader(manager).parse(buffer, '')
    fbxSourceBones(group).forEach((bone, index) => sourceNodeUUIDs.set(String(index), bone.uuid))
  } else if (['model/gltf-binary', 'model/gltf+json'].includes(source.mediaType)) {
    const gltf = await new GLTFLoader(manager).parseAsync(buffer, '')
    gltf.scene.animations = gltf.animations
    group = gltf.scene
    const associations = (gltf.parser as unknown as { associations: Map<Object3D, { nodes?: number }> }).associations
    for (const [node, association] of associations) if (Number.isInteger(association.nodes)) sourceNodeUUIDs.set(String(association.nodes), node.uuid)
  }
  if (!group) throw new TypeError('No rig inspection adapter exists for this format')
  const profileNodeUUIDs = new Map(profile.bones.flatMap((bone) => {
    const uuid = sourceNodeUUIDs.get(bone.id)
    return uuid ? [[bone.id, uuid] as const] : []
  }))
  const canAlignGlbNames = derivative && ['model/gltf-binary', 'model/gltf+json'].includes(source.mediaType) && glbTargetFingerprint(source.bytes) === profile.fingerprint
  if (canAlignGlbNames) {
    profileNodeUUIDs.clear()
    const names = profile.bones.filter((bone) => bone.deform).map((bone) => bone.name)
    const bones: Bone[] = []
    group.traverse((node) => { if ((node as Bone).isBone) bones.push(node as Bone) })
    if (bones.length !== names.length) throw new TypeError('Assigned Motion skeleton does not match its verified target profile')
    bones.forEach((bone, index) => { bone.name = names[index]!; profileNodeUUIDs.set(profile.bones.filter((item) => item.deform)[index]!.id, bone.uuid) })
  }
  if (profileNodeUUIDs.size !== profile.bones.length) {
    const unresolved = profile.bones.filter((bone) => !profileNodeUUIDs.has(bone.id))
    for (const bone of unresolved) {
      const matches = [] as Object3D[]
      group.traverse((node) => { if (node.name === bone.name) matches.push(node) })
      if (matches.length === 1) profileNodeUUIDs.set(bone.id, matches[0]!.uuid)
    }
  }
  const jointUUIDs = profile.bones.filter((bone) => bone.deform).map((bone) => profileNodeUUIDs.get(bone.id)).filter((uuid): uuid is string => !!uuid)
  const normalization = sceneBasisMatrix(profile.basisToScene).multiply(new Matrix4().makeScale(profile.metersPerUnit, profile.metersPerUnit, profile.metersPerUnit))
  return { group, profile, asset, sourceSha256, options: { fingerprint: profile.fingerprint, sourceToScene: normalization.toArray(),
    ...(jointUUIDs.length ? { jointUUIDs } : derivative ? { jointNames: profile.bones.filter((bone) => bone.deform).map((bone) => PropertyBinding.sanitizeNodeName(bone.name)) } : {}) }, profileNodeUUIDs }
}

export async function inspectProjectRig(project: UnifiedProject, assetId: string, motionId?: string, skeletonProfileId?: string) {
  const { group, profile, asset, options, sourceSha256, profileNodeUUIDs } = await loadProjectRig(project, assetId, motionId, skeletonProfileId)
  const adapter = createThreeRigAdapter(group, { ...options, collectUnsupportedTracks: true })
  try {
    const profileBoneLinks = profile.bones.map((bone) => {
      const identity = profileNodeUUIDs.get(bone.id)
      const linkedId = identity ? adapter.nodeIdsBySourceUUID.get(identity) : undefined
      const name = !('jointNames' in options) && asset.source.mediaType === 'application/vnd.autodesk.fbx' ? bone.name : PropertyBinding.sanitizeNodeName(bone.name)
      const matches = linkedId ? [] : adapter.rig.bones.filter((node) => node.name === name)
      const adapterNodeId = linkedId ?? (matches.length === 1 ? matches[0]!.id : null)
      return { profileBoneId: bone.id, adapterNodeId, status: adapterNodeId ? 'matched' : matches.length > 1 ? 'ambiguous' : 'missing' }
    })
    return { assetId, sourceSha256, skeletonProfileId: profile.id, availableSkeletonProfileIds: Object.values(project.skeletons).filter((candidate) => candidate.provenance.sourceHash === asset.source.sha256).map((candidate) => candidate.id), graph: adapter.rig,
      jointIds: adapter.joints, actions: adapter.actions, sourceRevision: project.revision, profileBoneLinks,
      capabilities: { sample: true, normalizationBasis: 'meters-scene', modelRebind: false },
      identityPolicy: 'Profile links use source node identity when available; missing or ambiguous legacy links require explicit resolution.' }
  } finally { adapter.dispose() }
}
