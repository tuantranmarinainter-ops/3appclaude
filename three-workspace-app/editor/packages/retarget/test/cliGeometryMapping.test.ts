import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnimationClip, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import { buildAutoMapping, MIXAMO65_REQUIRED_JOINTS } from '../cli/autoMapping.ts'
import { loadAsset } from '../cli/loadAsset.ts'
import { runNormalize } from '../cli/normalizeCore.ts'

const here = dirname(fileURLToPath(import.meta.url))
const targetPath = resolve(here, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')

type Variant = 'clavicle-t' | 'pelvis-a'

/**
 * Unnamed humanoid (`b0..bN`, creation order) facing +Z before `yawDegrees` is applied; its left side is +X.
 * `clavicle-t`: T-pose with clavicles, legs directly under the hips. `pelvis-a`: A-pose without clavicles, legs under a
 * pelvis child of the root. Both carry helper bones (cape pair, back weapon, hand weapon) that must not be mistaken for limbs.
 */
function unnamedHumanoid(yawDegrees: number, variant: Variant) {
  const root = new Group(), bones: Bone[] = [], roles = new Map<string, string>()
  const add = (parent: Bone | null, x: number, y: number, z = 0, role?: string) => {
    const bone = new Bone(); bone.name = `b${bones.length}`; bone.position.set(x, y, z)
    ;(parent ?? root).add(bone); bones.push(bone)
    if (role) roles.set(role, bone.name)
    return bone
  }
  const hips = add(null, 0, 1, 0, 'Hips'), pelvis = variant === 'pelvis-a' ? add(hips, 0, -0.02) : hips
  const spine = add(hips, 0, 0.12, 0, 'Spine'), mid = add(spine, 0, 0.12), chest = add(mid, 0, 0.2, 0, 'Spine2')
  const neck = add(chest, 0, 0.12, 0, 'Neck'), head = add(neck, 0, 0.1, 0.02, 'Head')
  add(head, 0, 0.12); add(head, 0.04, 0.05, 0.05); add(head, -0.04, 0.05, 0.05)
  add(spine, 0, 0.1, -0.12) // back weapon, extends above the chest but below the head
  for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
    let anchor = chest
    if (variant === 'clavicle-t') anchor = add(chest, 0.05 * sign, 0.1, -0.01, `${side}Shoulder`)
    const arm = add(anchor, 0.12 * sign, variant === 'clavicle-t' ? 0 : -0.02, 0, `${side}Arm`)
    const slope = variant === 'clavicle-t' ? 0 : -0.14
    const fore = add(arm, 0.26 * sign, slope, 0, `${side}ForeArm`), hand = add(fore, 0.25 * sign, slope, 0, `${side}Hand`)
    add(hand, 0.04 * sign, slope / 3, 0.02); add(hand, 0.05 * sign, 0, 0); add(hand, 0.08 * sign, 0, -0.02) // fingers + weapon socket
    const strand = add(chest, 0.06 * sign, -0.02, -0.08); add(add(strand, 0.02 * sign, -0.2, -0.02), 0.01 * sign, -0.2, 0) // cape strand: 3-joint pair that hangs down, not arm-like
    const up = add(pelvis, 0.1 * sign, -0.05, 0, `${side}UpLeg`), knee = add(up, 0.01 * sign, -0.44, 0.03, `${side}Leg`)
    const foot = add(knee, 0, -0.42, -0.03, `${side}Foot`); add(foot, 0, -0.05, 0.12, `${side}ToeBase`)
  }
  root.rotation.y = yawDegrees * Math.PI / 180
  const swing = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5)
  root.animations = [new AnimationClip('Walk', 1, [
    new QuaternionKeyframeTrack(`${roles.get('LeftUpLeg')}.quaternion`, [0, 1], [0, 0, 0, 1, ...swing.toArray()]),
  ])]
  return { root, roles }
}

