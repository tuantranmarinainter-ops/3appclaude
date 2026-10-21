import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CHARACTER_LABEL_KIND, GRID_NAME, GROUND_NAME } from '../objects/environment'
import { SILHOUETTE_BACKGROUND, SILHOUETTE_CHARACTER, SILHOUETTE_SET, SilhouetteView } from '../objects/silhouette'

function sceneWithCast() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0d0d0d)
  scene.fog = new THREE.Fog(0x000000, 1, 10)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()); ground.name = GROUND_NAME
  const grid = new THREE.Group(); grid.name = GRID_NAME
  const skin = new THREE.MeshStandardMaterial({ color: 0xff8844 })
  const character = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(), skin)
  const label = new THREE.Sprite(); label.userData.t3dKind = CHARACTER_LABEL_KIND
  character.add(body, label)
  const prop = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x00ff00 }))
  scene.add(ground, grid, character, prop)
  return { scene, ground, grid, character, body, label, prop, skin }
}

describe('silhouette view', () => {
  it('paints characters dark, sets light, hides ground/grid/labels, and restores everything exactly', () => {
    const { scene, ground, grid, character, body, label, prop, skin } = sceneWithCast()
    const propMaterial = prop.material
    const view = new SilhouetteView()
    view.apply(scene, [character], [prop])
    expect((scene.background as THREE.Color).getHex()).toBe(SILHOUETTE_BACKGROUND)
    expect(scene.fog).toBeNull()
    expect([ground.visible, grid.visible, label.visible]).toEqual([false, false, false])
    expect((body.material as THREE.MeshBasicMaterial).color.getHex()).toBe(SILHOUETTE_CHARACTER)
    expect((prop.material as THREE.MeshBasicMaterial).color.getHex()).toBe(SILHOUETTE_SET)
    // Environment tint written after the swap is overridden on the next frame and stays per mesh.
    ;(body.material as THREE.MeshBasicMaterial).color.setHex(0x123456)
    view.apply(scene, [character], [prop])
    expect((body.material as THREE.MeshBasicMaterial).color.getHex()).toBe(SILHOUETTE_CHARACTER)
    expect((prop.material as THREE.MeshBasicMaterial).color.getHex()).toBe(SILHOUETTE_SET)
    view.restore(scene)
    expect(body.material).toBe(skin)
    expect(prop.material).toBe(propMaterial)
    expect((scene.background as THREE.Color).getHex()).toBe(0x0d0d0d)
    expect(scene.fog).not.toBeNull()
    expect([ground.visible, grid.visible, label.visible]).toEqual([true, true, true])
    expect(view.enabled).toBe(false)
  })

  it('swaps meshes that load after the toggle', () => {
    const { scene, character, prop } = sceneWithCast()
    const view = new SilhouetteView()
    view.apply(scene, [character], [prop])
    const late = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); character.add(late)
    view.apply(scene, [character], [prop])
    expect((late.material as THREE.MeshBasicMaterial).color.getHex()).toBe(SILHOUETTE_CHARACTER)
  })
})
