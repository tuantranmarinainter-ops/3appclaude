import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createFrameSnapshot } from '../../evaluate/FrameSnapshot'
import { motionBlendWeight, motionPhaseOffsetSeconds, motionTimeSeconds } from '../../evaluate/clips'
import { applyMotionAndPose } from '../../engine/objects/applySnapshot'
import { CharacterAnimator } from '../../engine/objects/MotionPlayer'
import { lockStrength } from '../../engine/objects/footLockMath'
import { blendPlanFor, LOCK_EASE_SECONDS, resetBlendAlignment } from '../../engine/objects/clipBlendPlan'
import { mirrorBoneName, mirroredAnimation, reflectPoint, reflectQuaternion } from '../../engine/objects/clipMirror'
import { evaluateRootTrajectory } from '../../engine/objects/rootMotion'
import { blendOffBeatText, getBlendStatus, OFF_BEAT_TEXT } from '../../engine/objects/blendStatus'
import { setBlendOptions } from '../../document/clipBlend'
import type { StageGraph } from '../../engine/objects/graph'
import type { MotionClip } from '../../contract/types'

const FPS = 30
const D = 10

// ---- Pure math -------------------------------------------------------------------------------------------------

test('cặp xương L/R: Mixamo65, Verity, tên có hậu tố; xương giữa thân không có cặp; đảo hai lần về lại tên cũ', () => {
  const pairs: Array<[string, string]> = [
    ['mixamorigLeftArm', 'mixamorigRightArm'], ['mixamorigLeftHandIndex1', 'mixamorigRightHandIndex1'],
    ['mixamorigLeftToe_End', 'mixamorigRightToe_End'], ['mixamorig:LeftUpLeg', 'mixamorig:RightUpLeg'],
    ['Upper_Leg_L', 'Upper_Leg_R'], ['Foot_R', 'Foot_L'], ['Toe_L_end_end', 'Toe_R_end_end'], ['Index_01_L', 'Index_01_R'],
    ['Hand.L', 'Hand.R'], ['thigh_l', 'thigh_r'],
  ]
  for (const [a, b] of pairs) {
    assert.equal(mirrorBoneName(a)?.partner, b, a)
    assert.equal(mirrorBoneName(b)?.partner, a, b)
    assert.notEqual(mirrorBoneName(a)?.side, mirrorBoneName(b)?.side)
  }
  assert.equal(mirrorBoneName('mixamorigLeftArm')?.side, 'left')
  for (const centre of ['mixamorigHips', 'mixamorigSpine1', 'mixamorigHead', 'Root', 'COG', 'Pelvis', 'Neck_01', 'Clavicle', 'Leftover']) {
    assert.equal(mirrorBoneName(centre), null, centre)
  }
})

test('phản chiếu quaternion: quay quanh trục cắt mặt phẳng giữ nguyên chiều quanh trục trong mặt phẳng, đảo quanh trục pháp tuyến; M·R·M', () => {
  const nx = new THREE.Vector3(1, 0, 0)
  const aroundX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.7)
  const aroundY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7)
  const aroundZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7)
  // Mặt phẳng x=0: quay quanh X (trục pháp tuyến) giữ nguyên, quay quanh Y và Z đảo chiều.
  assert.ok(reflectQuaternion(aroundX, nx).angleTo(aroundX) < 1e-12)
  assert.ok(reflectQuaternion(aroundY, nx).angleTo(aroundY.clone().invert()) < 1e-12)
  assert.ok(reflectQuaternion(aroundZ, nx).angleTo(aroundZ.clone().invert()) < 1e-12)
  // Khớp định nghĩa M·R·M với pháp tuyến bất kỳ.
  const n = new THREE.Vector3(0.3, 0, 0.8).normalize()
  const m = new THREE.Matrix4().set(
    1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, 0,
    -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, 0,
    -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, 0,
    0, 0, 0, 1)
  for (const q of [aroundX, aroundY, new THREE.Quaternion(0.2, -0.5, 0.4, 0.7).normalize()]) {
    const expected = new THREE.Quaternion().setFromRotationMatrix(m.clone().multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(m))
    assert.ok(reflectQuaternion(q, n).angleTo(expected) < 1e-6)
    assert.ok(reflectQuaternion(reflectQuaternion(q, n), n).angleTo(q) < 1e-6, 'phản chiếu hai lần là phép đồng nhất')
  }
  const p = new THREE.Vector3(0.4, 1, 2)
  assert.ok(reflectPoint(p, nx).distanceTo(new THREE.Vector3(-0.4, 1, 2)) < 1e-12)
})

