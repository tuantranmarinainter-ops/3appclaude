import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { filmPoseViewDelta } from '../filmPoseView'
import { Stage } from '../../core/Stage'
import { makeEmptyDraft } from '../../../contract/emptyDraft'

const oraclePath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../apps/studio/src/unifiedFilmSampling.ts')
const { turnFilmSkeletonsByRotationKeys } = await import(pathToFileURL(oraclePath).href)

function scene(overrides: Record<string, unknown> = {}) {
  return {
    nodes: [{ id: 'actor', transform: { rotation: { x: 13, y: -27, z: 41 } } }],
    timeline: { animation: {
      motionClips: [{ target: { nodeId: 'actor' }, frameStart: 10, frameEnd: 30 }],
      pathMotionClips: [],
    } },
    fcurves: { evalScalar: (_id: string, _path: string, axis: number) => [72, 18, -35][axis]! },
    ...overrides,
  }
}

function maxDiff(a: readonly number[], b: readonly number[]) {
  return Math.max(...a.map((value, index) => Math.abs(value - b[index]!)))
}

describe('filmPoseViewDelta', () => {
  it('matches Studio film actor matrices with translated, rotated, scaled placements and root motion', () => {
    let worstMatrixElementError = 0
    for (const [position, rotation, scale, trajectory] of [
      [[3, -2, 7], [0.2, -0.7, 1.1], [1, 1, 1], [0.4, 0.1, -0.2]],
      [[-8, 4, 1], [-1.2, 0.4, -0.3], [2.4, 0.65, 1.3], [-0.1, 0.8, 0.2]],
      [[0, 0, 0], [2.3, 1.8, -2.1], [0.8, 1.7, 2.2], [0.2, -0.4, 0.5]],
    ] as const) {
      const parent = new THREE.Matrix4().compose(
        new THREE.Vector3(-1, 2, 5), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.31, -0.52, 0.17)), new THREE.Vector3(1.2, 0.9, 1.4),
      )
      const localPlacement = new THREE.Matrix4().compose(
        new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale),
      )
      const placement = parent.clone().multiply(localPlacement)
      const trajectoryMatrix = new THREE.Matrix4().makeTranslation(trajectory[0], trajectory[1], trajectory[2])
        .multiply(new THREE.Matrix4().makeRotationY(0.38))
      const actor = placement.clone().multiply(trajectoryMatrix)
      const sample = { frame: 20, side: 'right' as const, skeletonSamples: [{
        nodeId: 'actor', placementMatrix: placement.toArray(), actorWorldMatrix: actor.toArray(),
        bones: [{ name: 'root', worldMatrix: actor.clone().multiply(new THREE.Matrix4().makeTranslation(0.2, 1, -0.3)).toArray() }],
      }] }
      turnFilmSkeletonsByRotationKeys(scene() as never, sample as never)
      const delta = filmPoseViewDelta(scene() as never, 'actor', 20, 'right', placement)!
      const expected = new THREE.Matrix4().fromArray(sample.skeletonSamples[0]!.actorWorldMatrix)
      const actual = delta.clone().multiply(actor)
      const actorError = maxDiff(actual.toArray(), expected.toArray())
      worstMatrixElementError = Math.max(worstMatrixElementError, actorError)
      expect(actorError).toBeLessThanOrEqual(1e-9)
      const expectedBone = new THREE.Matrix4().fromArray(sample.skeletonSamples[0]!.bones[0]!.worldMatrix)
      const sourceBone = actor.clone().multiply(new THREE.Matrix4().makeTranslation(0.2, 1, -0.3))
      const boneError = maxDiff(delta.clone().multiply(sourceBone).toArray(), expectedBone.toArray())
      worstMatrixElementError = Math.max(worstMatrixElementError, boneError)
      expect(boneError).toBeLessThanOrEqual(1e-9)
    }
    console.info(`filmPoseView Studio oracle max matrix element error: ${worstMatrixElementError}`)
  })

  it('uses film boundary ownership and skips path-tangent motion without mutating its placement', () => {
    const placement = new THREE.Matrix4().makeTranslation(4, 2, -3)
    const original = placement.toArray()
    const active = scene() as never
    expect(filmPoseViewDelta(active, 'actor', 10, 'left', placement)).toBeNull()
    expect(filmPoseViewDelta(active, 'actor', 10, 'right', placement)).not.toBeNull()
    expect(filmPoseViewDelta(active, 'actor', 31, 'right', placement)).toBeNull()
    expect(filmPoseViewDelta(active, 'actor', 31, 'left', placement)).not.toBeNull()
    const path = scene({ timeline: { animation: {
      motionClips: [{ target: { nodeId: 'actor' }, frameStart: 0, frameEnd: 40 }],
      pathMotionClips: [{ target: { nodeId: 'actor' }, facing: 'path-tangent' }],
    } } }) as never
    expect(filmPoseViewDelta(path, 'actor', 20, 'right', placement)).toBeNull()
    expect(placement.toArray()).toEqual(original)
  })

  it('returns no turn when the key is inactive, preserving the evaluated root matrix', () => {
    const placement = new THREE.Matrix4().compose(new THREE.Vector3(2, 3, 4), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.2, -0.9)), new THREE.Vector3(1.5, 0.8, 2))
    const rootBefore = placement.toArray()
    const snapshot = { transforms: new Map([['actor', { rotation: { x: 1, y: 2, z: 3 } }]]) }
    const snapshotBefore = structuredClone(snapshot)
    const delta = filmPoseViewDelta(scene() as never, 'actor', 40, 'right', placement)
    const rootAfter = (delta ? delta.clone().multiply(placement) : placement).toArray()
    expect(delta).toBeNull()
    expect(rootAfter).toEqual(rootBefore)
    expect(snapshot).toEqual(snapshotBefore)
  })

  it('applies the turn through Stage and restores it immediately when BBS look turns off', () => {
    const stage = new Stage(() => '')
    stage.invalidate = () => {}
    const doc = makeEmptyDraft('film pose view', 30, 60)
    const node = {
      id: 'actor', type: 'character', name: 'Actor', visible: true, locked: false, parentId: null,
      transform: { position: { x: 2, y: 1, z: -4 }, rotation: { x: 13, y: -27, z: 41 }, scale: { x: 1.4, y: 0.75, z: 2 } },
      character: { appearance: { color: '#cccccc' }, label: { showLabel: false } },
    }
    doc.content.nodes.push(node as never)
    doc.content.timeline.animation.motionClips.push({
      id: 'motion', target: { nodeId: 'actor' }, frameStart: 0, frameEnd: 30,
      motion: { assetId: 'motion' }, playback: { loop: false },
    } as never)
    const root = new THREE.Group()
    root.name = 'root'
    root.position.set(7, -2, 3)
    root.rotation.set(0.3, -0.5, 0.2)
    root.scale.set(1.2, 0.8, 1.6)
    const motionRoot = new THREE.Group()
    motionRoot.matrixAutoUpdate = false
    motionRoot.matrix.makeTranslation(0.4, 0.1, -0.2).multiply(new THREE.Matrix4().makeRotationY(0.4))
    const inner = new THREE.Group()
    motionRoot.add(inner)
    root.add(motionRoot)
    root.userData.t3dLook = '#cccccc|false|Actor|0.7|0'
    const parent = new THREE.Group()
    parent.position.set(-1, 2, 5)
    parent.rotation.set(0.31, -0.52, 0.17)
    parent.scale.set(1.2, 0.9, 1.4)
    parent.add(root)
    stage.scene.add(parent)
    const character = {
      root, motionRoot, inner, node: node as never, rig: 'direct',
      animator: { stopAll() {} }, poseCache: null, restPose: new Map(), restPos: new Map(),
      motionRootDelta: null,
    }
    stage.characters.set('actor', character as never)
    stage.doc = doc
    stage.fcurves = { evalScalar: (_id: string, _path: string, axis: number) => [72, 18, -35][axis]! } as never
    const snapshot = {
      frame: 20, transforms: new Map([['actor', structuredClone(node.transform)]]), poses: new Map(),
      motionPlayback: [], camera: null,
    }
    stage.applySnapshot(snapshot as never)
    stage.scene.updateMatrixWorld(true)
    const placement = root.matrixWorld.clone()
    const baselineRoot = root.matrix.clone()
    const baselineMotion = motionRoot.matrix.clone()
    const baselineActor = motionRoot.matrixWorld.clone()
    stage.setBbsLook(true)
    stage.applySnapshot(snapshot as never)
    stage.scene.updateMatrixWorld(true)
    // The actual actor must reflect the evaluated key and leave the reusable snapshot untouched.
    const expectedDelta = filmPoseViewDelta(scene({ nodes: [node], timeline: doc.content.timeline }) as never, 'actor', 20, undefined, placement)!
    const expectedActor = expectedDelta.clone().multiply(baselineActor)
    expect(maxDiff(motionRoot.matrixWorld.toArray(), expectedActor.toArray())).toBeLessThanOrEqual(1e-9)
    expect(snapshot.transforms.get('actor')).toEqual(node.transform)
    stage.applySnapshot(snapshot as never)
    stage.scene.updateMatrixWorld(true)
    expect(maxDiff(motionRoot.matrixWorld.toArray(), expectedActor.toArray())).toBeLessThanOrEqual(1e-9)
    stage.setBbsLook(false)
    stage.scene.updateMatrixWorld(true)
    expect(maxDiff(root.matrix.toArray(), baselineRoot.toArray())).toBeLessThanOrEqual(1e-9)
    expect(maxDiff(motionRoot.matrix.toArray(), baselineMotion.toArray())).toBeLessThanOrEqual(1e-9)
    expect(maxDiff(motionRoot.matrixWorld.toArray(), baselineActor.toArray())).toBeLessThanOrEqual(1e-9)
    expect(stage.bbsLook).toBe(false)
  })

  it('conjugates the fallback root turn through a parent and restores its local matrix', () => {
    const stage = new Stage(() => '')
    stage.invalidate = () => {}
    const doc = makeEmptyDraft('fallback pose view', 30, 60)
    const node = {
      id: 'actor', type: 'character', name: 'Actor', visible: true, locked: false, parentId: null,
      transform: { position: { x: 2, y: 1, z: -4 }, rotation: { x: 13, y: -27, z: 41 }, scale: { x: 1.4, y: 0.75, z: 2 } },
      character: { appearance: { color: '#cccccc' }, label: { showLabel: false } },
    }
    doc.content.nodes.push(node as never)
    doc.content.timeline.animation.motionClips.push({
      id: 'motion', target: { nodeId: 'actor' }, frameStart: 0, frameEnd: 30,
      motion: { assetId: 'motion' }, playback: { loop: false },
    } as never)
    const parent = new THREE.Group()
    parent.position.set(-1, 2, 5)
    parent.rotation.set(0.31, -0.52, 0.17)
    parent.scale.set(1.2, 0.9, 1.4)
    const root = new THREE.Group()
    root.position.set(node.transform.position.x, node.transform.position.y, node.transform.position.z)
    root.rotation.set(13 * Math.PI / 180, -27 * Math.PI / 180, 41 * Math.PI / 180)
    root.scale.set(node.transform.scale.x, node.transform.scale.y, node.transform.scale.z)
    root.updateMatrix()
    root.matrixAutoUpdate = false
    const inner = new THREE.Group()
    root.add(inner)
    root.userData.t3dLook = '#cccccc|false|Actor|0.7|0'
    parent.add(root)
    stage.scene.add(parent)
    stage.characters.set('actor', {
      root, inner, node: node as never, rig: 'ual1', animator: { stopAll() {} }, poseCache: null,
      restPose: new Map(), restPos: new Map(),
    } as never)
    stage.doc = doc
    stage.fcurves = { evalScalar: (_id: string, _path: string, axis: number) => [72, 18, -35][axis]! } as never
    const snapshot = {
      frame: 20, transforms: new Map([['actor', structuredClone(node.transform)]]), poses: new Map(),
      motionPlayback: [], camera: null,
    }
    stage.applySnapshot(snapshot as never)
    stage.scene.updateMatrixWorld(true)
    const baselineLocal = root.matrix.clone()
    const baselineWorld = root.matrixWorld.clone()
    const delta = filmPoseViewDelta(scene({ nodes: [node], timeline: doc.content.timeline }) as never, 'actor', 20, undefined, baselineWorld)!
    stage.setBbsLook(true)
    stage.applySnapshot(snapshot as never)
    stage.scene.updateMatrixWorld(true)
    expect(maxDiff(root.matrixWorld.toArray(), delta.clone().multiply(baselineWorld).toArray()),
      `actual=${root.matrixWorld.toArray()} expected=${delta.clone().multiply(baselineWorld).toArray()}`).toBeLessThanOrEqual(1e-9)
    expect(root.matrixAutoUpdate).toBe(false)
    stage.applySnapshot(snapshot as never)
    stage.scene.updateMatrixWorld(true)
    expect(maxDiff(root.matrixWorld.toArray(), delta.clone().multiply(baselineWorld).toArray())).toBeLessThanOrEqual(1e-9)
    stage.setBbsLook(false)
    stage.scene.updateMatrixWorld(true)
    expect(root.matrixAutoUpdate).toBe(false)
    expect(maxDiff(root.matrix.toArray(), baselineLocal.toArray())).toBeLessThanOrEqual(1e-9)
    expect(maxDiff(root.matrixWorld.toArray(), baselineWorld.toArray())).toBeLessThanOrEqual(1e-9)
  })
})
