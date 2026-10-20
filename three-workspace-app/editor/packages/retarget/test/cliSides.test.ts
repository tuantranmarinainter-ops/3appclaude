import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnimationClip, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import { loadAsset } from '../cli/loadAsset.ts'
import { runNormalize } from '../cli/normalizeCore.ts'

const here = dirname(fileURLToPath(import.meta.url))
const targetPath = resolve(here, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')

/**
 * UE-style rig whose rest pose faces +Z (toes point +Z). Variants:
 * - `mirroredNames`: the `_l` bones sit on the anatomical RIGHT (−X) — the names lie, toes and steps do not;
 * - `turnedClips` (LoL Lux): every clip turns the pelvis 180°, so the Actions face −Z while the rest pose faces +Z;
 * - steps: root-motion walk (hips advance, planted foot stays), in-place walk (planted foot slides back), or none.
 * The anatomical left arm swings forward in every clip.
 */
function rig(options: { mirroredNames?: boolean; turnedClips?: boolean; steps?: 'root' | 'in-place' | 'none' | 'shuffle'; facing?: number } = {}) {
  const root = new Group(), bones = new Map<string, Bone>()
  const add = (name: string, parent: string | null, x: number, y: number, z = 0) => {
    const bone = new Bone(); bone.name = name; bone.position.set(x, y, z)
    ;(parent ? bones.get(parent)! : root).add(bone); bones.set(name, bone)
  }
  const left = options.mirroredNames ? 'r' : 'l', right = options.mirroredNames ? 'l' : 'r'
  add('pelvis', null, 0, 1)
  add('spine_01', 'pelvis', 0, 0.1); add('spine_02', 'spine_01', 0, 0.1); add('spine_03', 'spine_02', 0, 0.1)
  add('neck_01', 'spine_03', 0, 0.15); add('head', 'neck_01', 0, 0.1)
  for (const [side, sign] of [[left, 1], [right, -1]] as const) {
    add(`clavicle_${side}`, 'spine_03', 0.05 * sign, 0.1); add(`upperarm_${side}`, `clavicle_${side}`, 0.1 * sign, 0)
    add(`lowerarm_${side}`, `upperarm_${side}`, 0.25 * sign, 0); add(`hand_${side}`, `lowerarm_${side}`, 0.25 * sign, 0)
    add(`thigh_${side}`, 'pelvis', 0.1 * sign, -0.05); add(`calf_${side}`, `thigh_${side}`, 0, -0.45)
    add(`foot_${side}`, `calf_${side}`, 0, -0.45); add(`ball_${side}`, `foot_${side}`, 0, -0.05, 0.12)
  }
  // In clip space "forward" is local +Z of the pelvis; turnedClips spins the pelvis so clip-forward is world −Z.
  const swing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2) // +X arm → +Z (clip forward)
  const tracks = [new QuaternionKeyframeTrack(`upperarm_${left}.quaternion`, [0, 1], [0, 0, 0, 1, ...swing.toArray()])]
  const turn = options.turnedClips ? new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI) : null
  if (turn) tracks.push(new QuaternionKeyframeTrack('pelvis.quaternion', [0, 1], [...turn.toArray(), ...turn.toArray()]))
  const steps = options.steps ?? 'root'
  if (steps === 'in-place' || steps === 'shuffle') {
    const reach = steps === 'shuffle' ? 0.2 : 0.7 // pelvis-local: foot slides back (−Z) under still hips
    tracks.push(new VectorKeyframeTrack(`foot_${left}.position`, [0, 1], [0, -0.45, reach, 0, -0.45, -reach]))
  } else if (steps === 'root') {
    const sign = turn ? -1 : 1 // hips advance along clip-forward; the planted foot stays put in the world
    tracks.push(new VectorKeyframeTrack('pelvis.position', [0, 1], [0, 1, 0, 0, 1, 1.5 * sign]),
      new VectorKeyframeTrack(`foot_${left}.position`, [0, 1], [0, -0.45, 0, 0, -0.45, -1.5]))
  }
  root.animations = [new AnimationClip('Walk', 1, tracks)]
  root.rotation.y = (options.facing ?? 0) * Math.PI / 180
  return root
}