test('smootherstep nhả khóa: 1 -> 0 đơn điệu, độ dốc bằng 0 ở hai đầu, trơn hơn smoothstep cũ', () => {
  const ease = 12
  assert.equal(lockStrength(10, 4, 10, ease), 1)
  assert.equal(lockStrength(10 + ease, 4, 10, ease), 0)
  let previous = 1, maxStep = 0
  for (let i = 1; i <= 120; i++) {
    const value = lockStrength(10 + (i / 120) * ease, 4, 10, ease)
    assert.ok(value <= previous + 1e-12)
    maxStep = Math.max(maxStep, previous - value)
    previous = value
  }
  assert.ok(lockStrength(10 + 0.02 * ease, 4, 10, ease) > 0.9999, 'bắt đầu rất chậm (đạo hàm bậc 1 và 2 bằng 0)')
  assert.ok(lockStrength(10 + 0.98 * ease, 4, 10, ease) < 1e-4)
  assert.ok(Math.abs(lockStrength(10 + 0.5 * ease, 4, 10, ease) - 0.5) < 1e-12)
  assert.ok(maxStep * 120 < 1.9, 'độ dốc lớn nhất của smootherstep là 1,875')
})

test('Khớp nhịp: thời gian đọc động tác gốc cộng thêm độ dời, đúng với tốc độ, lặp và không lặp', () => {
  const base = motionClip('B', 10, 100, { blendIn: { frames: D, curve: 'smooth', footLock: true, phaseOffsetSeconds: 0.5 } })
  const plain = motionClip('B', 10, 100, { blendIn: { frames: D, curve: 'smooth', footLock: true } })
  assert.equal(motionPhaseOffsetSeconds(base), 0.5)
  assert.equal(motionPhaseOffsetSeconds(plain), 0)
  assert.ok(Math.abs(motionTimeSeconds(base, 10, FPS) - 0.5) < 1e-12)
  assert.ok(Math.abs(motionTimeSeconds(base, 25, FPS) - 1.0) < 1e-12)
  // Không lặp: kẹp ở cuối đoạn gốc (3 s).
  assert.ok(Math.abs(motionTimeSeconds(base, 100, FPS) - 3) < 1e-12)
  // Lặp: quay vòng sau khi cộng độ dời.
  const loop = { ...base, playback: { ...base.playback, loop: true } }
  assert.ok(Math.abs(motionTimeSeconds(loop, 10 + 75, FPS) - ((2.5 + 0.5) % 3)) < 1e-9)
  // Tốc độ 2: độ dời cộng vào thời gian đã nhân tốc độ (giây của động tác gốc).
  const fast = { ...base, playback: { ...base.playback, speed: 2 } }
  assert.ok(Math.abs(motionTimeSeconds(fast, 25, FPS) - (1.0 + 0.5)) < 1e-12)
  // Không có độ dời: y hệt K2.
  assert.equal(motionTimeSeconds(plain, 25, FPS), 0.5)
})

test('setBlendOptions: bật/tắt mirror và đặt/bỏ độ dời nhịp, giữ nguyên các trường khác, không đổi gì thì null', () => {
  const a = motionClip('A', 0, 39)
  const b = motionClip('B', 30, 90, { blendIn: { frames: D, curve: 'linear', footLock: true } })
  const mirrored = setBlendOptions([a, b], 'B', { mirror: true })!
  assert.deepEqual(mirrored[1].playback.blendIn, { frames: D, curve: 'linear', footLock: true, mirror: true })
  assert.equal(setBlendOptions(mirrored, 'B', { mirror: true }), null)
  const phased = setBlendOptions(mirrored, 'B', { phaseOffsetSeconds: 0.4 })!
  assert.deepEqual(phased[1].playback.blendIn, { frames: D, curve: 'linear', footLock: true, mirror: true, phaseOffsetSeconds: 0.4 })
  const cleared = setBlendOptions(phased, 'B', { mirror: false, phaseOffsetSeconds: null })!
  assert.deepEqual(cleared[1].playback.blendIn, { frames: D, curve: 'linear', footLock: true })
  assert.equal(setBlendOptions([a, motionClip('C', 50, 60)], 'C', { mirror: true }), null, 'không có blendIn')
})

