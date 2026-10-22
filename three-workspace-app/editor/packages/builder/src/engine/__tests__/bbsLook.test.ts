import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CHARACTER_LABEL_KIND, GRID_NAME, GROUND_NAME } from '../objects/environment'
import { BbsLookView, entityLight, grassTexture, skyBlend } from '../objects/bbsLook'

function sceneWithCast() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0d0d0d)
  scene.fog = new THREE.Fog(0x000000, 1, 10)
  const ground = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()); ground.name = GROUND_NAME
  const grid = new THREE.Group(); grid.name = GRID_NAME
  const map = new THREE.Texture()
  const skin = new THREE.MeshStandardMaterial({ color: 0xff8844, map })
  const character = new THREE.Group(), body = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(new THREE.BoxGeometry(), skin)
  const label = new THREE.Sprite(); label.userData.t3dKind = CHARACTER_LABEL_KIND
  character.add(body, label)
  scene.add(ground, grid, character)
  return { scene, ground, grid, character, body, label, skin, map }
}

describe('BBS look', () => {
  it('lights entities like Minecraft: full on top, darker on the sides, 0.4 ambient underneath', () => {
    expect(entityLight(new THREE.Vector3(0, 1, 0))).toBe(1)
    expect(entityLight(new THREE.Vector3(0, -1, 0))).toBeCloseTo(0.4, 12)
    // North (-Z) faces only see light 0: 0.4 + 0.6 * 0.7 / |(0.2, 1, -0.7)|.
    expect(entityLight(new THREE.Vector3(0, 0, -1))).toBeCloseTo(0.4 + 0.6 * 0.7 / Math.hypot(0.2, 1, 0.7), 12)
    expect(entityLight(new THREE.Vector3(1, 0, 0))).toBeCloseTo(0.4 + 0.6 * 0.2 / Math.hypot(0.2, 1, 0.7), 12)
  })

  it('blends the sky from fog colour at the horizon towards the sky colour overhead', () => {
    expect(skyBlend(0)).toBe(0)
    expect(skyBlend(8.8)).toBeCloseTo(0.42, 2)
    expect(skyBlend(90)).toBeGreaterThan(0.99)
  })

  it('makes a 16x16 nearest-filtered grass texture around the measured mean', () => {
    const texture = grassTexture()
    const data = texture.image.data as Uint8Array
    expect([texture.image.width, texture.image.height, texture.magFilter]).toEqual([16, 16, THREE.NearestFilter])
    const mean = [0, 1, 2].map((c) => { let sum = 0; for (let i = 0; i < 256; i++) sum += data[i * 4 + c]!; return sum / 256 })
    expect(mean[0]).toBeGreaterThan(70); expect(mean[0]).toBeLessThan(86)
    expect(mean[1]).toBeGreaterThan(92); expect(mean[1]).toBeLessThan(112)
  })

  it('swaps materials, hides ground/grid/labels, adds sky and floor, and restores everything exactly', () => {
    const { scene, ground, grid, character, body, label, skin, map } = sceneWithCast()
    const view = new BbsLookView()
    view.apply(scene, [character], 0.5)
    expect((body.material as THREE.ShaderMaterial).isShaderMaterial).toBe(true)
    expect((body.material as THREE.ShaderMaterial).uniforms.map!.value).toBe(map)
    expect([map.magFilter, map.minFilter]).toEqual([THREE.NearestFilter, THREE.NearestFilter])
    expect([ground.visible, grid.visible, label.visible]).toEqual([false, false, false])
    expect(scene.fog).toBeNull()
    expect(scene.getObjectByName('t3d-bbs-floor')!.position.y).toBe(0.5)
    expect(scene.getObjectByName('t3d-bbs-sky')).toBeDefined()
    const swapped = body.material
    view.apply(scene, [character], 0.5)
    expect(body.material).toBe(swapped)
    const late = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); character.add(late)
    view.apply(scene, [character], 0.5)
    expect((late.material as THREE.ShaderMaterial).isShaderMaterial).toBe(true)
    view.restore(scene)
    expect(body.material).toBe(skin)
    expect([map.magFilter, map.minFilter]).toEqual([THREE.LinearFilter, THREE.LinearMipmapLinearFilter])
    expect((scene.background as THREE.Color).getHex()).toBe(0x0d0d0d)
    expect(scene.fog).not.toBeNull()
    expect([ground.visible, grid.visible, label.visible]).toEqual([true, true, true])
    expect(scene.getObjectByName('t3d-bbs-floor')).toBeUndefined()
    expect(view.enabled).toBe(false)
  })
})
