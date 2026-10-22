import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnimationClip, BoxGeometry, Bone, Float32BufferAttribute, MeshStandardMaterial, QuaternionKeyframeTrack, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, type Object3D } from 'three'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { decodeGlb, encodeGlb } from '../cli/glb.ts'
import { formatFromPath, loadAsset, type AssetFormat } from '../cli/loadAsset.ts'
import { applyModelMode, ModelBlockedError, readModelSourceFiles } from '../cli/modelExport.ts'
import { runNormalize } from '../cli/normalizeCore.ts'

const here = dirname(fileURLToPath(import.meta.url))
const targetPath = resolve(here, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
const cliPath = resolve(here, '../cli/normalize.ts')
const tsxHome = resolve(here, '../../builder')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const MIXAMO = new Set(MIXAMO65_BONE_PARENTS.map(([name]) => name))

async function normalizeBytes(srcBytes: Uint8Array, format: AssetFormat, unitMeters: number, source?: Object3D) {
  const targetBytes = readFileSync(targetPath)
  return runNormalize({ source: source ?? await loadAsset(srcBytes, format, { skeletonOnly: true }), sourceLabel: 'src', sourceSha256: sha(srcBytes),
    target: await loadAsset(targetBytes, 'glb', { skeletonOnly: true }), targetLabel: 'target.glb', targetSha256: sha(targetBytes), unitMeters })
}

function accessor(json: Record<string, any>, bin: Uint8Array, index: number) {
  const a = json.accessors[index], view = json.bufferViews[a.bufferView], components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type as string]!
  const start = bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0), length = a.count * components
  const copy = bin.buffer.slice(start, start + length * (a.componentType === 5126 ? 4 : a.componentType === 5125 ? 4 : 2))
  return a.componentType === 5126 ? new Float32Array(copy) : a.componentType === 5125 ? new Uint32Array(copy) : new Uint16Array(copy)
}

/** Skinned rest positions in meters, the way a viewer shows them (CPU skinning, no WebGL). */
function restPositions(root: Object3D, scale: number): Vector3[][] {
  root.updateMatrixWorld(true)
  const result: Vector3[][] = []
  root.traverse((node) => {
    const mesh = node as SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    mesh.skeleton.update()
    const position = mesh.geometry.getAttribute('position')
    result.push(Array.from({ length: position.count }, (_, i) => mesh.applyBoneTransform(i, new Vector3().fromBufferAttribute(position, i)).applyMatrix4(mesh.matrixWorld).multiplyScalar(scale)))
  })
  return result
}

