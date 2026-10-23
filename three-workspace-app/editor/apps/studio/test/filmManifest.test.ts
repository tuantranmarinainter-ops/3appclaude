import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Quaternion } from 'three'
import { buildFilmExportManifest, inspectFilmActorTransform, projectOriginalVerityPoseTracks, type ConvertedFilmModelProfile } from '../src/filmManifest.ts'

const identity = new Matrix4().toArray()
const input = {
  schemaVersion: 1 as const, kind: 'film-sampling-input' as const, targetVersion: '2.4' as const,
  projectId: 'project_1', sourceRevision: 3, sourceSha256: 'a'.repeat(64), sourceHashes: { asset: 'b'.repeat(64) },
  sampleFps: 20, range: { startFrame: 0, endFrame: 1 }, sequenceId: 'sequence', durationTicks: 1,
  models: [{ characterId: 'character', nodeId: 'actor', name: 'Actor', assetId: 'asset', skeletonId: 'skeleton',
    source: { path: 'Actor.fbx', sha256: 'b'.repeat(64) }, metersPerUnit: 1, skeletonFingerprint: 'fingerprint',
    sourceBones: [{ id: 'root', name: 'root', parentId: null, rest: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }] }],
  cameras: [{ id: 'shot', startTick: 0, durationTicks: 1, keyframes: [
    { tick: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, verticalFovDegrees: 60 },
    { tick: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, verticalFovDegrees: 60 },
  ] }],
  frames: [0, 1].map((tick) => ({ tick, sourceFrame: tick, side: tick ? 'left' as const : 'right' as const,
    skeletons: [{ nodeId: 'actor', metersPerUnit: 1, placementMatrix: identity, trajectoryMatrix: identity,
      actorWorldMatrix: new Matrix4().compose({ x: tick * 2, y: 1, z: 3 } as never,
        new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, Math.PI * tick / 2), { x: 1, y: 1, z: 1 } as never).toArray(),
      bones: [{ name: 'root', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], worldMatrix: identity }] }] })),
}
const profile: ConvertedFilmModelProfile = {
  schemaVersion: 1, sourceSha256: 'b'.repeat(64), modelId: 'unified/bbbbbbbbbbbbbbbb', metersPerUnit: 1,
  bones: [{ name: 'root', parent: null, bobjRestMatrixRowMajor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
  actions: [], textureRequired: false, files: [{ sourcePath: 'C:/models/model.bobj', targetPath: 'model.bobj', sha256: 'c'.repeat(64) }],
}

test('builds a worker manifest with per-tick actor transforms and editable BOBJ tracks', () => {
  const manifest = buildFilmExportManifest(input as never, new Map([['asset', profile]]), 'take-01')
  assert.equal(manifest.mode, 'editable')
  assert.equal(manifest.durationTicks, 1)
  assert.deepEqual(manifest.models[0]!.bones, ['root'])
  const transforms = manifest.actors[0]!.transformSamples
  assert.deepEqual(transforms.map(({ x, y, z }) => [x, y, z]), [[0, 1, 3], [2, 1, 3]])
  // App 2 yaw 0 / -90 become BBS actor yaw 180 / 90 (converted models face away from BBS actors, calibrated in game).
  assert.ok(Math.abs(transforms[0]!.yaw - 180) < 1e-12 && Math.abs(transforms[1]!.yaw - 90) < 1e-12)
  assert.equal(manifest.actors[0]!.poseTracks[0]!.keyframes.length, 2)
  assert.equal(manifest.cameras[0]!.id, 'shot')
})

test('turns Minecraft20 (low_body rig) actors 180 degrees like every other model', () => {
  const rename = <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll('"root"', '"low_body"'))
  const manifest = buildFilmExportManifest(rename(input) as never, new Map([['asset', rename(profile)]]), 'take-mc20')
  const yaws = manifest.actors[0]!.transformSamples.map((sample) => sample.yaw)
  assert.ok(Math.abs(yaws[0]! - 180) < 1e-9 && Math.abs(yaws[1]! - 90) < 1e-9, JSON.stringify(yaws))
})

test('rejects a profile from a different source and actor transforms the worker cannot express', () => {
  assert.throws(() => buildFilmExportManifest(input as never, new Map([['asset', { ...profile, sourceSha256: 'd'.repeat(64) }]]), 'take'), /does not match/)
  const rolled = structuredClone(input) as typeof input
  rolled.frames[0]!.skeletons[0]!.actorWorldMatrix = new Matrix4().makeRotationZ(0.2).toArray()
  assert.throws(() => buildFilmExportManifest(rolled as never, new Map([['asset', profile]]), 'take'), /roll is not supported/)
  const scaled = structuredClone(input) as typeof input
  scaled.frames[0]!.skeletons[0]!.actorWorldMatrix = new Matrix4().makeScale(2, 2, 2).toArray()
  assert.throws(() => buildFilmExportManifest(scaled as never, new Map([['asset', profile]]), 'take'), /unit actor scale/)
})

test('shared actor transform inspector detects shear and non-unit scale without changing export errors', () => {
  const shear = new Matrix4(); shear.elements[4] = 0.25
  assert.ok(inspectFilmActorTransform(shear.toArray(), 0).issues.some((entry) => entry.code === 'TRANSFORM_SHEAR'))
  assert.ok(inspectFilmActorTransform(new Matrix4().makeScale(1, 2, 1).toArray(), 0).issues.some((entry) => entry.code === 'TRANSFORM_SCALE'))
  assert.deepEqual(inspectFilmActorTransform(identity, 0).issues, [])
})

test('selects a distinct model profile per Character skin even when both share one source asset', () => {
  const two = structuredClone(input)
  two.models.push({ ...structuredClone(two.models[0]!), characterId: 'character-skin-b', nodeId: 'actor-b', name: 'Actor B' })
  for (const frame of two.frames) frame.skeletons.push({ ...structuredClone(frame.skeletons[0]!), nodeId: 'actor-b' })
  const skinA = { ...profile, modelId: 'unified/shared-skin-a', files: [profile.files[0]!,
    { sourcePath: '/library/a.png', targetPath: 'textures/verity.mdl/Body.smd/default.png', sha256: 'd'.repeat(64) }] }
  const skinB = { ...profile, modelId: 'unified/shared-skin-b', files: [profile.files[0]!,
    { sourcePath: '/library/b.png', targetPath: 'textures/verity.mdl/Body.smd/default.png', sha256: 'e'.repeat(64) }] }
  skinA.textureRequired = skinB.textureRequired = true
  const manifest = buildFilmExportManifest(two as never, new Map([['character', skinA], ['character-skin-b', skinB]]), 'skins')
  assert.deepEqual(manifest.actors.map((actor) => actor.modelId), ['unified/shared-skin-a', 'unified/shared-skin-b'])
  assert.equal(manifest.models.length, 2)
  assert.equal(manifest.models[0]!.files[0]!.sha256, manifest.models[1]!.files[0]!.sha256, 'BOBJ bytes stay shared')
  assert.notEqual(manifest.models[0]!.files[1]!.sha256, manifest.models[1]!.files[1]!.sha256, 'skin bytes stay distinct')
})

test('original-rig projection emits Verity names, pins Jaw at rest and leaves Root and wings to the native action', () => {
  const verityInput = JSON.parse(JSON.stringify(input).replaceAll('"root"', '"Hips"'))
  verityInput.frames[0].tick = 3
  verityInput.frames[1].tick = 5
  const matrix = (y: number) => `1 0 0 0 0 1 0 ${y} 0 0 1 0 0 0 0 1`
  const bobj = [
    'arm_name verity.mdl',
    `arm_bone Root 0 0.1 0 ${matrix(0)}`,
    `arm_bone COG Root 0 1.1 0 ${matrix(1)}`,
    `arm_bone Jaw COG 0 1.6 0 ${matrix(1.5)}`,
    `arm_bone Wing_Bone_L COG 0 1.4 0 ${matrix(1.3)}`,
    'o body', 'v 0 0 0', 'vw COG 1',
    'an idle', 'ao Root', 'ag rotation 1', 'kf 0 1.570796 LINEAR 0 1.570796 0 1.570796',
    'ao Wing_Bone_L', 'ag rotation 2', 'kf 0 0 LINEAR 0 0 0 0', 'kf 1 0.2 LINEAR 1 0.2 1 0.2',
  ].join('\n') + '\n'
  const tracks = projectOriginalVerityPoseTracks(verityInput, 0, { bobj, wingAction: 'idle' })
  assert.deepEqual(tracks.map((track) => track.boneName), ['COG', 'Jaw'])
  assert.deepEqual(tracks[0]!.keyframes.map((key) => key.tick), [3, 5])
  assert.ok(tracks.find((track) => track.boneName === 'Jaw')!.keyframes.every((key) => [...key.t, ...key.r].every((value) => Math.abs(value) < 1e-9)))
  assert.ok(tracks[0]!.keyframes.every((key) => [...key.t, ...key.r, ...key.s].every(Number.isFinite)))
})

test('original named pose keys read back within 1e-4 native units at four noncontiguous ticks', async (t) => {
  const { evaluateBobjAction, parseBobjActions, parseBobjArmature } = await import('@bbs/retarget')
  const { Vector3 } = await import('three')
  const matrix = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1'
  const bobj = `arm_name verity.mdl\narm_bone Root 0 0 0 ${matrix}\narm_bone COG Root 0 1 0 ${matrix}\narm_bone Jaw COG 0 2 0 ${matrix}\no Body\nv 0 0 0\nvw COG 1\nan idle\nao Root\nag rotation 1\nkf 0 1.5707963267948966 LINEAR 0 1.5707963267948966 0 1.5707963267948966\n`
  const source = structuredClone(input) as any
  source.models[0].metersPerUnit = 0.4915394
  source.frames = [3, 7, 11, 19].map((tick) => ({ tick, skeletons: [{ nodeId: 'actor', actorWorldMatrix: identity,
    bones: [{ name: 'Hips', worldMatrix: new Matrix4().makeTranslation(tick / 10, 1, 0.25).toArray() }] }] }))
  const tracks = projectOriginalVerityPoseTracks(source, 0, { bobj })
  let action = 'an readback\nao Root\nag rotation 1\nkf 0 1.5707963267948966 LINEAR 0 1.5707963267948966 0 1.5707963267948966\n'
  for (const track of tracks) {
    action += `ao ${track.boneName}\n`
    for (const [kind, field] of [['location', 't'], ['rotation', 'r'], ['scale', 's']] as const) for (let axis = 0; axis < 3; axis++) {
      action += `ag ${kind} ${axis}\n`
      for (const key of track.keyframes) action += `kf ${key.tick} ${key[field][axis]} LINEAR ${key.tick} ${key[field][axis]} ${key.tick} ${key[field][axis]}\n`
    }
  }
  const armature = parseBobjArmature(bobj), parsed = parseBobjActions(bobj + action).get('readback')!
  const turn = new Matrix4().makeRotationY(Math.PI / 2)
  let maxError = 0, maxAngleDegrees = 0
  for (const frame of source.frames) {
    const actual = evaluateBobjAction(armature, parsed, frame.tick).find((bone) => bone.name === 'COG')!
    const expected = new Vector3(frame.tick / 10, 1, 0.25).multiplyScalar(1 / 0.4915394).applyMatrix4(turn)
    const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().fromArray([...actual.worldMatrix]))
    maxAngleDegrees = Math.max(maxAngleDegrees, rotation.angleTo(new Quaternion().setFromRotationMatrix(turn)) * 180 / Math.PI)
    maxError = Math.max(maxError, expected.distanceTo(new Vector3().setFromMatrixPosition(new Matrix4().fromArray([...actual.worldMatrix]))))
  }
  assert.ok(maxError <= 1e-4, `native position error ${maxError}`)
  assert.ok(maxAngleDegrees <= 2, `native hip direction error ${maxAngleDegrees}`)
  t.diagnostic(`four ticks: position=${maxError} native units; hip direction=${maxAngleDegrees} degrees`)
})

