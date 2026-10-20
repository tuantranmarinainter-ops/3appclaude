import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnimationClip, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import { buildAutoMapping, MIXAMO65_REQUIRED_JOINTS } from '../cli/autoMapping.ts'
import { loadAsset, removeFbxBoneAliases } from '../cli/loadAsset.ts'
import { runNormalize } from '../cli/normalizeCore.ts'

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
  assert.equal(Object.keys(result.manifest.fingerprint.boneLengthsMeters).length, 64)
  assert.equal(result.report.roundtrip.jointCount, 65)
  // Known contract gap until step 3: output still carries the `mixamorig:` prefix, and the report must say so.
  assert.equal(result.report.roundtrip.prefixedJointNames, 65)
  assert.equal(result.report.contract.noNamePrefix, 'FAIL')
  assert.ok(result.report.roundtrip.hipsTravelMeters > 0.5, 'root travel survives in preserve mode')
  assert.deepEqual(result.preview!.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const again = await runNormalize({ source: ueSource(), sourceLabel: 'ue.glb', sourceSha256: 'a'.repeat(64), target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }),
    targetLabel: 'mixamo65.glb', targetSha256: 'b'.repeat(64) })
  assert.equal(again.manifest.actions[0]!.uuid, result.manifest.actions[0]!.uuid, 'Action UUID is deterministic')
  assert.equal(again.manifest.glbSha256, result.manifest.glbSha256, 'output is reproducible')
})

test('animated nodes outside the skin joint list join the source rig instead of blocking (Soldier.glb case)', async () => {
  const source = ueSource(), hand = source.getObjectByName('hand_l')!
  const tip = new Group(); tip.name = 'index_tip_l'; tip.position.x = 0.05; hand.add(tip)
  source.animations[0]!.tracks.push(new VectorKeyframeTrack('index_tip_l.position', [0, 1], [0.05, 0, 0, 0.06, 0, 0]))
  const result = await runNormalize({ source, sourceLabel: 'ue', sourceSha256: 'e'.repeat(64),
    target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: 'f'.repeat(64) })
  assert.equal(result.status, 'PASS', JSON.stringify(result.report))
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