// ---- Synthetic rig ----------------------------------------------------------------------------------------------

function bone(name: string, x: number, y: number, z: number, parent?: THREE.Object3D) {
  const b = new THREE.Bone()
  b.name = name
  b.position.set(x, y, z)
  parent?.add(b)
  return b
}

/** Hips 1,05 m, đùi ±0,1, cẳng/bàn 0,5 m, thêm cánh tay để thử đảo tay. Nhìn về +Z, trái ở +X. */
function buildRig(clips: MotionClip[], sources: Record<string, THREE.AnimationClip>) {
  const root = new THREE.Group()
  const motionRoot = new THREE.Group()
  motionRoot.matrixAutoUpdate = false
  const inner = new THREE.Group()
  inner.name = 'Armature'
  const hips = bone('mixamorigHips', 0, 1.05, 0, inner)
  const spine = bone('mixamorigSpine', 0, 0.2, 0, hips)
  const bones: Record<string, THREE.Bone> = { hips, spine }
  for (const side of ['Left', 'Right']) {
    const sx = side === 'Left' ? 0.1 : -0.1
    const thigh = bone(`mixamorig${side}UpLeg`, sx, 0, 0, hips)
    const shin = bone(`mixamorig${side}Leg`, 0, -0.5, 0, thigh)
    const foot = bone(`mixamorig${side}Foot`, 0, -0.5, 0, shin)
    const toe = bone(`mixamorig${side}ToeBase`, 0, -0.05, 0.1, foot)
    const arm = bone(`mixamorig${side}Arm`, side === 'Left' ? 0.2 : -0.2, 0.3, 0, spine)
    const hand = bone(`mixamorig${side}Hand`, side === 'Left' ? 0.3 : -0.3, 0, 0, arm)
    Object.assign(bones, { [`${side}UpLeg`]: thigh, [`${side}Leg`]: shin, [`${side}Foot`]: foot, [`${side}Toe`]: toe, [`${side}Arm`]: arm, [`${side}Hand`]: hand })
  }
  motionRoot.add(inner)
  root.add(motionRoot)
  const restPose = new Map<string, THREE.Quaternion>(), restPos = new Map<string, THREE.Vector3>(), restScale = new Map<string, THREE.Vector3>()
  inner.traverse((o) => { if (!o.name) return; restPose.set(o.name, o.quaternion.clone()); restPos.set(o.name, o.position.clone()); restScale.set(o.name, o.scale.clone()) })
  const node = {
    id: 'hero', name: 'Hero', type: 'character' as const, visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    metadata: { rig: 'direct' },
    character: { animation: { mode: 'pose', posePresetId: '', controlValues: {} } },
  }
  const character = { node, root, inner, motionRoot, rig: 'direct', restPose, restPos, restScale, legLength: 1, animator: new CharacterAnimator(inner), retargeter: null }
  const graph = {
    doc: { content: { timeline: { fps: FPS, animation: { motionClips: clips } } } },
    scene: new THREE.Scene(), nodeById: new Map([['hero', node]]),
    characters: new Map([['hero', character]]), props: new Map(), primitives: new Map(), groups: new Map(),
    cameras: new Map(), poseBank: new Map(),
    motionPlayer: { getClipForDirectBind: (assetId: string) => sources[assetId], getRaw: () => null },
  } as unknown as StageGraph
  return { graph, bones, character, inner, root }
}

function motionClip(id: string, start: number, end: number, extra: Partial<MotionClip['playback']> = {}, policy?: string): MotionClip {
  return {
    id, target: { nodeId: 'hero' }, frameStart: start, frameEnd: end, sourceDuration: 3,
    motion: { assetId: id, time: 0, sourceLengthSeconds: 3, ...(policy ? { rootMotion: { policy, boneName: 'mixamorigHips', alignment: 'continue' } } : {}) },
    playback: { version: 1, speed: 1, loop: false, loopMode: 'repeat', ...extra },
  } as unknown as MotionClip
}

