import * as THREE from 'three'
import { DEFAULT_GROUND_OPACITY } from '../../contract/groundOpacity'
import { isEmptyDirectorGenesis, resolveSkyColor } from '../../contract/skyColor'
import type { DirectorDocument } from '../../contract/types'
import { EDITOR_LAYER, GRID_LAYER } from '../core/Layers'
import { GROUND_GRID_SIZE, createGroundGrid } from './groundGrid'
import type { StageGraph } from './graph'
import { makeLabel, topYInParent } from './labels'
import { clearSkinnedRaycastBounds } from './skinnedBounds'
import type { CharInstance } from './types'
import { isTemplateShared } from './templateShared'

export const GROUND_NAME = 't3d-ground'
export const GRID_NAME = 't3d-grid'
/** Mặt sàn UV checker của lớp xem N6 (engine/objects/groundChecker.ts); trạng thái tính từ tài liệu không bao giờ hiện nó. */
export const GROUND_CHECKER_NAME = 't3d-ground-checker'
export const CHARACTER_LABEL_KIND = 'characterLabel'
export const OBJECT_LABEL_KIND = 'objectLabel'
/** 可见地面边长（米）。与地面网格外沿重合，路径绘制的有效范围必须与它一致。 */
export const GROUND_SIZE = GROUND_GRID_SIZE
/** 地面固有色 RGB 30, 30, 30。透明地面透出的也是同一档亮度。 */
const GROUND_COLOR = 0x1e1e1e
/** 必须大于 PathObject 的 renderOrder（8/9），小于各类 20+ 的叠加层。 */
const GROUND_TRANSLUCENT_RENDER_ORDER = 10

export function addEnvironment(scene: THREE.Scene, doc: DirectorDocument): void {
  applySkyColor(scene, doc)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.0))
  const dir = new THREE.DirectionalLight(0xffffff, 1.8)
  dir.position.set(5, 10, 7)
  scene.add(dir)
  scene.add(new THREE.AmbientLight(0xffffff, 0.3))

  const grid = createGroundGrid()
  grid.name = GRID_NAME
  scene.add(grid)
  ensureGround(scene, doc)
}

type NodeLookup = ReadonlyMap<string, DirectorDocument['content']['nodes'][number]>

export function applyEnvironment(graph: StageGraph): void {
  const doc = graph.doc
  if (!doc) return
  applySkyColor(graph.scene, doc)
  ensureGround(graph.scene, doc)
  // Sàn checker chỉ được lớp xem bật ngay trước khi vẽ khung tương tác; mọi lần tính từ tài liệu đều tắt nó,
  // để đường xuất/thumbnail (evaluate rồi render thẳng) không bao giờ dính checker.
  const checker = sceneChildByName(graph.scene, GROUND_CHECKER_NAME)
  if (checker) checker.visible = false
  const byId: NodeLookup = new Map(doc.content.nodes.map((n) => [n.id, n]))
  applyCharacterLook(graph, doc, byId)
  applyPropAndPrimitiveLook(graph, byId)
}

function applyCharacterLook(graph: StageGraph, doc: DirectorDocument, byId: NodeLookup): void {
  const sceneLabels = doc.content.environment.display?.characterLabelsVisible !== false
  for (const [id, ch] of graph.characters) {
    const node = byId.get(id)
    const colorHex = node?.character?.appearance.color ?? '#cccccc'
    const showLabel = node?.character?.label?.showLabel !== false
    const name = node?.name ?? id
    const labelScale = (node?.character?.label?.scale || 1) * 0.7
    const yOffset = node?.character?.label?.yOffset ?? 0
    const labelVisible = sceneLabels && showLabel
    const sig = `${colorHex}|${labelVisible}|${name}|${labelScale}|${yOffset}`
    if (ch.root.userData.t3dLook !== sig) {
      const prev = typeof ch.root.userData.t3dLook === 'string' ? ch.root.userData.t3dLook : ''
      ch.root.userData.t3dLook = sig
      if (!prev || prev.split('|')[0] !== colorHex) tintCharacter(ch, colorHex)
      syncCharacterLabel(ch, name, colorHex, labelVisible, labelScale)
    }
    // 姿势、动作片段和关节拖拽都会改骨骼。标签和「编辑姿势」按钮都锚在标签高度上，
    // 必须按当前蒙皮包围盒重算，不能停在角色刚载入时的那一版。
    placeCharacterLabel(ch, yOffset)
  }
}

