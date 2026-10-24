/** Pure, atomic assignment over every row, including rows hidden by UI filters. */
export function mappingTransaction(rows, target, source) {
  if (!rows.some((row) => row.target === target)) return null
  const clear = (row) => ({ ...row, source: null, via: null, needsChoice: true })
  // Imported suggestions may already collide. Undo must also leave a unique mapping.
  const seen = new Set()
  const before = rows.map((row) => {
    if (!row.source) return { ...row }
    if (seen.has(row.source)) return clear(row)
    seen.add(row.source)
    return { ...row }
  })
  const assigned = new Set(source ? [source] : [])
  const next = rows.map((row) => {
    if (row.target === target) return { ...row, source,
      via: source === row.source ? row.via : source ? 'edited' : null, needsChoice: false }
    if (!row.source) return { ...row }
    if (assigned.has(row.source)) return clear(row)
    assigned.add(row.source)
    return { ...row }
  })
  if (next.every((row, i) => row.source === rows[i].source && !!row.needsChoice === !!rows[i].needsChoice)) return null
  return { before, rows: next }
}
