import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnimationClip, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { loadAsset } from '../cli/loadAsset.ts'
import { runNormalize } from '../cli/normalizeCore.ts'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import { parseOptions } from '../workbench/pipeline.ts'

const here = dirname(fileURLToPath(import.meta.url))
const targetPath = resolve(here, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
const target = () => loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })

/** UE-style rig with three arm-swing Actions, so armSpace visibly moves every baked Action. */
function threeActionSource() {
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
    add(`hand_${side}`, `lowerarm_${side}`, 0.25 * sign, 0)
    add(`thigh_${side}`, 'pelvis', 0.1 * sign, -0.05); add(`calf_${side}`, `thigh_${side}`, 0, -0.45)
    add(`foot_${side}`, `calf_${side}`, 0, -0.45); add(`ball_${side}`, `foot_${side}`, 0, -0.05, 0.12)
  }
  const swing = (axis: Vector3, angle: number) => new Quaternion().setFromAxisAngle(axis, angle).toArray()
  root.animations = [
    new AnimationClip('Walk forward', 1, [
      new VectorKeyframeTrack('pelvis.position', [0, 1], [0, 1, 0, 0, 1, 1]),
      new QuaternionKeyframeTrack('upperarm_l.quaternion', [0, 1], [0, 0, 0, 1, ...swing(new Vector3(0, 0, 1), -0.6)]),
    ]),
    new AnimationClip('Wave', 0.5, [
      new QuaternionKeyframeTrack('upperarm_r.quaternion', [0, 0.5], [0, 0, 0, 1, ...swing(new Vector3(0, 0, 1), 0.5)]),
    ]),
    new AnimationClip('Swing both', 0.8, [
      new QuaternionKeyframeTrack('upperarm_l.quaternion', [0, 0.8], [0, 0, 0, 1, ...swing(new Vector3(0, 0, 1), 0.4)]),
      new QuaternionKeyframeTrack('upperarm_r.quaternion', [0, 0.8], [0, 0, 0, 1, ...swing(new Vector3(0, 0, 1), -0.4)]),
    ]),
  ]
  return root
}

const run = async (extra: Record<string, unknown>) => runNormalize({ source: threeActionSource(), sourceLabel: 'c16.glb', sourceSha256: 'c'.repeat(64),
  target: await target(), targetLabel: 'mixamo65.glb', targetSha256: 'd'.repeat(64), ...extra } as any)

/** World positions of both hands at mid-clip, per exported clip, read back from the written GLB.
 *  (armSpace re-aims the upper arm; the hand, farthest from the shoulder, shows the largest shift.
 *  Measured on this fixture: armSpace 0.3 moves the hand ≈0.017 m, 0.5 ≈0.026 m.) */
async function armPositions(glb: Uint8Array) {
  const reloaded = createThreeRigAdapter(await loadAsset(glb, 'glb'), { fingerprint: 'c16-arms' })
  try {
    const ids = new Map(reloaded.rig.bones.map((bone) => [bone.name, bone.id]))
    return reloaded.actions.map((clip, clipIndex) => {
      const pose = new Map(reloaded.sample(clipIndex, clip.durationSeconds / 2).map((bone) => [bone.id, bone.world.slice(12, 15)]))
      return { left: pose.get(ids.get('LeftHand')!)!, right: pose.get(ids.get('RightHand')!)! }
    })
  } finally { reloaded.dispose() }
}
const distance = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