/** Four-legged animal: two low mirrored pairs under a horizontal spine. */
function unnamedQuadruped() {
  const root = new Group(), bones: Bone[] = []
  const add = (parent: Bone | null, x: number, y: number, z = 0) => {
    const bone = new Bone(); bone.name = `q${bones.length}`; bone.position.set(x, y, z)
    ;(parent ?? root).add(bone); bones.push(bone); return bone
  }
  const hips = add(null, 0, 0.5, -0.4), spine = add(hips, 0, 0.02, 0.4), chest = add(spine, 0, 0.02, 0.4)
  const neck = add(chest, 0, 0.15, 0.15); add(neck, 0, 0.1, 0.15)
  add(hips, 0, 0.03, -0.3) // tail
  for (const sign of [1, -1]) {
    for (const [parent, z] of [[hips, -0.05], [chest, 0.05]] as const) {
      const up = add(parent, 0.1 * sign, -0.05, z), knee = add(up, 0, -0.2, -0.03), foot = add(knee, 0, -0.2, 0.03); add(foot, 0, -0.04, 0.06)
    }
  }
  return root
}

const expectedRoles = ['Hips', 'Spine', 'Head', ...['Left', 'Right'].flatMap((side) => ['Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot'].map((part) => `${side}${part}`))]

for (const variant of ['clavicle-t', 'pelvis-a'] as const) for (const yaw of [0, 90, 180, -90, 45]) {
  test(`geometry mapping resolves an unnamed ${variant} humanoid facing ${yaw} degrees with correct left/right`, async () => {
    const { root, roles } = unnamedHumanoid(yaw, variant)
    const target = await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })
    const src = createThreeRigAdapter(root, { fingerprint: 'unnamed' }), dst = createThreeRigAdapter(target, { fingerprint: 'mixamo' })
    const mapping = buildAutoMapping(src.rig, dst.rig)
    assert.equal(mapping.family, 'unknown')
    assert.deepEqual(mapping.missingRequired, [])
    for (const role of expectedRoles) {
      const joint = mapping.joints.find((item) => item.target === role)!
      assert.equal(joint.source, roles.get(role), `${role} -> ${joint.source}`)
      assert.equal(joint.via, 'geometry')
    }
    for (const role of ['Spine2', 'Neck', 'LeftToeBase', 'RightToeBase']) {
      assert.equal(mapping.joints.find((item) => item.target === role)?.source, roles.get(role), role)
    }
    assert.ok(mapping.confidence! > 0.6 && mapping.confidence! <= 1, `confidence ${mapping.confidence}`)
    assert.ok(mapping.notes!.some((note) => /xac nhan|confirm/i.test(note)))
    src.dispose(); dst.dispose()
  })
}

test('geometry mapping leaves a quadruped unmapped (BLOCKED, never guessed)', async () => {
  const target = await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true })
  const src = createThreeRigAdapter(unnamedQuadruped(), { fingerprint: 'quad' }), dst = createThreeRigAdapter(target, { fingerprint: 'mixamo' })
  const mapping = buildAutoMapping(src.rig, dst.rig)
  assert.deepEqual(mapping.missingRequired, [...MIXAMO65_REQUIRED_JOINTS])
  assert.ok(mapping.joints.every((joint) => joint.via !== 'geometry'))
  assert.equal(mapping.confidence, undefined)
  src.dispose(); dst.dispose()
})

test('runNormalize on an unnamed humanoid passes and reports geometry mapping as needing confirmation', async () => {
  const { root } = unnamedHumanoid(90, 'clavicle-t')
  const result = await runNormalize({ source: root, sourceLabel: 'unnamed.glb', sourceSha256: 'c'.repeat(64),
    target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 'mixamo65.glb', targetSha256: 'd'.repeat(64) })
  assert.equal(result.status, 'PASS', JSON.stringify(result.report).slice(0, 600))
  const mapping = (result.report as any).mapping
  assert.ok(mapping.confidence > 0 && mapping.confidence <= 1)
  assert.equal(mapping.needsUserConfirmation, true)
  assert.ok(mapping.joints.some((joint: any) => joint.via === 'geometry'))
})
