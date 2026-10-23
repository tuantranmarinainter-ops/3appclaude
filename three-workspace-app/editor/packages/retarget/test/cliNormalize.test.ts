import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnimationClip, AnimationMixer, Bone, Euler, Group, LoopOnce, Matrix4, Object3D, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import { buildAutoMapping, MIXAMO65_REQUIRED_JOINTS } from '../cli/autoMapping.ts'
import { loadAsset, removeFbxBoneAliases } from '../cli/loadAsset.ts'
import { runNormalize } from '../cli/normalizeCore.ts'
import { decodeGlb } from '../cli/glb.ts'
import { validateGlbContract } from '../cli/glbContract.ts'
import { VERITY_TO_MIXAMO } from '../src/verityRig.ts'

const here = dirname(fileURLToPath(import.meta.url))
const targetPath = resolve(here, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
const cliPath = resolve(here, '../cli/normalize.ts')
// tsx lives in the builder package; spawning there lets `--import tsx` resolve.
const tsxHome = resolve(here, '../../builder')

/** UE-style T-pose rig with root travel and an arm swing. */
function ueSource(options: { withoutLeftHand?: boolean } = {}) {
  const root = new Group(), bones = new Map<string, Bone>()
  const add = (name: string, parent: string | null, x: number, y: number, z = 0) => {
    const bone = new Bone(); bone.name = name; bone.position.set(x, y, z)
    ;(parent ? bones.get(parent)! : root).add(bone); bones.set(name, bone)
  }
  add('pelvis', null, 0, 1)
  add('spine_01', 'pelvis', 0, 0.1); add('spine_02', 'spine_01', 0, 0.1); add('spine_03', 'spine_02', 0, 0.1)
  add('neck_01', 'spine_03', 0, 0.15); add('head', 'neck_01', 0, 0.1)
  for (const [side, sign] of [['l', 1], ['r', -1]] as const) {
    add(`clavicle_${side}`, 'spine_03', 0.05 * sign, 0.1); add(`upperarm_${side}`, `clavicle_${side}`, 0.1 * sign, 0)
    add(`lowerarm_${side}`, `upperarm_${side}`, 0.25 * sign, 0)
    if (!(options.withoutLeftHand && side === 'l')) add(`hand_${side}`, `lowerarm_${side}`, 0.25 * sign, 0)
    add(`thigh_${side}`, 'pelvis', 0.1 * sign, -0.05); add(`calf_${side}`, `thigh_${side}`, 0, -0.45)
    add(`foot_${side}`, `calf_${side}`, 0, -0.45); add(`ball_${side}`, `foot_${side}`, 0, -0.05, 0.12)
  }
  const down = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.6)
  root.animations = [new AnimationClip('Walk forward', 1, [
    new VectorKeyframeTrack('pelvis.position', [0, 1], [0, 1, 0, 0, 1, 1]),
    new QuaternionKeyframeTrack('upperarm_l.quaternion', [0, 1], [0, 0, 0, 1, ...down.toArray()]),
  ])]
  return root
}

test('auto mapping resolves UE names to the required Mixamo65 joints', async () => {
  const target = await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })
  const src = createThreeRigAdapter(ueSource(), { fingerprint: 'ue' }), dst = createThreeRigAdapter(target, { fingerprint: 'mixamo' })
  const mapping = buildAutoMapping(src.rig, dst.rig)
  assert.equal(mapping.family, 'ue')
  assert.deepEqual(mapping.missingRequired, [])
  assert.equal(mapping.joints.find((joint) => joint.target === 'LeftForeArm')?.source, 'lowerarm_l')
  assert.equal(mapping.joints.find((joint) => joint.target === 'Spine2')?.source, 'spine_03')
  assert.ok(mapping.pairs.length >= MIXAMO65_REQUIRED_JOINTS.length)
  const broken = createThreeRigAdapter(ueSource({ withoutLeftHand: true }), { fingerprint: 'ue-broken' })
  assert.deepEqual(buildAutoMapping(broken.rig, dst.rig).missingRequired, ['LeftHand'])
  src.dispose(); dst.dispose(); broken.dispose()
})

function veritySource() {
  const root = new Group(); root.scale.setScalar(1.7)
  const bones = new Map<string, Bone>(), sourceByTarget = new Map(Object.entries(VERITY_TO_MIXAMO).map(([source, target]) => [target, source]))
  const add = (name: string, parent: Object3D, position: Vector3) => { const bone = new Bone(); bone.name = name; bone.position.copy(position); parent.add(bone); bones.set(name, bone); return bone }
  const rootBone = add('Root', root, new Vector3())
  const cog = add('COG', rootBone, new Vector3(0, 1, 0))
  const pelvis = add('Pelvis', cog, new Vector3(0, -0.03, 0)); pelvis.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.17)
  for (const [target, parentTarget] of MIXAMO65_BONE_PARENTS) {
    if (target === 'Hips') continue
    const source = sourceByTarget.get(target)!
    const parentSource = sourceByTarget.get(parentTarget!)!
    const parent = /^(Left|Right)UpLeg$/.test(target) ? pelvis : bones.get(parentSource)!
    const side = target.startsWith('Left') ? 1 : target.startsWith('Right') ? -1 : 0
    const position = /UpLeg$/.test(target) ? new Vector3(0.11 * side, -0.08, 0) :
      /Leg$/.test(target) ? new Vector3(0, -0.42, 0) : /Foot$/.test(target) ? new Vector3(0, -0.4, 0.08) :
      /Arm$/.test(target) ? new Vector3(0.18 * side, 0, 0) : /ForeArm$/.test(target) ? new Vector3(0.25 * side, 0, 0) :
      /Hand$/.test(target) ? new Vector3(0.22 * side, 0, 0) : new Vector3(side * 0.03, 0.08, 0)
    const bone = add(source, parent, position)
    if (target === 'Head') bone.quaternion.setFromEuler(new Euler(0.23, -0.19, 0.11))
  }
  const jaw = add('Jaw', bones.get('Head')!, new Vector3(0, -0.08, 0.04))
  jaw.quaternion.setFromEuler(new Euler(0.12, 0.07, -0.04))
  const wing = add('Wing_Bone_L', bones.get('Chest')!, new Vector3(0.22, 0.02, -0.04))
  add('camera', rootBone, new Vector3(0, -2, 0))
  add('Jaw_end_end', jaw, new Vector3(0, -0.04, 0.02))
  add('Wing_end_end', wing, new Vector3(0.1, 0, 0))
  for (let index = 0; index < 12; index++) add(`Helper_${index}`, index % 2 ? bones.get('Chest')! : rootBone, new Vector3(0, index * 0.005, 0))
  const q = (axis: Vector3, angle: number) => new Quaternion().setFromAxisAngle(axis, angle).toArray()
  root.animations = [
    new AnimationClip('original', 1, [new QuaternionKeyframeTrack('Jaw.quaternion', [0, 1], [...jaw.quaternion.toArray(), ...q(new Vector3(1, 0, 0), 0.2)])]),
    new AnimationClip('selected', 2, [
      new VectorKeyframeTrack('COG.position', [0, 0.5, 1, 1.5, 2], [0, 1, 0, 0.02, 1.01, 0.03, 0.04, 1.02, 0.06, 0.06, 1.01, 0.09, 0.08, 1, 0.12]),
      new QuaternionKeyframeTrack('Head.quaternion', [0, 0.5, 1, 1.5, 2], [0, 0, 0, 1, ...q(new Vector3(1, 0, 0), 0.1), ...q(new Vector3(1, 0, 0), 0.2), ...q(new Vector3(1, 0, 0), 0.3), ...q(new Vector3(1, 0, 0), 0.4)]),
      new QuaternionKeyframeTrack('Jaw.quaternion', [0, 0.5, 1, 1.5, 2], [...jaw.quaternion.toArray(), ...q(new Vector3(1, 0, 0), 0.18), ...q(new Vector3(1, 0, 0), 0.3), ...q(new Vector3(1, 0, 0), 0.42), ...q(new Vector3(1, 0, 0), 0.5)]),
      new QuaternionKeyframeTrack('Wing_Bone_L.quaternion', [0, 2], [0, 0, 0, 1, ...q(new Vector3(0, 0, 1), 0.8)]),
    ]),
  ]
  return root
}