const axisQ = (x: number, y: number, z: number, angle: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(x, y, z).normalize(), angle)
const qTrack = (name: string, times: number[], quats: THREE.Quaternion[]) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quats.flatMap((q) => q.toArray()))

/** Bước đi: chân trái và phải đung đưa ngược nhau quanh trục X, chu kỳ `period` giây; `lead` = pha (rad) để chọn chân trước tại t=0. */
function gaitClip(name: string, period: number, hips: [number, number, number], phase = 0, amplitude = 0.4): THREE.AnimationClip {
  const times = Array.from({ length: 61 }, (_, i) => i * 0.05)
  const swing = (t: number) => amplitude * Math.cos((2 * Math.PI * t) / period + phase)
  const q = new THREE.Quaternion()
  return new THREE.AnimationClip(name, 3, [
    new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 3], [...hips, ...hips]),
    new THREE.QuaternionKeyframeTrack('mixamorigHips.quaternion', [0, 3], [...q.toArray(), ...q.toArray()]),
    qTrack('mixamorigLeftUpLeg', times, times.map((t) => axisQ(1, 0, 0, -swing(t)))),
    qTrack('mixamorigRightUpLeg', times, times.map((t) => axisQ(1, 0, 0, swing(t)))),
  ])
}

function evaluate(rig: ReturnType<typeof buildRig>, frame: number, a: MotionClip, b: MotionClip) {
  const snap = createFrameSnapshot()
  snap.frame = frame
  const t = (frame - b.frameStart) / D
  const inZone = frame >= b.frameStart && t < 1 && frame <= a.frameEnd
  const timeOf = (c: MotionClip) => motionTimeSeconds(c, frame, FPS, false, false)
  if (frame < b.frameStart) snap.motionPlayback.push({ nodeId: 'hero', clipId: a.id, timeSeconds: timeOf(a), weight: 1 })
  else if (inZone) {
    const w = motionBlendWeight('smooth', t)
    snap.motionPlayback.push({ nodeId: 'hero', clipId: a.id, timeSeconds: timeOf(a), weight: 1 - w }, { nodeId: 'hero', clipId: b.id, timeSeconds: timeOf(b), weight: w })
  } else snap.motionPlayback.push({ nodeId: 'hero', clipId: b.id, timeSeconds: timeOf(b), weight: 1 })
  applyMotionAndPose(rig.graph, snap)
  rig.root.updateMatrixWorld(true)
}

const world = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)

// ---- Đảo chân ---------------------------------------------------------------------------------------------------

