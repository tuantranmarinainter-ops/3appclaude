import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { VFX_DEPTH_BIAS_MAX, VFX_MANUAL_OPACITY, VfxSpriteLayer, findBoneByCanonicalName, validVfxSheetMeta, vfxCellUv, vfxCueActive, vfxCueWorld, vfxSheetCell, type VfxSheetMeta, type VfxSpriteCue } from '../objects/vfxSprites'

const meta: VfxSheetMeta = { frames: 10, columns: 4, rows: 3, fps: 20, sizeMeters: 2, pivot: [0.5, 0], blend: 'add', loop: false }
const cue = (patch: Partial<VfxSpriteCue> = {}): VfxSpriteCue => ({ id: 'c1', effect: 'aura01', frameStart: 30, frameEnd: 59, position: { x: 1, y: 0, z: 0 }, yaw: 0, scale: 0.5, ...patch })
const none = { node: () => null, bone: () => null }

describe('VFX sprite preview', () => {
  it('validates sheet metadata', () => {
    expect(validVfxSheetMeta(meta)).toBe(true)
    expect(validVfxSheetMeta({ ...meta, frames: 13 })).toBe(false)
    expect(validVfxSheetMeta({ ...meta, blend: 'screen' })).toBe(false)
  })

  it('is active on the inclusive cue range', () => {
    expect([29, 30, 59, 60].map((frame) => vfxCueActive(cue(), frame))).toEqual([false, true, true, false])
  })

  it('picks the sheet cell from cue time at the sheet frame rate', () => {
    expect(vfxSheetCell(meta, 0, 30)).toBe(0)
    expect(vfxSheetCell(meta, 14, 30)).toBe(9) // 0.47 s at 20 fps
    expect(vfxSheetCell(meta, 15, 30)).toBeNull() // 0.5 s: all 10 cells shown, not looping
    expect(vfxSheetCell({ ...meta, loop: true }, 15, 30)).toBe(0)
    expect(vfxSheetCell(meta, -1, 30)).toBeNull()
  })

  it('maps cells to UVs with rows counted from the top', () => {
    const near = (actual: { offset: number[]; repeat: number[] }, offset: number[]) => {
      actual.offset.forEach((value, i) => expect(value).toBeCloseTo(offset[i]!, 12))
      actual.repeat.forEach((value, i) => expect(value).toBeCloseTo([0.25, 1 / 3][i]!, 12))
    }
    near(vfxCellUv(meta, 0), [0, 2 / 3])
    near(vfxCellUv(meta, 5), [0.25, 1 / 3])
  })

  it('places free cues in the world and attached cues in the attached frame', () => {
    expect(vfxCueWorld(cue(), none)!.position.toArray()).toEqual([1, 0, 0])
    const turned = new THREE.Matrix4().compose(new THREE.Vector3(5, 0, 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Vector3(2, 2, 2))
    const node = vfxCueWorld(cue({ attachNodeId: 'n' }), { node: () => turned, bone: () => null })!
    node.position.toArray().forEach((value, axis) => expect(value).toBeCloseTo([5, 0, 1][axis]!, 9))
    expect(node.scale).toBe(1)
    // Bone matrices may carry model-unit scale: the offset stays in metres and the size is not rescaled.
    const bone = vfxCueWorld(cue({ attachNodeId: 'n', attachBone: 'mixamorig:RightHand' }), { node: () => null, bone: () => new THREE.Matrix4().makeScale(0.01, 0.01, 0.01) })!
    expect(bone.position.toArray()).toEqual([1, 0, 0])
    expect(bone.scale).toBe(0.5)
    expect(vfxCueWorld(cue({ attachNodeId: 'missing' }), none)).toBeNull()
  })

  it('finds bones by canonical name across rig prefixes', () => {
    const root = new THREE.Group(), hand = new THREE.Bone(); hand.name = 'mixamorig:RightHand'; root.add(hand)
    expect(findBoneByCanonicalName(root, 'RightHand')).toBe(hand)
    expect(findBoneByCanonicalName(root, 'LeftHand')).toBeNull()
  })

  it('shows, sizes and hides sprites per frame and rebuilds them when cues change', () => {
    const layer = new VfxSpriteLayer()
    layer.setCues([cue()], {})
    layer.update(10, 30, none)
    const sprite = layer.group.getObjectByName('vfx:c1') as THREE.Sprite
    expect(sprite.visible).toBe(false)
    layer.update(40, 30, none)
    expect(sprite.visible).toBe(true)
    expect(sprite.position.toArray()).toEqual([1, 0, 0])
    expect(sprite.scale.x).toBe(0.5) // placeholder is 1 m before scale
    layer.setCues([cue({ effect: 'toonhit' })], {})
    expect(layer.group.getObjectByName('vfx:c1')).toBeUndefined()
    layer.setCues([], {})
    expect(layer.cueCount).toBe(0)
    layer.dispose()
  })
})

describe('VFX sprite preview: manual play and depth bias', () => {
  it('shows a manual-play effect frozen and faded, and caps the depth bias', () => {
    // No DOM image loading under vitest: the sheet texture is a stand-in.
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture())
    const layer = new VfxSpriteLayer()
    const big = { ...meta, sizeMeters: 20 }
    layer.setCues([{ id: 'm', effect: 'fx', frameStart: 0, frameEnd: 90, position: { x: 0, y: 0, z: 0 }, yaw: 0, scale: 1, play: 'manual' }], { fx: { url: 'data:,', meta: big } })
    layer.update(10, 30, none)
    const sprite = layer.group.getObjectByName('vfx:m') as THREE.Sprite
    const offset = (sprite.material.map as THREE.Texture).offset.toArray()
    layer.update(50, 30, none)
    expect((sprite.material.map as THREE.Texture).offset.toArray()).toEqual(offset)
    expect(sprite.material.opacity).toBe(VFX_MANUAL_OPACITY)
    expect((sprite.material.userData.depthBias as { value: number }).value).toBe(VFX_DEPTH_BIAS_MAX)
    layer.dispose()
    load.mockRestore()
  })
})