test('L3 native topology keeps moving COG samples after removing actor and BOBJ wrapper transforms', () => {
  const row = (y: number) => `1 0 0 0 0 1 0 ${y} 0 0 1 0 0 0 0 1`
  const bobj = `arm_name verity.mdl\narm_bone Root 0 0 0 ${row(0)}\narm_bone COG Root 0 1 0 ${row(1)}\narm_bone Jaw COG 0 2 0 ${row(2)}\narm_bone Wing.Bone COG 0 2 0 ${row(2)}\no Body\nv 0 0 0\nvw COG 1\nan idle\nao Root\nag rotation 1\nkf 0 1.5707963267948966 LINEAR 0 1.5707963267948966 0 1.5707963267948966\n`
  const source = structuredClone(input) as any
  source.models[0].sourceBones = ['bobj-model', 'Root', 'COG', 'Jaw', 'Wing_Bone'].map((name) => ({ name }))
  const wrapper = new Matrix4().makeScale(0.4915394, 0.4915394, 0.4915394)
  const actor = new Matrix4().makeTranslation(4, 2, -3).multiply(new Matrix4().makeRotationY(0.5))
  source.frames = [0, 3, 7, 11].map((tick) => {
    const root = new Matrix4().makeRotationY(Math.PI / 2 + tick / 10)
    const cog = root.clone().multiply(new Matrix4().makeTranslation(tick / 5, 1, 0))
    const prefix = actor.clone().multiply(wrapper)
    return { tick, skeletons: [{ nodeId: 'actor', actorWorldMatrix: actor.toArray(), bones: [
      { name: 'bobj-model', worldMatrix: prefix.toArray() },
      { name: 'Root', worldMatrix: prefix.clone().multiply(root).toArray() },
      { name: 'COG', worldMatrix: prefix.clone().multiply(cog).toArray() },
      { name: 'Wing_Bone', worldMatrix: prefix.clone().multiply(cog).multiply(new Matrix4().makeTranslation(0, 1, 0)).multiply(new Matrix4().makeRotationZ(tick / 5)).toArray() },
      { name: 'Jaw', worldMatrix: prefix.clone().multiply(cog).multiply(new Matrix4().makeTranslation(0, 1, 0)).toArray() },
    ] }] }
  })
  const tracks = projectOriginalVerityPoseTracks(source, 0, { bobj })
  assert.deepEqual(tracks.map((track) => track.boneName), ['Root', 'COG', 'Jaw', 'Wing.Bone'])
  const cog = tracks[1]!
  assert.deepEqual(cog.keyframes.map((key) => key.tick), [0, 3, 7, 11])
  for (const key of cog.keyframes) {
    assert.ok(Math.abs(key.t[0] - key.tick / 5) < 1e-10, `moving native COG at ${key.tick}: ${key.t}`)
    assert.ok(Math.abs(key.t[1]) < 1e-10 && Math.abs(key.t[2]) < 1e-10)
  }
  assert.ok(Math.abs(tracks[0]!.keyframes.at(-1)!.r[1] - tracks[0]!.keyframes[0]!.r[1]) > 0.5, 'sampled Root differs from idle')
  assert.ok(tracks[3]!.keyframes.at(-1)!.r.some((value) => Math.abs(value) > 1), 'sampled wing differs from idle')
  assert.ok(cog.keyframes.at(-1)!.t[0] > 2, 'native motion must not collapse to rest')
  assert.ok(tracks[2]!.keyframes.every((key) => [...key.t, ...key.r].every((value) => Math.abs(value) < 1e-10)))
  source.durationTicks = 3
  source.frames.forEach((frame: { tick: number }, index: number) => { frame.tick = index })
  const nativeProfile: ConvertedFilmModelProfile = { ...profile, originalRig: { bobj }, bones: ['Root', 'COG', 'Jaw', 'Wing.Bone'].map((name) => ({ name, parent: name === 'Root' ? null : name === 'COG' ? 'Root' : 'COG', bobjRestMatrixRowMajor: identity })) }
  const manifest = buildFilmExportManifest(source, new Map([['character', nativeProfile]]), 'native-samples')
  assert.equal(manifest.actors[0]!.animationKeyframes, undefined, 'sampled native Root and wings must not layer over idle')
})