test('đảo chân: xương hoán đổi trái-phải, quay phản chiếu, root đổi phía; đảo hai lần về lại bản gốc', () => {
  const times = [0, 1, 2, 3]
  const base = new THREE.AnimationClip('walk', 3, [
    new THREE.VectorKeyframeTrack('mixamorigHips.position', times, [0, 1.05, 0, 0.5, 1.05, 0.2, 1.0, 1.05, 0.5, 1.5, 1.05, 1.0]),
    qTrack('mixamorigHips', times, [0, 0.2, 0.4, 0.6].map((a) => axisQ(0, 1, 0, a))),
    // Đùi trái: gập về trước quanh X (0,5) và dạng ra quanh Z (0,3).
    qTrack('mixamorigLeftUpLeg', times, times.map(() => axisQ(1, 0, 0, -0.5).multiply(axisQ(0, 0, 1, 0.3)))),
    qTrack('mixamorigLeftArm', times, times.map((t) => axisQ(0, 1, 0, 0.1 * t))),
  ])
  const rig = buildRig([], { walk: base })
  const mirrored = mirroredAnimation(rig.character as never, base)
  assert.notEqual(mirrored, base)
  assert.equal(mirroredAnimation(rig.character as never, base), mirrored, 'cùng đối tượng giữa các lần gọi')
  const track = (clip: THREE.AnimationClip, name: string) => clip.tracks.find((t) => t.name === name)!
  const q = (clip: THREE.AnimationClip, name: string, i: number) => new THREE.Quaternion().fromArray(Array.from(track(clip, `${name}.quaternion`).values), i * 4)
  // Đùi phải của bản lật = đùi trái gốc phản chiếu: quanh X giữ nguyên, quanh Z đảo chiều.
  const expectedRight = axisQ(1, 0, 0, -0.5).multiply(axisQ(0, 0, 1, -0.3))
  assert.ok(q(mirrored, 'mixamorigRightUpLeg', 1).angleTo(expectedRight) < 1e-6)
  // Đùi trái của bản lật = đùi phải gốc (đứng yên) -> về rest (đồng nhất).
  assert.ok(q(mirrored, 'mixamorigLeftUpLeg', 1).angleTo(new THREE.Quaternion()) < 1e-6)
  // Tay: quay quanh Y của tay trái đổi dấu và chuyển sang tay phải.
  assert.ok(q(mirrored, 'mixamorigRightArm', 2).angleTo(axisQ(0, 1, 0, -0.2)) < 1e-6)
  // Root: x đảo dấu, y/z giữ, yaw đảo dấu (rẽ trái thành rẽ phải).
  const hipsPos = Array.from(track(mirrored, 'mixamorigHips.position').values)
  assert.ok(Math.abs(hipsPos[3] + 0.5) < 1e-6 && Math.abs(hipsPos[4] - 1.05) < 1e-6 && Math.abs(hipsPos[5] - 0.2) < 1e-6)
  assert.ok(q(mirrored, 'mixamorigHips', 3).angleTo(axisQ(0, 1, 0, -0.6)) < 1e-6)
  // Đảo hai lần = bản gốc (so các xương đã có track).
  const twice = mirroredAnimation(rig.character as never, mirrored)
  for (const name of ['mixamorigHips', 'mixamorigLeftUpLeg', 'mixamorigLeftArm']) {
    for (let i = 0; i < 4; i++) assert.ok(q(twice, name, i).angleTo(q(base, name, i)) < 1e-6, `${name}[${i}]`)
  }
  const positionsTwice = Array.from(track(twice, 'mixamorigHips.position').values)
  const positionsBase = Array.from(track(base, 'mixamorigHips.position').values)
  positionsBase.forEach((v, i) => assert.ok(Math.abs(positionsTwice[i] - v) < 1e-6))
})

test('đảo chân: bàn chân/bàn tay trên rig đã lật nằm đối xứng qua mặt phẳng giữa so với rig gốc', () => {
  const times = Array.from({ length: 7 }, (_, i) => i * 0.5)
  const base = new THREE.AnimationClip('walk', 3, [
    new THREE.VectorKeyframeTrack('mixamorigHips.position', times, times.flatMap((t) => [0.3 * t, 1.05, 0.5 * t])),
    qTrack('mixamorigHips', times, times.map((t) => axisQ(0, 1, 0, 0.3 * t))),
    qTrack('mixamorigLeftUpLeg', times, times.map((t) => axisQ(1, 0, 0, -0.5 + 0.2 * t).multiply(axisQ(0, 0, 1, 0.1)))),
    qTrack('mixamorigRightArm', times, times.map((t) => axisQ(0, 0, 1, 0.4 * t))),
  ])
  const plain = buildRig([], { walk: base })
  const flipped = buildRig([], { walk: base })
  const mirrored = mirroredAnimation(flipped.character as never, base)
  const pose = (rig: ReturnType<typeof buildRig>, clip: THREE.AnimationClip, time: number) => {
    const mixer = new THREE.AnimationMixer(rig.inner)
    mixer.clipAction(clip).play()
    mixer.setTime(time)
    rig.root.updateMatrixWorld(true)
  }
  for (const time of [0.5, 1.25, 2.5]) {
    pose(plain, base, time)
    pose(flipped, mirrored, time)
    for (const [a, b] of [['LeftFoot', 'RightFoot'], ['RightFoot', 'LeftFoot'], ['LeftHand', 'RightHand'], ['RightHand', 'LeftHand'], ['hips', 'hips'], ['LeftToe', 'RightToe']]) {
      const p = world(plain.bones[b]), m = world(flipped.bones[a])
      assert.ok(Math.hypot(m.x + p.x, m.y - p.y, m.z - p.z) < 1e-5, `${a} t=${time}: ${m.toArray()} vs ${p.toArray()}`)
    }
  }
})

