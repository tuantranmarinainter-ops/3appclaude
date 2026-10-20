import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { evaluateBobjAction, parseBobjActions } from '../src/index.ts'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { createReverseRetargeter, parseBobjArmature, type MixamoPoseBone, type ReverseRetargetSettings } from '../src/reverse.ts'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import { canonical } from './autoMapping.ts'
import { loadAsset } from './loadAsset.ts'
import type { PreviewFrame } from './previewPng.ts'

const TICKS_PER_SECOND = 20
const PREVIEW_FRAMES = 8

/**
 * Euler for R = Rz·Ry·Rx (what `evaluateBobjAction` and Blender's 'XYZ' mode compose), kept continuous with the previous
 * key: both equivalent triples (x, y, z) and (x+π, π−y, z+π) are unwrapped by 2π and the closer one wins, so LINEAR
 * interpolation in BBS never spins the long way round.
 */
function continuousEuler(rotation: Quaternion, previous: readonly number[] | null): number[] {
  const euler = new Euler().setFromQuaternion(rotation, 'ZYX')
  const candidates = [[euler.x, euler.y, euler.z], [euler.x + Math.PI, Math.PI - euler.y, euler.z + Math.PI]]
  if (!previous) return candidates[0]!.map((value) => Math.atan2(Math.sin(value), Math.cos(value)))
  const unwrap = (values: number[]) => values.map((value, axis) => value + 2 * Math.PI * Math.round((previous[axis]! - value) / (2 * Math.PI)))
  const distance = (values: number[]) => values.reduce((sum, value, axis) => sum + Math.abs(value - previous[axis]!), 0)
  return candidates.map(unwrap).sort((a, b) => distance(a) - distance(b))[0]!
}

const formatNumber = (value: number) => (Math.abs(value) < 5e-7 ? 0 : value).toFixed(6)

/**
 * Mixamo65 GLB (App 1 contract output) → Minecraft20 `.bobj` actions for BBS FS, via the V9.12 reverse solver.
 * Every GLB animation is sampled at 20 Hz (one key per Minecraft tick, the BBSFix exporter convention), the solver's
 * local pose is turned into the BOBJ delta (restLocal⁻¹·local → location, Euler rotation, scale) and channels that stay
 * at their default are omitted. The written text is parsed and re-evaluated with `evaluateBobjAction`, and the joint
 * positions are compared with the solver output — the report states that error rather than trusting the writer.
 */
