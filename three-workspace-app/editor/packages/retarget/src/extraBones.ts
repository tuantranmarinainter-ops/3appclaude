import { MIXAMO65_BONE_PARENTS } from './mixamo65.ts'

export interface ExtraBone { name: string; parent: string; rest: { position: number[]; rotation: number[]; scale: number[] } }

/** Validate the additive GLB v1.1 rig metadata. */
export function validateExtraBones(manifest: { version?: unknown; rig?: unknown; extraBones?: unknown }): ExtraBone[] {
  if (manifest.version === '1.0.0') {
    if ((manifest.rig !== undefined && manifest.rig !== 'mixamo65') || manifest.extraBones !== undefined) throw new TypeError('v1.0 requires mixamo65 without extraBones')
    return []
  }
  if (manifest.version !== '1.1.0' || typeof manifest.rig !== 'string' || !/^mixamo65\+[A-Za-z0-9][A-Za-z0-9_-]*$/.test(manifest.rig) || !Array.isArray(manifest.extraBones) || !manifest.extraBones.length) throw new TypeError('v1.1 requires an extended rig and nonempty extraBones')
  const core = new Set(MIXAMO65_BONE_PARENTS.map(([name]) => name)), byName = new Map<string, ExtraBone>()
  for (const item of manifest.extraBones) {
    const bone = item as ExtraBone
    if (!bone || typeof bone.name !== 'string' || core.has(bone.name) || byName.has(bone.name) || !/^X_[A-Za-z0-9_]+_[A-Za-z0-9_]+$/.test(bone.name) || typeof bone.parent !== 'string') throw new TypeError('Invalid or duplicate extra bone metadata')
    for (const [key, size] of [['position', 3], ['rotation', 4], ['scale', 3]] as const) if (!Array.isArray(bone.rest?.[key]) || bone.rest[key].length !== size || !bone.rest[key].every(Number.isFinite)) throw new TypeError('Extra bone rest must contain finite TRS vectors')
    byName.set(bone.name, bone)
  }
  for (const bone of byName.values()) {
    if (!core.has(bone.parent) && !byName.has(bone.parent)) throw new TypeError(`Missing extra bone parent: ${bone.parent}`)
    let ancestor = bone.parent
    while (byName.has(ancestor)) ancestor = byName.get(ancestor)!.parent
    if (!bone.name.startsWith(`X_${ancestor}_`)) throw new TypeError('Extra bone name must identify its core parent')
  }
  return manifest.extraBones as ExtraBone[]
}
