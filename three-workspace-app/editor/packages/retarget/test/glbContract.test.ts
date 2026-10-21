import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { AnimationClip, QuaternionKeyframeTrack } from 'three'
import { loadAsset } from '../cli/loadAsset.ts'
import { runNormalize } from '../cli/normalizeCore.ts'
import { spawnSync } from 'node:child_process'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { validateExtraBones } from '../src/extraBones.ts'
import { validateGlbContract } from '../cli/glbContract.ts'
import { encodeGlb } from '../cli/glb.ts'
const rest = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
const extra = { name: 'X_Hips_Tail1', parent: 'Hips', rest }
const manifest = { version: '1.1.0', rig: 'mixamo65+tail', extraBones: [extra] }
function glb(extras: typeof extra[] = []) {
  const nodes: any[] = [...MIXAMO65_BONE_PARENTS.map(([name]) => ({ name, children: [] })), ...extras.map((bone) => ({ name: bone.name, children: [], translation: bone.rest.position, rotation: bone.rest.rotation, scale: bone.rest.scale }))]
  for (const [name, parent] of [...MIXAMO65_BONE_PARENTS, ...extras.map((bone) => [bone.name, bone.parent] as const)]) {
    if (parent) nodes.find((node) => node.name === parent)?.children.push(nodes.findIndex((node) => node.name === name))
  }
  return encodeGlb({ asset: { version: '2.0' }, nodes, skins: [{ joints: nodes.map((_, i) => i) }] }, new Uint8Array())
}
const invalid = [
  { ...manifest, extraBones: [{ ...extra, parent: 'Missing' }] },
  { ...manifest, extraBones: [{ ...extra, name: 'Tail1' }] },
  { ...manifest, extraBones: [{ ...extra, name: 'Hips' }] },
  { ...manifest, extraBones: [extra, extra] },
  { ...manifest, extraBones: [{ ...extra, parent: extra.name }] },
  { ...manifest, extraBones: [{ ...extra, parent: 'X_Hips_Tail2' }, { ...extra, name: 'X_Hips_Tail2', parent: extra.name }] },
  { ...manifest, extraBones: [{ ...extra, rest: { ...rest, scale: [1, 1, null] } }] },
  { ...manifest, rig: 'mixamo65' }, { ...manifest, extraBones: [] },
  { ...manifest, extraBones: [{ ...extra, name: 'X_Head_Tail1' }] },
  { ...manifest, version: '1.0.0' },
]
test('v1.0 unchanged; v1.1 topology/rest and malformed metadata', () => {
  validateGlbContract(glb(), { version: '1.0.0' })
  validateGlbContract(glb(), { version: '1.0.0', rig: 'mixamo65' })
  validateGlbContract(glb([extra]), manifest)
  const child = { ...extra, name: 'X_Hips_Tail2', parent: extra.name }
  validateGlbContract(glb([extra, child]), { ...manifest, extraBones: [child, extra] })
  for (const value of invalid) assert.throws(() => validateExtraBones(value))
  assert.throws(() => validateExtraBones({ ...manifest, extraBones: [{ ...extra, rest: { ...rest, scale: [1, 1, Infinity] } }] }))
  assert.throws(() => validateGlbContract(glb(), manifest))
  assert.throws(() => validateGlbContract(glb([{ ...extra, parent: 'Head' }]), manifest))
  assert.throws(() => validateGlbContract(glb([{ ...extra, rest: { ...rest, position: [1, 0, 0] } }]), manifest))
})
test('Python matches metadata acceptance and GLB validation', () => {
  const directory = fileURLToPath(new URL('../../../../', import.meta.url))
  const script = 'import json,sys\nfrom agent.glb_contract import validate_extra_bones,validate_glb_contract\nv=json.load(sys.stdin)\nimport copy\nfor bad in (float("inf"),float("nan")):\n item=copy.deepcopy(v["valid"][1]); item["extraBones"][0]["rest"]["scale"][0]=bad; v["invalid"].append(item)\nfor item in v["valid"]: validate_extra_bones(item)\nfor item in v["invalid"]:\n try: validate_extra_bones(item)\n except ValueError: pass\n else: raise AssertionError(item)\nvalidate_glb_contract(bytes(v["glb"]),v["valid"][1])\nvalidate_glb_contract(bytes(v["legacy"]),v["valid"][0])\nfor data in v["badGlbs"]:\n try: validate_glb_contract(bytes(data),v["valid"][1])\n except ValueError: pass\n else: raise AssertionError("invalid GLB accepted")'
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script], { cwd: directory, input: JSON.stringify({ valid: [{ version: '1.0.0' }, manifest], invalid, glb: [...glb([extra])], legacy: [...glb()], badGlbs: [[...glb()], [...glb([{ ...extra, parent: "Head" }])], [...glb([{ ...extra, rest: { ...rest, position: [1, 0, 0] } }])]] }), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('all existing builtin character rigs normalize to valid v1.0 GLBs', async () => {
  const directory = new URL('../../../../builtin-assets/characters/', import.meta.url)
  let count = 0
  for (const name of readdirSync(directory).filter((name) => name.endsWith('.glb'))) {
    const bytes = readFileSync(new URL(name, directory))
    const source = await loadAsset(bytes, 'glb', { skeletonOnly: true })
    const target = await loadAsset(bytes, 'glb', { skeletonOnly: true })
    let hipsName = ''
    source.traverse((node) => { if (/Hips$/.test(node.name)) hipsName = node.name })
    source.animations = [new AnimationClip('Rest', 1, [new QuaternionKeyframeTrack(`${hipsName}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])])]
    const result = await runNormalize({ source, target, sourceLabel: name, targetLabel: name, sourceSha256: 'a'.repeat(64), targetSha256: 'b'.repeat(64) })
    validateGlbContract(result.glb, result.manifest)
    count++
  }
  assert.ok(count >= 4)
})
