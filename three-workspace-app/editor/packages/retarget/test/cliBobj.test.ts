import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Matrix4, Vector3, type Bone } from 'three'
import { evaluateBobjAction, parseBobjActions } from '../src/index.ts'
import { parseBobjArmature } from '../src/reverse.ts'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import { loadAsset } from '../cli/loadAsset.ts'
import { runNormalize } from '../cli/normalizeCore.ts'

const here = dirname(fileURLToPath(import.meta.url))
const bobjDir = resolve(here, '../../../apps/studio/public/retarget/v9.12')
const armaturePath = join(bobjDir, 'minecraft20-armature.bobj'), actionsPath = join(bobjDir, 'minecraft-actions.bobj')
const targetPath = resolve(here, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
const cliPath = resolve(here, '../cli/normalize.ts'), tsxHome = resolve(here, '../../builder')

const loadMinecraft = () => loadAsset(readFileSync(actionsPath), 'bobj', { bobjArmature: readFileSync(armaturePath) })
const actionIndex = (name: string) => [...parseBobjActions(readFileSync(actionsPath, 'utf8')).keys()].indexOf(name)

test('BOBJ loader: orientation-preserving rest, 85 clips in seconds, poses equal to the V9.12 evaluator', async () => {
  const root = await loadMinecraft()
  assert.equal(root.animations.length, 85)
  const actions = parseBobjActions(readFileSync(actionsPath, 'utf8')), armature = parseBobjArmature(readFileSync(armaturePath, 'utf8'))
  const running = actions.get('running')!
  const clip = root.animations.find((item) => item.name === 'running')!
  assert.ok(Math.abs(clip.duration - running.durationTicks / 20) < 1e-6, 'ticks → seconds at 20 ticks/s')
  root.updateMatrixWorld(true)
  root.traverse((node) => { if ((node as Bone).isBone) assert.ok(node.matrixWorld.determinant() > 0, `${node.name} rest must not be mirrored`) })
  // Same world positions as evaluateBobjAction (the V9.12 reference), sampled through a real Three.js rig adapter.
  const adapter = createThreeRigAdapter(root, { fingerprint: 'mc20' })
  const clipIndex = root.animations.indexOf(clip)
  for (const seconds of [0, 0.4, clip.duration / 2]) {
    const sampled = new Map(adapter.sample(clipIndex, seconds).map((bone) => [adapter.rig.bones.find((item) => item.id === bone.id)!.name, bone.world]))
    for (const bone of evaluateBobjAction(armature, running, seconds * 20)) {
      const expected = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(bone.worldMatrix))
      const actual = new Vector3().fromArray(sampled.get(bone.name.replace(/\./g, '_'))!, 12) // loader sanitizes '.' (Three.js track syntax)
      assert.ok(actual.distanceTo(expected) < 1e-5, `${bone.name} at ${seconds}s: ${actual.toArray()} vs ${expected.toArray()}`)
    }
  }
  adapter.dispose()
})

test('Minecraft20 → Mixamo65: family minecraft20, feet not required, T-pose emote gives horizontal arms and idle hangs them', async () => {
  const target = async () => loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })
  const run = async (name: string) => runNormalize({ source: await loadMinecraft(), sourceLabel: 'minecraft-actions.bobj', sourceSha256: '1'.repeat(64),
    target: await target(), targetLabel: 't', targetSha256: '2'.repeat(64), actions: [actionIndex(name)] })
  const armAngle = async (glb: Uint8Array) => {
    const reloaded = createThreeRigAdapter(await loadAsset(glb, 'glb'), { fingerprint: 'out' })
    const id = (name: string) => reloaded.rig.bones.find((bone) => bone.name === name)!.id
    const pose = new Map(reloaded.sample(0, 0).map((bone) => [bone.id, bone.world]))
    const arm = pose.get(id('LeftArm'))!, fore = pose.get(id('LeftForeArm'))!
    reloaded.dispose()
    return Math.atan2(arm[13]! - fore[13]!, Math.hypot(fore[12]! - arm[12]!, fore[14]! - arm[14]!)) * 180 / Math.PI
  }
  const tpose = await run('emote_t_pose'), idle = await run('idle')
  for (const result of [tpose, idle]) {
    const report = result.report as any
    assert.equal(result.status, 'PASS', JSON.stringify(report.blocker ?? report.skippedActions))
    assert.equal(report.mapping.family, 'minecraft20')
    assert.deepEqual(report.mapping.missingRequired, [])
    assert.deepEqual(report.mapping.notInSourceRig, ['LeftFoot', 'RightFoot'])
    assert.ok(Object.values(report.contract).every((value) => value === 'PASS'))
  }
  const of = (name: string) => (tpose.report as any).mapping.joints.find((joint: { target: string }) => joint.target === name)?.source
  assert.deepEqual(['Hips', 'Spine', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightUpLeg', 'RightLeg'].map(of),
    ['body', 'low_body', 'head', 'left_arm', 'low_left_arm', 'low_left_arm_end', 'right_leg', 'low_leg_right'])
  const tposeAngle = await armAngle(tpose.glb!), idleAngle = await armAngle(idle.glb!)
  assert.ok(Math.abs(tposeAngle) < 15, `emote_t_pose arm ${tposeAngle.toFixed(1)}° from horizontal`)
  assert.ok(idleAngle > 60, `idle arm hangs ${idleAngle.toFixed(1)}° below horizontal`)
})

test('CLI reads .bobj actions with --armature', () => {
  const out = mkdtempSync(join(tmpdir(), 'w01-bobj-'))
  const run = spawnSync(process.execPath, ['--import', 'tsx', cliPath, '--src', actionsPath, '--armature', armaturePath, '--target', targetPath,
    '--out', out, '--action', String(actionIndex('running'))], { encoding: 'utf8', cwd: tsxHome })
  assert.equal(run.status, 0, run.stderr + run.stdout)
  for (const file of ['minecraft-actions.glb', 'minecraft-actions.manifest.json', 'minecraft-actions.report.json']) assert.ok(existsSync(join(out, file)), file)
  const missing = spawnSync(process.execPath, ['--import', 'tsx', cliPath, '--src', actionsPath, '--target', targetPath, '--out', out], { encoding: 'utf8', cwd: tsxHome })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /--armature/)
})
