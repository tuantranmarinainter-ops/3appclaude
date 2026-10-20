const parentByBone = new Map<string, string | null>([['Hips', null]])
for (const side of ['Left', 'Right']) {
  parentByBone.set(`${side}UpLeg`, 'Hips')
  parentByBone.set(`${side}Leg`, `${side}UpLeg`)
  parentByBone.set(`${side}Foot`, `${side}Leg`)
  parentByBone.set(`${side}ToeBase`, `${side}Foot`)
  parentByBone.set(`${side}Toe_End`, `${side}ToeBase`)
}
parentByBone.set('Spine', 'Hips')
parentByBone.set('Spine1', 'Spine')
parentByBone.set('Spine2', 'Spine1')
parentByBone.set('Neck', 'Spine2')
parentByBone.set('Head', 'Neck')
parentByBone.set('HeadTop_End', 'Head')
for (const side of ['Left', 'Right']) {
  parentByBone.set(`${side}Shoulder`, 'Spine2')
  parentByBone.set(`${side}Arm`, `${side}Shoulder`)
  parentByBone.set(`${side}ForeArm`, `${side}Arm`)
  parentByBone.set(`${side}Hand`, `${side}ForeArm`)
  for (const finger of ['Index', 'Middle', 'Pinky', 'Ring', 'Thumb']) {
    parentByBone.set(`${side}Hand${finger}1`, `${side}Hand`)
    parentByBone.set(`${side}Hand${finger}2`, `${side}Hand${finger}1`)
    parentByBone.set(`${side}Hand${finger}3`, `${side}Hand${finger}2`)
    parentByBone.set(`${side}Hand${finger}4`, `${side}Hand${finger}3`)
  }
}
export const MIXAMO65_BONE_PARENTS = Object.freeze([...parentByBone].map(([name, parent]) => [name, parent] as const))

function canonical(name: string): string { return name.split(':').pop()!.replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase() }

/** Exact 65-joint Mixamo topology pinned from the CC-BY Topview Female GLB fixture. */
export function isMixamo65Topology(bones: readonly { id: string; name: string; parentId: string | null; deform?: boolean }[]): boolean {
  const joints = bones.filter((bone) => bone.deform !== false)
  if (joints.length !== 65 || parentByBone.size !== 65) return false
  const byName = new Map<string, (typeof joints)[number]>()
  for (const bone of joints) {
    const name = canonical(bone.name)
    if (!name || byName.has(name)) return false
    byName.set(name, bone)
  }
  if (byName.size !== 65) return false
  const jointIds = new Set(joints.map((bone) => bone.id))
  for (const [name, parent] of parentByBone) {
    const bone = byName.get(canonical(name))
    const expectedParent = parent ? byName.get(canonical(parent))?.id : null
    if (!bone || (jointIds.has(bone.parentId ?? '') ? bone.parentId : null) !== expectedParent) return false
  }
  return true
}

export const MIXAMO65_REFERENCE = Object.freeze({
  assetId: 'a3d_char_30ec53c93eae4173946b38639691ebe0',
  sha256: 'd4ce3fb196938e538ebc83ff984b90d3294c4d083d8c2489cdd7a25cad0f8be5',
  license: 'CC-BY-4.0',
  attribution: '© Topview, CC BY 4.0',
})
