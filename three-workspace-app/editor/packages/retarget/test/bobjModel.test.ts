import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { AnimationMixer, Bone, Matrix4, Quaternion, SkinnedMesh, Vector3, LoopOnce } from 'three'
import { bobjModelToGlb, buildBobjModel, parseBobjModel } from '../src/bobjModel.ts'
import { loadBobj } from '../cli/loadBobj.ts'
import { loadAsset } from '../cli/loadAsset.ts'
import { decodeGlb } from '../cli/glb.ts'
import { inspectNormalize } from '../cli/normalizeCore.ts'
import { evaluateBobjAction } from '../src/index.ts'

const bone = (name: string, parent: string, x: number, y: number) => `arm_bone ${name} ${parent} ${x} ${y + 1} 0 1 0 0 ${x} 0 1 0 ${y} 0 0 1 0 0 0 0 1`
const fixture = `# BBSFix export motion_scale=0.02
arm_name synthetic
${bone('Root', '', 0, 0)}
${bone('Pelvis', 'Root', 0, 50)}
${bone('Head', 'Pelvis', 0, 80)}
${bone('Jaw', 'Head', 0, 75)}
${bone('Wing_Bone', 'Pelvis', 25, 65)}
${bone('Wing_Bone_end', 'Wing_Bone', 40, 65)}
o verity.mdl/Verity.smd
o_arm synthetic
v 0 0 0
vw Root 1
v 0 50 0
vw Pelvis 0.75
vw Jaw 0.25
v 50 0 0
vw Wing_Bone 0.6
vw Wing_Bone_end 0.4
vt 0 0
vt 0 1
vt 1 0
vn 0 0 1
f 1/1/1 2/2/1 3/3/1
o EYES
o_arm synthetic
v 0 75 0
vw Jaw 1
v 5 75 0
vw Head 1
v 0 80 0
vw Head 1
vt 0.1 0.2
vt 0.3 0.4
vt 0.5 0.6
f 4/4/1 5/5/1 6/6/1
an idle
ao Pelvis
ag location 0
kf 0 0 LINEAR
kf 1 5 LINEAR
kf 2 10 LINEAR
ao Jaw
ag rotation 2
kf 0 0 LINEAR
kf 1 0.2 LINEAR
kf 2 0.4 LINEAR
an swipe
ao Wing_Bone
ag rotation 1
kf 0 0 LINEAR
kf 1 -0.3 LINEAR
kf 2 -0.6 LINEAR
`

/** Generate a real RGBA PNG, including CRCs, entirely in the temporary test directory. */
function png(r: number, g: number, b: number, format: 'rgba' | 'rgb' | 'indexed' = 'rgba', filter = 0) {
  const crc = (data: Buffer) => {
    let value = 0xffffffff
    for (const byte of data) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0) }
    return (value ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const tag = Buffer.from(type), head = Buffer.alloc(4), tail = Buffer.alloc(4)
    head.writeUInt32BE(data.length); tail.writeUInt32BE(crc(Buffer.concat([tag, data])))
    return Buffer.concat([head, tag, data, tail])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = format === 'indexed' ? 2 : 8; ihdr[9] = format === 'indexed' ? 3 : format === 'rgb' ? 2 : 6
  const rows = format === 'indexed' ? [[0x10], [0xb0]] : format === 'rgb' ? [[r, g, b, 0, 0, 255], [255, 255, 0, 255, 0, 255]] : [[r, g, b, 255, 0, 0, 255, 255], [255, 255, 0, 255, 255, 0, 255, 255]]
  const bpp = format === 'indexed' ? 1 : format === 'rgb' ? 3 : 4
  const paeth = (a: number, b: number, c: number) => { const p = a + b - c; return Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c }
  const raw = rows.flatMap((row, y) => [filter, ...row.map((value, x) => { const a = row[x - bpp] ?? 0, b = rows[y - 1]?.[x] ?? 0, c = rows[y - 1]?.[x - bpp] ?? 0; return (value - [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) & 255 })])
  const palette = format === 'indexed' ? [chunk('PLTE', Buffer.from([r, g, b, 0, 0, 255, 255, 255, 0, 255, 0, 255])), chunk('tRNS', Buffer.from([255, 128, 64, 0]))] : []
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...palette, chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))])
}
const withFixture = async (run: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), 'bobj-model-'))
  try {
    writeFileSync(join(dir, 'model.bbs.bobj'), fixture)
    for (const [name, color] of [['verity.mdl/Verity.smd', [255, 0, 0]], ['EYES', [0, 255, 0]]] as const) {
      const path = join(dir, 'textures', name, 'default.png'); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, png(...color))
    }
    await run(dir)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const readTexture = (dir: string) => (path: string) => { try { return readFileSync(join(dir, path)) } catch { return undefined } }