test('đảo chân: đường đi root (policy trajectory) đảo trái-phải, rẽ trái thành rẽ phải', () => {
  const times = [0, 1]
  const travel = (name: string) => new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack('mixamorigHips.position', times, [0, 1.05, 0, 0.6, 1.05, 1]),
    qTrack('mixamorigHips', times, [axisQ(0, 1, 0, 0), axisQ(0, 1, 0, 0.8)]),
  ])
  const make = (mirror: boolean) => {
    const b = motionClip('B', 0, 29, { blendIn: { frames: D, curve: 'linear', footLock: true, ...(mirror ? { mirror: true } : {}) } }, 'trajectory')
    b.motion.sourceLengthSeconds = 1; (b as { sourceDuration: number }).sourceDuration = 1
    const rig = buildRig([b], { B: travel('B') })
    return { rig, b }
  }
  const plain = make(false), flipped = make(true)
  const at = (m: ReturnType<typeof make>, frame: number) => {
    const matrix = evaluateRootTrajectory(m.rig.character as never, [m.b], m.rig.graph.motionPlayer as never, frame, FPS)!
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    matrix.decompose(p, q, s)
    return { p, yaw: new THREE.Euler().setFromQuaternion(q, 'YXZ').y }
  }
  for (const frame of [8, 15, 29]) {
    const x = at(plain, frame), y = at(flipped, frame)
    assert.ok(x.p.x > 0.05 && x.yaw > 0.05, 'gốc rẽ trái (x dương, yaw dương)')
    assert.ok(Math.abs(y.p.x + x.p.x) < 1e-6 && Math.abs(y.p.z - x.p.z) < 1e-6 && Math.abs(y.p.y - x.p.y) < 1e-6, `frame ${frame} đường đi`)
    assert.ok(Math.abs(y.yaw + x.yaw) < 1e-6, `frame ${frame} hướng`)
  }
})

test('Khớp nhịp: quỹ đạo root của clip sau khởi đầu đúng tại neo khi có độ dời, và tiếp tục theo đúng tiến trình', () => {
  const travel = (name: string) => new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 1.05, 0, 0, 1.05, 1])])
  const make = (phase: number) => {
    const a = motionClip('A', 0, 29, {}, 'trajectory')
    a.motion.sourceLengthSeconds = 1; (a as { sourceDuration: number }).sourceDuration = 1
    const b = motionClip('B', 15, 59, { blendIn: { frames: 10, curve: 'linear', footLock: true, ...(phase ? { phaseOffsetSeconds: phase } : {}) } }, 'trajectory')
    b.motion.sourceLengthSeconds = 1; (b as { sourceDuration: number }).sourceDuration = 1
    const rig = buildRig([a, b], { A: travel('A'), B: travel('B') })
    return { rig, clips: [a, b] }
  }
  const z = (m: ReturnType<typeof make>, frame: number) => new THREE.Vector3().setFromMatrixPosition(evaluateRootTrajectory(m.rig.character as never, m.clips, m.rig.graph.motionPlayer as never, frame, FPS)!).z
  const plain = make(0), shifted = make(0.3)
  assert.ok(Math.abs(z(plain, 15) - z(shifted, 15)) < 1e-9, 'đầu vùng trộn cùng neo')
  // Sau vùng trộn: cùng neo, B bắt đầu đọc từ 0,3 s: z = neo + (rel(min(e,1)) - rel(0,3)) với e = 25/30 + 0,3 kẹp ở 1.
  assert.ok(Math.abs(z(plain, 40) - (0.5 + 25 / 30)) < 1e-6)
  assert.ok(Math.abs(z(shifted, 40) - (0.5 + Math.min(1, 25 / 30 + 0.3) - 0.3)) < 1e-6, `${z(shifted, 40)}`)
})

// ---- Ngược nhịp + khớp nhịp -------------------------------------------------------------------------------------

function offBeatSetup(options: { mirror?: boolean; phase?: number } = {}) {
  const a = motionClip('A', 0, 39)
  const b = motionClip('B', 30, 90, { blendIn: { frames: D, curve: 'smooth', footLock: true, ...(options.mirror ? { mirror: true } : {}), ...(options.phase ? { phaseOffsetSeconds: options.phase } : {}) } })
  // A: chân phải bước trước (pha π: swing âm -> trái sau). B: chân trái trước ở t=0, chu kỳ 1 s.
  const sources = { A: gaitClip('A', 1, [0, 1.05, 0], Math.PI), B: gaitClip('B', 1, [0, 1.05, 0], 0) }
  const rig = buildRig([a, b], sources)
  return { rig, a, b }
}

