import { createHash } from 'node:crypto'
import { Matrix4, Quaternion, Vector3 } from 'three'

/** Stable across GLB node reindexing; includes every joint, parent and rest transform. */
export function nativeSkeletonFingerprint(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes)
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)))
  const nodes = json.nodes ?? [], joints = new Set<number>((json.skins ?? []).flatMap((skin: any) => skin.joints ?? []))
  if (!joints.size) throw new Error('Native GLB has no skeleton')
  const parents = new Map<number, number>()
  nodes.forEach((node: any, parent: number) => { for (const child of node.children ?? []) { if (parents.has(child)) throw new Error('Native skeleton has multiple parents'); parents.set(child, parent) } })
  const names = new Set<string>()
  const signature = [...joints].map(index => {
    const node = nodes[index]
    if (!node || typeof node.name !== 'string' || names.has(node.name)) throw new Error('Native skeleton has missing or duplicate joint names')
    names.add(node.name)
    let parent = parents.get(index)
    const seen = new Set([index])
    while (parent !== undefined && !joints.has(parent)) { if (seen.has(parent)) throw new Error('Native skeleton cycle'); seen.add(parent); parent = parents.get(parent) }
    const matrix = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3().fromArray(node.translation ?? [0,0,0]), new Quaternion().fromArray(node.rotation ?? [0,0,0,1]), new Vector3().fromArray(node.scale ?? [1,1,1]))
    return [node.name, parent === undefined ? null : nodes[parent].name, matrix.elements.map(value => { if (!Number.isFinite(value)) throw new Error('Invalid native rest transform'); return Number(value.toFixed(5)) })]
  }).sort((a,b) => String(a[0]).localeCompare(String(b[0])))
  return createHash('sha256').update(JSON.stringify(signature)).digest('hex')
}
