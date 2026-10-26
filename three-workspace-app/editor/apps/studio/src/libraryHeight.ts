import { characterHeightBlocks, type CharacterMetadata } from '../../../packages/library/index'
import { libraryCharacterBoundingBoxHeight } from './libraryCharacterSpacing'

export interface LibraryHeightSnapshot { libraryHeightBlocks: number; librarySourceHeightMeters: number; libraryHeightScale: number }
export function libraryHeightSnapshot(character: CharacterMetadata, bytes: Buffer): LibraryHeightSnapshot {
  const source = libraryCharacterBoundingBoxHeight(bytes)
  const target = characterHeightBlocks(character) ?? source
  return { libraryHeightBlocks: target, librarySourceHeightMeters: source, libraryHeightScale: target / source }
}

/** Multiply absolute scale values and Bezier value handles, preserving frame/handle X coordinates. */
export function scaleHeightCurvePayload(payload: unknown, ratios: ReadonlyMap<string, number>): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const result = structuredClone(payload) as { fcurves?: Array<{ t?: unknown; p?: string; k?: unknown[][] }>; userKeys?: Record<string, { scale?: Array<{ value: number[] }> }> }
  for (const curve of result.fcurves ?? []) {
    const id = Array.isArray(curve.t) ? curve.t[1] : curve.t
    const ratio = typeof id === 'string' ? ratios.get(id) : undefined
    if (ratio === undefined || curve.p !== 'transform.scale') continue
    for (const key of curve.k ?? []) {
      key[1] = Number(key[1]) * ratio
      for (const index of [4, 5]) {
        const handle = key[index]
        if (handle && typeof handle === 'object' && 'y' in handle) (handle as { y: number }).y *= ratio
      }
    }
  }
  for (const [id, tracks] of Object.entries(result.userKeys ?? {})) {
    const ratio = ratios.get(id)
    if (ratio !== undefined) for (const key of tracks.scale ?? []) key.value = key.value.map(value => value * ratio)
  }
  return result
}
