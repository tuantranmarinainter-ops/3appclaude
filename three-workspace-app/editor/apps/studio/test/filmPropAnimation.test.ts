import assert from 'node:assert/strict'
import test from 'node:test'
import { decodePng, deriveAnimatedPropModel, encodePng, propTextureFrameAt, readPropTextureAnimation, splitVerticalStrip } from '../src/filmPropAnimation'

const animation = { version: 1, layout: 'vertical-strip', frameCount: 4, frametimeTicks: 1, ticksPerSecond: 20, uvFrame: 0 } as const

/** 2x8 RGBA strip of 4 square 2x2 frames; frame k is filled with red = 10 * (k + 1). */
function strip(): Buffer {
  const pixels = Buffer.alloc(2 * 8 * 4)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 2; x++) pixels.set([10 * (Math.floor(y / 2) + 1), x * 50, y, 255], (y * 2 + x) * 4)
  return encodePng({ width: 2, height: 8, channels: 4, pixels })
}

function glb(png: Buffer): Buffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const uvs = new Float32Array([0, 0, 1, 0, 0.5, 0.25])   // frame 0 of 4 = v in [0, 0.25]
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(uvs.buffer), png, Buffer.alloc((4 - png.length % 4) % 4)])
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, extras: { w01TextureAnimation: animation } }],
    textures: [{ source: 0 }], images: [{ bufferView: 2, mimeType: 'image/png' }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2', min: [0, 0], max: [1, 0.25] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }, { buffer: 0, byteOffset: 60, byteLength: png.length }],
    buffers: [{ byteLength: bin.length }],
  }
  let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)])
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8)
  const chunk = (length: number, type: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(length, 0); b.writeUInt32LE(type, 4); return b }
  return Buffer.concat([head, chunk(text.length, 0x4e4f534a), text, chunk(bin.length, 0x004e4942), bin])
}

test('PNG round trip and vertical strip split keep every frame pixel', () => {
  const frames = splitVerticalStrip(strip(), 4)
  assert.equal(frames.length, 4)
  for (const [k, frame] of frames.entries()) {
    const image = decodePng(frame)
    assert.deepEqual([image.width, image.height, image.channels], [2, 2, 4])
    assert.equal(image.pixels[0], 10 * (k + 1))
    assert.equal(image.pixels[(1 * 2 + 1) * 4 + 2], 2 * k + 1)   // row y of the strip survives
  }
  assert.throws(() => splitVerticalStrip(strip(), 3), /square frames/)
})

test('derived GLB maps one whole frame onto the UVs and embeds frame 0; plain models are untouched', () => {
  const derived = deriveAnimatedPropModel(glb(strip()))!
  assert.ok(derived)
  assert.equal(derived.frames.length, 4)
  const jsonLength = derived.glb.readUInt32LE(12)
  const json = JSON.parse(derived.glb.subarray(20, 20 + jsonLength).toString('utf8'))
  const bin = derived.glb.subarray(20 + jsonLength + 8)
  const uv = (i: number) => bin.readFloatLE(36 + i * 8 + 4)
  assert.deepEqual([uv(0), uv(1), uv(2)], [0, 0, 1])
  assert.deepEqual(json.accessors[1].max, [1, 1])
  assert.equal(json.materials[0].extras.w01TextureAnimation, undefined)
  const view = json.bufferViews[json.images[0].bufferView]
  assert.equal(decodePng(Buffer.from(bin.subarray(view.byteOffset, view.byteOffset + view.byteLength))).pixels[0], 10)
  const plain = glb(strip()), plainJson = JSON.parse(plain.subarray(20, 20 + plain.readUInt32LE(12)).toString('utf8'))
  delete plainJson.materials[0].extras
  assert.equal(readPropTextureAnimation(plainJson.materials[0].extras?.w01TextureAnimation), null)
})

test('texture frame follows Minecraft ticks at the timeline fps (same rule as the App 2 viewport)', () => {
  const a = readPropTextureAnimation({ ...animation, frameCount: 36 })!
  assert.deepEqual([0, 1, 2, 3, 54, 57].map((f) => propTextureFrameAt(a, f, 30)), [0, 0, 1, 2, 0, 2])
  assert.equal(propTextureFrameAt({ ...a, frametimeTicks: 2, frameOrder: [5, 4] }, 3, 30), 4)
})