test('Verity CLI auto preset writes 65 skin joints, animated Jaw scene extra, and no wing keys', async () => {
  const source = veritySource()
  const target = await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })
  const src = createThreeRigAdapter(source, { fingerprint: 'verity' }), dst = createThreeRigAdapter(target, { fingerprint: 'mixamo' })
  const mapping = buildAutoMapping(src.rig, dst.rig)
  assert.equal(mapping.family, 'verity')
  assert.equal(mapping.pairs.length, 65)
  assert.deepEqual(mapping.missingRequired, [])
  assert.equal(mapping.joints.find((joint) => joint.target === 'Hips')?.source, 'COG')
  assert.ok(!mapping.joints.some((joint) => ['Pelvis', 'Root', 'Jaw', 'Wing_Bone_L'].includes(joint.source ?? '')))
  src.dispose(); dst.dispose()

  source.updateMatrixWorld(true); target.updateMatrixWorld(true)
  const sourceHead = source.getObjectByName('Head')!, sourceJaw = source.getObjectByName('Jaw')!
  let targetHead: Object3D | undefined; target.traverse((node) => { if (/Head$/.test(node.name) && !/HeadTop/.test(node.name)) targetHead = node })
  const sourceHeadRestQ = new Quaternion(), sourceHeadScale = new Vector3(), targetHeadRestQ = new Quaternion()
  sourceHead.matrixWorld.decompose(new Vector3(), sourceHeadRestQ, sourceHeadScale)
  targetHead!.matrixWorld.decompose(new Vector3(), targetHeadRestQ, new Vector3())
  const expectedMixer = new AnimationMixer(source), expectedAction = expectedMixer.clipAction(source.animations[1]!).play()
  expectedMixer.setTime(0.5); source.updateMatrixWorld(true)
  const sourceJawRelative = sourceHead.matrixWorld.clone().invert().multiply(sourceJaw.matrixWorld)
  const sourceJawPosition = new Vector3(); sourceJawRelative.decompose(sourceJawPosition, new Quaternion(), new Vector3())
  const expectedBasis = targetHeadRestQ.clone().invert().multiply(sourceHeadRestQ)
  const expectedJawLocalPosition = sourceJawPosition.multiplyScalar(0.4915394 * (sourceHeadScale.x + sourceHeadScale.y + sourceHeadScale.z) / 3).applyQuaternion(expectedBasis)
  expectedAction.stop(); expectedMixer.uncacheRoot(source)

  const result = await runNormalize({ source, sourceLabel: 'verity.glb', sourceSha256: '7'.repeat(64), target,
    targetLabel: 'mixamo65.glb', targetSha256: '8'.repeat(64), actions: [1], actionRanges: { 1: [0.5, 1.5] },
    unitMeters: 0.4915394, calibrate: 'off', facingDegrees: 0, ground: 'off' })
  assert.equal(result.status, 'PASS', JSON.stringify(result.report))
  assert.deepEqual(result.manifest.actions.map((action) => [action.name, action.sourceActionIndex, action.durationSeconds]), [['selected', 1, 1]])
  assert.equal((result.manifest as any).extraBoneMode, 'scene-nodes')
  assert.equal((result.manifest as any).extraBones.length, 19)
  validateGlbContract(result.glb!, result.manifest as any)
  const { json, bin } = decodeGlb(result.glb!)
  const skinNames = json.skins[0].joints.map((index: number) => json.nodes[index].name)
  assert.equal(skinNames.length, 65)
  assert.deepEqual([...skinNames].sort(), MIXAMO65_BONE_PARENTS.map(([name]) => name).sort())
  const jaw = json.nodes.findIndex((node: any) => node.name === 'X_Head_Jaw')
  const wing = json.nodes.findIndex((node: any) => node.name.startsWith('X_Spine2_Wing_Bone_L'))
  assert.ok(jaw >= 0 && wing >= 0)
  assert.equal((result.manifest as any).extraBones.every((bone: any) => json.nodes.some((node: any) => node.name === bone.name)), true)
  const targets = json.animations[0].channels.map((channel: any) => [json.nodes[channel.target.node].name, channel.target.path])
  assert.ok(targets.some(([name, path]: string[]) => name === 'X_Head_Jaw' && path === 'rotation'))
  assert.ok(targets.some(([name, path]: string[]) => name === 'X_Head_Jaw' && path === 'translation'))
  assert.ok(!targets.some(([name]: string[]) => name.startsWith('X_Spine2_Wing')))
  const restOnlyExtras = new Set((result.manifest as any).extraBones.map((bone: any) => bone.name).filter((name: string) => name !== 'X_Head_Jaw'))
  assert.ok(!targets.some(([name]: string[]) => restOnlyExtras.has(name)))
  const jawInput = json.animations[0].samplers[json.animations[0].channels.find((channel: any) => channel.target.node === jaw).sampler].input
  assert.equal(json.accessors[jawInput].max[0], 1)
  const jawTranslationChannel = json.animations[0].channels.find((channel: any) => channel.target.node === jaw && channel.target.path === 'translation')
  const jawTranslationAccessor = json.accessors[json.animations[0].samplers[jawTranslationChannel.sampler].output]
  const jawTranslationView = json.bufferViews[jawTranslationAccessor.bufferView]
  const serializedJawStart = [...new Float32Array(bin.buffer, bin.byteOffset + (jawTranslationView.byteOffset ?? 0), 3)]

  const reloaded = createThreeRigAdapter(await loadAsset(result.glb!, 'glb'), { fingerprint: 'verity-output',
    jointNames: [...MIXAMO65_BONE_PARENTS.map(([name]) => name), ...(result.manifest as any).extraBones.map((bone: any) => bone.name)] })
  const worldQ = (name: string, time: number) => {
    const bone = reloaded.rig.bones.find((item) => item.name === name)!
    const sample = reloaded.sample(0, time).find((item) => item.id === bone.id)!
    return new Quaternion().setFromRotationMatrix(new Matrix4().fromArray(sample.world))
  }
  const angleDelta = (name: string) => worldQ(name, 0).angleTo(worldQ(name, 1)) * 180 / Math.PI
  const hipsDegrees = angleDelta('Hips'), headDegrees = angleDelta('Head')
  const firstPose = new Map(reloaded.sample(0, 0).map((item) => [reloaded.rig.bones.find((bone) => bone.id === item.id)?.name, new Matrix4().fromArray(item.world)]))
  const actualJawLocal = firstPose.get('Head')!.clone().invert().multiply(firstPose.get('X_Head_Jaw')!)
  const actualJawLocalPosition = new Vector3().setFromMatrixPosition(actualJawLocal)
  console.log('Verity CLI GLB measurements', JSON.stringify({ skinJoints: skinNames.length, animations: json.animations.length,
    jawChannels: targets.filter(([name]: string[]) => name === 'X_Head_Jaw').length, wingChannels: targets.filter(([name]: string[]) => name.startsWith('X_Spine2_Wing')).length,
    hipsDegrees, headDegrees, jawPositionError: actualJawLocalPosition.distanceTo(expectedJawLocalPosition), expectedJawLocalPosition: expectedJawLocalPosition.toArray(), actualJawLocalPosition: actualJawLocalPosition.toArray(), serializedJawStart }))
  assert.ok(hipsDegrees <= 2)
  assert.ok(Math.abs(headDegrees - 0.2 * 180 / Math.PI) <= 2)
  assert.ok(actualJawLocalPosition.distanceTo(expectedJawLocalPosition) <= 1e-4)

  const normalizedSource = await loadAsset(result.glb!, 'glb')
  const secondTarget = await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })
  const second = await runNormalize({ source: normalizedSource, sourceLabel: 'verity-normalized.glb', sourceSha256: result.manifest.glbSha256,
    sourceExtraManifest: result.manifest as any, sourceExtraGlb: result.glb!, target: secondTarget,
    targetLabel: 'mixamo65.glb', targetSha256: '8'.repeat(64), actions: [0],
    unitMeters: 1, calibrate: 'off', facingDegrees: 0, ground: 'off' })
  assert.equal(second.status, 'PASS', JSON.stringify(second.report))
  assert.equal((second.manifest as any).extraBoneMode, 'scene-nodes')
  assert.equal((second.manifest as any).extraBones.length, 19)
  assert.deepEqual(second.manifest.actions.map((action) => [action.sourceActionIndex, action.durationSeconds]), [[0, 1]])
  validateGlbContract(second.glb!, second.manifest as any)
  const secondJson = decodeGlb(second.glb!).json
  const secondSkinNames = secondJson.skins[0].joints.map((index: number) => secondJson.nodes[index].name)
  assert.equal(secondSkinNames.length, 65)
  assert.deepEqual([...secondSkinNames].sort(), MIXAMO65_BONE_PARENTS.map(([name]) => name).sort())
  assert.equal((second.manifest as any).extraBones.every((bone: any) => secondJson.nodes.some((node: any) => node.name === bone.name)), true)
  const secondTargets = secondJson.animations[0].channels.map((channel: any) => [secondJson.nodes[channel.target.node].name, channel.target.path])
  assert.ok(secondTargets.some(([name, path]: string[]) => name === 'X_Head_Jaw' && path === 'rotation'))
  assert.ok(secondTargets.some(([name, path]: string[]) => name === 'X_Head_Jaw' && path === 'translation'))
  assert.ok(!secondTargets.some(([name]: string[]) => name !== 'X_Head_Jaw' && name.startsWith('X_')))
  const extraValues = (decoded: ReturnType<typeof decodeGlb>, path: 'translation' | 'rotation') => {
    const node = decoded.json.nodes.findIndex((item: any) => item.name === 'X_Head_Jaw')
    const channel = decoded.json.animations[0].channels.find((item: any) => item.target.node === node && item.target.path === path)
    const accessor = decoded.json.accessors[decoded.json.animations[0].samplers[channel.sampler].output]
    const view = decoded.json.bufferViews[accessor.bufferView], width = path === 'rotation' ? 4 : 3
    return new Float32Array(decoded.bin.buffer, decoded.bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), accessor.count * width)
  }
  const firstDecoded = { json, bin }, secondDecoded = decodeGlb(second.glb!)
  const firstJawP = extraValues(firstDecoded, 'translation'), secondJawP = extraValues(secondDecoded, 'translation')
  const firstJawQ = extraValues(firstDecoded, 'rotation'), secondJawQ = extraValues(secondDecoded, 'rotation')
  for (const frame of [0, 15, 30]) {
    const positionError = new Vector3().fromArray(firstJawP, frame * 3).distanceTo(new Vector3().fromArray(secondJawP, frame * 3))
    const rotationError = new Quaternion().fromArray(firstJawQ, frame * 4).normalize().angleTo(new Quaternion().fromArray(secondJawQ, frame * 4).normalize())
    console.log('Verity re-normalize Jaw sample', JSON.stringify({ frame, positionError, rotationError }))
    assert.ok(positionError <= 1e-6)
    assert.ok(rotationError <= 1e-5)
  }
  assert.ok(new Quaternion().fromArray(firstJawQ, 30 * 4).normalize().angleTo(new Quaternion().fromArray(firstJawQ, 0).normalize()) > 0.01,
    'full-duration Jaw endpoint must not wrap to the first key')

  const trimmedSource = await loadAsset(result.glb!, 'glb'), trimmedExpected = await loadAsset(result.glb!, 'glb')
  const expectedJaw = trimmedExpected.getObjectByName('X_Head_Jaw')!, expectedMixer2 = new AnimationMixer(trimmedExpected)
  const expectedAction2 = expectedMixer2.clipAction(trimmedExpected.animations[0]!).setLoop(LoopOnce, 1).play()
  expectedAction2.clampWhenFinished = true
  const expectedTrimmed = [0.25, 0.75].map((time) => {
    expectedMixer2.setTime(time)
    return { position: expectedJaw.position.clone(), rotation: expectedJaw.quaternion.clone().normalize() }
  })
  const trimmed = await runNormalize({ source: trimmedSource, sourceLabel: 'verity-normalized.glb', sourceSha256: result.manifest.glbSha256,
    sourceExtraManifest: result.manifest as any, sourceExtraGlb: result.glb!, target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }),
    targetLabel: 'mixamo65.glb', targetSha256: '8'.repeat(64), actions: [0], range: [0.25, 0.75],
    unitMeters: 1, calibrate: 'off', facingDegrees: 0, ground: 'off' })
  assert.equal(trimmed.status, 'PASS', JSON.stringify(trimmed.report))
  assert.deepEqual(trimmed.manifest.actions.map((action) => [action.sourceActionIndex, action.durationSeconds]), [[0, 0.5]])
  validateGlbContract(trimmed.glb!, trimmed.manifest as any)
  const trimmedDecoded = decodeGlb(trimmed.glb!), trimmedP = extraValues(trimmedDecoded, 'translation'), trimmedQ = extraValues(trimmedDecoded, 'rotation')
  for (const [frame, expected] of [[0, expectedTrimmed[0]!], [15, expectedTrimmed[1]!]] as const) {
    assert.ok(new Vector3().fromArray(trimmedP, frame * 3).distanceTo(expected.position) <= 1e-6)
    assert.ok(new Quaternion().fromArray(trimmedQ, frame * 4).normalize().angleTo(expected.rotation) <= 1e-5)
  }
  const probe = process.env.K3_LIBRARY_PROBE_DIR
  if (probe) {
    mkdirSync(probe, { recursive: true }); writeFileSync(join(probe, 'model.glb'), result.glb!)
    writeFileSync(join(probe, 'model.manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n')
    writeFileSync(join(probe, 'model.report.json'), JSON.stringify(result.report, null, 2) + '\n')
  }
  reloaded.dispose()
})

