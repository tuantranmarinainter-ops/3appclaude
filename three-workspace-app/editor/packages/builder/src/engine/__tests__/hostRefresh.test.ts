import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import * as THREE from 'three'
import { Stage } from '../core/Stage'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import { AssetLoader } from '../io/AssetLoader'
import { libraryAssetCacheKey } from '../io/libraryAssetCache'

const hash = 'a'.repeat(64)
const source = (project: string, digest = hash) => `/api/unified/projects/${project}/assets/sha256%3A${digest}/source`

test('content addresses reuse templates across projects; changing content does not reuse them', async () => {
  const first = new AssetLoader(() => '')
  let loads = 0
  first.loadGltf = async () => { loads++; return new THREE.Group() }
  const model = await first.loadCharacterTemplate(source('one'))
  first.clear()
  const second = new AssetLoader(() => '')
  second.loadGltf = async () => { loads++; return new THREE.Group() }
  assert.equal(await second.loadCharacterTemplate(source('two')), model)
  assert.notEqual(await second.loadCharacterTemplate(source('two', 'b'.repeat(64))), model)
  assert.equal(loads, 2)
  assert.equal(libraryAssetCacheKey('/api/library?modelCharacter=den'), null)
  assert.notEqual(libraryAssetCacheKey('/api/library?modelCharacter=den&fingerprint=one'), libraryAssetCacheKey('/api/library?modelCharacter=den&fingerprint=two'))
})

test('host refresh preserves unchanged runtime identity and editor camera; applies transform and deletion', async () => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const stage = new Stage(() => '')
  const doc = makeEmptyDraft('incremental', 30, 120)
  doc.content.nodes.push({ id: 'box', type: 'primitive', name: 'Box', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    primitive: { kind: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } },
  } as never)
  await stage.load(doc)
  stage.stopAmbient()
  const instance = stage.primitives.get('box')
  assert.ok(instance)
  const before = structuredClone(doc)
  stage.editorCamera.position.set(4, 5, 6)
  doc.content.nodes[0]!.transform.position.x = 7
  await stage.refreshDocument(before)
  assert.equal(stage.primitives.get('box'), instance)
  assert.equal(instance.position.x, 7)
  assert.deepEqual(stage.editorCamera.position.toArray(), [4, 5, 6])
  const previous = structuredClone(doc)
  doc.content.nodes = []
  await stage.refreshDocument(previous)
  assert.equal(stage.hasNode('box'), false)
  stage.dispose()
  vi.unstubAllGlobals()
})

test('shared skinned templates retain independent bones and materials, and survive eviction until both scenes close', async () => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const first = new AssetLoader(() => '')
  const second = new AssetLoader(() => '')
  const template = new THREE.Group()
  const bone = new THREE.Bone()
  const geometry = new THREE.BoxGeometry()
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() })
  const mesh = new THREE.SkinnedMesh(geometry, material)
  template.add(bone, mesh)
  mesh.bind(new THREE.Skeleton([bone]))
  let disposed = 0
  geometry.dispose = () => { disposed++ }
  first.loadGltf = async () => template
  const firstClone = await first.loadPropTemplate(source('skin', 'c'.repeat(64)))
  const secondClone = await second.loadPropTemplate(source('skin-two', 'c'.repeat(64)))
  const a = firstClone.children.find((child) => child instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh
  const b = secondClone.children.find((child) => child instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh
  assert.notEqual(a.skeleton.bones[0], b.skeleton.bones[0])
  a.skeleton.bones[0]!.position.x = 12
  assert.equal(b.skeleton.bones[0]!.position.x, 0)
  const { attachProp } = await import('../objects/PropObject')
  const firstStage = new Stage(() => '')
  const secondStage = new Stage(() => '')
  const node = { id: 'skin', type: 'prop', name: 'Skin', visible: true, locked: false,
    metadata: { preserveMaterials: true },
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  } as const
  attachProp(firstStage, node, firstClone)
  attachProp(secondStage, node, secondClone)
  assert.notEqual(a.material, b.material)
  for (let index = 0; index < 60; index++) {
    const filler = new AssetLoader(() => '')
    filler.loadGltf = async () => new THREE.Group()
    await filler.loadPropTemplate(source('filler', index.toString(16).padStart(64, '0')))
    filler.clear()
  }
  assert.equal(disposed, 0)
  // Disposing one scene cannot release geometry still used by the other scene.
  firstStage.dispose()
  first.clear()
  assert.equal(disposed, 0)
  secondStage.dispose()
  second.clear()
  assert.equal(disposed, 1)
  vi.unstubAllGlobals()
})

