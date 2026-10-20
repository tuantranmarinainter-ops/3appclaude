import { Float32BufferAttribute, Group, Matrix4, PropertyBinding, Skeleton, Uint16BufferAttribute, Vector3, type Bone, type Object3D, type SkinnedMesh } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { isMixamo65Topology } from './mixamo65'
import { transferSkinWeights } from './universalSkin'

/** Inputs must share normalized coordinates. Returns a private rest model; animation is assigned separately. */
export function rebindCanonicalModel(source: Object3D, receiver: Object3D, owners: ReadonlyMap<string, string>) {
  if (source.parent || receiver.parent) throw new TypeError('Rebinding requires detached normalized model roots')
  const model = clone(source), target = clone(receiver), root = new Group()
  target.traverse((node) => { if ('isMesh' in node && node.isMesh) throw new TypeError('Pass a skeleton-only receiver; receiver meshes require explicit asset selection') })
  const targetBones: Bone[] = []
  target.traverse((node) => { if ((node as Bone).isBone) targetBones.push(node as Bone) })
  const names = new Map(targetBones.map((bone) => [bone.name, bone]))
  if (names.size !== targetBones.length || !isMixamo65Topology(targetBones.map((bone) => ({ id: bone.uuid, name: bone.name, parentId: (bone.parent as Bone)?.isBone ? bone.parent!.uuid : null })))) throw new TypeError('Receiver must contain exactly one canonical65 skeleton with unique joint names')
  const meshes: SkinnedMesh[] = []
  model.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) meshes.push(node as SkinnedMesh) })
  if (!meshes.length) throw new TypeError('Source model has no skinned meshes')
  const skeletons = new Set(meshes.map((mesh) => mesh.skeleton))
  if (skeletons.size !== 1) throw new TypeError('Multiple source skeletons require explicit component selection')
  for (const skeleton of skeletons) skeleton.pose()
  root.add(model, target); root.updateMatrixWorld(true)
  const targetSkeleton = new Skeleton(targetBones)
  targetSkeleton.calculateInverses()
  let vertices = 0, maxRestError = 0
  const reports: Array<{ mesh: string; vertices: number; droppedWeight: number; affectedVertices: number }> = []
  for (const mesh of meshes) {
    const geometry = mesh.geometry.clone(), position = geometry.getAttribute('position'), indices = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight')
    const indices1 = geometry.getAttribute('skinIndex1'), weights1 = geometry.getAttribute('skinWeight1')
    if (!position || !indices || !weights || indices.itemSize !== 4 || weights.itemSize !== 4 || position.count !== indices.count || indices.count !== weights.count ||
        (!!indices1 !== !!weights1) || indices1 && (indices1.itemSize !== 4 || weights1!.itemSize !== 4 || indices1.count !== position.count || weights1!.count !== position.count) ||
        geometry.getAttribute('skinIndex2') || geometry.getAttribute('skinWeight2')) throw new TypeError('Skin attributes require matching four-wide primary and optional secondary influence sets')
    mesh.skeleton.update()
    const boneMatrices = mesh.skeleton.boneMatrices
    if (!boneMatrices) throw new TypeError('Source skeleton did not produce bone matrices')
    const sourceNames = mesh.skeleton.bones.map((bone) => bone.name)
    if (new Set(sourceNames).size !== sourceNames.length) throw new TypeError('Source joint names are ambiguous; resolve owners by unique identity before rebinding')
    const indexSets = [indices, ...(indices1 ? [indices1] : [])], weightSets = [weights, ...(weights1 ? [weights1] : [])]
    const originalPositions = Array.from({ length: position.count }, (_, vertex) => {
      const bindPosition = new Vector3().fromBufferAttribute(position, vertex).applyMatrix4(mesh.bindMatrix), skinned = new Vector3()
      let totalWeight = 0
      for (const [set, indexSet] of indexSets.entries()) for (let slot = 0; slot < 4; slot++) {
        const jointIndex = indexSet.getComponent(vertex, slot), weight = weightSets[set]!.getComponent(vertex, slot)
        if (!Number.isFinite(weight) || weight < 0) throw new TypeError(`Vertex ${vertex} has an invalid skin weight`)
        if (weight === 0) continue
        if (!Number.isInteger(jointIndex) || !sourceNames[jointIndex]) throw new TypeError(`Vertex ${vertex} references an invalid source joint index`)
        const boneMatrix = new Matrix4().fromArray(boneMatrices, jointIndex * 16)
        skinned.addScaledVector(bindPosition.clone().applyMatrix4(boneMatrix), weight)
        totalWeight += weight
      }
      if (Math.abs(totalWeight - 1) > 1e-3) throw new TypeError(`Vertex ${vertex} skin weights across influence sets must sum to 1`)
      return skinned.applyMatrix4(mesh.bindMatrixInverse)
    })
    const transfer = transferSkinWeights(Array.from({ length: position.count }, (_, vertex) => ({ influences: [indices, ...(indices1 ? [indices1] : [])].flatMap((indexSet, set) => {
      const weightSet = set === 0 ? weights : weights1!
      return Array.from({ length: 4 }, (_, slot) => {
        const jointIndex = indexSet.getComponent(vertex, slot), weight = weightSet.getComponent(vertex, slot)
        if (weight > 0 && (!Number.isInteger(jointIndex) || !sourceNames[jointIndex])) throw new TypeError('Skin references an invalid source joint index')
        return { boneId: sourceNames[jointIndex] ?? '', weight }
      }).filter((item) => item.weight !== 0)
    }) })), owners, 4)
    const newIndices: number[] = [], newWeights: number[] = []
    for (const vertex of transfer.vertices) {
      const slots = vertex.influences.map((influence) => {
        const bone = names.get(influence.boneId)
        if (!bone) throw new TypeError(`Skin owner is not a receiver joint: ${influence.boneId}`)
        return { index: targetBones.indexOf(bone), weight: influence.weight }
      })
      for (let slot = 0; slot < 4; slot++) { newIndices.push(slots[slot]?.index ?? 0); newWeights.push(slots[slot]?.weight ?? 0) }
    }
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(newIndices, 4)); geometry.setAttribute('skinWeight', new Float32BufferAttribute(newWeights, 4))
    geometry.deleteAttribute('skinIndex1'); geometry.deleteAttribute('skinWeight1')
    mesh.geometry = geometry; mesh.bind(targetSkeleton, mesh.matrixWorld.clone()); mesh.skeleton.update()
    for (let vertex = 0; vertex < position.count; vertex++) {
      const error = mesh.applyBoneTransform(vertex, new Vector3().fromBufferAttribute(position, vertex)).distanceTo(originalPositions[vertex]!)
      if (!Number.isFinite(error) || error > 1e-5 * Math.max(1, originalPositions[vertex]!.length())) throw new TypeError('Rest mesh drift exceeds rebinding tolerance')
      maxRestError = Math.max(maxRestError, error)
    }
    vertices += position.count
    reports.push({ mesh: mesh.name, vertices: position.count, droppedWeight: transfer.droppedWeight, affectedVertices: transfer.affectedVertices })
  }
  const targetNames = new Set(targetBones.map((bone) => PropertyBinding.sanitizeNodeName(bone.name)))
  const renamedSourceNodes: Array<{ originalName: string; outputName: string }> = []
  model.traverse((node) => {
    if (targetNames.has(PropertyBinding.sanitizeNodeName(node.name))) {
      const originalName = node.name
      node.name = `__source_${node.uuid}`
      node.userData.normalizationOriginalName = originalName
      renamedSourceNodes.push({ originalName, outputName: node.name })
    }
  })
  return { model: root, report: { vertices, targetJoints: targetBones.length, maxRestError, meshes: reports, renamedSourceNodes } }
}