test('auto mapping resolves League of Legends (lol2gltf) names', async () => {
  const root = new Group(), bones = new Map<string, Bone>()
  const add = (name: string, parent: string | null) => { const bone = new Bone(); bone.name = name; bone.position.y = 0.1; (parent ? bones.get(parent)! : root).add(bone); bones.set(name, bone) }
  add('Root', null); add('Spine1', 'Root'); add('Spine2', 'Spine1'); add('Spine3', 'Spine2'); add('Neck', 'Spine3'); add('Head', 'Neck'); add('Pelvis', 'Root')
  for (const s of ['L', 'R']) {
    add(`${s}_Clavicle`, 'Spine3'); add(`${s}_Shoulder`, `${s}_Clavicle`); add(`${s}_Elbow`, `${s}_Shoulder`); add(`${s}_Hand`, `${s}_Elbow`)
    add(`${s}_Index1`, `${s}_Hand`); add(`${s}_Index2`, `${s}_Index1`)
    add(`${s}_Hip`, 'Pelvis'); add(`${s}_KneeUpper`, `${s}_Hip`); add(`${s}_KneeLower`, `${s}_KneeUpper`); add(`${s}_Foot`, `${s}_KneeLower`); add(`${s}_Toe`, `${s}_Foot`)
  }
  const target = await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })
  const src = createThreeRigAdapter(root, { fingerprint: 'lol' }), dst = createThreeRigAdapter(target, { fingerprint: 'mixamo' })
  const mapping = buildAutoMapping(src.rig, dst.rig)
  const of = (name: string) => mapping.joints.find((joint) => joint.target === name)?.source
  assert.equal(mapping.family, 'lol')
  assert.deepEqual(mapping.missingRequired, [])
  assert.deepEqual([of('Hips'), of('Spine'), of('Spine2'), of('LeftArm'), of('LeftForeArm'), of('LeftUpLeg'), of('LeftLeg'), of('LeftToeBase'), of('LeftHandIndex2'), of('LeftHandIndex3')],
    ['Root', 'Spine1', 'Spine3', 'L_Shoulder', 'L_Elbow', 'L_Hip', 'L_KneeLower', 'L_Toe', 'L_Index2', null])
  src.dispose(); dst.dispose()
})