test('Minecraft20 native BOBJ removes the GLB wrapper and exports exactly 20 moving native tracks without an idle action', () => {
  const matrix = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1'
  const names = ['low_body', ...Array.from({ length: 19 }, (_, i) => `bone_${i}`)]
  const bobj = ['arm_name minecraft20', ...names.map((name, i) => `arm_bone ${name}${i ? ' low_body' : ''} 0 1 0 ${matrix}`),
    'o body', 'v 0 -2 0', 'vw low_body 1', 'v 1 -2 0', 'vw low_body 1', 'v 0 -2 1', 'vw low_body 1', 'f 1 2 3'].join('\n') + '\n'
  const source = structuredClone(input) as any
  source.models[0].sourceBones = ['bobj-model', ...names].map((name) => ({ name }))
  const wrapper = new Matrix4().makeTranslation(0, 2, 0)
  source.frames = [0, 1, 2].map((tick) => ({ tick, skeletons: [{ nodeId: 'actor', actorWorldMatrix: identity,
    bones: [{ name: 'bobj-model', worldMatrix: wrapper.toArray() }, ...names.map((name) => ({ name,
      worldMatrix: wrapper.clone().multiply(new Matrix4().makeTranslation(tick / 4, 0, 0)).toArray() }))] }] }))
  const tracks = projectOriginalVerityPoseTracks(source, 0, { bobj, nativeOnly: true })
  assert.equal(tracks.length, 20)
  assert.deepEqual(tracks.map((track) => track.boneName), names)
  for (const key of tracks[0]!.keyframes) {
    assert.ok(Math.abs(key.t[0] - key.tick / 4) < 1e-10)
    assert.ok(Math.abs(key.t[1]) < 1e-10, 'wrapper floor translation must be removed once')
  }
  assert.ok(tracks.slice(1).every((track) => track.keyframes.every((key) => key.t.every((value) => Math.abs(value) < 1e-10))))
  source.durationTicks = 2
  const nativeProfile: ConvertedFilmModelProfile = { ...profile, originalRig: { bobj, nativeOnly: true }, bones: names.map((name, index) => ({ name, parent: index ? 'low_body' : null, bobjRestMatrixRowMajor: identity })) }
  const manifest = buildFilmExportManifest(source, new Map([['character', nativeProfile]]), 'native-minecraft')
  assert.equal(manifest.models[0]!.bones.length, 20)
  assert.equal(manifest.actors[0]!.poseTracks.length, 20)
  assert.equal(manifest.actors[0]!.animationKeyframes, undefined)
})
