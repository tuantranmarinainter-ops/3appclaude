import { MIXAMO65_BONE_PARENTS } from '@bbs/retarget'
import { createHash } from 'node:crypto'
import { isRecord } from '@bbs/animation-workspace-shared'
import type { ImportedAsset } from './unifiedAssetFiles'

/** Bind App 1 Action identities to decoded clips before any project transaction. */
export function attachApp1Manifest(imported: ImportedAsset, bytes: Buffer, value: unknown): void {
  if (!isRecord(value) || typeof value.version !== 'string' || !/^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value.version) ||
      value.glbSha256 !== createHash('sha256').update(bytes).digest('hex') || !Array.isArray(value.actions) || !value.actions.length) {
    throw new TypeError('APP1_MANIFEST_INVALID: version, GLB SHA-256 or actions are invalid')
  }
  if (imported.skeleton?.family !== 'mixamo65' || value.actions.length !== imported.motions.length || imported.issues?.length) {
    throw new TypeError('APP1_ACTION_MISSING: every manifest Action must resolve to a Mixamo65 GLB clip')
  }
  const used = new Set<string>(), indices = new Set<number>()
  for (const entry of value.actions) {
    if (!isRecord(entry) || typeof entry.uuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.uuid) ||
        used.has(entry.uuid) || !Number.isSafeInteger(entry.glbAnimationIndex) || indices.has(entry.glbAnimationIndex as number) ||
        typeof entry.name !== 'string' || !entry.name.trim() || entry.fps !== 30 || typeof entry.durationSeconds !== 'number' || !Number.isFinite(entry.durationSeconds)) {
      throw new TypeError('APP1_MANIFEST_INVALID: Action UUID, index, name, duration or FPS is invalid')
    }
    const item = imported.motions.find((motion) => motion.clipIndex === entry.glbAnimationIndex)
    if (!item || Math.abs(item.motion.durationSeconds - entry.durationSeconds) > 1e-4) throw new TypeError('APP1_ACTION_MISSING: manifest clip index or duration does not match GLB')
    const jointNames = new Set(MIXAMO65_BONE_PARENTS.map(([name]) => name))
    item.boneNames = item.boneNames?.filter(name => jointNames.has(name))
    item.motion.id = entry.uuid
    item.motion.sourceFps = 30
    item.name = entry.name
    used.add(entry.uuid); indices.add(entry.glbAnimationIndex as number)
  }
  imported.app1Manifest = structuredClone(value)
}
