import assert from 'node:assert/strict'
import test from 'node:test'
import { AnimationClip, AnimationMixer, Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Quaternion, QuaternionKeyframeTrack, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { rebindCanonicalModel } from '../src/rebindCanonicalModel.ts'
import { exportCanonicalModel } from '../src/exportCanonicalModel.ts'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

function fixture() {
  const source = new Group(), bone = new Bone(); bone.name = 'SourceRoot'; bone.position.y = 2; source.add(bone)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 2, 0, 1, 3, 0], 3))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0], 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0], 4))
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial()); mesh.name = 'Body'; source.add(mesh)
  source.updateMatrixWorld(true); mesh.bind(new Skeleton([bone]))
  const target = new Group(), bones = new Map<string, Bone>()
  for (const [name, parent] of MIXAMO65_BONE_PARENTS) { const joint = new Bone(); joint.name = name; joint.position.y = parent ? 0.2 : 1; (parent ? bones.get(parent)! : target).add(joint); bones.set(name, joint) }
  return { source, target, mesh }
}

test('rebinds existing weights to65 joints and preserves rest geometry and source buffers', () => {
  const { source, target, mesh } = fixture(), before = JSON.stringify(source.toJSON())
  const output = rebindCanonicalModel(source, target, new Map([['SourceRoot', 'Hips']]))
  assert.equal(output.report.targetJoints, 65)
  assert.equal(output.report.vertices, 2)
  assert.ok(output.report.maxRestError < 1e-6)
  let rebound: SkinnedMesh | undefined
  output.model.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) rebound = node as SkinnedMesh })
  assert.equal(rebound!.skeleton.bones.length, 65)
  assert.notEqual(rebound!.geometry, mesh.geometry)
  assert.deepEqual(Array.from(rebound!.geometry.getAttribute('position').array), Array.from(mesh.geometry.getAttribute('position').array))
  assert.equal(JSON.stringify(source.toJSON()), before)
})

test('unmapped weights or invalid receiver owners fail without changing source', () => {
  const { source, target } = fixture(), before = JSON.stringify(source.toJSON())
  assert.throws(() => rebindCanonicalModel(source, target, new Map()), /unmapped/)
  assert.throws(() => rebindCanonicalModel(source, target, new Map([['SourceRoot', 'Wing']])), /not a receiver joint/)
  assert.equal(JSON.stringify(source.toJSON()), before)
})

test('mixed source weights retain relative deformation and transformed model rest geometry', () => {
  const { source, target, mesh } = fixture()
  const first = source.getObjectByName('SourceRoot') as Bone, second = new Bone()
  second.name = 'SourceHelper'; second.position.y = 1; first.add(second)
  source.updateMatrixWorld(true); mesh.bind(new Skeleton([first, second]))
  mesh.geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0, 1, 0, 0, 0, 1, 0, 0], 4))
  mesh.geometry.setAttribute('skinWeight', new Float32BufferAttribute([0.25, 0.75, 0, 0, 0.25, 0.75, 0, 0], 4))
  const owners = new Map([['SourceRoot', 'Hips'], ['SourceHelper', 'Spine']])
  const result = rebindCanonicalModel(source, target, owners)
  let rebound: SkinnedMesh | undefined
  result.model.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) rebound = node as SkinnedMesh })
  rebound!.skeleton.getBoneByName('Spine')!.position.x += 2
  result.model.updateMatrixWorld(true); rebound!.skeleton.update()
  assert.ok(rebound!.applyBoneTransform(0, new Vector3(0, 2, 0)).distanceTo(new Vector3(1.5, 2, 0)) < 1e-6)
  source.position.set(7, -3, 2); source.scale.setScalar(2); source.updateMatrixWorld(true)
  target.position.set(-2, 4, 1); target.updateMatrixWorld(true)
  const transformed = rebindCanonicalModel(source, target, owners)
  assert.ok(transformed.report.maxRestError < 1e-5)
  assert.equal(transformed.report.meshes[0]!.droppedWeight, 0)
})

