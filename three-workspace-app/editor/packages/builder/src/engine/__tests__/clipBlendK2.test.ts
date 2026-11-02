import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createFrameSnapshot } from '../../evaluate/FrameSnapshot'
import { motionBlendWeight } from '../../evaluate/clips'
import { applyMotionAndPose } from '../objects/applySnapshot'
import { CharacterAnimator } from '../objects/MotionPlayer'
import { alignRoot, alignmentMatrix, isFootPlanted, lockStrength, plantedRuns, solveKnee, yawOf } from '../objects/footLockMath'
import { blendPlanFor, resetBlendAlignment } from '../objects/clipBlendPlan'
import { evaluateRootTrajectory } from '../objects/rootMotion'
import { getBlendStatus, blendLockText, blendOffsetText } from '../objects/blendStatus'
import type { StageGraph } from '../objects/graph'
import type { MotionClip } from '../../contract/types'

const FPS = 30

// ---- Pure math -----------------------------------------------------------------------------------------------

test('căn root: điểm gốc và hướng của B trùng A sau phép căn cứng', () => {
  const cases = [
    [{ x: 0, z: 0, yaw: 0 }, { x: 0.5, z: -0.2, yaw: 0.5 }],
    [{ x: 3, z: -1, yaw: 1.2 }, { x: -2, z: 4, yaw: -2.5 }],
    [{ x: 1, z: 1, yaw: 3.0 }, { x: 1, z: 1, yaw: -3.0 }],
  ]
  for (const [a, b] of cases) {
    const al = alignRoot(a, b)
    const m = alignmentMatrix(al)
    const moved = new THREE.Vector3(b.x, 0, b.z).applyMatrix4(m)
    assert.ok(Math.hypot(moved.x - a.x, moved.z - a.z) < 1e-9, 'điểm gốc trùng')
    // Một vector có hướng yaw b.yaw sau phép xoay phải có hướng yaw a.yaw.
    const dir = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw)).transformDirection(m)
    assert.ok(Math.abs(Math.atan2(Math.sin(yawOf(dir.x, dir.z) - a.yaw), Math.cos(yawOf(dir.x, dir.z) - a.yaw))) < 1e-9, 'hướng trùng')
    assert.ok(Math.abs(al.distance - Math.hypot(a.x - b.x, a.z - b.z)) < 1e-12)
  }
  const same = alignRoot({ x: 1, z: 2, yaw: 0.3 }, { x: 1, z: 2, yaw: 0.3 })
  assert.ok(Math.abs(same.yaw) < 1e-12 && Math.abs(same.tx) < 1e-12 && Math.abs(same.tz) < 1e-12)
})

test('phát hiện chân chạm đất: tốc độ + độ cao, gom thành khoảng', () => {
  const options = { maxSpeed: 0.3, maxHeight: 0.1 }
  assert.equal(isFootPlanted(0.1, 0.02, options), true)
  assert.equal(isFootPlanted(0.5, 0.02, options), false)
  assert.equal(isFootPlanted(0.1, 0.3, options), false)
  assert.deepEqual(plantedRuns([false, true, true, false, true, true, true]), [[1, 2], [4, 6]])
  assert.deepEqual(plantedRuns([false, false]), [])
})

test('độ mạnh khóa: 1 trong khoảng, nhả êm đúng thời lượng, 0 trước khi bắt đầu', () => {
  assert.equal(lockStrength(4, 5, 10, 3), 0)
  assert.equal(lockStrength(7, 5, 10, 3), 1)
  assert.equal(lockStrength(10, 5, 10, 3), 1)
  const mid = lockStrength(11.5, 5, 10, 3)
  assert.ok(mid > 0.4 && mid < 0.6)
  assert.equal(lockStrength(13, 5, 10, 3), 0)
})

test('IK 2 xương: cổ chân chạm mục tiêu trong tầm với, giữ độ dài xương', () => {
  const hip = new THREE.Vector3(0, 1, 0), knee = new THREE.Vector3(0, 0.5, 0.05), ankle = new THREE.Vector3(0, 0.05, 0)
  const target = new THREE.Vector3(0.12, 0.1, 0.2)
  const newKnee = solveKnee(hip, knee, ankle, target)!
  assert.ok(Math.abs(newKnee.distanceTo(hip) - knee.distanceTo(hip)) < 1e-9)
  // Cổ chân mới cách gối đúng độ dài cẳng và đặt tại mục tiêu khi mục tiêu trong tầm.
  const l2 = ankle.distanceTo(knee)
  assert.ok(Math.abs(newKnee.distanceTo(target) - l2) < 1e-9)
})

