/** Character dimensions remain a display/placement concern; Actions retain canonical native units. */
export function app3HeightHint(metadata: Record<string, unknown> | undefined): { heightBlocks: number; heightScale: number } | undefined {
  if (metadata?.libraryHeightBlocks === undefined && metadata?.libraryHeightScale === undefined) return undefined
  const heightBlocks = metadata?.libraryHeightBlocks, heightScale = metadata?.libraryHeightScale
  if (typeof heightBlocks !== 'number' || !Number.isFinite(heightBlocks) || heightBlocks <= 0 || typeof heightScale !== 'number' || !Number.isFinite(heightScale) || heightScale <= 0) throw new TypeError('Chiều cao nhân vật trong cảnh không hợp lệ')
  return { heightBlocks, heightScale }
}
export function shotPlacementAtHeight<T extends { position: number[] }>(keys: T[], base: number[], heightScale = 1): T[] {
  if (!Number.isFinite(heightScale) || heightScale <= 0) throw new TypeError('Tỷ lệ chiều cao không hợp lệ')
  return keys.map((key) => ({ ...key, position: key.position.map((n, axis) => base[axis]! + (n - base[axis]!) * heightScale) }))
}
