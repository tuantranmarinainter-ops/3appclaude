import assert from 'node:assert/strict'
import test from 'node:test'
import { adjustGround, restFootFloor } from '../src/groundAdjust.ts'
import type { RetargetRig } from '../src/universal.ts'
import type { UniversalBakeFrame } from '../src/universalBake.ts'

const translation = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
const rig: RetargetRig = { fingerprint: 'f', bones: [
  { id: 'hips', name: 'mixamorigHips', parentId: null, restWorld: translation(0, 1, 0) },
  { id: 'foot', name: 'mixamorigLeftFoot', parentId: 'hips', restWorld: translation(0.1, 0.08, 0) },
  { id: 'toe', name: 'mixamorigLeftToeBase', parentId: 'foot', restWorld: translation(0.1, 0.02, 0.1) },
] }
const frame = (index: number, hipsY: number, footY: number, toeY: number): UniversalBakeFrame => ({ frame: index, timeSeconds: index / 30, bones: [
  { targetBoneId: 'hips', targetBoneName: 'mixamorigHips', position: [0, hipsY, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], world: translation(0, hipsY, 0) },
  { targetBoneId: 'foot', targetBoneName: 'mixamorigLeftFoot', position: [0.1, footY - hipsY, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], world: translation(0.1, footY, 0) },
  { targetBoneId: 'toe', targetBoneName: 'mixamorigLeftToeBase', position: [0, toeY - footY, 0.1], rotation: [0, 0, 0, 1], scale: [1, 1, 1], world: translation(0.1, toeY, 0.1) },
] })
const floorOf = (frames: UniversalBakeFrame[]) => frames.map((item) => Math.min(item.bones[1]!.world[13]!, item.bones[2]!.world[13]!))

test('rest floor is the lowest foot/toe joint of the target', () => assert.equal(restFootFloor(rig), 0.02))

test('lift raises a sinking Action by its deepest sink and never lowers one that floats', () => {
  const sunk = [frame(0, 0.9, 0.0, -0.06), frame(1, 0.95, 0.05, -0.01)]
  const report = adjustGround(rig, sunk, 'lift')
  assert.equal(report.applied, true)
  assert.ok(Math.abs(report.offsetMeters - 0.08) < 1e-9)
  assert.ok(Math.abs(Math.min(...floorOf(sunk)) - 0.02) < 1e-9)
  assert.ok(Math.abs(sunk[0]!.bones[0]!.position[1]! - 0.98) < 1e-9, 'root local Y moves with the lift')
  assert.equal(sunk[0]!.bones[0]!.rotation.join(), '0,0,0,1', 'rotations are untouched')
  const floating = [frame(0, 1.2, 0.3, 0.25)], before = floating[0]!.bones[0]!.position[1]
  assert.equal(adjustGround(rig, floating, 'lift').applied, false)
  assert.equal(floating[0]!.bones[0]!.position[1], before)
  const lowered = [frame(0, 1.2, 0.3, 0.25)]
  assert.equal(adjustGround(rig, lowered, 'level').applied, true)
  assert.ok(Math.abs(floorOf(lowered)[0]! - 0.02) < 1e-9)
})

test('frame mode keeps every frame at or above the floor and smooth', () => {
  const frames = [0, 0, 0, -0.05, 0, 0, 0].map((dip, index) => frame(index, 0.9, 0.08 + dip, 0.02 + dip))
  const report = adjustGround(rig, frames, 'frame')
  assert.equal(report.applied, true)
  for (const value of floorOf(frames)) assert.ok(value >= 0.02 - 1e-9, `frame floor ${value}`)
  const offsets = frames.map((item) => item.bones[0]!.position[1]! - 0.9)
  assert.ok(Math.max(...offsets.slice(1).map((value, index) => Math.abs(value - offsets[index]!))) < 0.05, 'no single-frame jump')
})

test('an offset beyond half the hips height (wrong units/root scale) is skipped, not applied', () => {
  const frames = [frame(0, -4, -5, -5.05)]
  const report = adjustGround(rig, frames, 'lift')
  assert.equal(report.applied, false); assert.equal(report.skipped, 'OFFSET_TOO_LARGE')
  assert.equal(frames[0]!.bones[0]!.position[1], -4)
})

test('off leaves frames alone', () => {
  const frames = [frame(0, 0.9, 0, -0.06)]
  assert.equal(adjustGround(rig, frames, 'off').applied, false)
})

test('source in the wrong unit (hips tens of "meters") gets body-relative root travel automatically and stays on the floor', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { loadAsset } = await import('../cli/loadAsset.ts')
  const { runNormalize } = await import('../cli/normalizeCore.ts')
  const here = dirname(fileURLToPath(import.meta.url)), bobjDir = resolve(here, '../../../apps/studio/public/retarget/v9.12')
  const target = resolve(here, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
  const run = async (unitMeters: number, rootScale?: number) => runNormalize({
    source: await loadAsset(readFileSync(resolve(bobjDir, 'minecraft-actions.bobj')), 'bobj', { bobjArmature: readFileSync(resolve(bobjDir, 'minecraft20-armature.bobj')) }),
    sourceLabel: 'mc', sourceSha256: '5'.repeat(64), target: await loadAsset(readFileSync(target), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: '6'.repeat(64),
    actions: [0], unitMeters, ...(rootScale === undefined ? {} : { rootScale }) })
  const huge = await run(80)
  assert.equal(huge.status, 'PASS')
  assert.equal(huge.report.proportions.rootScaleSource, 'auto-units')
  assert.ok(Math.abs(huge.report.proportions.rootScale - huge.report.proportions.suggestedRootScale!) < 1e-12)
  const [low, high] = huge.report.roundtrip.perAction[0]!.hipsHeightRangeMeters
  assert.ok(low! > 0.3 && high! < 2, `hips stay human-sized: ${low}..${high}`)
  const given = await run(80, 1)
  assert.equal(given.report.proportions.rootScaleSource, 'given')
  assert.equal((await run(1)).report.proportions.rootScaleSource, 'default')
})