// ---- Synthetic rig --------------------------------------------------------------------------------------------

interface Rig { graph: StageGraph; bones: Record<string, THREE.Bone>; character: any; inner: THREE.Group; root: THREE.Group }

function bone(name: string, x: number, y: number, z: number, parent?: THREE.Object3D) {
  const b = new THREE.Bone()
  b.name = name
  b.position.set(x, y, z)
  parent?.add(b)
  return b
}

/** Hips cao 1,05 m, đùi ±0,1, cẳng/ bàn 0,5 m: cổ chân cao 0,05, mũi chân chạm sàn y=0. */
function buildRig(clips: MotionClip[], sources: Record<string, THREE.AnimationClip>, options: { policy?: 'skeletal' | 'trajectory' } = {}): Rig {
  const root = new THREE.Group()
  const motionRoot = new THREE.Group()
  motionRoot.matrixAutoUpdate = false
  const inner = new THREE.Group()
  inner.name = 'Armature'
  const hips = bone('mixamorigHips', 0, 1.05, 0, inner)
  const bones: Record<string, THREE.Bone> = { hips }
  for (const side of ['Left', 'Right']) {
    const sx = side === 'Left' ? 0.1 : -0.1
    const thigh = bone(`mixamorig${side}UpLeg`, sx, 0, 0, hips)
    const shin = bone(`mixamorig${side}Leg`, 0, -0.5, 0.0, thigh)
    const foot = bone(`mixamorig${side}Foot`, 0, -0.5, 0, shin)
    const toe = bone(`mixamorig${side}ToeBase`, 0, -0.05, 0.1, foot)
    Object.assign(bones, { [`${side}UpLeg`]: thigh, [`${side}Leg`]: shin, [`${side}Foot`]: foot, [`${side}Toe`]: toe })
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
  void options
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

function holdTracks(name: string, hipsPos: [number, number, number], yaw = 0, extra: THREE.KeyframeTrack[] = []): THREE.AnimationClip {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
  return new THREE.AnimationClip(name, 3, [
    new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 3], [...hipsPos, ...hipsPos]),
    new THREE.QuaternionKeyframeTrack('mixamorigHips.quaternion', [0, 3], [...q.toArray(), ...q.toArray()]),
    ...extra,
  ])
}

const D = 10 // blend frames

/** Gửi khung như evaluateCharacters: một lệnh phát ngoài vùng trộn, hai lệnh (1-w, w) trong vùng trộn. */
function evaluate(rig: Rig, frame: number, a: MotionClip, b: MotionClip) {
  const snap = createFrameSnapshot()
  snap.frame = frame
  const t = (frame - b.frameStart) / D
  const inZone = frame >= b.frameStart && t < 1 && frame <= a.frameEnd
  const timeOf = (c: MotionClip) => Math.max(0, (frame - c.frameStart) / FPS)
  if (frame < b.frameStart) snap.motionPlayback.push({ nodeId: 'hero', clipId: a.id, timeSeconds: timeOf(a), weight: 1 })
  else if (inZone) {
    const w = motionBlendWeight('smooth', t)
    snap.motionPlayback.push({ nodeId: 'hero', clipId: a.id, timeSeconds: timeOf(a), weight: 1 - w }, { nodeId: 'hero', clipId: b.id, timeSeconds: timeOf(b), weight: w })
  } else snap.motionPlayback.push({ nodeId: 'hero', clipId: b.id, timeSeconds: timeOf(b), weight: 1 })
  applyMotionAndPose(rig.graph, snap)
  rig.root.updateMatrixWorld(true)
}

const world = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)
function rootPointNow(rig: Rig) {
  const l = world(rig.bones.LeftUpLeg), r = world(rig.bones.RightUpLeg)
  return { x: (l.x + r.x) / 2, z: (l.z + r.z) / 2, yaw: yawOf(l.x - r.x, l.z - r.z) }
}

function setup(bRoot: [number, number, number], bYaw: number, options: { airborneB?: boolean } = {}) {
  const a = motionClip('A', 0, 39)
  const b = motionClip('B', 30, 90, { blendIn: { frames: D, curve: 'smooth', footLock: true } })
  const sources = {
    A: holdTracks('A', [0, 1.05, 0], 0),
    // Chân trái của B bước ra trước 0,3 rad (vẫn chạm đất) để hai tư thế đứng khác nhau.
    B: holdTracks('B', bRoot, bYaw, [new THREE.QuaternionKeyframeTrack('mixamorigLeftUpLeg.quaternion', [0, 3],
      [...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.3).toArray(), ...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.3).toArray()])]),
  }
  void options
  return { rig: buildRig([a, b], sources), a, b }
}