/** All checks from the T2 acceptance list, applied to one source file; returns the numbers for the report. */
async function checkModelExport(path: string, unitMeters: number, expectImages: boolean) {
  const format = formatFromPath(path), bytes = readFileSync(path)
  const animation = await normalizeBytes(bytes, format, unitMeters)
  assert.ok('glb' in animation, `animation mode must succeed: ${JSON.stringify((animation.report as any).blocker)}`)
  const files = readModelSourceFiles(bytes, format, dirname(path))
  const source = await loadAsset(bytes, format, { keepMeshes: true, resourceDir: dirname(path) })
  const model = await applyModelMode(animation, { loadSource: async () => source, files, unitMeters, upAxis: 'y' })
  assert.ok('glb' in model)
  const report = model.report as any
  assert.equal(report.model.status, 'PASS', JSON.stringify(report.model.checks))
  assert.equal(model.manifest.glb.mode, 'model')
  assert.equal(report.status, 'PASS')

  const { json, bin } = decodeGlb(model.glb)
  assert.equal(json.skins.length, 1)
  assert.equal(json.skins[0].joints.length, 65)
  const jointNames = json.skins[0].joints.map((joint: number) => json.nodes[joint].name)
  assert.deepEqual(new Set(jointNames), MIXAMO)
  assert.equal(json.nodes.filter((node: any) => /mixamorig/i.test(node.name ?? '')).length, 0)
  assert.equal(json.animations.length, (animation as any).manifest.actions.length)
  assert.equal(json.animations.length, report.exportedActions)

  let maxInfluences = 0, maxSumError = 0, vertices = 0
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    const joints = accessor(json, bin, primitive.attributes.JOINTS_0), weights = accessor(json, bin, primitive.attributes.WEIGHTS_0)
    for (let v = 0; v < weights.length / 4; v++) {
      let sum = 0, count = 0
      for (let s = 0; s < 4; s++) { const w = weights[v * 4 + s]!; sum += w; if (w > 0) { count++; assert.ok(joints[v * 4 + s]! < 65) } }
      maxInfluences = Math.max(maxInfluences, count); maxSumError = Math.max(maxSumError, Math.abs(sum - 1))
    }
    vertices += weights.length / 4
  }
  assert.ok(maxInfluences <= 4)
  assert.ok(maxSumError < 1e-4, `weight sum error ${maxSumError}`)
  assert.equal(vertices, report.model.vertices)

  // Images: embedded through bufferView, byte-identical to the source images.
  const images: any[] = json.images ?? []
  assert.equal(images.length > 0, expectImages)
  for (const image of images) assert.ok(image.bufferView !== undefined && image.uri === undefined)
  assert.equal((json.buffers as any[]).every((buffer) => buffer.uri === undefined), true)
  if (files?.json.images?.length) {
    const sourceHashes = new Set(files.json.images.map((image: any) => { const v = files.json.bufferViews[image.bufferView]; return sha(files.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)) }))
    for (const image of images) { const v = json.bufferViews[image.bufferView]; assert.ok(sourceHashes.has(sha(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)))) }
  }

  // Bind pose: reload and compare CPU-skinned rest positions to the untouched source.
  const reloaded = await loadAsset(model.glb, 'glb', { keepMeshes: true })
  const before = restPositions(source, unitMeters), after = restPositions(reloaded, 1)
  assert.equal(after.length, before.length)
  let maxError = 0
  for (let m = 0; m < before.length; m++) { assert.equal(after[m]!.length, before[m]!.length); before[m]!.forEach((p, i) => { maxError = Math.max(maxError, p.distanceTo(after[m]![i]!)) }) }
  assert.ok(maxError < 1e-3, `rest error ${maxError} m`)
  let skeletons = 0
  const seen = new Set<Skeleton>()
  reloaded.traverse((node) => { const mesh = node as SkinnedMesh; if (mesh.isSkinnedMesh && !seen.has(mesh.skeleton)) { seen.add(mesh.skeleton); skeletons++ } })
  assert.equal(skeletons, 1)
  return { meshes: report.model.meshes, vertices, maxInfluencesBefore: report.model.maxInfluencesBefore, maxInfluences, maxSumError, images: images.length, maxError, jointFit: report.model.jointFit.maxMeters, animations: json.animations.length, dropped: report.model.droppedWeight, affected: report.model.affectedVertices }
}

test('Xbot (Mixamo GLB, no images) exports a skinned model with every Action', { skip: existsSync('C:/w01-samples/Xbot.glb') ? false : 'External fixture not present: C:/w01-samples/Xbot.glb' }, async () => {
  const numbers = await checkModelExport('C:/w01-samples/Xbot.glb', 1, false)
  console.log('Xbot', JSON.stringify(numbers))
})

test('Michelle (Mixamo GLB with textures) embeds the original image bytes', { skip: existsSync('C:/w01-samples/Michelle.glb') ? false : 'External fixture not present: C:/w01-samples/Michelle.glb' }, async () => {
  const numbers = await checkModelExport('C:/w01-samples/Michelle.glb', 1, true)
  console.log('Michelle', JSON.stringify(numbers))
})

const fbxPath = 'C:/Users/Administrator/Downloads/MODEL WARCRAFT/NAP MODEL CHO CLAUDE/MIXAMO/X BOT Hip Hop Dancing.fbx'
test('Mixamo FBX with skin exports a skinned model', { skip: existsSync(fbxPath) ? false : `External fixture not present: ${fbxPath}` }, async () => {
  const numbers = await checkModelExport(fbxPath, 0.01, false)
  console.log('FBX', JSON.stringify(numbers))
})