test('BOBJ model GLB roundtrip preserves two textured objects, six bones, UVs, normals and weights', async () => withFixture(async dir => {
  const parsed = parseBobjModel(fixture), { bytes, report } = bobjModelToGlb(parsed, { readTexture: readTexture(dir) })
  assert.equal(report.unitMeters, 0.02); assert.equal(report.boneCount, 6); assert.equal(report.actionCount, 2)
  assert.equal(report.heightMeters, 1.6); assert.equal(report.hipHeightMeters, 1); assert.equal(report.vertexCount, 6)
  assert.deepEqual(report.missingTextures, []); assert.deepEqual(report.warnings, [])
  const { json, bin } = decodeGlb(bytes)
  assert.equal(json.materials.length, 2); assert.equal(json.images.length, 2); assert.equal(json.textures.length, 2)
  for (const object of parsed.objects) {
    const image = json.images.find((i: any) => i.name === object.name), view = json.bufferViews[image.bufferView]
    assert.deepEqual(bin.slice(view.byteOffset, view.byteOffset + view.byteLength), new Uint8Array(readTexture(dir)(`textures/${object.name}/default.png`)!))
  }
  const loaded = await loadAsset(bytes, 'glb', { keepMeshes: true }), meshes: SkinnedMesh[] = [], bones: Bone[] = []
  loaded.traverse(node => { if (node instanceof SkinnedMesh) meshes.push(node); if (node instanceof Bone) bones.push(node) })
  assert.equal(meshes.length, 2); assert.deepEqual(bones.map(b => b.name).sort(), parsed.armature.bones.map(b => b.name).sort())
  assert.equal(bones.find(b => b.name === 'Jaw')!.parent!.name, 'Head')
  assert.equal(bones.find(b => b.name === 'Wing_Bone_end')!.parent!.name, 'Wing_Bone')
  for (const mesh of meshes) {
    const source = buildBobjModel(parsed).root.children.find(n => n.name === mesh.userData.bobjObject) as SkinnedMesh
    for (const attribute of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
      const actual = mesh.geometry.getAttribute(attribute), expected = source.geometry.getAttribute(attribute)
      assert.equal(actual.array.length, expected.array.length)
      for (let i = 0; i < actual.array.length; i++) assert.ok(Math.abs(actual.array[i] - expected.array[i]) <= 1e-6, `${mesh.name}/${attribute}/${i}`)
    }
    for (let i = 0; i < mesh.skeleton.bones.length; i++) {
      const identity = mesh.skeleton.bones[i].matrixWorld.clone().multiply(mesh.skeleton.boneInverses[i])
      assert.ok(identity.elements.every((v, j) => Math.abs(v - new Matrix4().elements[j]) < 1e-6))
    }
  }
  const body = meshes.find(m => m.userData.bobjObject === 'verity.mdl/Verity.smd')!
  assert.ok(Math.abs(body.geometry.getAttribute('skinWeight').getX(1) - 0.75) < 1e-6)
  assert.ok(Math.abs(body.geometry.getAttribute('skinWeight').getY(1) - 0.25) < 1e-6)
  assert.ok(Math.abs(body.geometry.getAttribute('skinWeight').getX(2) - 0.6) < 1e-6)
  assert.equal(body.geometry.getAttribute('uv').getY(1), 0)
}))

