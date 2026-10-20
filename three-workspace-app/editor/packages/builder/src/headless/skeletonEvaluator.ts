import * as THREE from 'three'
import type { DirectorDocument } from '../contract/types'
import type { FrameSnapshot } from '../evaluate/FrameSnapshot'
import { fbxSourceBones } from '../evaluate/retarget/fbxSourceBones'
import { PoseLibraryBank } from '../data/poseLibraryBank'
import { buildCharacterRig } from '../engine/objects/CharacterObject'
import { MotionPlayer } from '../engine/objects/MotionPlayer'
import { applyMotionAndPose, applyRootTransforms } from '../engine/objects/applySnapshot'
import type { StageGraph } from '../engine/objects/graph'
export { sampleSkeletonRange } from './sampleSkeletonRange'
export type { SkeletonSampleRange, SkeletonRangeSample } from './sampleSkeletonRange'
export { sampleCameraSequence } from './sampleCameraSequence'
export type { CameraSequenceSample } from './sampleCameraSequence'

export interface SkeletonFrameSample {
  nodeId: string
  metersPerUnit: number
  placementMatrix: number[]
  trajectoryMatrix: number[]
  actorWorldMatrix: number[]
  bones: Array<{ name: string; position: number[]; rotation: number[]; scale: number[]; worldMatrix: number[] }>
}

/** CPU-only: caller owns loading; the same rig, animator and root sampler drive browser playback. */
export function createSkeletonEvaluator(
  document: DirectorDocument,
  models: ReadonlyMap<string, THREE.Object3D>,
  motions: ReadonlyMap<string, { group: THREE.Object3D; clipIndex: number }>,
) {
  const player = new MotionPlayer()
  for (const [id, motion] of motions) player.register(id, motion.group, motion.clipIndex)
  const graph: StageGraph = {
    doc: document, scene: new THREE.Scene(), motionPlayer: player, poseBank: new PoseLibraryBank(), resolveMediaUrl: () => '',
    nodeById: new Map(document.content.nodes.map((node) => [node.id, node])), characters: new Map(),
    cameras: new Map(), props: new Map(), groups: new Map(), primitives: new Map(), pathNodes: new Map(), snapshot: new Map(), invalidate() {},
  }
  for (const [id, model] of models) {
    const node = graph.nodeById.get(id)
    if (!node || node.type !== 'character' || node.metadata?.rig !== 'direct') throw new TypeError('Skeleton evaluation requires a direct Character node')
    const character = buildCharacterRig(node, model)
    graph.characters.set(id, character)
    graph.scene.add(character.root)
  }
  let disposed = false
  return {
    evaluate(snapshot: FrameSnapshot): SkeletonFrameSample[] {
      if (disposed) throw new Error('Skeleton evaluator was disposed')
      applyMotionAndPose(graph, snapshot)
      applyRootTransforms(graph, snapshot)
      graph.scene.updateMatrixWorld(true)
      const samples = [...graph.characters.values()].map((character) => ({
        nodeId: character.node.id,
        metersPerUnit: character.node.metadata?.modelUnitMeters ?? 1,
        placementMatrix: character.root.matrixWorld.toArray(),
        trajectoryMatrix: character.motionRoot?.matrix.toArray() ?? new THREE.Matrix4().toArray(),
        actorWorldMatrix: (character.motionRoot ?? character.root).matrixWorld.toArray(),
        bones: fbxSourceBones(character.inner).map((bone) => ({ name: bone.name, position: bone.position.toArray(),
          rotation: bone.quaternion.toArray(), scale: bone.scale.toArray(), worldMatrix: bone.matrixWorld.toArray() })),
      }))
      for (const value of samples) {
        const arrays = [value.placementMatrix, value.trajectoryMatrix, value.actorWorldMatrix,
          ...value.bones.flatMap((bone) => [bone.position, bone.rotation, bone.scale, bone.worldMatrix])]
        if (!arrays.every((array) => array.every(Number.isFinite))) throw new RangeError('Skeleton sample contains non-finite values')
      }
      return samples
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      for (const character of graph.characters.values()) {
        character.animator.stopAll()
        character.animator.mixer.uncacheRoot(character.inner)
        character.inner.traverse((object) => {
          const mesh = object as THREE.Mesh
          if (mesh.isMesh) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose()
        })
      }
      graph.characters.clear(); graph.scene.clear()
    },
  }
}
