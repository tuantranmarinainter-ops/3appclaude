import type { RetargetRig } from '@bbs/retarget'

export function boneLinePositions(bones: RetargetRig['bones'], worlds: ReadonlyMap<string, readonly number[]>, horizontalOffset = 0): Float32Array {
  const output: number[] = []
  for (const bone of bones) {
    if (!bone.parentId) continue
    const parent = worlds.get(bone.parentId), child = worlds.get(bone.id)
    if (!parent || !child || parent.length !== 16 || child.length !== 16) throw new TypeError(`Preview pose is missing bone world transform: ${bone.id}`)
    output.push(parent[12]! + horizontalOffset, parent[13]!, parent[14]!, child[12]! + horizontalOffset, child[13]!, child[14]!)
  }
  return new Float32Array(output)
}
