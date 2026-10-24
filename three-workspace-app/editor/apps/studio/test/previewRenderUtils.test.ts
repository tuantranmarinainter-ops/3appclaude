import assert from 'node:assert/strict'
import test from 'node:test'
import { glbUsesDraco } from '../src/previewRenderUtils'

function glb(jsonValue: unknown): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(jsonValue))
  const jsonLength = Math.ceil(text.length / 4) * 4
  const data = new ArrayBuffer(20 + jsonLength)
  const view = new DataView(data)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, data.byteLength, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  new Uint8Array(data, 20, text.length).set(text)
  new Uint8Array(data, 20 + text.length, jsonLength - text.length).fill(0x20)
  return data
}

test('preview renderer only needs the Draco decoder for GLBs that declare Draco compression', () => {
  assert.equal(glbUsesDraco(glb({ asset: { version: '2.0' } })), false)
  assert.equal(glbUsesDraco(glb({ asset: { version: '2.0' }, extensionsUsed: ['KHR_draco_mesh_compression'] })), true)
  assert.equal(glbUsesDraco(glb({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] })), true)
})

test('preview renderer rejects malformed GLB headers', () => {
  assert.throws(() => glbUsesDraco(new ArrayBuffer(20)), /Invalid GLB header/)
})