function tintCharacter(ch: CharInstance, colorHex: string): void {
  const color = new THREE.Color(colorHex)
  ch.inner.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.userData.t3dTint) return
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const item of list) {
      const std = item as THREE.MeshStandardMaterial
      if (std.color) std.color.copy(color)
    }
  })
}

function syncCharacterLabel(
  ch: CharInstance,
  name: string,
  colorHex: string,
  visible: boolean,
  scale: number,
): void {
  let sprite: THREE.Sprite | undefined
  for (const child of ch.root.children) {
    if (child.userData.t3dKind === CHARACTER_LABEL_KIND) {
      sprite = child as THREE.Sprite
      break
    }
  }
  if (!sprite) {
    clearSkinnedRaycastBounds(ch.inner)
    sprite = makeLabel(name, colorHex, scale)
    sprite.userData.t3dKind = CHARACTER_LABEL_KIND
    sprite.position.set(0, 0, 0)
    sprite.traverse((o) => {
      o.layers.set(EDITOR_LAYER)
      o.layers.enable(GRID_LAYER)
    })
    ch.root.add(sprite)
  } else if (sprite.userData.t3dLabelSig !== `${name}|${colorHex}|${scale}`) {
    const next = makeLabel(name, colorHex, scale)
    next.userData.t3dKind = CHARACTER_LABEL_KIND
    next.position.copy(sprite.position)
    next.traverse((o) => {
      o.layers.set(EDITOR_LAYER)
      o.layers.enable(GRID_LAYER)
    })
    ch.root.remove(sprite)
    const mat = sprite.material as THREE.SpriteMaterial
    mat.map?.dispose()
    mat.dispose()
    ch.root.add(next)
    sprite = next
  }
  sprite.userData.t3dLabelSig = `${name}|${colorHex}|${scale}`
  sprite.visible = visible
}

function placeCharacterLabel(ch: CharInstance, yOffset: number): void {
  const sprite = ch.root.children.find((child) => child.userData.t3dKind === CHARACTER_LABEL_KIND)
  if (!sprite) return
  sprite.position.y = topYInParent(ch.inner, ch.root) + 0.18 + yOffset
  clearSkinnedRaycastBounds(ch.inner)
}


function applyPropAndPrimitiveLook(graph: StageGraph, byId: NodeLookup): void {
  for (const [id, root] of graph.props) {
    const node = byId.get(id)
    const colorHex = node?.prop?.appearance?.color ?? '#cccccc'
    syncObjectLabel(root, node?.name ?? id, colorHex, node?.prop?.label?.showLabel === true)
    const prev = typeof root.userData.t3dLook === 'string' ? root.userData.t3dLook : ''
    if (prev === colorHex) continue
    root.userData.t3dLook = colorHex
    tintObjectTree(root, colorHex)
  }
  for (const [id, mesh] of graph.primitives) {
    const node = byId.get(id)
    const parent = node?.parentId ? byId.get(node.parentId) : undefined
    const colorHex =
      node?.primitive?.appearance?.color ?? parent?.group?.appearance.color ?? '#cccccc'
    syncObjectLabel(mesh, node?.name ?? id, colorHex, node?.primitive?.label?.showLabel === true)
    const prev = typeof mesh.userData.t3dLook === 'string' ? mesh.userData.t3dLook : ''
    if (prev === colorHex) continue
    mesh.userData.t3dLook = colorHex
    tintObjectTree(mesh, colorHex)
  }
}

