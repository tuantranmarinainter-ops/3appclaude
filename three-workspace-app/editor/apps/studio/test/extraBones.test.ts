import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { inflateSync } from 'node:zlib'
import { Quaternion, Vector3 } from 'three'
import { makeEmptyDraft } from '@topview/3d-builder'
import { MIXAMO65_BONE_PARENTS } from '@bbs/retarget'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore.ts'
import { stageAssetUpload } from '../src/unifiedAssetFiles.ts'
import { getUnifiedJob, readUnifiedJobFile } from '../src/unifiedJobs.ts'

const directory = mkdtempSync(path.join(tmpdir(), 'extra-bones-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = directory
test.after(() => rmSync(directory, { recursive: true, force: true }))
const extras = [['X_Hips_Tail1', 'Hips'], ['X_Hips_Tail2', 'X_Hips_Tail1'], ['X_Hips_Tail3', 'X_Hips_Tail2'], ['X_Head_Jaw', 'Head']] as const

/** Synthetic v1.1 source: unchanged Mixamo65 core and four additional joints; no binary fixture. */
function fixture({ model = false, prefix = '', old = false } = {}) {
  const pairs = [...MIXAMO65_BONE_PARENTS, ...(old ? [] : extras)]
  const nodes: Array<Record<string, any>> = pairs.map(([name]) => ({ name: prefix + name, translation: name === 'Hips' ? [0, 1, 0] : name.startsWith('X_Hips') ? [0.3, 0, 0] : [0, 0.05, 0], children: [] }))
  pairs.forEach(([, parent], index) => { if (parent) nodes[pairs.findIndex(([name]) => name === parent)]!.children.push(index) })
  const data = Buffer.alloc(108)
  const floats = [0, 1, 0, 0, 0, 1, 0, 0, Math.sin(Math.PI / 12), Math.cos(Math.PI / 12), 0, -0.12, 0, 0.3, -0.12, 0, 0.15, 0.18, 0]
  floats.forEach((value, index) => data.writeFloatLE(value, index * 4))
  ;[0, 2, 0, 1, 0, 0, 1, 0].forEach((value, index) => data.writeFloatLE(value, 76 + index * 4))
  if (model) nodes[pairs.findIndex(([name]) => name === 'X_Hips_Tail3')]!.mesh = 0
  const document = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes,
    extras: { version: old ? '1.0.0' : '1.1.0', rig: old ? 'mixamo65' : 'mixamo65+tail-jaw', ...(old ? {} : { extraBones: extras.map(([name, parent]) => ({ name, parent, rest: { position: nodes[pairs.findIndex(([key]) => key === name)]!.translation, rotation: [0, 0, 0, 1], scale: [1, 1, 1] } })) }) },
    ...(model ? { skins: [{ joints: pairs.map((_, i) => i), skeleton: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 2 }, material: 0 }] }], materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0, roughnessFactor: 1 }, emissiveFactor: [1, 0, 0] }] } : {}),
    buffers: [{ byteLength: data.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 32 }, { buffer: 0, byteOffset: 40, byteLength: 36 }, { buffer: 0, byteOffset: 76, byteLength: 8 }, { buffer: 0, byteOffset: 84, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }, { bufferView: 1, componentType: 5126, count: 2, type: 'VEC4' }, { bufferView: 2, componentType: 5126, count: 3, type: 'VEC3', min: [0, -0.12, 0], max: [0.3, 0.18, 0] }, { bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [2] }, { bufferView: 4, componentType: 5126, count: 2, type: 'VEC3' }],
    ...(model ? {} : { animations: [{ name: old ? 'Core only' : 'Tail wave', samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }, { input: 3, output: 4, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: old ? 0 : pairs.findIndex(([name]) => name === 'X_Hips_Tail1'), path: 'rotation' } }, { sampler: 1, target: { node: 0, path: 'translation' } }] }] }),
  }
  const json = Buffer.from(JSON.stringify(document)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded)
  const out = Buffer.alloc(28 + padded.length + data.length)
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8)
  out.writeUInt32LE(padded.length, 12); out.writeUInt32LE(0x4e4f534a, 16); padded.copy(out, 20)
  out.writeUInt32LE(data.length, 20 + padded.length); out.writeUInt32LE(0x004e4942, 24 + padded.length); data.copy(out, 28 + padded.length)
  return out
}

/** Decode browser PNG scanlines so the assertion measures rendered tail pixels, not file encoding. */
function redPixels(png: Buffer): Set<number> {
  const chunks: Buffer[] = []; let width = 0, height = 0, channels = 0
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8), data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); assert.equal(data[8], 8); channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0; assert.ok(channels) }
    if (type === 'IDAT') chunks.push(data)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels, pixels = Buffer.alloc(height * stride), red = new Set<number>()
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, left = x >= channels ? pixels[at - channels]! : 0, up = y ? pixels[at - stride]! : 0, upperLeft = y && x >= channels ? pixels[at - stride - channels]! : 0
      const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft)
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : a <= b && a <= c ? left : b <= c ? up : upperLeft
      assert.ok(filter <= 4)
      pixels[at] = (raw[y * (stride + 1) + 1 + x]! + prediction) & 255
    }
    for (let x = 0; x < width; x++) { const at = y * stride + x * channels; if (pixels[at]! > 150 && pixels[at + 1]! < 80 && pixels[at + 2]! < 80) red.add(y * width + x) }
  }
  return red
}