test('ngược nhịp: phát hiện chân trước của A khác B, dải báo vàng; hết ngược khi Đảo chân', () => {
  const bad = offBeatSetup()
  const plan = blendPlanFor(bad.rig.graph, bad.rig.character as never, bad.b)!
  assert.equal(plan.status.leadA, 'right')
  assert.equal(plan.status.leadB, 'left')
  assert.equal(plan.status.leadMismatch, true)
  assert.equal(getBlendStatus('B')!.leadMismatch, true)
  assert.equal(blendOffBeatText(getBlendStatus('B')), OFF_BEAT_TEXT)
  assert.match(OFF_BEAT_TEXT, /^Ngược nhịp bước: chân trước của clip sau ngược clip trước/)

  const fixed = offBeatSetup({ mirror: true })
  const fixedPlan = blendPlanFor(fixed.rig.graph, fixed.rig.character as never, fixed.b)!
  assert.equal(fixedPlan.status.leadB, 'right')
  assert.equal(fixedPlan.status.leadMismatch, false)
  assert.equal(blendOffBeatText(getBlendStatus('B')), '')

  const ok = offBeatSetup()
  ok.rig.graph.doc!.content.timeline.animation.motionClips[0] = ok.a
  const sameLead = buildRig([ok.a, ok.b], { A: gaitClip('A', 1, [0, 1.05, 0], 0), B: gaitClip('B', 1, [0, 1.05, 0], 0) })
  const samePlan = blendPlanFor(sameLead.graph, sameLead.character as never, ok.b)!
  assert.equal(samePlan.status.leadMismatch, false, 'cùng chân trước: không cảnh báo')
})

test('đứng yên (không chân trước rõ rệt): không báo ngược nhịp', () => {
  const a = motionClip('A', 0, 39)
  const b = motionClip('B', 30, 90, { blendIn: { frames: D, curve: 'smooth', footLock: true } })
  const rig = buildRig([a, b], { A: gaitClip('A', 1, [0, 1.05, 0], 0, 0.001), B: gaitClip('B', 1, [0, 1.05, 0], 0, 0.4) })
  const plan = blendPlanFor(rig.graph, rig.character as never, b)!
  assert.equal(plan.status.leadA, null)
  assert.equal(plan.status.leadMismatch, false)
})

test('Khớp nhịp bước: tìm độ dời nhỏ nhất để chân trước của B trùng A; áp vào thì hết ngược nhịp', () => {
  const bad = offBeatSetup()
  const plan = blendPlanFor(bad.rig.graph, bad.rig.character as never, bad.b)!
  const suggested = plan.status.suggestedPhaseSeconds
  assert.ok(suggested !== null, 'tìm được')
  // B: chân trái trước khi cos(2πt) > 0; chân phải trước khi cos < 0 -> t đầu tiên ~ 0,25 s (cộng ngưỡng chân trước 3 cm).
  assert.ok(suggested! > 0.25 && suggested! < 0.32, `suggested=${suggested}`)
  // Nhỏ nhất: mọi độ dời nhỏ hơn đều có chân trước là trái hoặc không rõ.
  for (let t = 0; t < suggested! - 1e-9; t += 0.02) {
    const test = offBeatSetup({ phase: t })
    const status = blendPlanFor(test.rig.graph, test.rig.character as never, test.b)!.status
    assert.notEqual(status.leadB, 'right', `t=${t}`)
  }
  const fixed = offBeatSetup({ phase: suggested! })
  const fixedPlan = blendPlanFor(fixed.rig.graph, fixed.rig.character as never, fixed.b)!
  assert.equal(fixedPlan.status.leadB, 'right')
  assert.equal(fixedPlan.status.leadMismatch, false)
  assert.equal(fixedPlan.status.phaseOffsetSeconds, suggested)
  // Phát qua applyMotionAndPose: B đọc đúng thời điểm đã dời.
  evaluate(fixed.rig, 60, fixed.a, fixed.b)
  const expectedAngle = -0.4 * Math.cos(2 * Math.PI * (1.0 + suggested!))
  const left = fixed.rig.bones.LeftUpLeg.quaternion
  assert.ok(left.angleTo(axisQ(1, 0, 0, expectedAngle)) < 1e-3)
  resetBlendAlignment()
})

