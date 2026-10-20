export function sceneBasisElements(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 9 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new TypeError('Scene basis must contain nine finite values')
  }
  const m = value as number[]
  const rows = [[m[0]!, m[1]!, m[2]!], [m[3]!, m[4]!, m[5]!], [m[6]!, m[7]!, m[8]!]]
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const dot = rows[i]!.reduce((sum, item, k) => sum + item * rows[j]![k]!, 0)
    if (Math.abs(dot - (i === j ? 1 : 0)) > 1e-6) throw new TypeError('Scene basis must be orthonormal')
  }
  const determinant = m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!)
  if (Math.abs(Math.abs(determinant) - 1) > 1e-6) throw new TypeError('Scene basis must be orthonormal')
  return [m[0]!, m[3]!, m[6]!, 0, m[1]!, m[4]!, m[7]!, 0, m[2]!, m[5]!, m[8]!, 0, 0, 0, 0, 1]
}
