import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnimationClip, Bone, Group, VectorKeyframeTrack } from 'three'
import { loadAsset } from '../cli/loadAsset.ts'
import { runNormalize } from '../cli/normalizeCore.ts'
import { QualityMeter, summarizeQuality } from '../cli/quality.ts'

const here = dirname(fileURLToPath(import.meta.url))
const targetPath = resolve(here, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')

/** UE-style rig, feet on the ground (pelvis 1 m), animated by `pelvis` position keys only. */
function legsSource(pelvisKeys: readonly number[] | null) {
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
    add(`lowerarm_${side}`, `upperarm_${side}`, 0.25 * sign, 0); add(`hand_${side}`, `lowerarm_${side}`, 0.25 * sign, 0)
    add(`thigh_${side}`, 'pelvis', 0.1 * sign, -0.05); add(`calf_${side}`, `thigh_${side}`, 0, -0.45)
    add(`foot_${side}`, `calf_${side}`, 0, -0.45); add(`ball_${side}`, `foot_${side}`, 0, -0.05, 0.12)
  }
  // A constant track keeps the Action alive when the pelvis does not move.
  root.animations = [new AnimationClip('Clip', 1, [new VectorKeyframeTrack('pelvis.position', [0, 1], pelvisKeys ? [...pelvisKeys] : [0, 1, 0, 0, 1, 0])])]
  return root
}

const run = async (source: Group, extra: Record<string, unknown> = {}) => runNormalize({ source, sourceLabel: 'legs', sourceSha256: '9'.repeat(64),
  target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: '8'.repeat(64), ...extra })
const codes = (result: Awaited<ReturnType<typeof run>>) => ((result.report as any).roundtrip.perAction[0].quality.warnings as Array<{ code: string }>).map((w) => w.code)

test('standing source: feet in contact, no slide, no warnings', async () => {
  const result = await run(legsSource(null))
  assert.equal(result.status, 'PASS')
  const quality = (result.report as any).roundtrip.perAction[0].quality
  assert.ok(quality.contactFrames.left >= 30 && quality.contactFrames.right >= 30, JSON.stringify(quality))
  assert.ok(quality.footSlideMeters.left < 1e-3 && quality.footSlideMeters.right < 1e-3, JSON.stringify(quality))
  assert.deepEqual(quality.warnings, [])
  assert.deepEqual((result.report as any).quality.warnings, [])
})

test('pelvis gliding over planted feet reports FOOT_SLIDE with the travelled distance, status unchanged', async () => {
  const result = await run(legsSource([0, 1, 0, 0, 1, 1]))
  assert.equal(result.status, 'PASS')
  const roundtrip = (result.report as any).roundtrip, quality = roundtrip.perAction[0].quality
  assert.ok(codes(result).includes('FOOT_SLIDE'))
  for (const side of ['left', 'right'] as const) assert.ok(Math.abs(quality.footSlideMeters[side] - roundtrip.perAction[0].hipsTravelMeters) < 0.1 * roundtrip.perAction[0].hipsTravelMeters, JSON.stringify(quality))
  assert.ok(Math.abs(quality.footSlideMaxSpeed - 1) < 0.15, `speed ${quality.footSlideMaxSpeed}`)
  const summary = (result.report as any).quality.warnings.find((w: any) => w.code === 'FOOT_SLIDE')
  assert.equal(summary.actions, 1); assert.deepEqual(summary.examples, ['Clip'])
})

test('pelvis dropped 1.2 m reports HIPS_BELOW_GROUND with a --root-scale suggestion', async () => {
  const result = await run(legsSource([0, 1, 0, 0, -0.2, 0]))
  assert.equal(result.status, 'PASS')
  const quality = (result.report as any).roundtrip.perAction[0].quality
  const warning = quality.warnings.find((w: any) => w.code === 'HIPS_BELOW_GROUND')
  assert.ok(warning, JSON.stringify(codes(result)))
  assert.match(warning.suggestion, /--root-scale /)
  assert.ok(quality.penetrationMeters > 0.05)
  assert.ok(codes(result).includes('FEET_PENETRATE'))
})

test('pelvis raised high reports HIPS_TOO_HIGH', async () => {
  assert.ok(codes(await run(legsSource([0, 1, 0, 0, 3, 0]))).includes('HIPS_TOO_HIGH'))
})

test('QualityMeter: a foot swinging in the air is not a contact and its speed is not counted as slide', () => {
  const meter = new QualityMeter()
  const pose = (x: number, y: number) => new Map<string, number[]>([['Hips', [0, 0.9, 0]], ['LeftFoot', [x, y + 0.1, 0]], ['LeftToeBase', [x, y, 0]], ['RightFoot', [0, 0.1, 0]], ['RightToeBase', [0, 0, 0]]])
  for (let frame = 0; frame < 30; frame++) meter.push(pose(frame * 0.05, 0.2), frame / 30)
  const quality = meter.finish(0.9, null)
  assert.equal(quality.contactFrames.left, 0)
  assert.equal(quality.footSlideMeters.left, 0)
  assert.equal(quality.contactFrames.right, 30)
  assert.equal(quality.groundY, 0)
})

test('summarizeQuality groups by code with count and at most 3 examples', () => {
  const warning = (code: string) => ({ code, message: code })
  const items = ['a', 'b', 'c', 'd'].map((name) => ({ name, quality: { warnings: [warning('FOOT_SLIDE')] } }))
  const summary = summarizeQuality([...items, { name: 'e', quality: { warnings: [] } }])
  assert.deepEqual(summary.warnings.map((w) => [w.code, w.actions, w.examples]), [['FOOT_SLIDE', 4, ['a', 'b', 'c']]])
})
