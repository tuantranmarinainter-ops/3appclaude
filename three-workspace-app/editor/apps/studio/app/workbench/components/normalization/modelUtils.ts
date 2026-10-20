import { AnimationClip, Bone, Float32BufferAttribute, Group, Matrix4, PropertyBinding, Uint16BufferAttribute, type SkinnedMesh } from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { SkeletonMapping, SkeletonProfile } from '@bbs/animation-workspace-shared'
import { exportCanonicalModel, isMixamo65Topology, rebindCanonicalModel } from '@bbs/retarget'
import { sceneBasisMatrix } from '@topview/3d-builder/evaluate'

export async function loadModelScene(bytes: ArrayBuffer, mediaType: string) {
  if (mediaType === 'application/vnd.autodesk.fbx') return new FBXLoader().parse(bytes, '')
  if (mediaType === 'model/gltf-binary' || mediaType === 'model/gltf+json') {
    const gltf = await new GLTFLoader().parseAsync(bytes, '')
    const primitives = gltf.parser.json.meshes as Array<{ primitives: Array<{ attributes: Record<string, number> }> }>
    const skinned: SkinnedMesh[] = []
    gltf.scene.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) skinned.push(node as SkinnedMesh) })
    for (const mesh of skinned) {
      const association = gltf.parser.associations.get(mesh) as { meshes?: number; primitives?: number } | undefined
      if (association?.meshes === undefined || association.primitives === undefined) throw new TypeError(`Mesh ${mesh.name || '(unnamed)'} has no glTF primitive identity`)
      const attributes = primitives[association.meshes]?.primitives[association.primitives]?.attributes
      if (!attributes) throw new TypeError(`Mesh ${mesh.name || '(unnamed)'} references a missing glTF primitive`)
      if (attributes.JOINTS_1 === undefined && attributes.WEIGHTS_1 === undefined) continue
      if (attributes.JOINTS_1 === undefined || attributes.WEIGHTS_1 === undefined || attributes.WEIGHTS_0 === undefined) throw new TypeError(`Mesh ${mesh.name || '(unnamed)'} has incomplete glTF influence attributes`)
      const [joints1, weights1, weights0] = await Promise.all([gltf.parser.loadAccessor(attributes.JOINTS_1), gltf.parser.loadAccessor(attributes.WEIGHTS_1), gltf.parser.loadAccessor(attributes.WEIGHTS_0)])
      const vertexCount = mesh.geometry.getAttribute('position')?.count
      if (!vertexCount || joints1.itemSize !== 4 || weights1.itemSize !== 4 || weights0.itemSize !== 4 || joints1.count !== vertexCount || weights1.count !== vertexCount || weights0.count !== vertexCount) throw new TypeError(`Mesh ${mesh.name || '(unnamed)'} has incompatible glTF influence accessor dimensions`)
      const jointValues = new Uint16Array(vertexCount * 4), weightValues0 = new Float32Array(vertexCount * 4), weightValues1 = new Float32Array(vertexCount * 4)
      for (let vertex = 0; vertex < vertexCount; vertex++) for (let slot = 0; slot < 4; slot++) {
        const offset = vertex * 4 + slot
        const jointValue = slot === 0 ? joints1.getX(vertex) : slot === 1 ? joints1.getY(vertex) : slot === 2 ? joints1.getZ(vertex) : joints1.getW(vertex)
        if (!Number.isInteger(jointValue) || jointValue < 0 || jointValue > 65535) throw new TypeError(`Mesh ${mesh.name || '(unnamed)'} has an invalid secondary joint index`)
        jointValues[offset] = jointValue
        weightValues0[offset] = slot === 0 ? weights0.getX(vertex) : slot === 1 ? weights0.getY(vertex) : slot === 2 ? weights0.getZ(vertex) : weights0.getW(vertex)
        weightValues1[offset] = slot === 0 ? weights1.getX(vertex) : slot === 1 ? weights1.getY(vertex) : slot === 2 ? weights1.getZ(vertex) : weights1.getW(vertex)
      }
      mesh.geometry.setAttribute('skinWeight', new Float32BufferAttribute(weightValues0, 4))
      mesh.geometry.setAttribute('skinIndex1', new Uint16BufferAttribute(jointValues, 4))
      mesh.geometry.setAttribute('skinWeight1', new Float32BufferAttribute(weightValues1, 4))
    }
    gltf.scene.animations = gltf.animations
    return gltf.scene
  }
  throw new TypeError('Model rebinding supports imported FBX and self-contained glTF/GLB assets')
}

export function weightedSourceBones(root: Group): string[] {
  const names = new Set<string>()
  root.traverse((node) => {
    const mesh = node as SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight')
    const indices1 = mesh.geometry.getAttribute('skinIndex1'), weights1 = mesh.geometry.getAttribute('skinWeight1')
    if (!indices || !weights || indices.itemSize !== 4 || weights.itemSize !== 4 || indices.count !== weights.count ||
        (!!indices1 !== !!weights1) || indices1 && (indices1.itemSize !== 4 || weights1!.itemSize !== 4 || indices1.count !== indices.count || weights1!.count !== indices.count) ||
        mesh.geometry.getAttribute('skinIndex2') || mesh.geometry.getAttribute('skinWeight2')) throw new TypeError(`Mesh ${mesh.name || '(unnamed)'} needs matching primary and optional secondary four-influence sets`)
    for (const [indexSet, weightSet] of [[indices, weights], ...(indices1 ? [[indices1, weights1!] as const] : [])] as const) {
      for (let vertex = 0; vertex < indexSet.count; vertex++) for (let slot = 0; slot < 4; slot++) {
        if (weightSet.getComponent(vertex, slot) > 0) {
          const bone = mesh.skeleton.bones[indexSet.getComponent(vertex, slot)]
          if (!bone?.name) throw new TypeError(`Mesh ${mesh.name || '(unnamed)'} references a missing/unnamed skin joint`)
          names.add(bone.name)
        }
      }
    }
  })
  if (!names.size) throw new TypeError('Source model has no weighted skinned mesh')
  return [...names].sort((a, b) => a.localeCompare(b))
}