test('nối tiếp chỗ đứng: B dời + xoay cứng để gốc/hướng trùng A tại khung bắt đầu trộn, giữ nguyên cả clip', () => {
  const { rig, a, b } = setup([0.5, 1.05, 0.2], 0.6)
  evaluate(rig, 30, a, b)
  const atStart = rootPointNow(rig)
  // Tại khung đầu vùng trộn trọng số B = 0: chính là A.
  assert.ok(Math.hypot(atStart.x, atStart.z) < 1e-6)
  const aYaw = atStart.yaw
  for (const frame of [40, 55, 90]) {
    evaluate(rig, frame, a, b)
    const p = rootPointNow(rig)
    // B đứng yên trong cả clip: sau căn, gốc B luôn nằm đúng chỗ A đứng, hướng bằng hướng A.
    assert.ok(Math.hypot(p.x, p.z) < 1e-5, `frame ${frame}: ${p.x},${p.z}`)
    assert.ok(Math.abs(Math.atan2(Math.sin(p.yaw - aYaw), Math.cos(p.yaw - aYaw))) < 1e-5, `frame ${frame} yaw`)
  }
  const status = getBlendStatus('B')!
  assert.equal(status.aligned, true)
  assert.ok(Math.abs(status.offsetMeters - Math.hypot(0.5, 0.2)) < 1e-6)
  assert.ok(Math.abs(Math.abs(status.yawDegrees) - THREE.MathUtils.radToDeg(0.6)) < 1e-6)
  assert.match(blendOffsetText(status), /^Clip sau dời 0,5\d m, xoay -?3[34]°$/)
})

test('phép căn không cộng dồn qua các khung và trả về đúng khi tua lại', () => {
  const { rig, a, b } = setup([0.5, 1.05, 0.2], 0.6)
  for (const frame of [40, 41, 42, 41, 35, 36, 85, 85, 60]) {
    evaluate(rig, frame, a, b)
    const p = rootPointNow(rig)
    if (frame >= 40) assert.ok(Math.hypot(p.x, p.z) < 1e-5, `frame ${frame}`)
  }
  // Về trước vùng trộn: A một mình, không bị dời.
  evaluate(rig, 10, a, b)
  const p = rootPointNow(rig)
  assert.ok(Math.hypot(p.x, p.z) < 1e-9)
})

test('khóa chân: cổ chân đang chạm đất đứng yên trong vùng trộn dù hai tư thế khác nhau, rồi nhả êm về B', () => {
  const { rig, a, b } = setup([0.4, 1.05, 0], 0.5)
  evaluate(rig, 30, a, b)
  const hold = world(rig.bones.LeftFoot).clone()
  const plan = blendPlanFor(rig.graph, rig.character, b)!
  const left = plan.locks.find((lock) => lock.side === 'left')!
  assert.ok(left && left.endFrame > b.frameStart + 3, 'có khóa chân trái')
  let moved = 0
  for (let frame = 30; frame <= left.endFrame; frame += 0.5) {
    evaluate(rig, frame, a, b)
    moved = Math.max(moved, world(rig.bones.LeftFoot).distanceTo(hold))
  }
  assert.ok(moved < 1e-4, `chân trượt ${moved}`)
  // Kiểm không-khóa để chắc rằng phép thử có ý nghĩa: không IK thì chân phải lệch rõ.
  const unlocked = setup([0.4, 1.05, 0], 0.5)
  const unlockedPlan = blendPlanFor(unlocked.rig.graph, unlocked.rig.character, unlocked.b)!
  unlockedPlan.locks.length = 0
  let slide = 0
  for (let frame = 30; frame <= left.endFrame; frame += 0.5) {
    evaluate(unlocked.rig, frame, unlocked.a, unlocked.b)
    slide = Math.max(slide, world(unlocked.rig.bones.LeftFoot).distanceTo(hold))
  }
  assert.ok(slide > 0.02, `đối chứng không khóa phải trượt (${slide})`)
  // Hết vùng trộn: chân về đúng tư thế B đã căn (liên tục, không IK dư).
  evaluate(rig, b.frameStart + D, a, b)
  const afterEnd = world(rig.bones.LeftFoot).clone()
  evaluate(rig, b.frameStart + D - 0.01, a, b)
  assert.ok(afterEnd.distanceTo(world(rig.bones.LeftFoot)) < 0.01, 'liên tục tại cuối vùng trộn')
  assert.match(blendLockText(getBlendStatus('B'), FPS), /^Chân (trái|phải) khóa/)
})