test('auto mapping resolves Warcraft III Reforged (WhiteoutLib GltfConverter) names', async () => {
  const root = new Group(), bones = new Map<string, Bone>()
  const add = (name: string, parent: string | null) => { const bone = new Bone(); bone.name = name; bone.position.y = 0.1; (parent ? bones.get(parent)! : root).add(bone); bones.set(name, bone) }
  add('local_C0_0_jnt', null); add('spine_C0_0_jnt', 'local_C0_0_jnt'); add('spine_C0_1_jnt', 'spine_C0_0_jnt'); add('bone_chest', 'spine_C0_1_jnt')
  add('neck_C0_0_jnt', 'bone_chest'); add('neck_C0_1_jnt', 'neck_C0_0_jnt'); add('neck_C0_2_jnt', 'neck_C0_1_jnt'); add('bone_head', 'neck_C0_2_jnt')
  for (const s of ['L', 'R']) {
    add(`shoulder_${s}0_shoulder_jnt`, 'bone_chest'); let parent = `shoulder_${s}0_shoulder_jnt`
    for (const part of ['0', '1', '2', '3', '4', 'end']) { add(`arm_${s}0_${part}_jnt`, parent); parent = `arm_${s}0_${part}_jnt` }
    add(`thumb_${s}0_0_jnt`, parent); add(`thumb_${s}0_1_jnt`, `thumb_${s}0_0_jnt`)
    parent = 'spine_C0_0_jnt'
    for (const part of ['0', '1', '2', '3', '4', 'end']) { add(`leg_${s}0_${part}_jnt`, parent); parent = `leg_${s}0_${part}_jnt` }
    add(`foot_${s}0_0_jnt`, parent)
  }
  const target = await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })
  const src = createThreeRigAdapter(root, { fingerprint: 'wc3r' }), dst = createThreeRigAdapter(target, { fingerprint: 'mixamo' })
  const mapping = buildAutoMapping(src.rig, dst.rig)
  const of = (name: string) => mapping.joints.find((joint) => joint.target === name)?.source
  assert.equal(mapping.family, 'wc3r')
  assert.deepEqual(mapping.missingRequired, [])
  assert.deepEqual([of('Hips'), of('Spine'), of('Spine1'), of('Spine2'), of('Neck'), of('Head'), of('RightShoulder'), of('RightArm'), of('RightForeArm'), of('RightHand'),
    of('RightUpLeg'), of('RightLeg'), of('RightFoot'), of('RightToeBase'), of('RightHandThumb2')],
  ['spine_C0_0_jnt', 'spine_C0_1_jnt', null, 'bone_chest', 'neck_C0_0_jnt', 'bone_head', 'shoulder_R0_shoulder_jnt', 'arm_R0_0_jnt', 'arm_R0_2_jnt', 'arm_R0_end_jnt',
    'leg_R0_0_jnt', 'leg_R0_2_jnt', 'leg_R0_end_jnt', 'foot_R0_0_jnt', 'thumb_R0_1_jnt'])
  src.dispose(); dst.dispose()
})

