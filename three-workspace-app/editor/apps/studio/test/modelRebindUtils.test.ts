import assert from 'node:assert/strict'
import test from 'node:test'
import { Bone, BufferAttribute, BufferGeometry, Group, Skeleton, SkinnedMesh } from 'three'
import { loadModelScene, weightedSourceBones } from '../app/workbench/components/normalization/modelUtils.ts'

function glbWithSecondaryInfluences() {
  const chunks: Uint8Array[] = [], views: Array<{ buffer: number; byteOffset: number; byteLength: number }> = [], accessors: Array<Record<string, unknown>> = []
  let offset = 0
  function add(values: Float32Array | Uint8Array, componentType: number, type: string) {
    const bytes = new Uint8Array(values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength))
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }); chunks.push(bytes); offset += bytes.length
    accessors.push({ bufferView: views.length - 1, componentType, count: 3, type })
    return accessors.length - 1
  }
  const position = add(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 5126, 'VEC3')
  const joints0 = add(new Uint8Array([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]), 5121, 'VEC4')
  const weights0 = add(new Float32Array(Array(12).fill(0.2)), 5126, 'VEC4')
  const joints1 = add(new Uint8Array([4, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0]), 5121, 'VEC4')
  const weights1 = add(new Float32Array([0.2, 0, 0, 0, 0.2, 0, 0, 0, 0.2, 0, 0, 0]), 5126, 'VEC4')
  const binary = new Uint8Array(offset); let cursor = 0
  for (const chunk of chunks) { binary.set(chunk, cursor); cursor += chunk.length }
  const document = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [
    { name: 'Rig', children: [1, 6] }, { name: 'source-0', children: [2] }, { name: 'source-1', children: [3] },
    { name: 'source-2', children: [4] }, { name: 'source-3', children: [5] }, { name: 'source-4' }, { mesh: 0, skin: 0 },
  ], skins: [{ joints: [1, 2, 3, 4, 5], skeleton: 1 }], meshes: [{ primitives: [{ attributes: {
    POSITION: position, JOINTS_0: joints0, WEIGHTS_0: weights0, JOINTS_1: joints1, WEIGHTS_1: weights1,
  } }] }], buffers: [{ byteLength: binary.length }], bufferViews: views, accessors }
  accessors[position]!.min = [0, 0, 0]; accessors[position]!.max = [1, 1, 0]
  const json = new TextEncoder().encode(JSON.stringify(document)), jsonLength = (json.length + 3) & ~3, binaryLength = (binary.length + 3) & ~3
  const bytes = new Uint8Array(28 + jsonLength + binaryLength), header = new DataView(bytes.buffer)
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, bytes.length, true)
  header.setUint32(12, jsonLength, true); header.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + jsonLength); bytes.set(json, 20)
  header.setUint32(20 + jsonLength, binaryLength, true); header.setUint32(24 + jsonLength, 0x004e4942, true); bytes.set(binary, 28 + jsonLength)
  return bytes.buffer
}

test('weightedSourceBones reports only joints with positive skin weights', () => {
  const root = new Group(), weighted = new Bone(), unused = new Bone()
  weighted.name = 'source-hip'; unused.name = 'source-extra'
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3))
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 1, 0, 0]), 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0]), 4))
  const mesh = new SkinnedMesh(geometry)
  root.add(weighted, unused, mesh)
  mesh.bind(new Skeleton([weighted, unused]))
  assert.deepEqual(weightedSourceBones(root), ['source-hip'])
})

test('weightedSourceBones includes joints present in an optional secondary influence set', () => {
  const root = new Group(), bones = Array.from({ length: 5 }, (_, index) => { const bone = new Bone(); bone.name = `source-${index}`; return bone })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3))
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 1, 2, 3]), 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([0.25, 0.25, 0.25, 0.25]), 4))
  geometry.setAttribute('skinIndex1', new BufferAttribute(new Uint16Array([4, 0, 0, 0]), 4))
  geometry.setAttribute('skinWeight1', new BufferAttribute(new Float32Array([0.2, 0, 0, 0]), 4))
  const mesh = new SkinnedMesh(geometry); root.add(...bones, mesh); mesh.bind(new Skeleton(bones))
  assert.deepEqual(weightedSourceBones(root), bones.map((bone) => bone.name))
})

test('GLB loading restores JOINTS_1 and WEIGHTS_1 ignored by the Three.js loader', async () => {
  const scene = await loadModelScene(glbWithSecondaryInfluences(), 'model/gltf-binary')
  assert.deepEqual(weightedSourceBones(scene), ['source-0', 'source-1', 'source-2', 'source-3', 'source-4'])
})

test('weightedSourceBones rejects models without supported weighted skin data', () => {
  assert.throws(() => weightedSourceBones(new Group()), /no weighted skinned mesh/)
  const root = new Group(), mesh = new SkinnedMesh(new BufferGeometry())
  root.add(mesh)
  assert.throws(() => weightedSourceBones(root), /influence sets/)
})
