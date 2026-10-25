import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AnimationMixer, LoopOnce, Matrix4, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { SkeletonProfile, UnifiedProject } from '@bbs/animation-workspace-shared'
import { makeEmptyDraft } from '@topview/3d-builder'
import { parseBobjArmature } from '../../../packages/retarget/src/reverse.ts'
import { loadBobj } from '../../../packages/retarget/cli/loadBobj.ts'
import { encodeGlb } from '../../../packages/retarget/cli/glb.ts'
import { filmPreflight, measureFilmFeet } from '../src/filmPreflight.ts'

const rest = (position: number[], rotation = [0, 0, 0, 1]) => ({ position, rotation, scale: [1, 1, 1] })
const bones = [
  { id: 'wrapper', name: 'Wrapper', parentId: null, rest: rest([0, 0, 0]), deform: false },
  { id: 'left', name: 'actor:left_leg', parentId: 'wrapper', rest: rest([12.5, 75, 0]), deform: true },
  { id: 'left-low', name: 'actor:low_left_leg', parentId: 'left', rest: rest([0, -37.5, 0]), deform: true },
  { id: 'right', name: 'actor:right_leg', parentId: 'wrapper', rest: rest([-12.5, 75, 0]), deform: true },
  { id: 'right-low', name: 'actor:low_leg_right', parentId: 'right', rest: rest([0, -37.5, 0]), deform: true },
]
const profile = { family: 'minecraft20', metersPerUnit: 0.01, bones } as SkeletonProfile
const close = (actual: number | undefined, expected: number) => assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`)

function preflight(feet: { leftY?: number; rightY?: number }) {
  const scene = makeEmptyDraft('MC20 feet', 30, 29)
  const project = { type: 'three-workspace-project', version: 1, projectId: 'feet', name: 'Feet', revision: 0, scene,
    assets: {}, characters: { actor: { id: 'actor', name: 'Đen', assetId: 'asset', nodeId: 'actor', skeletonId: 'mc20' } },
    skeletons: {}, mappings: {}, motions: {}, bindings: {}, extensions: {}, origins: [], retargetSessions: {} } as unknown as UnifiedProject
  return filmPreflight(project, { characterIds: ['actor'], sequenceId: '', range: { startFrame: 0, endFrame: 29 }, viewportAspect: 1,
    footSamples: { actor: [{ frame: 7, ...feet, actorWorldMatrix: new Matrix4().toArray() }] } }).warnings.map((warning) => warning.code)
}

test('GLB readback: animated MC20 shin tips use scene metres and world placement, not knee origins', async () => {
  // Disk round trip, a skin marking joints as Bones, a translated/rotated wrapper and real GLB animation.
  const values = new Float32Array([0, 1, 0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2])
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Wrapper', translation: [200, 0, -300], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], children: [1, 3] },
      { name: 'actor:left_leg', translation: [12.5, 75, 0], children: [2] }, { name: 'actor:low_left_leg', translation: [0, -37.5, 0] },
      { name: 'actor:right_leg', translation: [-12.5, 75, 0], children: [4] }, { name: 'actor:low_leg_right', translation: [0, -37.5, 0] }],
    skins: [{ joints: [1, 2, 3, 4], skeleton: 0 }], buffers: [{ byteLength: values.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 32 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }, { bufferView: 1, componentType: 5126, count: 2, type: 'VEC4' }],
    animations: [{ name: 'Bend', samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }], channels: [
      { sampler: 0, target: { node: 2, path: 'rotation' } }, { sampler: 0, target: { node: 4, path: 'rotation' } }] }] }
  const directory = mkdtempSync(path.join(tmpdir(), 'a14-glb-'))
  try {
    const file = path.join(directory, 'mc20.glb'); writeFileSync(file, encodeGlb(json, new Uint8Array(values.buffer)))
    const gltf = await new GLTFLoader().parseAsync(Uint8Array.from(readFileSync(file)).buffer, '')
    gltf.scene.scale.setScalar(0.01)
    const mixer = new AnimationMixer(gltf.scene), action = mixer.clipAction(gltf.animations[0]!).setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    const measure = (time: number, height: number) => {
      action.reset().play(); mixer.setTime(time); gltf.scene.position.y = height; gltf.scene.updateMatrixWorld(true)
      const samples: Array<{ name: string; worldMatrix: number[] }> = []
      gltf.scene.traverse((bone) => { if (bone.type === 'Bone') samples.push({ name: bone.name, worldMatrix: bone.matrixWorld.toArray() }) })
      // GLTFLoader sanitizes namespaces for animation binding; the profile retains imported names.
      return measureFilmFeet({ metersPerUnit: 0.01, bones: samples }, profile)
    }
    const standing = measure(0, 0); close(standing.leftY, 0); close(standing.rightY, 0)
    assert.ok(!preflight(standing).includes('FOOT_EVALUATION_UNAVAILABLE'))
    assert.ok(!preflight(standing).includes('CHARACTER_FLOATING'))
    const half = measure(0.5, 0); close(half.leftY, 0.375 * (1 - Math.SQRT1_2))
    const bent = measure(1, 0); close(bent.leftY, 0.375); close(bent.rightY, 0.375)
    assert.ok(preflight(bent).includes('CHARACTER_FLOATING'))
    const sunk = measure(0, -0.1); close(sunk.leftY, -0.1); assert.ok(preflight(sunk).includes('CHARACTER_BELOW_FLOOR'))
    const raised = measure(0, 0.4); close(raised.rightY, 0.4); assert.ok(preflight(raised).includes('CHARACTER_FLOATING'))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('MC20 rest-axis rotations are undone before applying the animated world matrix', () => {
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  const rotated = structuredClone(profile); rotated.bones[2]!.rest = rest([0, -37.5, 0], rotation.toArray())
  const matrix = new Matrix4().compose(new Vector3(2, 0.375, -3), rotation, new Vector3(0.01, 0.01, 0.01))
  close(measureFilmFeet({ metersPerUnit: 0.01, bones: [{ name: 'ns:low_left_leg', worldMatrix: matrix.toArray() }] }, rotated).leftY, 0)
})

test('missing, malformed, ambiguous or non-MC20 profiles never invent floor contact', () => {
  const sample = { metersPerUnit: 0.01, bones: [{ name: 'low_left_leg', worldMatrix: new Matrix4().toArray() }] }
  for (const invalid of [undefined, { ...profile, family: 'custom-preserved' }, { ...profile, family: 'mixamo65' }, { ...profile, metersPerUnit: 1 },
    { ...profile, bones: [...bones, bones[2]!] }, { ...profile, bones: bones.map((bone) => ({ ...bone, rest: {} })) }]) {
    const feet = measureFilmFeet(sample, invalid as SkeletonProfile | undefined)
    assert.deepEqual(feet, {}); assert.ok(preflight(feet).includes('FOOT_EVALUATION_UNAVAILABLE'))
  }
})

test('Mixamo and legacy foot aliases keep their world-origin measurements with no profile', () => {
  const sample = { metersPerUnit: 0.01, bones: [
    { name: 'ns:mixamorig1LeftFoot', worldMatrix: new Matrix4().makeTranslation(4, -0.06, 9).toArray() },
    { name: 'RightFoot', worldMatrix: new Matrix4().makeTranslation(4, 0.42, 9).toArray() },
    { name: 'low_left_leg', worldMatrix: new Matrix4().makeTranslation(0, 100, 0).toArray() }] }
  assert.deepEqual(measureFilmFeet(sample), { leftY: -0.06, rightY: 0.42 })
  for (const [left, right] of [['FootLeft', 'FootRight'], ['LFoot', 'RFoot'], ['FootL', 'FootR']]) {
    sample.bones[0]!.name = left; sample.bones[1]!.name = right
    assert.deepEqual(measureFilmFeet(sample, profile), { leftY: -0.06, rightY: 0.42 })
  }
})


test('bundled MC20 rest armature: inferred tips match the BOBJ-authored tail heights', () => {
  const text = readFileSync(new URL('../public/retarget/v9.12/minecraft20-armature.bobj', import.meta.url), 'utf8')
  const armature = parseBobjArmature(text)
  const model = loadBobj('', text); model.updateMatrixWorld(true)
  const imported: SkeletonProfile['bones'] = []
  const samples: Array<{ name: string; worldMatrix: number[] }> = []
  model.traverse((bone) => {
    if (bone.type !== 'Bone') return
    imported.push({ id: bone.name, name: bone.name, parentId: bone.parent?.type === 'Bone' ? bone.parent.name : null, deform: true,
      rest: { position: bone.position.toArray(), rotation: bone.quaternion.toArray(), scale: bone.scale.toArray() } })
    samples.push({ name: bone.name, worldMatrix: bone.matrixWorld.toArray() })
  })
  const feet = measureFilmFeet({ metersPerUnit: 1, bones: samples }, { ...profile, metersPerUnit: 1, bones: imported })
  close(feet.leftY, armature.bones.find((bone) => bone.name === 'low_left_leg')!.tail[1])
  close(feet.rightY, armature.bones.find((bone) => bone.name === 'low_leg_right')!.tail[1])
  close(feet.leftY, 0); close(feet.rightY, 0)
})