test('C16: per-Action armSpace bakes each Action with its own set; defaults stay byte-identical', async () => {
  const base = await run({})
  assert.equal(base.status, 'PASS', JSON.stringify(base.report))
  const baseSha = base.manifest.glbSha256

  // No map, an empty map, and a map of explicit defaults all reproduce the pre-C16 bytes exactly.
  assert.equal((await run({ adjustmentsByAction: {} })).manifest.glbSha256, baseSha, 'empty adjustmentsByAction changes nothing')
  assert.equal((await run({ adjustmentsByAction: { 0: {}, 1: {}, 2: {} } })).manifest.glbSha256, baseSha, 'explicit defaults change nothing')

  const perAction = await run({ adjustmentsByAction: { 0: { armSpace: 0 }, 1: { armSpace: 0.3 }, 2: { armSpace: 0.5 } } })
  assert.equal(perAction.status, 'PASS', JSON.stringify(perAction.report))
  assert.notEqual(perAction.manifest.glbSha256, baseSha)
  const report = perAction.report as any
  assert.equal(report.adjustments.armSpace, 0, 'run-wide report.adjustments stays the global set')
  assert.deepEqual(report.adjustmentsByAction.map((item: any) => [item.index, item.name, item.armSpace]),
    [[0, 'Walk forward', 0], [1, 'Wave', 0.3], [2, 'Swing both', 0.5]])
  assert.equal(report.adjustmentsByAction[1].defaults.armSpace, 0)

  // Inside the one combined GLB: Action 0 (armSpace 0 = default) matches the base bake, Actions 1/2 moved.
  const baseArms = await armPositions(base.glb!), perArms = await armPositions(perAction.glb!)
  assert.ok(distance(baseArms[0]!.left, perArms[0]!.left) < 1e-6 && distance(baseArms[0]!.right, perArms[0]!.right) < 1e-6, 'Action 0 unchanged')
  assert.ok(distance(baseArms[1]!.right, perArms[1]!.right) > 0.01, 'Action 1 right arm moved by armSpace 0.3')
  assert.ok(distance(baseArms[2]!.left, perArms[2]!.left) > 0.01 && distance(baseArms[2]!.right, perArms[2]!.right) > 0.01, 'Action 2 arms moved by armSpace 0.5')
  assert.ok(distance(perArms[1]!.right, perArms[2]!.right) > 0.005, 'Actions 1 and 2 differ from each other')

  // One Action per run: three different armSpace values give three pairwise-different GLBs,
  // and a per-Action entry equals the old run-wide option for that Action.
  const singles: string[] = []
  for (const [index, armSpace] of [[0, 0], [1, 0.3], [2, 0.5]] as const) {
    const own = await run({ actions: [index], adjustmentsByAction: { [index]: { armSpace } } })
    const global = await run({ actions: [index], adjustments: { armSpace } })
    assert.equal(own.manifest.glbSha256, global.manifest.glbSha256, `Action ${index}: per-Action entry == run-wide set`)
    singles.push(own.manifest.glbSha256)
  }
  assert.equal(new Set(singles).size, 3, 'three armSpace values produce three different GLBs')
  const defaultSingle = await run({ actions: [0] })
  assert.equal(defaultSingle.manifest.glbSha256, singles[0], 'armSpace 0 per-Action == no adjustments at all')
})

test('C16: parseOptions validates adjustmentsByAction like adjustments', () => {
  assert.equal(parseOptions({}).adjustmentsByAction, undefined)
  const parsed = parseOptions({ adjustmentsByAction: { 1: { armSpace: 0.3 } } })
  assert.equal(parsed.adjustmentsByAction![1]!.armSpace, 0.3)
  assert.equal(parsed.adjustmentsByAction![1]!.intensity, 1, 'entries resolve against the defaults')
  assert.throws(() => parseOptions({ adjustmentsByAction: [] }), /adjustmentsByAction must be an object/)
  assert.throws(() => parseOptions({ adjustmentsByAction: { x: {} } }), /adjustmentsByAction keys/)
  assert.throws(() => parseOptions({ adjustmentsByAction: { 0: { armSpace: 3 } } }), /adjustmentsByAction\.0\.armSpace/)
  assert.throws(() => parseOptions({ adjustmentsByAction: { 0: { nope: 1 } } }), /adjustmentsByAction\.0\.nope/)
})
