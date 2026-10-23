import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { AnimationMixer, LoopOnce, Matrix4, Vector3, type Object3D } from 'three'
import { canonical } from '../cli/autoMapping.ts'
import { decodeGlb, encodeGlb } from '../cli/glb.ts'
import { loadAsset } from '../cli/loadAsset.ts'
import { runNormalize } from '../cli/normalizeCore.ts'
import { exportVerityOriginalArtifacts } from '../cli/verityOriginal.ts'
import { evaluateBobjAction, parseBobjActions } from '../src/index.ts'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { parseBobjArmature } from '../src/reverse.ts'
import { MIXAMO_TO_VERITY, VERITY_METRES_PER_UNIT } from '../src/verityRig.ts'

const targetPath = resolve(import.meta.dirname, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwW9WQAAAABJRU5ErkJggg==', 'base64')

async function syntheticVerity84(targetBytes: Uint8Array, boneCount = 84) {
  const target = await loadAsset(targetBytes, 'glb', { skeletonOnly: true }); target.updateMatrixWorld(true)
  const targetNodes = new Map<string, Matrix4>()
  target.traverse((node) => {
    const name = MIXAMO65_BONE_PARENTS.find(([joint]) => canonical(joint) === canonical(node.name))?.[0]
    if (name) targetNodes.set(name, node.matrixWorld.clone())
  })
  assert.equal(targetNodes.size, 65)
  const native = (world: Matrix4) => {
    const value = world.clone(), position = new Vector3().setFromMatrixPosition(value).multiplyScalar(1 / VERITY_METRES_PER_UNIT)
    value.setPosition(position)
    return value
  }
  const arm = (name: string, parent: string | null, world: Matrix4) => {
    const p = new Vector3().setFromMatrixPosition(world), tail = p.clone().add(new Vector3(0, 0.1, 0))
    return `arm_bone ${name}${parent ? ` ${parent}` : ''} ${tail.toArray().join(' ')} ${world.clone().transpose().toArray().join(' ')}`
  }
  const lines = ['arm_name verity.mdl', arm('Root', null, new Matrix4()), arm('COG', 'Root', native(targetNodes.get('Hips')!)),
    arm('Pelvis', 'COG', native(targetNodes.get('Hips')!).multiply(new Matrix4().makeRotationY(0.17)))]
  for (const [targetName, parentTarget] of MIXAMO65_BONE_PARENTS) {
    if (targetName === 'Hips') continue
    const source = MIXAMO_TO_VERITY[targetName]!
    const parent = targetName === 'LeftUpLeg' || targetName === 'RightUpLeg' ? 'Pelvis' : parentTarget === 'Hips' ? 'COG' : MIXAMO_TO_VERITY[parentTarget!]!
    lines.push(arm(source, parent, native(targetNodes.get(targetName)!)))
  }
  const head = native(targetNodes.get('Head')!), chest = native(targetNodes.get('Spine2')!)
  lines.push(arm('Jaw', 'Head', head.clone().multiply(new Matrix4().makeTranslation(0, -0.02, 0.04))))
  lines.push(arm('Wing_Bone_L', 'Chest', chest.clone().multiply(new Matrix4().makeTranslation(-0.3, 0, -0.1))))
  lines.push(arm('camera', 'Root', new Matrix4().makeTranslation(0, -2, 0)))
  lines.push(arm('Jaw_end_end', 'Jaw', head.clone().multiply(new Matrix4().makeTranslation(0, -0.06, 0.08))))
  for (let index = 0; index < boneCount - 71; index++) lines.push(arm(`Helper_${index}`, 'Root', new Matrix4().makeTranslation(0, 0, index * 0.01)))
  lines.push('o body', 'v -0.2 0 0', 'vw COG 1', 'v 0.2 0 0', 'vw COG 1', 'v 0 3.865407 0', 'vw Head 1', 'vt 0 0', 'vt 1 0', 'vt 0.5 1', 'vn 0 0 1', 'f 1/1/1 2/2/1 3/3/1')
  lines.push('o camera_helper', 'v -1 -2 0', 'vw camera 1', 'v 1 -2 0', 'vw camera 1', 'v 0 -1 0', 'vw camera 1', 'f 4/1/1 5/2/1 6/3/1')
  for (const name of ['idle', 'crouching', 'crouching_idle', 'dead', 'dying', 'running', 'sprinting', 'swipe']) {
    lines.push(`an ${name}`, 'ao Root', 'ag rotation 1', 'kf 0 0.35 LINEAR 0 0.35 0 0.35', 'kf 4 0.35 LINEAR 4 0.35 4 0.35')
    if (name === 'idle') lines.push('ao Wing_Bone_L', 'ag rotation 2', 'kf 0 0 LINEAR 0 0 0 0', 'kf 2 0.25 LINEAR 2 0.25 2 0.25', 'kf 4 0 LINEAR 4 0 4 0')
    lines.push('ao COG', 'ag location 0', 'kf 0 0 LINEAR 0 0 0 0', 'kf 4 0.08 LINEAR 4 0.08 4 0.08')
  }
  return lines.join('\r\n') + '\r\n'
}

test('Verity BOBJ normalization produces byte-prefix original BOBJ and full original-rig GLB', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'verity-cli-')), targetBytes = readFileSync(targetPath)
  const sourceText = '\uFEFF  ' + await syntheticVerity84(targetBytes), sourcePath = join(dir, 'model.bbs.bobj')
  writeFileSync(sourcePath, sourceText); mkdirSync(join(dir, 'textures', 'body'), { recursive: true }); writeFileSync(join(dir, 'textures', 'body', 'default.png'), png)
  const source = await loadAsset(Buffer.from(sourceText), 'bobj', { skeletonOnly: true, resourceDir: dir })
  assert.equal(source.scale.x, VERITY_METRES_PER_UNIT)
  const normalized = await runNormalize({ source, sourceLabel: 'model.bbs.bobj', sourceSha256: sha(sourceText),
    target: await loadAsset(targetBytes, 'glb', { skeletonOnly: true }), targetLabel: 'target.glb', targetSha256: sha(targetBytes), actions: [0], ground: 'off' })
  assert.equal(normalized.status, 'PASS', JSON.stringify(normalized.report))
  assert.ok('glb' in normalized)
  // Use an exactly representable endpoint so the final sample reaches clip.duration (not just below it).
  const timed = decodeGlb(normalized.glb)
  for (const input of new Set<number>(timed.json.animations.flatMap((animation: { samplers: Array<{ input: number }> }) => animation.samplers.map((sampler: { input: number }) => sampler.input)))) {
    const accessor = timed.json.accessors[input], view = timed.json.bufferViews[accessor.bufferView]
    const times = new DataView(timed.bin.buffer, timed.bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), accessor.count * 4)
    const duration = times.getFloat32((accessor.count - 1) * 4, true)
    for (let i = 0; i < accessor.count; i++) times.setFloat32(i * 4, times.getFloat32(i * 4, true) / duration * 0.25, true)
    accessor.max = [0.25]
  }
  normalized.glb = encodeGlb(timed.json, timed.bin)
  const artifact = await exportVerityOriginalArtifacts({ sourceText, sourcePath, normalizedGlb: normalized.glb })
  assert.equal(Buffer.from(artifact.bobj).subarray(0, Buffer.byteLength(sourceText)).toString(), sourceText)
  assert.equal(artifact.report.bones, 84); assert.equal(artifact.report.originalActions, 8); assert.equal(artifact.report.addedActions, 1)
  assert.equal(artifact.report.unitMeters, 0.4915394); assert.equal(artifact.report.selectedWingAction, 'idle')
  assert.ok(artifact.report.roundtripMaxPositionErrorUnits <= 1e-4, JSON.stringify(artifact.report))
  assert.ok(artifact.report.maxHipAngleDegrees <= 2); assert.ok(artifact.report.maxHeadAngleDegrees <= 2)
  const outputActions = parseBobjActions(artifact.bobj), armature = parseBobjArmature(sourceText)
  assert.deepEqual([...outputActions.keys()].slice(0, 8), ['idle', 'crouching', 'crouching_idle', 'dead', 'dying', 'running', 'sprinting', 'swipe'])
  const added = outputActions.get('idle_2')!; assert.ok(added); assert.equal(added.groups.has('Jaw'), false); assert.equal(added.groups.has('Wing_Bone_L'), true)
  for (const tick of [0, 4]) assert.ok(evaluateBobjAction(armature, added, tick).every((bone) => bone.worldMatrix.every(Number.isFinite)))
  // Compare independently sampled normalized motion with the written original-rig endpoint.
  // A repeating mixer silently samples frame zero at clip.duration; serialization-only checks miss that.
  const moving = await loadAsset(normalized.glb, 'glb', { skeletonOnly: true })
  const mixer = new AnimationMixer(moving), clip = moving.animations[0]!, playback = mixer.clipAction(clip)
  playback.setLoop(LoopOnce, 1); playback.clampWhenFinished = true; playback.play()
  const hips = (() => { let found: Object3D | undefined; moving.traverse(node => { if (canonical(node.name) === 'hips') found = node }); assert.ok(found); return found })()
  mixer.setTime(0); moving.updateMatrixWorld(true); const first = hips.getWorldPosition(new Vector3())
  mixer.setTime(clip.duration); moving.updateMatrixWorld(true); const last = hips.getWorldPosition(new Vector3())
  const expectedTravel = first.distanceTo(last) / VERITY_METRES_PER_UNIT
  const cogAt = (tick: number) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray([...evaluateBobjAction(armature, added, tick).find(bone => bone.name === 'COG')!.worldMatrix]))
  assert.ok(expectedTravel > 0.01, 'fixture must move between first and last key')
  assert.ok(Math.abs(cogAt(0).distanceTo(cogAt(added.durationTicks)) - expectedTravel) < 1e-4, 'last written key retains the independent normalized endpoint')
  const source101 = '\uFEFF  ' + await syntheticVerity84(targetBytes, 101)
  const artifact101 = await exportVerityOriginalArtifacts({ sourceText: source101, sourcePath, normalizedGlb: normalized.glb })
  assert.equal(artifact101.report.bones, 101); assert.equal(decodeGlb(artifact101.glb).json.skins[0].joints.length, 101)
  assert.equal(sha(Buffer.from(artifact101.bobj).subarray(0, Buffer.byteLength(source101))), sha(source101))
  const { json } = decodeGlb(artifact.glb)
  assert.equal(json.skins[0].joints.length, 84); assert.equal(json.animations.length, 9); assert.equal(json.images.length, 1)
  assert.equal(json.extras.bobjModel.unitMeters, 0.4915394); assert.deepEqual(json.extras.bobjModel.helperObjects, ['camera_helper'])

  const cliOut = join(dir, 'cli-out'), cli = resolve(import.meta.dirname, '../cli/normalize.ts'), builder = resolve(import.meta.dirname, '../../builder')
  const run = spawnSync(process.execPath, ['--import', 'tsx', cli, '--src', sourcePath, '--target', targetPath, '--out', cliOut, '--action', '0', '--ground', 'off', '--unit-meters', '0.25'],
    { cwd: builder, encoding: 'utf8', timeout: 30_000 })
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`)
  for (const file of ['model.bbs.glb', 'model.bbs.original.bbs.bobj', 'model.bbs.original.glb', 'model.bbs.report.json']) assert.ok(existsSync(join(cliOut, file)), file)
  const cliOriginal = readFileSync(join(cliOut, 'model.bbs.original.bbs.bobj'))
  assert.equal(sha(cliOriginal.subarray(0, Buffer.byteLength(sourceText))), sha(sourceText))
  const cliReport = JSON.parse(readFileSync(join(cliOut, 'model.bbs.report.json'), 'utf8'))
  assert.equal(cliReport.originalRig.bones, 84); assert.equal(cliReport.originalRig.originalActions, 8)
  assert.equal(cliReport.originalRig.unitMeters, 0.25)
  const explicitUnitSource = await loadAsset(Buffer.from(sourceText), 'bobj', { skeletonOnly: true, unitMeters: 0.25 })
  assert.equal(explicitUnitSource.scale.x, 0.25)
  const expectedExplicit = await runNormalize({ source: explicitUnitSource, sourceLabel: 'model.bbs.bobj', sourceSha256: sha(sourceText), target: await loadAsset(targetBytes, 'glb', { skeletonOnly: true }), targetLabel: 'target.glb', targetSha256: sha(targetBytes), actions: [0], ground: 'off', unitMeters: 1 })
  assert.ok('glb' in expectedExplicit)
  assert.equal(sha(readFileSync(join(cliOut, 'model.bbs.glb'))), sha(expectedExplicit.glb), 'explicit physical wrapper is applied exactly once')
  assert.ok(cliReport.originalRig.roundtripMaxPositionErrorUnits <= 1e-4)
  // A preset label alone does not make canonical bone names a native Verity topology (K2 regression).
  const nativeToCanonical = new Map(Object.entries(MIXAMO_TO_VERITY).map(([canonicalName, nativeName]) => [nativeName, canonicalName]))
  const canonicalSource = sourceText.replace(/\b[A-Za-z_][A-Za-z_0-9]*\b/g, name => nativeToCanonical.get(name) ?? name)
  const canonicalPath = join(dir, 'canonical.bbs.bobj'), canonicalOut = join(dir, 'canonical-out')
  writeFileSync(canonicalPath, canonicalSource)
  const canonicalRun = spawnSync(process.execPath, ['--import', 'tsx', cli, '--src', canonicalPath, '--target', targetPath, '--out', canonicalOut, '--action', '0', '--ground', 'off'],
    { cwd: builder, encoding: 'utf8', timeout: 30_000 })
  assert.equal(canonicalRun.status, 0, canonicalRun.stderr + canonicalRun.stdout)
  assert.equal(existsSync(join(canonicalOut, 'canonical.bbs.original.bbs.bobj')), false)
  const canonicalReport = JSON.parse(readFileSync(join(canonicalOut, 'canonical.bbs.report.json'), 'utf8'))
  assert.equal(canonicalReport.input.bobjModel.unitSource, 'verity-preset')
  assert.equal(canonicalReport.input.unitMeters, 1)
  assert.equal(canonicalReport.input.bobjModel.unitMeters, VERITY_METRES_PER_UNIT)
  console.log('Verity CLI original measurements', JSON.stringify(artifact.report))
})