test('auto mapping resolves wow.export rigs: named bones, `_p` pivots, and unnamed knee/spine found by structure', async () => {
  const root = new Group(), nodes = new Map<string, Group | Bone>()
  // wow.export inserts a non-bone `<name>_p` pivot above every bone.
  const add = (name: string, parent: string | null) => {
    const pivot = new Group(); pivot.name = `${name}_p`; pivot.position.y = 0.1; (parent ? nodes.get(parent)! : root).add(pivot)
    const bone = new Bone(); bone.name = name; pivot.add(bone); nodes.set(name, bone)
  }
  add('bone_Main', null); add('bone_Root', 'bone_Main'); add('bone_SpineLow', 'bone_Root'); add('bone_4', 'bone_SpineLow'); add('bone_Chest', 'bone_4')
  add('bone_Neck', 'bone_Chest'); add('bone_Head', 'bone_Neck'); add('bone_Waist', 'bone_Root')
  for (const s of ['L', 'R']) {
    add(`bone_Shoulder${s}`, 'bone_Chest'); add(`bone_Arm${s}`, `bone_Shoulder${s}`); add(`bone_Elbow${s}`, `bone_Arm${s}`); add(`bone_Hand${s}`, `bone_Elbow${s}`)
    add(`bone_Leg${s}`, 'bone_Waist'); add(`bone_${s === 'L' ? 10 : 11}`, `bone_Leg${s}`); add(`bone_Foot${s}`, `bone_${s === 'L' ? 10 : 11}`)
  }
  const target = await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })
  const src = createThreeRigAdapter(root, { fingerprint: 'wow' }), dst = createThreeRigAdapter(target, { fingerprint: 'mixamo' })
  const mapping = buildAutoMapping(src.rig, dst.rig)
  const of = (name: string) => mapping.joints.find((joint) => joint.target === name)
  assert.equal(mapping.family, 'wow')
  assert.deepEqual(mapping.missingRequired, [])
  assert.deepEqual(['Hips', 'Spine', 'Spine1', 'Spine2', 'Head', 'LeftForeArm', 'LeftUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot'].map((name) => of(name)?.source),
    ['bone_Root', 'bone_SpineLow', 'bone_4', 'bone_Chest', 'bone_Head', 'bone_ElbowL', 'bone_LegL', 'bone_10', 'bone_11', 'bone_FootL'])
  assert.equal(of('LeftLeg')?.via, 'structure:wow')
  src.dispose(); dst.dispose()
})

test('auto mapping resolves modern WoW elf rigs (EXP leg/neck names, upper chest = shoulders parent)', async () => {
  const root = new Group(), nodes = new Map<string, Group | Bone>()
  const add = (name: string, parent: string | null) => {
    const pivot = new Group(); pivot.name = `${name}_p`; pivot.position.y = 0.1; (parent ? nodes.get(parent)! : root).add(pivot)
    const bone = new Bone(); bone.name = name; pivot.add(bone); nodes.set(name, bone)
  }
  add('bone_Main', null); add('bone_Root', 'bone_Main'); add('bone_SpineLow', 'bone_Root'); add('bone_EXP_C1_Spine2', 'bone_SpineLow')
  add('bone_Chest', 'bone_EXP_C1_Spine2'); add('bone_21', 'bone_Chest'); add('bone_EXP_C1_Neck1', 'bone_21'); add('bone_EXP_C1_Neck2', 'bone_EXP_C1_Neck1')
  add('bone_Head', 'bone_EXP_C1_Neck2'); add('bone_EXP_C1_Pelvis1', 'bone_Root')
  for (const s of ['L', 'R']) {
    add(`bone_Shoulder${s}`, 'bone_21'); add(`bone_Arm${s}`, `bone_Shoulder${s}`); add(`bone_Elbow${s}`, `bone_Arm${s}`); add(`bone_Hand${s}`, `bone_Elbow${s}`)
    add(`bone_EXP_${s}1_Leg1Twist1`, 'bone_EXP_C1_Pelvis1'); add(`bone_EXP_${s}1_Leg2Twist1`, `bone_EXP_${s}1_Leg1Twist1`)
    add(`bone_${s === 'L' ? 19 : 20}`, `bone_EXP_${s}1_Leg2Twist1`); add(`bone_Foot${s}`, `bone_${s === 'L' ? 19 : 20}`)
  }
  const target = await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })
  const src = createThreeRigAdapter(root, { fingerprint: 'elf' }), dst = createThreeRigAdapter(target, { fingerprint: 'mixamo' })
  const mapping = buildAutoMapping(src.rig, dst.rig)
  const of = (name: string) => mapping.joints.find((joint) => joint.target === name)?.source
  assert.equal(mapping.family, 'wow')
  assert.deepEqual(mapping.missingRequired, [])
  assert.deepEqual(['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightLeg'].map(of),
    ['bone_Root', 'bone_SpineLow', 'bone_EXP_C1_Spine2', 'bone_21', 'bone_EXP_C1_Neck1', 'bone_Head', 'bone_EXP_L1_Leg1Twist1', 'bone_EXP_L1_Leg2Twist1', 'bone_FootL', 'bone_EXP_R1_Leg2Twist1'])
  src.dispose(); dst.dispose()
})