test('both GLB animations match source evaluated world position/rotation at ticks 0, 1, 2', async () => withFixture(async dir => {
  const parsed = parseBobjModel(fixture), { bytes } = bobjModelToGlb(parsed, { readTexture: readTexture(dir) })
  for (const action of parsed.actions.values()) {
    const loaded = await loadAsset(bytes, 'glb', { keepMeshes: true }), mixer = new AnimationMixer(loaded)
    const playing = mixer.clipAction(loaded.animations.find(a => a.name === action.name)!); playing.setLoop(LoopOnce, 1); playing.clampWhenFinished = true; playing.play()
    for (const tick of [0, 1, 2]) {
      mixer.setTime(tick / 20); loaded.updateMatrixWorld(true)
      for (const expected of evaluateBobjAction(parsed.armature, action, tick)) {
        const node = loaded.getObjectByName(expected.name)!, world = new Matrix4().fromArray([...expected.worldMatrix]), p = new Vector3(), q = new Quaternion(), s = new Vector3()
        world.decompose(p, q, s)
        assert.ok(node.getWorldPosition(new Vector3()).distanceTo(p.multiplyScalar(0.02)) < 1e-6, `${action.name}@${tick}/${expected.name} position`)
        assert.ok(node.getWorldQuaternion(new Quaternion()).angleTo(q) < 1e-6, `${action.name}@${tick}/${expected.name} rotation`)
      }
    }
  }
}))

