import { MIXAMO65_BONE_PARENTS } from './mixamo65'

export interface ExtraBone {
  name: string
  parent: string
  rest: { position: number[]; rotation: number[]; scale: number[] }
}

/** Validate the additive rig metadata without changing legacy v1.0 manifests. */
export function validateExtraBones(manifest: { version?: unknown; rig?: unknown; extraBones?: unknown }): ExtraBone[] {
  const { version, rig, extraBones } = manifest
  if (version === '1.0.0') {
    if ((rig !== undefined && rig !== 'mixamo65') || extraBones !== undefined) throw new TypeError('v1.0 requires mixamo65 without extraBones')
    return []
  }
  if (version !== '1.1.0') throw new TypeError('Unsupported GLB contract version')
  if (typeof rig !== 'string' || !/^mixamo65\+[A-Za-z0-9][A-Za-z0-9_-]*$/.test(rig) || !Array.isArray(extraBones) || !extraBones.length) throw new TypeError('v1.1 requires an extended rig and nonempty extraBones')
  const core = new Set(MIXAMO65_BONE_PARENTS.map(([name]) => name)), byName = new Map<string, ExtraBone>()
  for (const bone of extraBones) {
    if (!bone || typeof bone !== 'object' || typeof bone.name !== 'string' || core.has(bone.name) || byName.has(bone.name) || !/^X_[A-Za-z0-9_]+_[A-Za-z0-9_]+$/.test(bone.name)) throw new TypeError('Invalid or duplicate extra bone name')
    if (typeof bone.parent !== 'string' || !bone.rest) throw new TypeError('Missing extra bone parent/rest')
    for (const [key, size] of [['position', 3], ['rotation', 4], ['scale', 3]] as const) {
      const vector = bone.rest[key]
      if (!Array.isArray(vector) || vector.length !== size || !vector.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) throw new TypeError('Extra bone rest must contain finite TRS vectors')
    }
    byName.set(bone.name, bone)
  }
  for (const bone of byName.values()) {
    if (!core.has(bone.parent) && !byName.has(bone.parent)) throw new TypeError('Missing extra bone parent')
    const seen = new Set([bone.name]); let parent = bone.parent
    while (byName.has(parent)) {
      if (seen.has(parent)) throw new TypeError('Extra bone parent cycle')
      seen.add(parent); parent = byName.get(parent)!.parent
    }
    // The name identifies the core attachment, including for descendants of another extra.
    if (!bone.name.startsWith(`X_${parent}_`)) throw new TypeError('Extra bone name must identify its core parent')
  }
  return extraBones as ExtraBone[]
}
