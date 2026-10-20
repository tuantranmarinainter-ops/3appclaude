export interface SkinInfluence { boneId: string; weight: number }
export interface SkinVertex { influences: SkinInfluence[] }
export interface SkinWeightTransferReport { vertices: SkinVertex[]; droppedWeight: number; affectedVertices: number }

/** Transfers explicit joint weights; unmapped joints need an owner policy instead of being discarded. */
export function transferSkinWeights(
  vertices: readonly SkinVertex[],
  sourceToTarget: ReadonlyMap<string, string>,
  maxInfluences = Number.POSITIVE_INFINITY,
): SkinWeightTransferReport {
  if (!Number.isSafeInteger(vertices.length) || !Number.isSafeInteger(maxInfluences) && maxInfluences !== Number.POSITIVE_INFINITY || maxInfluences < 1) throw new RangeError('Skin transfer requires vertices and a positive influence limit')
  let droppedWeight = 0
  let affectedVertices = 0
  const result = vertices.map((vertex, index) => {
    if (!vertex || !Array.isArray(vertex.influences)) throw new TypeError(`Vertex ${index} has invalid influences`)
    const combined = new Map<string, number>()
    let sum = 0
    for (const influence of vertex.influences) {
      if (!influence || !Number.isFinite(influence.weight) || influence.weight < 0 || !influence.boneId) throw new TypeError(`Vertex ${index} has an invalid skin weight`)
      if (influence.weight === 0) continue
      const targetId = sourceToTarget.get(influence.boneId)
      if (!targetId) throw new TypeError(`Vertex ${index} references unmapped source joint ${influence.boneId}`)
      combined.set(targetId, (combined.get(targetId) ?? 0) + influence.weight)
      sum += influence.weight
    }
    if (!(sum > 0) || !Number.isFinite(sum)) throw new TypeError(`Vertex ${index} has no positive finite skin weight`)
    const ordered = [...combined].sort((a, b) => b[1] - a[1])
    const kept = ordered.slice(0, maxInfluences)
    const keptSum = kept.reduce((total, [, weight]) => total + weight, 0)
    const lost = sum - keptSum
    if (lost > Math.max(1e-8, sum * 1e-8)) { droppedWeight += lost; affectedVertices += 1 }
    return { influences: kept.map(([boneId, weight]) => ({ boneId, weight: weight / keptSum })) }
  })
  return { vertices: result, droppedWeight, affectedVertices }
}
