import { AnimationMixer, LoopOnce, Matrix4, PropertyBinding, type Bone, type Object3D, type SkinnedMesh } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import type { RetargetPoseBone, RetargetRig } from './universal'

export interface ThreeRigAdapterOptions {
  fingerprint: string
  sourceToScene?: readonly number[]
  jointNames?: readonly string[]
  jointUUIDs?: readonly string[]
  /** Collect per-Action diagnostics for inspection without making other Actions unusable. */
  collectUnsupportedTracks?: boolean
}

export interface ThreeRigActionIssue { code: string; trackName: string; message: string }

function actionIssue(error: unknown, trackName: string): ThreeRigActionIssue {
  const message = error instanceof Error ? error.message : String(error)
  const code = message.startsWith('Ambiguous animation node:') ? 'AMBIGUOUS_ANIMATION_NODE'
    : message.startsWith('Unsupported animation binding:') ? 'UNSUPPORTED_BINDING'
      : message.startsWith('Animation channel outside selected rig') ? 'TRACK_OUTSIDE_SELECTED_RIG' : 'INVALID_TRACK'
  return { code, trackName, message }
}

/** Operates on a private clone; loading files and resolving URLs remain the host's responsibility. */
export function createThreeRigAdapter(source: Object3D, options: ThreeRigAdapterOptions) {
  if (!options.fingerprint || source.parent) throw new TypeError('A source fingerprint and detached asset root are required')
  const basis = new Matrix4()
  if (options.sourceToScene) {
    if (options.sourceToScene.length !== 16 || options.sourceToScene.some((value) => !Number.isFinite(value))) throw new TypeError('Source normalization must be a finite 4x4 matrix')
    basis.fromArray(options.sourceToScene)
    if (!(basis.determinant() > 0) || [3, 7, 11].some((index) => Math.abs(basis.elements[index]!) > 1e-10) || Math.abs(basis.elements[15]! - 1) > 1e-10) throw new TypeError('Source normalization must be affine and orientation-preserving')
    const columns = [0, 4, 8].map((offset) => basis.elements.slice(offset, offset + 3))
    const lengths = columns.map((column) => Math.hypot(...column))
    if (lengths.some((length) => Math.abs(length / lengths[0]! - 1) > 1e-6) || columns.some((column, index) => columns.slice(index + 1).some((other) => Math.abs(column.reduce((sum, value, axis) => sum + value * other[axis]!, 0) / lengths[index]! ** 2) > 1e-6))) throw new TypeError('Source normalization must use uniform units without shear')
  }
  const root = clone(source)
  const sourceNodes: Object3D[] = []
  source.traverse((node) => sourceNodes.push(node))
  const allNodes: Object3D[] = []
  root.traverse((node) => allNodes.push(node))
  const clonedUUIDs = new Map(sourceNodes.map((node, index) => [node.uuid, allNodes[index]!.uuid]))
  const clonedNodesBySourceUUID = new Map(sourceNodes.map((node, index) => [node.uuid, allNodes[index]!]))
  const indices = new Map(allNodes.map((node, index) => [node, `node:${index}`]))
  const joints = new Set<Object3D>()
  const skeletons = new Map<string, SkinnedMesh['skeleton']>()
  root.traverse((node) => {
    const mesh = node as SkinnedMesh
    if (mesh.isSkinnedMesh) skeletons.set(mesh.skeleton.bones.map((bone) => indices.get(bone)).join('|'), mesh.skeleton)
  })
  if (skeletons.size > 1 && !options.jointUUIDs) throw new TypeError('Multiple distinct skeletons require explicit selection before normalization')
  if (options.jointUUIDs) {
    if (!options.jointUUIDs.length || new Set(options.jointUUIDs).size !== options.jointUUIDs.length) throw new TypeError('Animation skeleton node UUIDs must be nonempty and unique')
    for (const uuid of options.jointUUIDs) {
      const node = clonedNodesBySourceUUID.get(uuid)
      if (!node) throw new TypeError(`Selected skeleton node is missing: ${uuid}`)
      joints.add(node)
    }
    const matchingSkeletons = [...skeletons.values()].filter((skeleton) => options.jointUUIDs!.every((uuid) => {
      const selected = clonedNodesBySourceUUID.get(uuid)
      return !!selected && skeleton.bones.includes(selected as Bone)
    }))
    if (skeletons.size && matchingSkeletons.length !== 1) throw new TypeError('Selected node identities do not match exactly one imported skeleton')
    matchingSkeletons[0]?.pose()
  } else if (options.jointNames) {
    if (!options.jointNames.length || new Set(options.jointNames).size !== options.jointNames.length) throw new TypeError('Animation-only joint names must be nonempty and unique')
    for (const name of options.jointNames) {
      const matches = allNodes.filter((node) => node.name === name)
      if (matches.length !== 1) throw new TypeError(`Animation-only joint is missing or ambiguous: ${name}`)
      joints.add(matches[0]!)
    }
  } else if (skeletons.size) {
    const skeleton = skeletons.values().next().value as SkinnedMesh['skeleton'] | undefined
    skeleton?.pose()
    if (skeleton) for (const bone of skeleton.bones) joints.add(bone)
  } else {
    for (const node of allNodes) if ((node as Bone).isBone) joints.add(node)
  }
  if (!joints.size) throw new TypeError('Source has no skeleton; animation-only nodes require explicit joint names')
  const retained = new Set<Object3D>()
  for (const joint of joints) {
    let ancestor: Object3D | null = joint
    while (ancestor && !retained.has(ancestor)) { retained.add(ancestor); ancestor = ancestor.parent }
  }
  const nodes = allNodes.filter((node) => retained.has(node))
  const nodeIdsBySourceUUID = new Map<string, string>()
  sourceNodes.forEach((node, index) => {
    const adapterId = indices.get(allNodes[index]!)
    if (adapterId && retained.has(allNodes[index]!)) nodeIdsBySourceUUID.set(node.uuid, adapterId)
  })
  root.updateMatrixWorld(true)
  const world = (node: Object3D) => basis.clone().multiply(node.matrixWorld).toArray()
  const rig: RetargetRig = { fingerprint: options.fingerprint, bones: nodes.map((node) => ({
    id: indices.get(node)!, name: node.name, parentId: node.parent ? indices.get(node.parent)! : null, restWorld: world(node),
  })) }
  const initial = allNodes.map((node) => ({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() }))
  const clips = source.animations.map((clip) => clip.clone())
  const issuesByAction: ThreeRigActionIssue[][] = []
  const channels = clips.map((clip, clipIndex) => {
    const issues: ThreeRigActionIssue[] = []
    if (!Number.isFinite(clip.duration) || clip.duration < 0 || !clip.validate()) {
      const error = new TypeError(`Invalid animation clip ${clipIndex}`)
      if (!options.collectUnsupportedTracks) throw error
      issues.push(actionIssue(error, clip.name || `Clip ${clipIndex + 1}`))
      issuesByAction.push(issues)
      return []
    }
    const supported: Array<{ nodeId: string; property: string; trackName: string }> = []
    for (const track of clip.tracks) {
      try {
      let binding = PropertyBinding.parseTrackName(track.name)
      const clonedUUID = clonedUUIDs.get(binding.nodeName)
      if (clonedUUID) {
        track.name = clonedUUID + track.name.slice(binding.nodeName.length)
        binding = PropertyBinding.parseTrackName(track.name)
      }
      if (allNodes.filter((node) => node.name && node.name === binding.nodeName).length > 1) throw new TypeError(`Ambiguous animation node: ${track.name}`)
      let node = PropertyBinding.findNode(root, binding.nodeName) as Object3D | null
      if (binding.objectName === 'bones' && binding.objectIndex !== undefined) {
        const skeleton = (node as SkinnedMesh | null)?.skeleton
        node = skeleton?.getBoneByName(String(binding.objectIndex)) ?? null
      } else if (binding.objectName || binding.propertyIndex !== undefined) throw new TypeError(`Unsupported animation binding: ${track.name}`)
      if (!node || !retained.has(node) || !['position', 'quaternion', 'scale'].includes(binding.propertyName)) throw new TypeError(`Animation channel outside selected rig or unsupported: ${track.name}`)
      supported.push({ nodeId: indices.get(node)!, property: binding.propertyName, trackName: track.name })
      } catch (error) {
        if (!options.collectUnsupportedTracks) throw error
        issues.push(actionIssue(error, track.name))
      }
    }
    issuesByAction.push(issues)
    return supported
  })
  const mixer = new AnimationMixer(root)
  let disposed = false
  return {
    rig,
    nodeIdsBySourceUUID,
    joints: nodes.filter((node) => joints.has(node)).map((node) => indices.get(node)!),
    actions: clips.map((clip, index) => ({ index, name: clip.name, durationSeconds: clip.duration, channels: channels[index]!,
      totalTrackCount: clip.tracks.length, issues: issuesByAction[index]!, ready: issuesByAction[index]!.length === 0 })),
    sample(actionIndex: number, timeSeconds: number): RetargetPoseBone[] {
      if (disposed) throw new TypeError('Rig adapter has been disposed')
      const clip = clips[actionIndex]
      if (!Number.isInteger(actionIndex) || !clip || !Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > clip.duration) throw new RangeError('Select an existing action and a time within its duration')
      if (issuesByAction[actionIndex]!.length) throw new TypeError(`Action has unsupported channels: ${issuesByAction[actionIndex]!.map((issue) => issue.code).join(', ')}`)
      mixer.stopAllAction()
      for (const saved of initial) {
        saved.node.position.copy(saved.position); saved.node.quaternion.copy(saved.quaternion); saved.node.scale.copy(saved.scale)
      }
      const action = mixer.clipAction(clip).reset().setLoop(LoopOnce, 1)
      action.clampWhenFinished = true
      action.play()
      mixer.setTime(timeSeconds)
      root.updateMatrixWorld(true)
      return nodes.map((node) => ({ id: indices.get(node)!, world: world(node) }))
    },
    dispose() {
      mixer.stopAllAction(); mixer.uncacheRoot(root); disposed = true
    },
  }
}