export async function exportMinecraft20(glb: Uint8Array, armatureText: string, settings: Partial<ReverseRetargetSettings> = {}, previewAnimation = 0) {
  const armature = parseBobjArmature(armatureText)
  const solver = createReverseRetargeter(armature)
  const restLocalInverse = new Map(armature.bones.map((bone) => [bone.name, new Matrix4().fromArray([...bone.restLocal]).invert()]))
  const parent = new Map(armature.bones.map((bone) => [bone.name, bone.parent]))
  const adapter = createThreeRigAdapter(await loadAsset(glb, 'glb'), { fingerprint: 'mixamo65-glb' })
  const lines = ['# Minecraft20 actions retargeted from a Mixamo65 GLB (W01 App 1, V9.12 reverse solver)', '# Animation data']
  const expected = new Map<string, Array<{ ticks: number; worlds: Map<string, Vector3>; tips: Map<string, Vector3> }>>()
  // Preview only: helper bones (`misc_*`, anchored at the ground) are hidden and leaf bones (lower legs, head, hands)
  // are drawn to their tail, since the rig has no foot/hand-tip joints to end the segment.
  const shown = armature.bones.filter((bone) => !bone.name.startsWith('misc_')).map((bone) => bone.name)
  const leaves = shown.filter((name) => !armature.bones.some((bone) => bone.parent === name && shown.includes(bone.name)))
  const localTail = new Map(armature.bones.map((bone) => [bone.name, [...bone.localTail] as [number, number, number]]))
  const label = (name: string) => name === 'body' ? 'Hips' : /left/.test(name) ? `Left ${name}` : /right/.test(name) ? `Right ${name}` : name
  const previewParents = new Map<string, string | null>([...shown.map((name) => [label(name), parent.get(name) && shown.includes(parent.get(name)!) ? label(parent.get(name)!) : null] as const),
    ...leaves.map((name) => [`${label(name)} tip`, label(name)] as const)])
  const previewJoints = (worlds: Map<string, Vector3>, tips: Map<string, Vector3>) => new Map<string, number[]>([
    ...shown.map((name) => [label(name), worlds.get(name)!.toArray()] as const), ...leaves.map((name) => [`${label(name)} tip`, tips.get(name)!.toArray()] as const)])
  const actions: Array<{ name: string; glbName: string; ticks: number; channels: number }> = []
  const usedNames = new Set<string>()
  // BOBJ keys actions by name; GLB allows duplicates (WC3 "Stand 2" twice). Blender's rule: name.001, name.002, …
  const uniqueName = (name: string) => {
    let candidate = name
    for (let suffix = 1; usedNames.has(candidate); suffix++) candidate = `${name}.${String(suffix).padStart(3, '0')}`
    usedNames.add(candidate)
    return candidate
  }
  let previewFrames: PreviewFrame[] = []
  try {
    const mixamo = new Map(adapter.rig.bones.flatMap((bone) => {
      const name = MIXAMO65_BONE_PARENTS.find(([joint]) => canonical(joint) === canonical(bone.name ?? ''))?.[0]
      return name ? [[bone.id, { name, rest: new Matrix4().fromArray(bone.restWorld) }] as const] : []
    }))
    if (mixamo.size !== 65) throw new TypeError(`Expected a Mixamo65 GLB, found ${mixamo.size} Mixamo joints`)
    const restPose = new Map([...mixamo].map(([id, { name, rest }]) => {
      const position = new Vector3(), rotation = new Quaternion()
      rest.decompose(position, rotation, new Vector3())
      return [id, { name, position: position.toArray(), rotation: rotation.toArray() }]
    }))
    for (const [clipIndex, clip] of adapter.actions.entries()) {
      const actionName = uniqueName(clip.name)
      const lastTick = Math.max(0, Math.round(clip.durationSeconds * TICKS_PER_SECOND))
      const channels = new Map<string, { location: number[][]; rotation: number[][]; scale: number[][] }>()
      const samples: Array<{ ticks: number; worlds: Map<string, Vector3>; tips: Map<string, Vector3> }> = []
      for (let tick = 0; tick <= lastTick; tick++) {
        const pose: MixamoPoseBone[] = adapter.sample(clipIndex, Math.min(tick / TICKS_PER_SECOND, clip.durationSeconds)).flatMap((bone) => {
          const rest = restPose.get(bone.id)
          if (!rest) return []
          const position = new Vector3(), rotation = new Quaternion()
          new Matrix4().fromArray(bone.world).decompose(position, rotation, new Vector3())
          return [{ name: rest.name, restWorldPosition: rest.position as [number, number, number], restWorldQuaternion: rest.rotation as [number, number, number, number],
            worldPosition: position.toArray(), worldQuaternion: rotation.toArray() as [number, number, number, number] }]
        })
        const result = solver.evaluate(pose, settings)
        const worlds = new Map(result.map((bone) => [bone.name, new Matrix4().fromArray(bone.worldMatrix)]))
        samples.push({ ticks: tick, worlds: new Map([...worlds].map(([name, world]) => [name, new Vector3().setFromMatrixPosition(world)])),
          tips: new Map(leaves.map((name) => [name, new Vector3(...localTail.get(name)!).applyMatrix4(worlds.get(name)!)])) })
        for (const bone of armature.bones) {
          const parentName = parent.get(bone.name)
          const local = parentName ? worlds.get(parentName)!.clone().invert().multiply(worlds.get(bone.name)!) : worlds.get(bone.name)!
          const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
          restLocalInverse.get(bone.name)!.clone().multiply(local).decompose(position, rotation, scale)
          const entry = channels.get(bone.name) ?? { location: [], rotation: [], scale: [] }
          entry.location.push(position.toArray()); entry.scale.push(scale.toArray())
          entry.rotation.push(continuousEuler(rotation, entry.rotation.at(-1) ?? null))
          channels.set(bone.name, entry)
        }
      }
      expected.set(actionName, samples)
      if (clipIndex === previewAnimation) previewFrames = Array.from({ length: PREVIEW_FRAMES }, (_, index) => {
        const sample = samples[Math.round(index * lastTick / (PREVIEW_FRAMES - 1))]!
        return { label: `${(sample.ticks / TICKS_PER_SECOND).toFixed(2)}s`, joints: previewJoints(sample.worlds, sample.tips) }
      })
      lines.push(`an ${actionName}`)
      let written = 0
      for (const bone of armature.bones) {
        const entry = channels.get(bone.name)!, groupLines: string[] = []
        for (const [path, series, rest] of [['location', entry.location, 0], ['rotation', entry.rotation, 0], ['scale', entry.scale, 1]] as const) {
          for (let axis = 0; axis < 3; axis++) {
            const values = series.map((value) => value[axis]!)
            if (values.every((value) => Math.abs(value - rest) < 1e-6)) continue // BBSFix skips all-default channels
            groupLines.push(`ag ${path} ${axis}`)
            values.forEach((value, tick) => groupLines.push(`kf ${tick} ${formatNumber(value)} LINEAR ${tick} ${formatNumber(value)} ${tick} ${formatNumber(value)}`))
            written++
          }
        }
        if (groupLines.length) lines.push(`ao ${bone.name}`, ...groupLines)
      }
      actions.push({ name: actionName, glbName: clip.name, ticks: lastTick, channels: written })
    }
  } finally { adapter.dispose() }
  const bobj = `${lines.join('\n')}\n`

  // Read back what was written: parse + V9.12 evaluation must land on the solver's joint positions.
  let roundtripMaxErrorBlocks = 0
  const parsed = parseBobjActions(bobj)
  for (const [name, samples] of expected) {
    const action = parsed.get(name)
    if (!action) { roundtripMaxErrorBlocks = Infinity; continue }
    for (const sample of samples) for (const bone of evaluateBobjAction(armature, action, sample.ticks)) {
      roundtripMaxErrorBlocks = Math.max(roundtripMaxErrorBlocks, new Vector3().setFromMatrixPosition(new Matrix4().fromArray(bone.worldMatrix)).distanceTo(sample.worlds.get(bone.name)!))
    }
  }
  const status = parsed.size === actions.length && roundtripMaxErrorBlocks < 1e-3 ? 'PASS' as const : 'FAIL' as const
  return { bobj, previewFrames, previewParents, report: { status, format: 'bobj-v9.12 (BBSFix: 20 Hz integer ticks, Euler XYZ, LINEAR)', ticksPerSecond: TICKS_PER_SECOND,
    settings: { ...settings }, actions, roundtripMaxErrorBlocks } }
}