function syncObjectLabel(object: THREE.Object3D, name: string, colorHex: string, visible: boolean): void {
  let sprite = object.children.find((child) => child.userData.t3dKind === OBJECT_LABEL_KIND) as THREE.Sprite | undefined
  if (!sprite && !visible) return
  const signature = `${name}|${colorHex}`
  if (!sprite) {
    sprite = makeLabel(name, colorHex, 0.7)
    sprite.userData.t3dKind = OBJECT_LABEL_KIND
    sprite.userData.t3dLabelSig = signature
    sprite.position.set(0, topYInParent(object, object) + 0.18, 0)
    sprite.traverse((o) => {
      o.layers.set(EDITOR_LAYER)
      o.layers.enable(GRID_LAYER)
    })
    object.add(sprite)
  } else if (sprite.userData.t3dLabelSig !== signature) {
    const next = makeLabel(name, colorHex, 0.7)
    next.userData.t3dKind = OBJECT_LABEL_KIND
    next.userData.t3dLabelSig = signature
    next.position.copy(sprite.position)
    next.traverse((o) => {
      o.layers.set(EDITOR_LAYER)
      o.layers.enable(GRID_LAYER)
    })
    object.remove(sprite)
    const mat = sprite.material as THREE.SpriteMaterial
    mat.map?.dispose()
    mat.dispose()
    object.add(next)
    sprite = next
  }
  sprite.visible = visible
}

function tintObjectTree(root: THREE.Object3D, colorHex: string): void {
  const color = new THREE.Color(colorHex)
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.userData.t3dTint) return
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const item of list) {
      const std = item as THREE.MeshStandardMaterial
      if (std.color) std.color.copy(color)
    }
  })
}

function applySkyColor(scene: THREE.Scene, doc: DirectorDocument): void {
  const emptyGenesis = isEmptyDirectorGenesis(doc.content.nodes)
  const sky = resolveSkyColor(doc.content.environment.background?.skyColor, emptyGenesis)
  if (scene.background instanceof THREE.Color) scene.background.set(sky)
  else scene.background = new THREE.Color(sky)
}

// 地面和网格都是 scene 的直接子节点；getObjectByName 会把所有角色骨骼一起遍历，每次求值都跑。
function sceneChildByName(scene: THREE.Scene, name: string): THREE.Object3D | undefined {
  return scene.children.find((child) => child.name === name)
}

function ensureGround(scene: THREE.Scene, doc: DirectorDocument): void {
  const display = doc.content.environment.display
  const visible = display?.groundVisible !== false
  let ground = sceneChildByName(scene, GROUND_NAME) as THREE.Mesh | undefined
  if (!ground) {
    ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshBasicMaterial({
        color: GROUND_COLOR,
        toneMapped: false,
        // Let scene floors at groundHeight win depth testing without moving either surface.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        transparent: true,
        opacity: display?.groundOpacity ?? DEFAULT_GROUND_OPACITY,
      }),
    )
    ground.name = GROUND_NAME
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
  }
  ground.visible = visible
  const grid = sceneChildByName(scene, GRID_NAME)
  if (grid) grid.visible = visible
  ground.position.y = display?.groundHeight ?? 0
  const material = ground.material
  if (material && !Array.isArray(material)) {
    const std = material as THREE.MeshBasicMaterial
    std.color.setHex(GROUND_COLOR)
    std.toneMapped = false
    std.transparent = true
    std.opacity = display?.groundOpacity ?? DEFAULT_GROUND_OPACITY
    applyGroundDepthMode(ground, std)
  }
}

/**
 * 地面完全不透明时：先画、写深度，把地面以下的东西挡住。
 * 半透明时：不写深度，并排到路径（renderOrder 8/9）之后再画——
 * 路径先绘制、通过深度测试，地面随后叠在上面，地面以下的路径就
 * 透过半透明地面按透明度衰减显示；地面之上的路径深度更近，不受影响。
 */
function applyGroundDepthMode(ground: THREE.Mesh, material: THREE.MeshBasicMaterial): void {
  const translucent = material.opacity < 1
  material.depthWrite = !translucent
  ground.renderOrder = translucent ? GROUND_TRANSLUCENT_RENDER_ORDER : 0
}

export function disposeSceneChildren(scene: THREE.Scene): void {
  for (const child of [...scene.children]) {
    child.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      const geometry = mesh.geometry
      if (geometry && !isTemplateShared(geometry)) geometry.dispose?.()
      const material = mesh.material
      if (!material) return
      const list = Array.isArray(material) ? material : [material]
      for (const item of list) {
        const std = item as THREE.MeshStandardMaterial
        // 模板自带的材质要留给模块级缓存复用；每实例新建/克隆的材质才由这里释放。
        if (isTemplateShared(std)) continue
        if (std.map && !isTemplateShared(std.map)) std.map.dispose?.()
        std.dispose?.()
      }
    })
    scene.remove(child)
  }
  scene.background = null
}