for (const prefix of ['', 'mixamorig:']) test(`v1.1 import, evaluate, jaw pose Undo and v1.0 rest (${prefix || 'bare'})`, async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Extra bones', scene: makeEmptyDraft('Extra bones', 30, 90, { fov: 50, position: { x: 0.6, y: 1.1, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0.6, y: 1.1, z: 0 } }) } })
  const projectId = String(created.result.projectId)
  async function command(command: string, args: Record<string, unknown>) {
    const project = await readUnifiedProject(projectId)
    return executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: project.revision, command, args })
  }
  async function upload(name: string, bytes: Buffer, skeletonProfileId?: string) {
    const staged = await stageAssetUpload(name, new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } }))
    return command('asset.import', { files: [staged.id], format: 'glb', ...(skeletonProfileId ? { skeletonProfileId } : {}) })
  }
  const imported = await upload('character.glb', fixture({ model: true }))
  const skeletonId = (imported.result.skeletonIds as string[])[0]!, assetId = (imported.result.assetIds as string[])[0]!
  const profile = (await readUnifiedProject(projectId)).skeletons[skeletonId]!
  assert.equal(profile.bones.length, 69)
  assert.deepEqual(profile.bones.filter(b => b.name.startsWith('X_')).map(b => b.name).sort(), extras.map(([name]) => name).sort())
  const added = await command('character.add', { assetId, skeletonId, name: 'Tail actor' })
  const characterId = String(added.result.characterId), nodeId = String(added.result.nodeId)
  const motion = await upload('tail.glb', fixture({ prefix }), skeletonId)
  const motionId = (motion.result.motionIds as string[])[0]!
  await command('motion.place', { motionId, characterId, loop: false })
  async function evaluate(frame: number) {
    const response = await command('scene.evaluate', { frame })
    assert.deepEqual(response.result.issues, [])
    return (response.result.skeletonSamples as Array<{ bones: Array<{ name: string; rotation: number[] }> }>)[0]!.bones
  }
  const tail = (await evaluate(30)).find(b => b.name === 'X_Hips_Tail1')!
  const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 6)
  const error = new Quaternion().fromArray(tail.rotation).angleTo(expected) * 180 / Math.PI
  assert.ok(error <= 0.5, `tail error ${error} degrees`)
  console.log(`extra-bones ${prefix || 'bare'}: tail error=${error.toFixed(6)}deg`)
  const current = await readUnifiedProject(projectId), scene = structuredClone(current.scene)
  scene.content.timeline.animation.motionClips = []
  scene.content.nodes.find(node => node.id === nodeId)!.character!.animation = { mode: 'pose', controlValues: { 'joint:X_Head_Jaw:z': 20 } }
  await command('scene.apply', { operations: [{ type: 'document.replace', document: scene, fcurves: null }] })
  const jaw = (await evaluate(0)).find(b => b.name === 'X_Head_Jaw')!
  assert.ok(new Quaternion().fromArray(jaw.rotation).angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 9)) < 1e-6)
  await command('history.undo', {})
  assert.ok(new Quaternion().fromArray((await evaluate(0)).find(b => b.name === 'X_Head_Jaw')!.rotation).angleTo(new Quaternion()) < 1e-6)

  if (!prefix) {
    const render = await command('scene.render', { frames: [0, 30], cameraNodeIds: ['camera_1'], width: 192, height: 192, outputDirectory: { kind: 'client-directory', id: randomUUID() } })
    let job = await getUnifiedJob(String(render.result.jobId), projectId)
    for (let i = 0; i < 300 && !['succeeded', 'failed', 'cancelled'].includes(job.state); i++) {
      await new Promise(resolve => setTimeout(resolve, 100)); job = await getUnifiedJob(job.jobId, projectId)
    }
    assert.equal(job.state, 'succeeded', JSON.stringify(job))
    const frames = job.result!.files.filter(file => /^camera-0-frame-/.test(file.name))
    assert.equal(frames.length, 2)
    const bytes = await Promise.all(frames.map(async file => (await readUnifiedJobFile(job.jobId, projectId, file.id))!.bytes))
    const masks = bytes.map(redPixels)
    assert.ok(masks.every(mask => mask.size > 20), `visible red tail pixels: ${masks.map(mask => mask.size)}`)
    const changedPixels = [...masks[0]!].filter(pixel => !masks[1]!.has(pixel)).length + [...masks[1]!].filter(pixel => !masks[0]!.has(pixel)).length
    assert.ok(changedPixels > 20, `tail changed ${changedPixels} pixels`)
    console.log(`extra-bones actual renders: red tail pixels=${masks.map(mask => mask.size)}, changed=${changedPixels}`)
  }
  const old = await upload('core.glb', fixture({ old: true }), skeletonId)
  const oldMotionId = (old.result.motionIds as string[])[0]!
  const clean = structuredClone((await readUnifiedProject(projectId)).scene); clean.content.timeline.animation.motionClips = []
  await command('scene.apply', { operations: [{ type: 'document.replace', document: clean, fcurves: null }] })
  await command('motion.place', { motionId: oldMotionId, characterId, loop: false })
  for (const bone of (await evaluate(30)).filter(b => b.name.startsWith('X_'))) assert.ok(new Quaternion().fromArray(bone.rotation).angleTo(new Quaternion()) < 1e-6, bone.name)
})
