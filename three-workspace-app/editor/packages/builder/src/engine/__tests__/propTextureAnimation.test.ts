import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { preparePropTextureAnimation, propTextureFrameAt, readPropTextureAnimation, syncPropTextureAnimations, type PropTextureAnimation } from '../objects/propTextureAnimation'

const anim: PropTextureAnimation = { version: 1, layout: 'vertical-strip', frameCount: 36, frametimeTicks: 1, ticksPerSecond: 20 }

describe('prop texture animation (Minecraft .mcmeta strip)', () => {
  it('rejects malformed extras', () => {
    expect(readPropTextureAnimation(undefined)).toBeNull()
    expect(readPropTextureAnimation({ ...anim, version: 2 })).toBeNull()
    expect(readPropTextureAnimation({ ...anim, frameCount: 1 })).toBeNull()
    expect(readPropTextureAnimation({ ...anim, frameOrder: [0, 36] })).toBeNull()
    expect(readPropTextureAnimation(anim)).toEqual(anim)
  })

  it('advances one sheet frame per game tick at 30 fps and wraps after 36 ticks (1.8 s)', () => {
    expect(propTextureFrameAt(anim, 0, 30)).toBe(0)
    expect(propTextureFrameAt(anim, 1, 30)).toBe(0)
    expect(propTextureFrameAt(anim, 2, 30)).toBe(1)
    expect(propTextureFrameAt(anim, 3, 30)).toBe(2)
    expect(propTextureFrameAt(anim, 54, 30)).toBe(0)
    expect(propTextureFrameAt(anim, 57, 30)).toBe(2)
    expect(propTextureFrameAt({ ...anim, frametimeTicks: 2, frameOrder: [5, 4] }, 3, 30)).toBe(4)
  })

  it('gives each prop instance its own texture and shifts both map and emissive map', () => {
    const shared = new THREE.Texture()
    const template = new THREE.MeshStandardMaterial({ map: shared, emissiveMap: shared })
    template.userData.w01TextureAnimation = anim
    const rootA = new THREE.Group()
    const rootB = new THREE.Group()
    const a = template.clone()
    const b = template.clone()
    preparePropTextureAnimation(rootA, a)
    preparePropTextureAnimation(rootB, b)
    expect(a.map).not.toBe(shared)
    expect(a.map).toBe(a.emissiveMap)
    expect(a.map).not.toBe(b.map)
    expect(syncPropTextureAnimations([rootA], 3, 30)).toBe(true)
    expect(a.map!.offset.y).toBeCloseTo(2 / 36)
    // BBS-look shader reads texture.matrix directly, so it must already hold the new offset.
    expect(a.map!.matrix.elements[7]).toBeCloseTo(2 / 36)
    expect(b.map!.offset.y).toBe(0)
    expect(shared.offset.y).toBe(0)
    expect(syncPropTextureAnimations([rootA], 3, 30)).toBe(false)
  })

  it('leaves plain props alone', () => {
    const root = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial({ map: new THREE.Texture() })
    const before = mat.map
    preparePropTextureAnimation(root, mat)
    expect(mat.map).toBe(before)
    expect(syncPropTextureAnimations([root], 10, 30)).toBe(false)
  })
})