/** Mixamo65 rig cloned from the target, plus one extra bone and a box whose vertices carry up to 6 influences. */
async function syntheticSource(options: { withMesh: boolean }) {
  const root = await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })
  root.animations = [new AnimationClip('Wave', 1, [new QuaternionKeyframeTrack('mixamorigLeftArm.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0.3826834, 0.9238795])])]
  if (!options.withMesh) return root
  const bones: Bone[] = []
  root.traverse((node) => { if ((node as Bone).isBone) bones.push(node as Bone) })
  const extra = new Bone(); extra.name = 'mixamorigLeftHandExtra'; extra.position.set(0, 0.05, 0)
  const hand = bones.find((bone) => bone.name === 'mixamorigLeftHand')!
  hand.add(extra); bones.push(extra)
  const index = (name: string) => bones.findIndex((bone) => bone.name === name)
  const geometry = new BoxGeometry(0.2, 0.2, 0.2, 1, 1, 1), count = geometry.getAttribute('position').count
  const idx0 = new Uint16Array(count * 4), w0 = new Float32Array(count * 4), idx1 = new Uint16Array(count * 4), w1 = new Float32Array(count * 4)
  const six = ['mixamorigHips', 'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2', 'mixamorigNeck', 'mixamorigLeftHandExtra']
  const sixWeights = [0.3, 0.25, 0.2, 0.1, 0.1, 0.05]
  for (let v = 0; v < count; v++) {
    if (v === 0) { six.slice(0, 4).forEach((name, s) => { idx0[s] = index(name); w0[s] = sixWeights[s]! }); six.slice(4).forEach((name, s) => { idx1[s] = index(name); w1[s] = sixWeights[4 + s]! }) }
    else if (v === 1) { idx0[v * 4] = index('mixamorigLeftHandExtra'); w0[v * 4] = 1 }
    else { idx0[v * 4] = index('mixamorigHips'); w0[v * 4] = 1 }
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(idx0, 4)); geometry.setAttribute('skinWeight', new Float32BufferAttribute(w0, 4))
  geometry.setAttribute('skinIndex1', new Uint16BufferAttribute(idx1, 4)); geometry.setAttribute('skinWeight1', new Float32BufferAttribute(w1, 4))
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ color: 0xff0000 })); mesh.name = 'Body'
  root.add(mesh); root.updateMatrixWorld(true)
  mesh.bind(new Skeleton(bones))
  return root
}

test('synthetic skin: 6 influences are cut to 4 with weights renormalized, unmapped bones go to their parent joint', async () => {
  const bytes = new TextEncoder().encode('synthetic')
  const animation = await normalizeBytes(bytes, 'glb', 1, await syntheticSource({ withMesh: false }))
  assert.ok('glb' in animation)
  const model = await applyModelMode(animation, { loadSource: () => syntheticSource({ withMesh: true }), files: null, unitMeters: 1, upAxis: 'y' })
  assert.ok('glb' in model)
  const report = (model.report as any).model
  assert.equal(report.status, 'PASS', JSON.stringify(report.checks))
  assert.equal(report.maxInfluencesBefore, 6)
  assert.equal(report.maxInfluencesAfter, 4)
  assert.equal(report.affectedVertices, 1)
  assert.ok(Math.abs(report.droppedWeight - 0.15) < 1e-6)
  assert.deepEqual(report.reassignedBones, [{ bone: 'mixamorigLeftHandExtra', owner: 'LeftHand' }])
  assert.ok(report.restMaxErrorMeters < 1e-3)
  assert.ok(report.jointFit.maxMeters < 1e-6, 'identical skeleton must fit the target exactly')
  const { json, bin } = decodeGlb(model.glb)
  const primitive = json.meshes[0].primitives[0]
  const joints = accessor(json, bin, primitive.attributes.JOINTS_0), weights = accessor(json, bin, primitive.attributes.WEIGHTS_0)
  const names = json.skins[0].joints.map((joint: number) => json.nodes[joint].name)
  assert.deepEqual([0, 1, 2, 3].map((s) => names[joints[s]!]), ['Hips', 'Spine', 'Spine1', 'Spine2'])
  const kept = [0.3, 0.25, 0.2, 0.1], keptSum = kept.reduce((a, b) => a + b, 0)
  kept.forEach((w, s) => assert.ok(Math.abs(weights[s]! - w / keptSum) < 1e-6))
  assert.equal(names[joints[4]!], 'LeftHand')
  assert.equal(weights[4]!, 1)
  assert.equal(json.meshes[0].primitives.length, 1)
  assert.equal(json.materials.length, 1)
})