test('runNormalize returns GLB, contract manifest and gated report', async () => {
  const target = await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })
  const result = await runNormalize({ source: ueSource(), sourceLabel: 'ue.glb', sourceSha256: 'a'.repeat(64), target, targetLabel: 'mixamo65.glb',
    targetSha256: 'b'.repeat(64), preview: true })
  assert.equal(result.report.status, 'PASS')
  assert.equal(result.report.gates.mapping, 'PASS')
  assert.equal(result.report.gates.roundtrip, 'PASS')
  assert.equal(result.manifest.version, '1.0.0')
  assert.equal(result.manifest.actions.length, 1)
  assert.equal(result.manifest.actions[0]!.fps, 30)
  assert.match(result.manifest.actions[0]!.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.ok(Math.abs(result.manifest.actions[0]!.durationSeconds - 1) < 1e-6)
  assert.ok(result.manifest.fingerprint.hipsHeightMeters > 0.5)
  const proportions = (result.report as any).proportions
  assert.ok(Math.abs(proportions.sourceHipsHeightMeters - 1) < 1e-6)
  assert.ok(Math.abs(proportions.suggestedRootScale - result.manifest.fingerprint.hipsHeightMeters) < 1e-6)
  assert.equal(Object.keys(result.manifest.fingerprint.boneLengthsMeters).length, 64)
  assert.equal(result.report.roundtrip.jointCount, 65)
  assert.equal(result.report.roundtrip.prefixedJointNames, 0)
  assert.equal(result.report.contract.noNamePrefix, 'PASS')
  assert.ok(result.report.roundtrip.hipsTravelMeters > 0.5, 'root travel survives in preserve mode')
  assert.deepEqual(result.preview!.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const again = await runNormalize({ source: ueSource(), sourceLabel: 'ue.glb', sourceSha256: 'a'.repeat(64), target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }),
    targetLabel: 'mixamo65.glb', targetSha256: 'b'.repeat(64) })
  assert.equal(again.manifest.actions[0]!.uuid, result.manifest.actions[0]!.uuid, 'Action UUID is deterministic')
  assert.equal(again.manifest.glbSha256, result.manifest.glbSha256, 'output is reproducible')
})

test('GLB contract v1.0.0: every Action in one GLB, unprefixed Mixamo65 joint names, one manifest entry per Action', async () => {
  const source = ueSource(), swing = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5)
  source.animations.push(
    new AnimationClip('Wave', 0.5, [new QuaternionKeyframeTrack('upperarm_r.quaternion', [0, 0.5], [0, 0, 0, 1, ...swing.toArray()])]),
    new AnimationClip('Pose only', 0, [new VectorKeyframeTrack('pelvis.position', [0], [0, 1, 0])]))
  const result = await runNormalize({ source, sourceLabel: 'multi', sourceSha256: 'f'.repeat(64),
    target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: '0'.repeat(64) })
  assert.equal(result.status, 'PASS', JSON.stringify(result.report))
  const glb = Buffer.from(result.glb!), json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString())
  assert.deepEqual(json.animations.map((animation: { name: string }) => animation.name), ['Walk forward', 'Wave'])
  assert.deepEqual(json.skins[0].joints.map((index: number) => json.nodes[index].name).sort(), MIXAMO65_BONE_PARENTS.map(([name]) => name).sort())
  const report = result.report as any
  assert.deepEqual(Object.values(report.contract), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS'])
  assert.deepEqual(report.skippedActions, [{ index: 2, name: 'Pose only', code: 'ACTION_EMPTY', message: 'Action has no duration (single-pose export?)' }])
  assert.deepEqual(result.manifest.actions.map((action: any) => [action.name, action.sourceActionIndex, action.glbAnimationIndex]), [['Walk forward', 0, 0], ['Wave', 1, 1]])
  assert.equal(new Set(result.manifest.actions.map((action: any) => action.uuid)).size, 2)
  assert.deepEqual(report.roundtrip.perAction.map((item: any) => [item.name, Math.round(item.durationSeconds * 10) / 10]), [['Walk forward', 1], ['Wave', 0.5]])
  // Reloaded animations bind to the renamed joints (not silently to nothing).
  const reloaded = createThreeRigAdapter(await loadAsset(result.glb!, 'glb'), { fingerprint: 'multi-out' })
  assert.deepEqual(reloaded.actions.map((action) => [action.name, action.ready]), [['Walk forward', true], ['Wave', true]])
  const hips = reloaded.rig.bones.find((bone) => bone.name === 'Hips')!.id
  assert.ok(reloaded.sample(0, 1).find((bone) => bone.id === hips)!.world[14]! > 0.9, 'root travel still drives the renamed Hips')
  reloaded.dispose()
  // An explicit selection exports only that Action.
  const only = await runNormalize({ source: ueSource(), sourceLabel: 'multi', sourceSha256: 'f'.repeat(64), actions: [0],
    target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: '0'.repeat(64) })
  assert.equal(only.manifest!.actions.length, 1)
})

test('animated nodes outside the skin joint list join the source rig instead of blocking (Soldier.glb case)', async () => {
  const source = ueSource(), hand = source.getObjectByName('hand_l')!
  const tip = new Group(); tip.name = 'index_tip_l'; tip.position.x = 0.05; hand.add(tip)
  source.animations[0]!.tracks.push(new VectorKeyframeTrack('index_tip_l.position', [0, 1], [0.05, 0, 0, 0.06, 0, 0]))
  const result = await runNormalize({ source, sourceLabel: 'ue', sourceSha256: 'e'.repeat(64),
    target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: 'f'.repeat(64) })
  assert.equal(result.status, 'PASS', JSON.stringify(result.report))
})

