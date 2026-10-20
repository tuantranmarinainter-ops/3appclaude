import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { canonical } from './autoMapping.ts'
import { decodeGlb, encodeGlb } from './glb.ts'

const MIXAMO_BY_CANONICAL = new Map(MIXAMO65_BONE_PARENTS.map(([name]) => [canonical(name), name]))

/**
 * GLB contract v1.0.0 writer. `normalizeAnimation` (shared with Studio) emits one Action per GLB with the target's own
 * joint names (`mixamorigHips`); the contract wants every Action in one file and bare Mixamo65 names. All parts come
 * from the same target rig, so the node tree of the first part is kept, each part's animation is appended with its
 * accessors/bufferViews re-indexed into one BIN chunk, and skin joints are renamed. Channels address nodes by index,
 * so renaming never detaches an animation.
 */
export function mergeAnimationGlbs(parts: readonly Uint8Array[]): Uint8Array {
  if (!parts.length) throw new TypeError('At least one animation GLB is required')
  const decoded = parts.map(decodeGlb)
  const base = structuredClone(decoded[0]!.json)
  const nodeNames = JSON.stringify(base.nodes.map((node: { name?: string }) => node.name ?? ''))
  const bins: Uint8Array[] = [], bufferViews: any[] = [], accessors: any[] = [], animations: any[] = []
  let offset = 0
  for (const [index, { json, bin }] of decoded.entries()) {
    if (JSON.stringify(json.nodes.map((node: { name?: string }) => node.name ?? '')) !== nodeNames) throw new TypeError(`Animation part ${index} was baked on a different target node tree`)
    if ((json.animations ?? []).length !== 1) throw new TypeError(`Animation part ${index} must hold exactly one animation`)
    const viewBase = bufferViews.length, accessorBase = accessors.length
    for (const view of json.bufferViews ?? []) bufferViews.push({ ...view, buffer: 0, byteOffset: (view.byteOffset ?? 0) + offset })
    for (const accessor of json.accessors ?? []) accessors.push({ ...accessor, bufferView: accessor.bufferView + viewBase })
    const animation = json.animations[0]
    animations.push({ ...animation, samplers: animation.samplers.map((sampler: any) => ({ ...sampler, input: sampler.input + accessorBase, output: sampler.output + accessorBase })) })
    bins.push(bin); offset += Math.ceil(bin.length / 4) * 4
  }
  const bin = new Uint8Array(offset)
  let cursor = 0
  for (const part of bins) { bin.set(part, cursor); cursor += Math.ceil(part.length / 4) * 4 }
  for (const joint of base.skins?.[0]?.joints ?? []) {
    const name = MIXAMO_BY_CANONICAL.get(canonical(base.nodes[joint].name ?? ''))
    if (name) base.nodes[joint].name = name
  }
  return encodeGlb({ ...base, buffers: [{ byteLength: offset }], bufferViews, accessors, animations }, bin)
}

/** Node names exactly as stored (GLTFLoader sanitizes names on load, so the contract check must read the JSON). */
export function glbNodeNames(glb: Uint8Array): string[] {
  return (decodeGlb(glb).json.nodes ?? []).map((node: { name?: string }) => node.name ?? '')
}
