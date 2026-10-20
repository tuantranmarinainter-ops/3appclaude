import { describe, expect, it } from 'vitest'
import { sceneBasisElements } from '../sceneBasis'

describe('sceneBasisElements', () => {
  it('returns column-major affine elements mapping Z-up to Y-up', () => {
    expect(sceneBasisElements([1, 0, 0, 0, 0, 1, 0, -1, 0])).toEqual([
      1, 0, 0, 0,
      0, 0, -1, 0,
      0, 1, 0, 0,
      0, 0, 0, 1,
    ])
  })

  it('rejects scale, shear and non-finite scene basis matrices', () => {
    expect(() => sceneBasisElements([2, 0, 0, 0, 1, 0, 0, 0, 1])).toThrow(/orthonormal/)
    expect(() => sceneBasisElements([1, 0.2, 0, 0, 1, 0, 0, 0, 1])).toThrow(/orthonormal/)
    expect(() => sceneBasisElements([1, 0, 0, 0, 0, 1, 0, 0, Number.NaN])).toThrow(/finite/)
  })
})