test('loader forwards resourceDir, reports nested missing texture and respects skeletonOnly', async () => withFixture(async dir => {
  const file = readFileSync(join(dir, 'model.bbs.bobj'))
  const root = await loadAsset(file, 'bobj', { resourceDir: dir })
  assert.deepEqual(root.userData.bobjModel.missingTextures, [])
  const body = root.children.find(n => n.name === 'verity.mdl/Verity.smd') as SkinnedMesh
  const map = (body.material as any).map
  assert.equal(map.image.width, 2); assert.equal(map.image.height, 2); assert.equal(map.flipY, false)
  assert.deepEqual([...map.image.data.slice(0, 4)], [255, 0, 0, 255])
  // PNG first scanline is the top; OBJ bottom-left vt 0,0 becomes glTF 0,1.
  assert.equal(body.geometry.getAttribute('uv').getY(0), 1)
  assert.deepEqual([...map.image.data.slice(8, 12)], [255, 255, 0, 255])
  rmSync(join(dir, 'textures/EYES/default.png'))
  const missing = loadBobj(fixture, fixture, { resourceDir: dir })
  assert.deepEqual(missing.userData.bobjModel.missingTextures, ['EYES'])
  assert.match(missing.userData.bobjModel.warnings.join('\n'), /EYES/)
  const skeleton = await loadAsset(file, 'bobj', { resourceDir: dir, skeletonOnly: true })
  assert.equal(skeleton.children.some(n => n instanceof SkinnedMesh), false)
  assert.equal(skeleton.animations.length, 2)
  const here = dirname(fileURLToPath(import.meta.url)), target = resolve(here, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
  const inspection = await inspectNormalize({ source: skeleton, sourceLabel: 'model.bbs.bobj', sourceSha256: '0'.repeat(64), target: await loadAsset(readFileSync(target), 'glb', { skeletonOnly: true }), targetLabel: 'target', targetSha256: '1'.repeat(64) })
  assert.deepEqual(inspection.input.bobjModel, skeleton.userData.bobjModel)
  assert.equal(inspection.input.effectiveSourceUnitMeters, 0.02)
  const scaled = await inspectNormalize({ source: skeleton, sourceLabel: 'model.bbs.bobj', sourceSha256: '0'.repeat(64), target: await loadAsset(readFileSync(target), 'glb', { skeletonOnly: true }), targetLabel: 'target', targetSha256: '1'.repeat(64), unitMeters: 0.5 })
  assert.equal(scaled.input.effectiveSourceUnitMeters, 0.01, 'CLI unit option is an additional multiplier after header conversion')
  assert.equal(skeleton.getObjectByName('Pelvis')!.position.y, 1, 'header scale is baked into the imported rig exactly once')
}))

test('parser rejects dangling weights, unweighted vertices, traversal and invalid faces', () => {
  assert.throws(() => parseBobjModel(fixture.replace('vw Jaw 1', 'vw absent 1')), /invalid vertex weight/)
  assert.throws(() => buildBobjModel(parseBobjModel(fixture.replace('vw Root 1', ''))), /no bone influence/)
  assert.throws(() => parseBobjModel(fixture.replace('o EYES', 'o ../EYES')), /unsafe object name/)
  assert.throws(() => parseBobjModel(fixture.replace('f 4/4/1', 'f 999/4/1')), /out of bounds/)
  assert.throws(() => parseBobjModel(fixture.replace('motion_scale=0.02', 'motion_scale=0')), /motion_scale/)
  const report = buildBobjModel(parseBobjModel(fixture.replace('motion_scale=0.02', 'motion_scale=0.00002'))).report
  assert.match(report.warnings.join('\n'), /Hip height.*outside/)
})

test('rotated source rest axes preserve weighted world vertices, and object/bone name collision binds the joint', async () => {
  const rotated = fixture.replace(bone('Head', 'Pelvis', 0, 80), 'arm_bone Head Pelvis 0 81 0 0 -1 0 0 1 0 0 80 0 0 1 0 0 0 0 1').replace('o EYES', 'o Jaw')
  const parsed = parseBobjModel(rotated), { bytes } = bobjModelToGlb(parsed), { json } = decodeGlb(bytes)
  const jawIndex = json.nodes.findIndex((n: any) => n.extras.bobjName === 'Jaw')
  assert.ok(json.animations[0].channels.some((c: any) => c.target.node === jawIndex && c.target.path === 'rotation'))
  assert.ok(json.animations[0].channels.every((c: any) => json.skins[0].joints.includes(c.target.node)))
  const root = await loadAsset(bytes, 'glb', { keepMeshes: true }), mixer = new AnimationMixer(root)
  mixer.clipAction(root.animations[0]).play(); mixer.setTime(0.05); root.updateMatrixWorld(true)
  const body = root.children.find(n => n.userData.bobjObject === 'verity.mdl/Verity.smd') as SkinnedMesh
  const worlds = new Map(evaluateBobjAction(parsed.armature, parsed.actions.get('idle')!, 1).map(b => [b.name, new Matrix4().fromArray([...b.worldMatrix])]))
  for (let i = 0; i < 3; i++) {
    const original = new Vector3(...parsed.positions[i] as [number, number, number]), expected = new Vector3()
    for (const influence of parsed.weights[i]) {
      const rest = new Matrix4().fromArray([...parsed.armature.bones.find(b => b.name === influence.bone)!.restWorld])
      expected.add(original.clone().applyMatrix4(rest.invert()).applyMatrix4(worlds.get(influence.bone)!).multiplyScalar(influence.weight * 0.02))
    }
    const actual = body.applyBoneTransform(i, new Vector3().fromBufferAttribute(body.geometry.getAttribute('position'), i))
    assert.ok(actual.distanceTo(expected) < 1e-6, `${i}: ${actual.toArray()} vs ${expected.toArray()}`)
  }
})

test('normalize.ts --src model.bbs.bobj normalizes a textured synthetic 65-bone model and writes importer report', async () => withFixture(async dir => {
  const here = dirname(fileURLToPath(import.meta.url)), targetPath = resolve(here, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
  const target = await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }); target.updateMatrixWorld(true)
  const rows: string[] = []
  target.traverse(node => {
    if (!(node instanceof Bone)) return
    const name = node.name.replace(/^mixamorig:?/, ''), parent = node.parent instanceof Bone ? node.parent.name.replace(/^mixamorig:?/, '') : ''
    const e = node.matrixWorld.elements
    const world = Array.from({ length: 16 }, (_, i) => { const row = Math.floor(i / 4), col = i % 4; return e[col * 4 + row] / (col === 3 && row < 3 ? 0.02 : 1) })
    rows.push(`arm_bone ${name} ${parent} 0 0 0 ${world.join(' ')}`)
  })
  assert.equal(rows.length, 65)
  const model = `# BBSFix motion_scale=0.02\narm_name synthetic65\n${rows.join('\n')}\no verity.mdl/Verity.smd\nv 0 0 0\nvw Hips 1\nv 1 0 0\nvw Hips 1\nv 0 1 0\nvw Hips 1\nvt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 1\nf 1/1/1 2/2/1 3/3/1\nan idle\nao Hips\nag location 0\nkf 0 0 LINEAR\nkf 1 1 LINEAR\nkf 2 2 LINEAR\n`
  const src = join(dir, 'model.bbs.bobj'), out = join(dir, 'out'); writeFileSync(src, model)
  const result = spawnSync(process.execPath, ['--import', 'tsx', resolve(here, '../cli/normalize.ts'), '--src', src, '--target', targetPath, '--out', out], { cwd: resolve(here, '../../builder'), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const report = JSON.parse(readFileSync(join(out, 'model.bbs.report.json'), 'utf8'))
  assert.equal(report.status, 'PASS'); assert.equal(report.input.bobjModel.boneCount, 65)
  assert.equal(report.input.effectiveSourceUnitMeters, 0.02); assert.equal(report.input.unitMeters, 1); assert.equal(report.input.bobjModel.unitMeters, 0.02)
  assert.deepEqual(report.input.bobjModel.missingTextures, [])
  const glb = await loadAsset(readFileSync(join(out, 'model.bbs.glb')), 'glb', { skeletonOnly: true })
  assert.equal(glb.animations.length, 1)
  const motion = glb.animations[0].tracks.find(t => t.name === 'Hips.position')!
  assert.ok(motion, 'normalizer preserves source position tracks')
  assert.ok(Math.abs(motion.values[motion.values.length - 3] - motion.values[0] - 0.04) < 1e-6, 'Hips moves 0.04 m after header conversion through the full CLI')
  assert.equal(report.loss.prunedTracks.count, 0, 'generic BOBJ bone tracks survive normalizer pruning')
}))


test('source material decodes RGB/RGBA and packed indexed PNGs with all five row filters', async () => withFixture(async dir => {
  for (const format of ['rgb', 'rgba', 'indexed'] as const) for (let filter = 0; filter < 5; filter++) {
    writeFileSync(join(dir, 'textures/EYES/default.png'), png(240, 30, 80, format, filter))
    const root = loadBobj(fixture, fixture, { resourceDir: dir }), mesh = root.children.find(n => n.name === 'EYES') as SkinnedMesh
    const data = (mesh.material as any).map.image.data
    assert.deepEqual([...data], [240, 30, 80, 255, 0, 0, 255, format === 'indexed' ? 128 : 255, 255, 255, 0, format === 'indexed' ? 64 : 255, 255, 0, 255, format === 'indexed' ? 0 : 255], `${format} filter ${filter}`)
  }
}))


test('GLTFLoader reads both embedded textures and binds them to the correct object materials', async () => withFixture(async dir => {
  const { bytes } = bobjModelToGlb(parseBobjModel(fixture), { readTexture: readTexture(dir) })
  const scope = globalThis as any, savedSelf = scope.self, savedBitmap = scope.createImageBitmap
  const decodedImages: Uint8Array[] = []
  scope.self = globalThis
  // Node has no image decoder; the source PNG pixels are tested through the real Node decoder above.
  scope.createImageBitmap = async (blob: Blob) => { decodedImages.push(new Uint8Array(await blob.arrayBuffer())); return { width: 2, height: 2, close() {} } }
  try {
    const gltf = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '')
    assert.equal(decodedImages.length, 2)
    const meshes: SkinnedMesh[] = []; gltf.scene.traverse(n => { if (n instanceof SkinnedMesh) meshes.push(n) })
    for (const mesh of meshes) {
      assert.ok((mesh.material as any).map)
      assert.equal((mesh.material as any).map.flipY, false)
      const expected = new Uint8Array(readTexture(dir)(`textures/${mesh.userData.bobjObject}/default.png`)!)
      assert.ok(decodedImages.some(data => Buffer.from(data).equals(Buffer.from(expected))))
    }
  } finally { if (savedSelf === undefined) delete scope.self; else scope.self = savedSelf; if (savedBitmap === undefined) delete scope.createImageBitmap; else scope.createImageBitmap = savedBitmap }
}))