test('không có chân chạm đất: bỏ khóa, không lỗi, dải X ghi lý do', () => {
  const a = motionClip('A', 0, 39)
  const b = motionClip('B', 30, 90, { blendIn: { frames: D, curve: 'smooth', footLock: true } })
  // Hips cao hơn 0,6 m ở cả hai clip: cổ chân rời sàn xa hơn ngưỡng.
  const rig = buildRig([a, b], { A: holdTracks('A', [0, 1.65, 0]), B: holdTracks('B', [0.3, 1.65, 0], 0.4) })
  for (let frame = 30; frame <= 40; frame++) evaluate(rig, frame, a, b)
  const plan = blendPlanFor(rig.graph, rig.character, b)!
  assert.equal(plan.locks.length, 0)
  assert.equal(blendLockText(getBlendStatus('B'), FPS), 'Không khóa chân: không có chân chạm đất')
})

test('không có blendIn: kết quả y hệt đường một clip (không IK, không căn, không đổi xương)', () => {
  const a = motionClip('A', 0, 39)
  const b = motionClip('B', 40, 90) // liền nhau, không chồng, không blendIn
  const rig = buildRig([a, b], { A: holdTracks('A', [0, 1.05, 0]), B: holdTracks('B', [0.5, 1.05, 0.2], 0.6) })
  const pose = (frame: number) => {
    const snap = createFrameSnapshot()
    snap.frame = frame
    snap.motionPlayback.push({ nodeId: 'hero', clipId: frame < 40 ? 'A' : 'B', timeSeconds: frame / FPS, weight: 1 })
    applyMotionAndPose(rig.graph, snap)
    return rig.inner.children[0].children.length + ':' + Object.values(rig.bones).map((x) => x.position.toArray().join(',') + '|' + x.quaternion.toArray().join(',')).join(';')
  }
  const first = pose(45)
  pose(10)
  assert.equal(pose(45), first)
  // B giữ nguyên hips (0.5,1.05,0.2): không bị dời.
  assert.ok(rig.bones.hips.position.distanceTo(new THREE.Vector3(0.5, 1.05, 0.2)) < 1e-6)
  assert.equal(blendPlanFor(rig.graph, rig.character, b), null)
  resetBlendAlignment()
})

// ---- Root trajectory ---------------------------------------------------------------------------------------------

test('evaluateRootTrajectory có blendIn: B neo theo A tại khung bắt đầu trộn, không phải cuối A', () => {
  const travel = (name: string) => new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 1.05, 0, 0, 1.05, 1])])
  const a = motionClip('A', 0, 29, {}, 'trajectory')
  a.motion.sourceLengthSeconds = 1; (a as { sourceDuration: number }).sourceDuration = 1
  const b = motionClip('B', 15, 44, { blendIn: { frames: 10, curve: 'linear', footLock: true } }, 'trajectory')
  b.motion.sourceLengthSeconds = 1; (b as { sourceDuration: number }).sourceDuration = 1
  const rig = buildRig([a, b], { A: travel('A'), B: travel('B') })
  const clips = [a, b]
  const player = rig.graph.motionPlayer
  const zAt = (frame: number) => new THREE.Vector3().setFromMatrixPosition(evaluateRootTrajectory(rig.character, clips, player as never, frame, FPS)!).z
  // Trước vùng trộn: chỉ A.
  assert.ok(Math.abs(zAt(10) - 10 / 30) < 1e-6)
  // Đầu vùng trộn: B ở thời điểm 0, neo tại A(15) = 0,5.
  assert.ok(Math.abs(zAt(15) - 0.5) < 1e-6)
  // Giữa vùng trộn 0,5: trung bình A(20)=2/3 và B(20)=0,5 + 5/30.
  assert.ok(Math.abs(zAt(20) - ((20 / 30 + (0.5 + 5 / 30)) / 2)) < 1e-6)
  // Sau vùng trộn: B một mình, vẫn neo tại A(15) chứ không phải cuối A (=1).
  assert.ok(Math.abs(zAt(30) - (0.5 + 15 / 30)) < 1e-6, `z=${zAt(30)}`)
})