test('unmapped helpers with sheared scale or non-rig tracks are pruned and reported, not blocking (Garen/CC case)', async () => {
  const source = ueSource(), hand = source.getObjectByName('hand_l')!
  const weapon = new Bone(); weapon.name = 'weapon_smear'; hand.add(weapon)
  const tip = new Bone(); tip.name = 'weapon_tip'; tip.position.x = 0.3; tip.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.7); weapon.add(tip)
  const body = new Group(); body.name = 'body_mesh'; source.add(body)
  source.animations[0]!.tracks.push(
    new VectorKeyframeTrack('weapon_smear.scale', [0, 1], [1, 1, 1, 3, 0.2, 1]),
    new VectorKeyframeTrack('body_mesh.position', [0, 1], [0, 0, 0, 0, 0, 1]),
    new VectorKeyframeTrack('body_mesh.morphTargetInfluences[0]', [0, 1], [0, 1]))
  const result = await runNormalize({ source, sourceLabel: 'ue', sourceSha256: '1'.repeat(64),
    target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: '2'.repeat(64) })
  assert.equal(result.status, 'PASS', JSON.stringify(result.report))
  const pruned = (result.report as any).loss.prunedTracks
  assert.equal(pruned.count, 3)
  assert.deepEqual(pruned.nodes.sort(), ['body_mesh', 'weapon_smear'])
})

test('animated scale on the source rig is dropped and reported, never blocking (iClone noise, WC3 breathing)', async () => {
  const run = async (mid: readonly number[]) => {
    const source = ueSource()
    // Non-uniform scale on a mapped spine joint with rotated children would shear the solver input.
    source.getObjectByName('spine_03')!.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.4)
    source.animations[0]!.tracks.push(new VectorKeyframeTrack('spine_02.scale', [0, 0.5, 1], [1, 1, 1, ...mid, 1, 1, 1]))
    return runNormalize({ source, sourceLabel: 'ue', sourceSha256: '3'.repeat(64),
      target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: '4'.repeat(64) })
  }
  for (const [mid, deviation] of [[[1 + 4e-5, 1 - 4e-5, 1], 4e-5], [[1.02, 1, 1.02], 0.02], [[1.2, 1.2, 1.2], 0.2]] as const) {
    const result = await run(mid)
    assert.equal(result.status, 'PASS', JSON.stringify(result.report))
    const scale = (result.report as any).loss.scaleTracks
    assert.equal(scale.dropped, 1)
    assert.ok(Math.abs(scale.maxDeviation - deviation) < 1e-6, String(scale.maxDeviation))
    assert.deepEqual(scale.nodes, [{ node: 'spine_02', maxDeviation: scale.maxDeviation }])
  }
})

test('auto A/T calibration: an A-pose source holding its rest pose drives the T-pose target arms down, not horizontal', async () => {
  const armAngle = async (calibrate: 'limbs' | 'none') => {
    const source = ueSource()
    source.animations[0]!.tracks.splice(1) // keep only root travel: arms stay at their (A-pose) rest
    source.getObjectByName('upperarm_l')!.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 4)
    source.getObjectByName('upperarm_r')!.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4)
    const result = await runNormalize({ source, sourceLabel: 'a-pose', sourceSha256: '5'.repeat(64), calibrate,
      target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: '6'.repeat(64) })
    assert.equal(result.status, 'PASS', JSON.stringify(result.report))
    const reloaded = createThreeRigAdapter(await loadAsset(result.glb!, 'glb'), { fingerprint: 'out' })
    const id = (name: string) => reloaded.rig.bones.find((bone) => bone.name?.endsWith(name))!.id
    const pose = new Map(reloaded.sample(0, 0).map((bone) => [bone.id, bone.world]))
    const arm = pose.get(id('LeftArm'))!, fore = pose.get(id('LeftForeArm'))!
    reloaded.dispose()
    return { degrees: Math.atan2(arm[13]! - fore[13]!, Math.hypot(fore[12]! - arm[12]!, fore[14]! - arm[14]!)) * 180 / Math.PI, report: result.report as any }
  }
  const raw = await armAngle('none'), calibrated = await armAngle('limbs')
  assert.ok(Math.abs(raw.degrees) < 3, `uncalibrated keeps target T-pose (${raw.degrees.toFixed(1)}°)`)
  assert.ok(Math.abs(calibrated.degrees - 45) < 3, `calibrated arm hangs 45° (${calibrated.degrees.toFixed(1)}°)`)
  const correction = calibrated.report.calibration.corrections.find((item: { joint: string }) => item.joint === 'LeftArm')
  // ~45° plus the target rest arm droop and the clavicle swing applied first.
  assert.ok(correction.degrees > 40 && correction.degrees < 55, `LeftArm correction ${correction.degrees.toFixed(2)}° (all: ${JSON.stringify(calibrated.report.calibration.corrections)})`)
  assert.equal(raw.report.calibration.mode, 'none')
})

test('facing alignment: a source turned 180° (faces -Z) walks forward on the +Z target and keeps arm directions', async () => {
  for (const calibrate of ['none', 'limbs'] as const) {
    const source = ueSource()
    source.rotation.y = Math.PI // whole character faces -Z; its pelvis track (local +Z) now travels along world -Z = its forward
    const raise = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2) // swings the +X arm to local +Z = the character's forward
    source.animations[0]!.tracks[1] = new QuaternionKeyframeTrack('upperarm_l.quaternion', [0, 1], [...raise.toArray(), ...raise.toArray()])
    const result = await runNormalize({ source, sourceLabel: 'turned', sourceSha256: '7'.repeat(64), calibrate,
      target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: '8'.repeat(64) })
    assert.equal(result.status, 'PASS', JSON.stringify(result.report))
    const report = result.report as any
    assert.ok(Math.abs(Math.abs(report.calibration.facingYawDegrees) - 180) < 1, String(report.calibration.facingYawDegrees))
    assert.ok(report.calibration.maxDegrees < 30, `no limb needs a half turn once facing is aligned (${report.calibration.maxDegrees})`)
    const reloaded = createThreeRigAdapter(await loadAsset(result.glb!, 'glb'), { fingerprint: 'out' })
    const id = (name: string) => reloaded.rig.bones.find((bone) => bone.name?.endsWith(name))!.id
    const first = new Map(reloaded.sample(0, 0).map((bone) => [bone.id, bone.world])), last = new Map(reloaded.sample(0, 1).map((bone) => [bone.id, bone.world]))
    assert.ok(last.get(id('Hips'))![14]! - first.get(id('Hips'))![14]! > 0.9, `${calibrate}: target walks forward (+Z)`)
    const arm = first.get(id('LeftArm'))!, fore = first.get(id('LeftForeArm'))!
    assert.ok(fore[14]! - arm[14]! > 0.15, `${calibrate}: raised arm points forward (+Z), got dz=${(fore[14]! - arm[14]!).toFixed(3)}`)
    reloaded.dispose()
  }
})

