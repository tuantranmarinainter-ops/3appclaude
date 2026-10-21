/**
 * Flat recolour of a builtin Topview character (CC BY 4.0, attribution kept in builtin-assets/NOTICE): every material's
 * base colour is replaced, the Mixamo65 skeleton and skin are untouched, so all Mixamo65 Actions and poses still apply.
 *
 *   node --import tsx ../../apps/studio/scripts/recolorCharacter.mts --src <builtin.glb> --out <file.glb> --color '#3F8F3A' [--joints '#2A5F27']
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { decodeGlb, encodeGlb } from '../../../packages/retarget/cli/glb.ts'

const linear = (hex: string) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255) ** 2.2)

export function recolor(bytes: Uint8Array, color: string, joints = color, scale = 1): Uint8Array {
  const { json, bin } = decodeGlb(bytes)
  // Size is baked into the scene root nodes so placed Characters keep unit scale (Film replay has no actor scale).
  if (scale !== 1) for (const index of json.scenes?.[json.scene ?? 0]?.nodes ?? []) { const node = json.nodes[index]; node.scale = (node.scale ?? [1, 1, 1]).map((v: number) => v * scale) }
  for (const material of json.materials ?? []) {
    const pbr = material.pbrMetallicRoughness ??= {}
    pbr.baseColorFactor = [...linear(/joint/i.test(material.name ?? '') ? joints : color), 1]
    delete pbr.baseColorTexture
  }
  return encodeGlb(json, bin)
}

if (process.argv[1]?.endsWith('recolorCharacter.mts')) {
  const { values } = parseArgs({ options: { src: { type: 'string' }, out: { type: 'string' }, color: { type: 'string' }, joints: { type: 'string' }, scale: { type: 'string' } } })
  if (!values.src || !values.out || !/^#[0-9a-f]{6}$/i.test(values.color ?? '')) throw new TypeError('--src, --out and --color #RRGGBB are required')
  writeFileSync(values.out, recolor(readFileSync(values.src), values.color!, values.joints, Number(values.scale ?? 1)))
  console.log(`wrote ${values.out}`)
}
