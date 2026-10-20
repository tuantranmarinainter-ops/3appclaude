import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { sceneBasisMatrix } from '../sceneBasisMatrix'

describe('sceneBasisMatrix compatibility adapter', () => {
  it('preserves the legacy Matrix4 conversion and inverse behavior', () => {
    const basis = sceneBasisMatrix([1, 0, 0, 0, 0, 1, 0, -1, 0])
    const source = new Vector3(1, 2, 3)
    const scene = source.clone().applyMatrix4(basis)
    expect(scene.toArray()).toEqual([1, 3, -2])
    expect(scene.applyMatrix4(basis.clone().invert()).distanceTo(source)).toBeLessThan(1e-12)
    expect(basis.clone().multiply(basis.clone().invert()).equals(new Matrix4())).toBe(true)
  })
})