test('host Undo/Redo replaces content while preserving scene runtime, current frame and camera', async () => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const { StudioSession } = await import('../../sync/StudioSession')
  const { DirectorDoc } = await import('../../document/DirectorDoc')
  const { History } = await import('../../document/History')
  const { EditorStore } = await import('../../stores/EditorStore')
  const doc = makeEmptyDraft('host-history', 30, 120, {
    fov: 35, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 },
  })
  let next = structuredClone(doc)
  const stage = new Stage(() => '')
  const session = new StudioSession(stage, new DirectorDoc(), new EditorStore('host-history'), new History(), {
    loadDocument: async () => structuredClone(next), loadFCurves: async () => null,
  } as never)
  await session.loadDraft('host-history')
  const cameraNode = doc.content.nodes[0]!
  const camera = stage.cameras.get(cameraNode.id)
  stage.editorCamera.position.set(9, 8, 7)
  session.setFrame(42)
  next.content.nodes[0]!.transform.position.x = 3
  await session.reloadFromHost()
  assert.equal(stage.cameras.get(cameraNode.id), camera)
  assert.equal(stage.currentFrame, 42)
  assert.equal(session.editor.activeCameraId, cameraNode.id)
  assert.equal(stage.cameras.get(cameraNode.id)!.camera.position.x, 3)
  assert.deepEqual(stage.editorCamera.position.toArray(), [9, 8, 7])
  next = structuredClone(doc)
  await session.reloadFromHost()
  assert.equal(stage.cameras.get(cameraNode.id), camera)
  assert.equal(stage.cameras.get(cameraNode.id)!.camera.position.x, 0)
  assert.equal(session.dirty, false)
  stage.dispose()
  vi.unstubAllGlobals()
})

test('replacing a same-ID UAL1 motion updates the animated pose', async () => {
  const { Ual1Retargeter } = await import('../rig/applyRetarget')
  const source = new THREE.Group()
  const hips = new THREE.Bone()
  hips.name = 'mixamorigHips'
  hips.position.y = 100
  source.add(hips)
  const target = new THREE.Group()
  const pelvis = new THREE.Bone()
  pelvis.name = 'pelvis'
  pelvis.position.y = 1
  target.add(pelvis)
  const player = new Ual1Retargeter(target)
  const clip = (x: number) => new THREE.AnimationClip('motion', 1, [new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [x, 100, 0, x, 100, 0])])
  player.setClip('same', source, clip(100))
  player.apply(0.5)
  const first = pelvis.position.x
  pelvis.position.set(0, 1, 0)
  target.updateMatrixWorld(true)
  player.setClip('same', source, clip(200))
  player.apply(0.5)
  assert.ok(Math.abs(pelvis.position.x - first * 2) < 1e-6)
  assert.ok(first > 0)
})

test('same timeline clip ID starts its replacement animation action', async () => {
  const { CharacterAnimator } = await import('../objects/MotionPlayer')
  const root = new THREE.Group()
  const bone = new THREE.Bone()
  bone.name = 'Hips'
  root.add(bone)
  const animator = new CharacterAnimator(root)
  const clip = (x: number) => new THREE.AnimationClip('motion', 1, [new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [x, 0, 0, x, 0, 0])])
  animator.playAt('same', clip(1), 0.5)
  assert.equal(bone.position.x, 1)
  animator.playAt('same', clip(2), 0.5)
  assert.equal(bone.position.x, 2)
})