test('reads two glTF influence sets and reports weight discarded when rebinding to four output slots', () => {
  const { source, target, mesh } = fixture(), root = source.getObjectByName('SourceRoot') as Bone
  const bones = [root]
  for (let index = 1; index < 5; index++) { const bone = new Bone(); bone.name = `Source${index}`; root.add(bone); bones.push(bone) }
  source.updateMatrixWorld(true); mesh.bind(new Skeleton(bones))
  mesh.geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0, 1, 2, 3, 0, 1, 2, 3], 4))
  mesh.geometry.setAttribute('skinWeight', new Float32BufferAttribute([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2], 4))
  mesh.geometry.setAttribute('skinIndex1', new Uint16BufferAttribute([4, 0, 0, 0, 4, 0, 0, 0], 4))
  mesh.geometry.setAttribute('skinWeight1', new Float32BufferAttribute([0.2, 0, 0, 0, 0.2, 0, 0, 0], 4))
  const owners = new Map(bones.map((bone, index) => [bone.name, ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck'][index]!]))
  const result = rebindCanonicalModel(source, target, owners)
  assert.equal(result.report.meshes[0]!.affectedVertices, 2)
  assert.ok(Math.abs(result.report.meshes[0]!.droppedWeight - 0.4) < 1e-6)
  let outputMesh: SkinnedMesh | undefined
  result.model.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) outputMesh = node as SkinnedMesh })
  assert.equal(outputMesh!.geometry.getAttribute('skinIndex1'), undefined)
  assert.equal(outputMesh!.geometry.getAttribute('skinWeight1'), undefined)
})

test('receiver animation deforms rebound vertices even when original source joints use the same names', () => {
  const { source, target } = fixture()
  source.getObjectByName('SourceRoot')!.name = 'Hips'
  const original = JSON.stringify(source.toJSON())
  const output = rebindCanonicalModel(source, target, new Map([['Hips', 'Hips']]))
  let rebound: SkinnedMesh | undefined
  output.model.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) rebound = node as SkinnedMesh })
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  const clip = new AnimationClip('Turn', 1, [new QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, ...turn.toArray()])])
  const mixer = new AnimationMixer(output.model)
  mixer.clipAction(clip).play(); mixer.setTime(0.5)
  output.model.updateMatrixWorld(true); rebound!.skeleton.update()
  const point = rebound!.applyBoneTransform(0, new Vector3(0, 2, 0))
  assert.ok(point.distanceTo(new Vector3(-Math.SQRT1_2, 1 + Math.SQRT1_2, 0)) < 1e-6)
  assert.ok(output.report.renamedSourceNodes.some((node) => node.originalName === 'Hips'))
  assert.equal(JSON.stringify(source.toJSON()), original)
  mixer.stopAllAction(); mixer.uncacheRoot(output.model)
})

test('model+rig+animation GLB roundtrip retains65 skin joints and animated vertex deformation', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'FileReader')
  class BlobReader {
    result: ArrayBuffer | null = null
    onloadend?: () => void
    readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then((value) => { this.result = value; this.onloadend?.() }) }
  }
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: BlobReader })
  try {
    const { source, target } = fixture()
    const rebound = rebindCanonicalModel(source, target, new Map([['SourceRoot', 'Hips']]))
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
    const clip = new AnimationClip('Turn', 1, [new QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, ...turn.toArray()])])
    const bytes = await exportCanonicalModel(rebound.model, [clip])
    const loaded = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '')
    let mesh: SkinnedMesh | undefined
    loaded.scene.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) mesh = node as SkinnedMesh })
    assert.equal(mesh!.skeleton.bones.length, 65)
    assert.equal(loaded.animations[0]!.duration, 1)
    const mixer = new AnimationMixer(loaded.scene)
    mixer.clipAction(loaded.animations[0]!).play(); mixer.setTime(0.5)
    loaded.scene.updateMatrixWorld(true); mesh!.skeleton.update()
    const vertex = new Vector3().fromBufferAttribute(mesh!.geometry.getAttribute('position'), 0)
    assert.ok(mesh!.applyBoneTransform(0, vertex).distanceTo(new Vector3(-Math.SQRT1_2, 1 + Math.SQRT1_2, 0)) < 1e-5)
    mixer.stopAllAction(); mixer.uncacheRoot(loaded.scene)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'FileReader', previous)
    else Reflect.deleteProperty(globalThis, 'FileReader')
  }
})