async function run(source: Group, swapSides?: 'auto' | 'on' | 'off') {
  const result = await runNormalize({ source, sourceLabel: 'sides', sourceSha256: '5'.repeat(64), ...(swapSides ? { swapSides } : {}),
    target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: '6'.repeat(64) })
  assert.equal(result.status, 'PASS', JSON.stringify((result.report as any).blocker))
  const reloaded = createThreeRigAdapter(await loadAsset(result.glb!, 'glb'), { fingerprint: 'out' })
  const id = (name: string) => reloaded.rig.bones.find((bone) => bone.name === name)!.id
  const at = (time: number) => new Map(reloaded.sample(0, time).map((bone) => [bone.id, bone.world]))
  const start = at(0), end = at(1)
  const out = {
    report: result.report as any,
    hipsTravelZ: end.get(id('Hips'))![14]! - start.get(id('Hips'))![14]!,
    // target faces +Z when its LeftUpLeg is on +X
    facesForward: start.get(id('LeftUpLeg'))![12]! > start.get(id('RightUpLeg'))![12]!,
    leftArmForward: end.get(id('LeftForeArm'))![14]! - end.get(id('LeftArm'))![14]!,
    rightArmForward: end.get(id('RightForeArm'))![14]! - end.get(id('RightArm'))![14]!,
  }
  reloaded.dispose()
  return out
}

test('mirrored L/R names are detected from the rest toes and swapped; the target walks forward with the anatomical left arm', async () => {
  for (const steps of ['root', 'in-place', 'none'] as const) {
    const fixed = await run(rig({ mirroredNames: true, steps }))
    assert.equal(fixed.report.sides.mirrored, true, steps)
    assert.equal(fixed.report.sides.swapped, true, steps)
    assert.equal(fixed.report.sides.restTurnDegrees, 0, `${steps}: no rest turn once the names are fixed`)
    assert.equal(fixed.report.calibration.facingYawDegrees, 0)
    assert.ok(fixed.facesForward, steps)
    assert.ok(fixed.leftArmForward > 0.15 && fixed.rightArmForward < 0.05, `${steps}: left arm forward (${fixed.leftArmForward}, ${fixed.rightArmForward})`)
    if (steps === 'root') assert.ok(fixed.hipsTravelZ > 1.3, `walks forward (${fixed.hipsTravelZ})`)
  }
})

test('rest/animation facing mismatch (LoL Lux: clips turned 180°) turns the source reference, not the names', async () => {
  for (const steps of ['root', 'in-place'] as const) {
    const fixed = await run(rig({ turnedClips: true, steps }))
    assert.equal(fixed.report.sides.mirrored, false, steps)
    assert.equal(fixed.report.sides.swapped, false, steps)
    assert.equal(fixed.report.sides.restTurnDegrees, 180, steps)
    assert.ok(fixed.report.sides.warnings.some((warning: { code: string }) => warning.code === 'REST_FACING_TURNED'))
    assert.ok(fixed.facesForward, `${steps}: target faces +Z like every other output`)
    assert.ok(fixed.leftArmForward > 0.15 && fixed.rightArmForward < 0.05, `${steps}: anatomical left arm forward (${fixed.leftArmForward}, ${fixed.rightArmForward})`)
    if (steps === 'root') assert.ok(fixed.hipsTravelZ > 1.3, `walks forward (${fixed.hipsTravelZ})`)
  }
})

test('honest rigs are untouched, also when the whole character is turned 180° (Soldier case)', async () => {
  for (const facing of [0, 180]) {
    const result = await run(rig({ facing }))
    assert.equal(result.report.sides.mirrored, false, `facing ${facing}`)
    assert.equal(result.report.sides.swapped, false)
    assert.equal(result.report.sides.restTurnDegrees, 0)
    assert.ok(result.facesForward && result.hipsTravelZ > 1.3 && result.leftArmForward > 0.15, `facing ${facing}`)
  }
})

test('short sliding steps (dance) are not enough evidence to turn the rest pose', async () => {
  const result = await run(rig({ turnedClips: true, steps: 'shuffle' }))
  assert.equal(result.report.sides.evidence, 'insufficient')
  assert.equal(result.report.sides.restTurnDegrees, 0)
})

test('--swap-sides on/off force the side policy', async () => {
  const forced = await run(rig({ steps: 'none' }), 'on')
  assert.equal(forced.report.sides.swapped, true)
  assert.ok(forced.leftArmForward < 0.05, 'forcing a swap on honest names takes the swing off the target left arm')
  const off = await run(rig({ mirroredNames: true, steps: 'none' }), 'off')
  assert.equal(off.report.sides.swapped, false)
  assert.equal(off.report.sides.mode, 'off')
})
