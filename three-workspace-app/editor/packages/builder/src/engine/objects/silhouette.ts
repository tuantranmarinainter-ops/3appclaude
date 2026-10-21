import * as THREE from 'three'
import { CHARACTER_LABEL_KIND, GRID_NAME, GROUND_NAME, OBJECT_LABEL_KIND } from './environment'

// 剪影视图：只改观看方式，不写文档。角色压成实心暗色，布景压成浅灰，背景纯浅色，隐藏地面 / 网格 / 标签，
// 方便检查姿势轮廓是否一眼可读。关闭时按原样还原材质、可见性、背景和雾。
export const SILHOUETTE_BACKGROUND = 0xf2f2f2
export const SILHOUETTE_CHARACTER = 0x111111
export const SILHOUETTE_SET = 0xd6d6d6

type Materials = THREE.Material | THREE.Material[]

export class SilhouetteView {
  private active = false
  private readonly materials = new Map<THREE.Mesh, Materials>()
  private readonly visibility = new Map<THREE.Object3D, boolean>()
  private background: THREE.Color | THREE.Texture | null = null
  private fog: THREE.Fog | THREE.FogExp2 | null = null
  private readonly character = new THREE.MeshBasicMaterial({ color: SILHOUETTE_CHARACTER, toneMapped: false })
  private readonly set = new THREE.MeshBasicMaterial({ color: SILHOUETTE_SET, toneMapped: false })

  get enabled(): boolean { return this.active }

  /**
   * Called before every render while enabled. Idempotent: meshes loaded after the toggle (new characters, props)
   * are swapped on the next frame, and the background is pinned even if the environment was re-applied.
   */
  apply(scene: THREE.Scene, characters: Iterable<THREE.Object3D>, sets: Iterable<THREE.Object3D>): void {
    if (!this.active) {
      this.active = true
      this.background = scene.background as THREE.Color | THREE.Texture | null
      this.fog = scene.fog
    }
    if (!(scene.background instanceof THREE.Color) || scene.background.getHex() !== SILHOUETTE_BACKGROUND) scene.background = new THREE.Color(SILHOUETTE_BACKGROUND)
    scene.fog = null
    for (const child of scene.children) if (child.name === GROUND_NAME || child.name === GRID_NAME) this.hide(child)
    for (const root of characters) this.paint(root, this.character)
    for (const root of sets) this.paint(root, this.set)
  }

  restore(scene: THREE.Scene): void {
    if (!this.active) return
    for (const [mesh, material] of this.materials) { (mesh.material as THREE.Material).dispose(); mesh.material = material }
    for (const [object, visible] of this.visibility) object.visible = visible
    this.materials.clear(); this.visibility.clear()
    scene.background = this.background
    scene.fog = this.fog
    this.background = null; this.fog = null
    this.active = false
  }

  dispose(): void { this.character.dispose(); this.set.dispose() }

  private hide(object: THREE.Object3D): void {
    if (!this.visibility.has(object)) this.visibility.set(object, object.visible)
    object.visible = false
  }

  private paint(root: THREE.Object3D, material: THREE.Material): void {
    root.traverse((object) => {
      const kind = object.userData.t3dKind
      if (kind === CHARACTER_LABEL_KIND || kind === OBJECT_LABEL_KIND) { this.hide(object); return }
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      // One clone per mesh: environment tinting writes to `mesh.material.color` and must not leak across meshes;
      // the colour is re-pinned every frame because character tint can be re-applied after the swap.
      if (!this.materials.has(mesh)) { this.materials.set(mesh, mesh.material); mesh.material = material.clone() }
      const color = (mesh.material as THREE.MeshBasicMaterial).color
      if (color) color.copy((material as THREE.MeshBasicMaterial).color)
    })
  }
}