test('facing between quarter turns (archer stance) is flagged, not applied, unless overridden', async () => {
  const run = async (facingDegrees?: number) => {
    const source = ueSource(); source.rotation.y = -45 * Math.PI / 180
    return (await runNormalize({ source, sourceLabel: 'stance', sourceSha256: '9'.repeat(64), facingDegrees,
      target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: 'a'.repeat(64) })).report as any
  }
  const auto = await run(), forced = await run(45)
  assert.equal(auto.calibration.facingYawDegrees, 0)
  assert.ok(Math.abs(auto.calibration.measuredFacingYawDegrees - 45) < 1)
  assert.equal(auto.calibration.facingAmbiguous, true)
  assert.equal(forced.calibration.facingYawDegrees, 45)
  assert.equal(forced.calibration.facingSource, 'override')
})

test('.gltf with external .bin buffers (wow.export) loads buffers from its own folder only', async () => {
  const result = await runNormalize({ source: ueSource(), sourceLabel: 'ue', sourceSha256: 'b'.repeat(64),
    target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: 'c'.repeat(64) })
  const glb = Buffer.from(result.glb!), jsonLength = glb.readUInt32LE(12)
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString()), bin = glb.subarray(28 + jsonLength)
  const dir = mkdtempSync(join(tmpdir(), 'w01-gltf-'))
  writeFileSync(join(dir, 'anim.bin'), bin)
  json.buffers = [{ uri: 'anim.bin', byteLength: bin.length }]
  const gltf = new TextEncoder().encode(JSON.stringify(json))
  const loaded = await loadAsset(gltf, 'gltf', { skeletonOnly: true, resourceDir: dir })
  assert.equal(loaded.animations.length, 1)
  assert.ok(Math.abs(loaded.animations[0]!.duration - 1) < 1e-6)
  json.buffers = [{ uri: '../escape.bin', byteLength: bin.length }]
  await assert.rejects(loadAsset(new TextEncoder().encode(JSON.stringify(json)), 'gltf', { skeletonOnly: true, resourceDir: dir }), /outside the glTF folder/)
})

test('non-unit quaternion keys (wow.export int16, |q|≈0.99997) are normalized and counted instead of shearing', async () => {
  const source = ueSource(), bent = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.8)
  const short = bent.toArray().map((value) => value * 0.99997)
  source.getObjectByName('spine_03')!.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.3)
  source.animations[0]!.tracks.push(new QuaternionKeyframeTrack('spine_02.quaternion', [0, 1], [...short, ...short]))
  const result = await runNormalize({ source, sourceLabel: 'wow', sourceSha256: 'd'.repeat(64),
    target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: 'e'.repeat(64) })
  assert.equal(result.status, 'PASS', JSON.stringify(result.report))
  const quaternions = (result.report as any).loss.quaternionTracks
  assert.equal(quaternions.normalized, 1)
  assert.ok(Math.abs(quaternions.maxDeviation - 3e-5) < 1e-6, String(quaternions.maxDeviation))
})

test('FBX identity bone aliases (one bone shared by several meshes) are removed, real bones kept', () => {
  const hips = Object.assign(new Bone(), { ID: 7 }); hips.name = 'mixamorig:Hips'; hips.position.y = 1
  const alias = Object.assign(new Bone(), { ID: 7 }); alias.name = 'mixamorig:Hips'; hips.add(alias)
  const spine = Object.assign(new Bone(), { ID: 8 }); spine.name = 'mixamorig:Spine'; spine.position.y = 0.1; hips.add(spine)
  const twin = Object.assign(new Bone(), { ID: 9 }); twin.name = 'mixamorig:Spine'; spine.add(twin) // different FBX model: not an alias
  const root = new Group(); root.add(hips)
  assert.equal(removeFbxBoneAliases(root), 1)
  assert.deepEqual(hips.children.map((child) => child.name), ['mixamorig:Spine'])
  assert.equal(spine.children.length, 1)
})

test('CLI writes GLB + manifest + report + preview, and blocks on missing required joints', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'w01-cli-'))
  const target = await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })
  const first = await runNormalize({ source: ueSource(), sourceLabel: 'ue', sourceSha256: 'c'.repeat(64), target, targetLabel: 't', targetSha256: 'd'.repeat(64) })
  const src = join(dir, 'walk.glb'); writeFileSync(src, first.glb)
  const out = join(dir, 'out')
  const run = spawnSync(process.execPath, ['--import', 'tsx', cliPath, '--src', src, '--target', targetPath, '--out', out, '--preview'], { encoding: 'utf8', cwd: tsxHome })
  assert.equal(run.status, 0, run.stderr + run.stdout)
  for (const file of ['walk.glb', 'walk.manifest.json', 'walk.report.json', 'walk.preview.png']) assert.ok(existsSync(join(out, file)), file)
  const manifest = JSON.parse(readFileSync(join(out, 'walk.manifest.json'), 'utf8'))
  assert.equal(manifest.source.file, 'walk.glb')
  const report = JSON.parse(readFileSync(join(out, 'walk.report.json'), 'utf8'))
  assert.equal(report.mapping.family, 'mixamo')

  const blocked = spawnSync(process.execPath, ['--import', 'tsx', cliPath, '--src', targetPath, '--target', targetPath, '--out', join(dir, 'blocked')], { encoding: 'utf8', cwd: tsxHome })
  assert.equal(blocked.status, 2, blocked.stderr + blocked.stdout)
  const blockedReport = JSON.parse(readFileSync(join(dir, 'blocked', 'a3d_char_30ec53c93eae4173946b38639691ebe0.report.json'), 'utf8'))
  assert.equal(blockedReport.status, 'BLOCKED')
})