test('model mode fits a UE-named skeleton to mapped source joint positions', async () => {
  const bytes = new TextEncoder().encode('synthetic-ue')
  const original = await syntheticSource({ withMesh: false })
  const aliases: Record<string, string> = {
    Hips: 'pelvis', Spine: 'spine01', Spine1: 'spine02', Spine2: 'spine03', Neck: 'neck01',
    LeftShoulder: 'clavicle_l', LeftArm: 'upperarm_l', LeftForeArm: 'lowerarm_l', LeftHand: 'hand_l', LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l',
    RightShoulder: 'clavicle_r', RightArm: 'upperarm_r', RightForeArm: 'lowerarm_r', RightHand: 'hand_r', RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r',
  }
  const rename = (root: Object3D) => root.traverse((node) => {
    if (node.name.startsWith('mixamorig')) {
      const target = node.name.replace(/^mixamorig/, '')
      node.name = aliases[target] ?? target
    }
  })
  rename(original)
  const upper = original.getObjectByName('upperarm_l')!
  upper.position.multiplyScalar(1.2)
  original.updateMatrixWorld(true)
  const animation = await normalizeBytes(bytes, 'glb', 1, original)
  assert.ok('glb' in animation)
  const mapping = (animation.report as any).mapping
  mapping.family = 'ue'
  for (const joint of mapping.joints) if (aliases[joint.target]) joint.source = aliases[joint.target]
  const source = await syntheticSource({ withMesh: true })
  rename(source)
  source.getObjectByName('upperarm_l')!.position.multiplyScalar(1.2)
  source.updateMatrixWorld(true)
  const model = await applyModelMode(animation, { loadSource: async () => source, files: null, unitMeters: 1, upAxis: 'y' })
  assert.ok('glb' in model, JSON.stringify((model.report as any).blocker))
  const report = (model.report as any).model
  assert.equal(report.status, 'PASS', JSON.stringify(report.checks))
  assert.ok(report.fittedJoints >= 12)
  assert.ok(report.jointFit.maxMeters < 1e-6, `mapped joint fit ${report.jointFit.maxMeters} m`)
  assert.ok(report.restMaxErrorMeters < 1e-3, `skinned rest error ${report.restMaxErrorMeters} m`)
  assert.equal(report.warnings.some((warning: any) => warning.code === 'MODEL_NOT_REFIT'), false)
  assert.equal(decodeGlb(model.glb).json.skins[0].joints.length, 65)
  console.log('synthetic UE fit', JSON.stringify({ fittedJoints: report.fittedJoints, maxJointErrorMeters: report.jointFit.maxMeters, maxRestErrorMeters: report.restMaxErrorMeters }))
})

test('unknown family is BLOCKED before the mesh source is even loaded', async () => {
  const animation = await normalizeBytes(new TextEncoder().encode('synthetic-unknown'), 'glb', 1, await syntheticSource({ withMesh: false }))
  assert.ok('glb' in animation)
  const other = { ...animation, report: { ...animation.report, mapping: { ...animation.report.mapping, family: 'unknown' } } }
  let loaded = false
  const result = await applyModelMode(other, { loadSource: async () => { loaded = true; throw new Error('must not load') }, files: null, unitMeters: 1, upAxis: 'y' })
  assert.equal(result.status, 'BLOCKED')
  assert.equal('glb' in result, false)
  assert.equal((result.report as any).blocker.code, 'MODEL_MODE_FAMILY_UNSUPPORTED')
  assert.equal(loaded, false)
})

test('Draco and meshopt sources are BLOCKED with DRACO_UNSUPPORTED', () => {
  for (const extension of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression']) {
    const glb = encodeGlb({ asset: { version: '2.0' }, extensionsUsed: [extension], extensionsRequired: [extension] }, new Uint8Array(0))
    assert.throws(() => readModelSourceFiles(glb, 'glb'), (error: unknown) => error instanceof ModelBlockedError && error.code === 'DRACO_UNSUPPORTED')
  }
})

test('CLI: --mode model writes mode=model manifest for a Mixamo source', { timeout: 120_000, skip: existsSync('C:/w01-samples/Xbot.glb') ? false : 'External fixture not present: C:/w01-samples/Xbot.glb' }, () => {
  const out = mkdtempSync(join(tmpdir(), 'w01-model-'))
  const run = (src: string, extra: string[] = []) => spawnSync(process.execPath, ['--import', 'tsx', cliPath, '--src', src, '--target', targetPath, '--out', join(out, src.split('/').pop()!.replace(/\W/g, '_')), '--mode', 'model', ...extra], { cwd: tsxHome, encoding: 'utf8' })
  const ok = run('C:/w01-samples/Xbot.glb')
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  assert.match(ok.stdout, /model PASS/)
  const manifest = JSON.parse(readFileSync(join(out, 'Xbot_glb', 'Xbot.manifest.json'), 'utf8'))
  assert.equal(manifest.glb.mode, 'model')
  assert.equal(sha(readFileSync(join(out, 'Xbot_glb', 'Xbot.glb'))), manifest.glbSha256)
  const sion = 'C:/Users/Administrator/Downloads/MODEL WARCRAFT/NAP MODEL CHO CLAUDE/LOL/sion.glb'
  if (existsSync(sion)) {
    const blocked = run(sion)
    assert.equal(blocked.status, 2, blocked.stdout + blocked.stderr)
    assert.match(blocked.stdout, /MODEL_MODE_FAMILY_UNSUPPORTED/)
  }
})