// ---- Nhả khóa chân ----------------------------------------------------------------------------------------------

test('nhả khóa chân: giữ chân đứng yên khi khóa 100%, rồi nhả smootherstep suốt phần còn lại của vùng, liên tục và trơn', () => {
  const a = motionClip('A', 0, 39)
  const b = motionClip('B', 30, 90, { blendIn: { frames: D, curve: 'smooth', footLock: true } })
  const still = (name: string, hips: [number, number, number], yaw: number, legX: number) => new THREE.AnimationClip(name, 3, [
    new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 3], [...hips, ...hips]),
    new THREE.QuaternionKeyframeTrack('mixamorigHips.quaternion', [0, 3], [...axisQ(0, 1, 0, yaw).toArray(), ...axisQ(0, 1, 0, yaw).toArray()]),
    qTrack('mixamorigLeftUpLeg', [0, 3], [axisQ(1, 0, 0, legX), axisQ(1, 0, 0, legX)]),
  ])
  const rig = buildRig([a, b], { A: still('A', [0, 1.05, 0], 0, 0), B: still('B', [0.4, 1.05, 0], 0.5, -0.3) })
  const plan = blendPlanFor(rig.graph, rig.character as never, b)!
  const left = plan.locks.find((lock) => lock.side === 'left')!
  assert.ok(left, 'có khóa chân trái')
  const shortEase = LOCK_EASE_SECONDS * FPS
  // Chân còn chạm đất tới hết vùng: nhả kéo dài tới cuối vùng (dài hơn nhả ngắn 0,125 s) và đúng cuối vùng thì về 0.
  assert.ok(left.ease > shortEase + 1, `ease=${left.ease}`)
  assert.ok(Math.abs(left.endFrame + left.ease - (b.frameStart + D)) < 1e-9)
  assert.ok(left.endFrame - left.startFrame >= 2)
  evaluate(rig, 30, a, b)
  const hold = world(rig.bones.LeftFoot).clone()
  let drift = 0
  for (let frame = 30; frame <= left.endFrame; frame += 0.25) {
    evaluate(rig, frame, a, b)
    drift = Math.max(drift, Math.hypot(world(rig.bones.LeftFoot).x - hold.x, world(rig.bones.LeftFoot).z - hold.z))
  }
  assert.ok(drift < 1e-4, `trượt khi khóa 100%: ${drift}`)
  // Sau đó chân đi tới vị trí B: liên tục (không nhảy) và bước lớn nhất không vượt xa độ dốc lý tưởng của smootherstep.
  const path: THREE.Vector3[] = []
  const step = 0.25
  for (let frame = left.endFrame; frame <= b.frameStart + D + 1e-9; frame += step) {
    evaluate(rig, frame, a, b)
    path.push(world(rig.bones.LeftFoot).clone())
  }
  let longest = 0
  for (let i = 1; i < path.length; i++) longest = Math.max(longest, path[i].distanceTo(path[i - 1]))
  const total = path[0].distanceTo(path[path.length - 1])
  assert.ok(total > 0.05, 'chân có đi tới vị trí B')
  // Nhả ngắn cũ: cùng quãng đường trong shortEase khung. Bản mới phải chậm hơn rõ rệt (đỉnh vận tốc thấp hơn).
  const oldPeakStep = (total * 1.5 * step) / shortEase
  assert.ok(longest < oldPeakStep * 0.85, `bước lớn nhất ${longest} so với nhả cũ ${oldPeakStep}`)
  // Khớp B ở cuối vùng trộn.
  evaluate(rig, b.frameStart + D, a, b)
  const endPoint = world(rig.bones.LeftFoot).clone()
  evaluate(rig, b.frameStart + D - 0.01, a, b)
  assert.ok(endPoint.distanceTo(world(rig.bones.LeftFoot)) < 0.01)
  resetBlendAlignment()
})
