import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { Matrix4, Vector3 } from 'three'
import { describeSource, parseOptions, runPipeline, sha256 } from '../workbench/pipeline.ts'
import { parseBobjActions, evaluateBobjAction } from '../src/index.ts'
import { parseBobjArmature } from '../src/reverse.ts'

const data = resolve(process.argv[2]!), output = resolve(process.argv[3]!)
const targetPath = resolve(import.meta.dirname, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
const source = describeSource(join(data, 'Samba Dancing.fbx'), 'Samba Dancing.fbx', false, 'samba')
const original = join(data, 'library/models/d7453737fa9a4427')
const target = { id: 'mixamo65', file: 'target.glb', path: targetPath, sha256: sha256(readFileSync(targetPath)), hipsHeightMeters: 1, original }
const nativeText = readFileSync(join(original, 'model.bbs.bobj'), 'utf8')
const mcText = readFileSync(resolve(import.meta.dirname, '../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8')
const lengths = (text: string, armatureText: string, native: boolean) => {
  const armature = parseBobjArmature(armatureText), action = [...parseBobjActions(text).values()].at(-1)!
  const world = new Map(evaluateBobjAction(armature, action, 0).map(b => [b.name, new Vector3().setFromMatrixPosition(new Matrix4().fromArray([...b.worldMatrix]))]))
  const pairs = native ? [['Clavicle_L', 'Upper_Arm_L'], ['Upper_Arm_L', 'Lower_Arm_L'], ['Lower_Arm_L', 'Hand_L'], ['Upper_Leg_L', 'Lower_Leg_L']]
    : [['low_body', 'left_arm'], ['left_arm', 'low_left_arm'], ['low_left_arm', 'low_left_arm.end'], ['left_leg', 'low_left_leg']]
  return Object.fromEntries(['shoulderWidth', 'upperArm', 'forearm', 'legLength'].map((key, i) => [key, world.get(pairs[i]![0]!)!.distanceTo(world.get(pairs[i]![1]!)!)]))
}
const runs: Record<string, any> = {}
for (const key of ['default', 'shoulderWidth', 'upperArm', 'forearm', 'legLength']) {
  const dir = join(data, `measure-${key}`); mkdirSync(dir, { recursive: true })
  const result = await runPipeline(source, target, parseOptions({ bobj: true, preview: false, adjustments: key === 'default' ? {} : { [key]: 1.2 } }), null, undefined, dir, async () => {})
  assert.equal(result.status, 'PASS', JSON.stringify(result.report))
  const file = (kind: string) => readFileSync(join(dir, result.files.find(f => f.kind === kind)!.name))
  const prefix = file('originalBobj').subarray(0, Buffer.byteLength(nativeText))
  assert.equal(sha256(prefix), sha256(Buffer.from(nativeText)))
  runs[key] = { sha256: sha256(file('glb')), minecraft: lengths(file('bobj').toString(), mcText, false), verity: lengths(file('originalBobj').toString(), nativeText, true), originalPrefixSha256: sha256(prefix), mcError: result.report.minecraft20.roundtripMaxErrorBlocks, verityError: result.report.original.roundTripMaxErrorUnits }
  if (key === 'default') assert.ok(runs[key].sha256.startsWith('68fcdb75d373'), runs[key].sha256)
  else for (const format of ['minecraft', 'verity']) assert.ok(runs[key][format][key] > runs.default[format][key] * 1.05, `${key} not carried into ${format}: ${JSON.stringify(runs)}`)
  console.log(key, JSON.stringify(runs[key]))
}
mkdirSync(output, { recursive: true }); writeFileSync(join(output, 'numerical.json'), JSON.stringify(runs, null, 2))