export function mappedSkinOwners(mapping: SkeletonMapping, sourceProfile: SkeletonProfile, targetProfile: SkeletonProfile): Record<string, string> {
  const sourceById = new Map(sourceProfile.bones.map((bone) => [bone.id, bone.name])), targetById = new Map(targetProfile.bones.map((bone) => [bone.id, bone.name]))
  return Object.fromEntries(mapping.pairs.filter((pair) => pair.enabled).flatMap((pair) => {
    const targetName = targetById.get(pair.targetBoneId)
    return targetName ? (pair.sourceBoneIds ?? [pair.sourceBoneId]).flatMap((sourceId) => {
      const sourceName = sourceById.get(sourceId)
      return sourceName ? [[sourceName, targetName]] : []
    }) : []
  }))
}

export function makeCanonicalSkeleton(profile: SkeletonProfile): Group {
  if (!isMixamo65Topology(profile.bones)) throw new TypeError('Select a canonical Mixamo65 receiver profile')
  const root = new Group(), bones = new Map(profile.bones.map((item) => [item.id, new Bone()]))
  for (const item of profile.bones) {
    const bone = bones.get(item.id)!
    bone.name = item.name
    const rest = item.rest as { position: number[]; rotation: number[]; scale: number[] }
    if (rest.position.length !== 3 || rest.rotation.length !== 4 || rest.scale.length !== 3 || [...rest.position, ...rest.rotation, ...rest.scale].some((value) => !Number.isFinite(value))) throw new TypeError(`Invalid receiver rest transform for ${item.name}`)
    bone.position.fromArray(rest.position); bone.quaternion.fromArray(rest.rotation).normalize(); bone.scale.fromArray(rest.scale)
    const parent = item.parentId ? bones.get(item.parentId) : null
    if (item.parentId && !parent) throw new TypeError(`Receiver parent is missing for ${item.name}`)
    ;(parent ?? root).add(bone)
  }
  const basis = sceneBasisMatrix(profile.basisToScene).multiply(new Matrix4().makeScale(profile.metersPerUnit, profile.metersPerUnit, profile.metersPerUnit))
  root.applyMatrix4(basis); root.updateMatrixWorld(true)
  return root
}

export function canonicalizeClip(clip: AnimationClip, root: Group, target: SkeletonProfile): AnimationClip {
  const byIdentity = new Map<string, string>(), bones = new Set(target.bones.map((bone) => bone.name))
  root.traverse((node) => { byIdentity.set(node.uuid, node.name); if (node.name) byIdentity.set(node.name, node.name) })
  const output = clip.clone()
  for (const track of output.tracks) {
    const binding = PropertyBinding.parseTrackName(track.name), name = byIdentity.get(binding.nodeName)
    if (!name || !bones.has(name) || binding.objectName || binding.propertyIndex !== undefined || !['position', 'quaternion', 'scale'].includes(binding.propertyName)) throw new TypeError(`Motion track cannot be resolved to a canonical joint: ${track.name}`)
    track.name = `${name}.${binding.propertyName}`
  }
  return output
}

export function rebindAndExport(source: Group, sourceProfile: SkeletonProfile, targetProfile: SkeletonProfile, mapping: SkeletonMapping, ownersBySourceName: Readonly<Record<string, string>>, clip: AnimationClip) {
  if (mapping.sourceProfileId !== sourceProfile.id || mapping.targetProfileId !== targetProfile.id ||
      mapping.sourceFingerprint !== sourceProfile.fingerprint || mapping.targetFingerprint !== targetProfile.fingerprint) throw new TypeError('Saved mapping does not match the selected source and target profiles')
  const owners = new Map(Object.entries(mappedSkinOwners(mapping, sourceProfile, targetProfile)))
  for (const [sourceName, targetName] of Object.entries(ownersBySourceName)) owners.set(sourceName, targetName)
  const weighted = weightedSourceBones(source), missing = weighted.filter((name) => !owners.has(name))
  if (missing.length) throw new TypeError(`Choose a Mixamo65 skin owner for every weighted source joint: ${missing.join(', ')}`)
  const sourceBasis = sceneBasisMatrix(sourceProfile.basisToScene).multiply(new Matrix4().makeScale(sourceProfile.metersPerUnit, sourceProfile.metersPerUnit, sourceProfile.metersPerUnit))
  source.applyMatrix4(sourceBasis); source.updateMatrixWorld(true)
  const receiver = makeCanonicalSkeleton(targetProfile)
  const rebound = rebindCanonicalModel(source, receiver, owners)
  return exportCanonicalModel(rebound.model, [clip]).then((bytes) => ({ bytes, report: { ...rebound.report, sourceProfileId: sourceProfile.id,
    targetProfileId: targetProfile.id, mappingId: mapping.id, weightedSourceJoints: weighted.length, ownerCount: owners.size, actionName: clip.name, durationSeconds: clip.duration } }))
}
