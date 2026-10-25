import * as THREE from 'three'
import {
  normalizeGroundViewOptions,
  type GroundViewOptions,
} from '../../contract/groundView'
import { GRID_NAME, GROUND_CHECKER_NAME, GROUND_NAME, GROUND_SIZE } from './environment'

/** Trục X vẽ đỏ, trục Z vẽ xanh lá/xanh dương (quy ước lưới Minecraft/BBS). */
export const CHECKER_AXIS_X_COLOR = '#e5484d'
export const CHECKER_AXIS_Z_COLOR = '#3e8bff'

const BW_DARK = '#101010'
const BW_LIGHT = '#e8e8e8'
const NUMBERS_DARK = '#222222'
const NUMBERS_LIGHT = '#2e2e2e'

/** Bảng 16 màu kiểu UV checker cổ điển, lặp theo lưới 4×4 ô. */
const COLOR_PALETTE = [
  '#8a8a8a', '#c94f4f', '#c98a4f', '#c9c44f',
  '#7ac94f', '#4fc97a', '#4fc9c0', '#4f8ac9',
  '#4f4fc9', '#8a4fc9', '#c94fb0', '#c94f6a',
  '#a8a8a8', '#d97b7b', '#d9b07b', '#7bd9a8',
] as const

/** Màu của một ô theo chỉ số đã dời gốc về tâm sàn (ô chứa gốc toạ độ luôn cùng màu). */
export function checkerCellColor(style: GroundViewOptions['style'], col: number, row: number): string {
  const odd = (((col + row) % 2) + 2) % 2 === 1
  if (style === 'color') {
    const c = (((col % 4) + 4) % 4) as number
    const r = (((row % 4) + 4) % 4) as number
    return COLOR_PALETTE[r * 4 + c]!
  }
  if (style === 'numbers') return odd ? NUMBERS_LIGHT : NUMBERS_DARK
  return odd ? BW_DARK : BW_LIGHT
}

export interface CheckerLabel {
  text: string
  x: number
  z: number
}

export interface CheckerPlan {
  cellsAcross: number
  cellMeters: number
  labels: CheckerLabel[]
}

/** Kế hoạch vẽ thuần dữ liệu (không cần canvas) để test được: số ô + vị trí các số toạ độ. */
export function buildCheckerPlan(options: GroundViewOptions, sizeMeters: number = GROUND_SIZE): CheckerPlan {
  const cellsAcross = Math.max(1, Math.round(sizeMeters / options.cellSize))
  const labels: CheckerLabel[] = []
  if (options.style === 'numbers') {
    const step = 5
    const half = sizeMeters / 2
    for (let v = -half + step; v < half; v += step) {
      if (v === 0) continue
      labels.push({ text: String(v), x: v, z: 0 })
      labels.push({ text: String(v), x: 0, z: v })
    }
    labels.push({ text: '0', x: 0, z: 0 })
  }
  return { cellsAcross, cellMeters: sizeMeters / cellsAcross, labels }
}

/**
 * Vẽ checker lên canvas: canvas trái→phải là x −half→+half, trên→dưới là z −half→+half
 * (khớp UV của PlaneGeometry xoay −90° quanh X với flipY mặc định).
 */
export function paintCheckerCanvas(
  canvas: HTMLCanvasElement,
  options: GroundViewOptions,
  sizeMeters: number = GROUND_SIZE,
): void {
  const plan = buildCheckerPlan(options, sizeMeters)
  const px = canvas.width
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const cellPx = px / plan.cellsAcross
  const origin = plan.cellsAcross / 2
  for (let row = 0; row < plan.cellsAcross; row++) {
    for (let col = 0; col < plan.cellsAcross; col++) {
      ctx.fillStyle = checkerCellColor(options.style, col - origin, row - origin)
      ctx.fillRect(col * cellPx, row * cellPx, Math.ceil(cellPx), Math.ceil(cellPx))
    }
  }
  const centerPx = px / 2
  const axisHalf = Math.max(2, Math.round(px * 0.0016))
  ctx.fillStyle = CHECKER_AXIS_X_COLOR
  ctx.fillRect(0, centerPx - axisHalf, px, axisHalf * 2)
  ctx.fillStyle = CHECKER_AXIS_Z_COLOR
  ctx.fillRect(centerPx - axisHalf, 0, axisHalf * 2, px)
  if (plan.labels.length > 0) {
    const half = sizeMeters / 2
    const fontPx = Math.max(18, Math.min(42, Math.round(cellPx * 1.05)))
    ctx.font = `700 ${fontPx}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const label of plan.labels) {
      const cx = ((label.x + half) / sizeMeters) * px
      const cy = ((label.z + half) / sizeMeters) * px
      const w = ctx.measureText(label.text).width + 12
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
      ctx.fillRect(cx - w / 2, cy - fontPx * 0.78, w, fontPx * 1.56)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label.text, cx, cy + 1)
    }
  }
}

export type CheckerTextureFactory = (options: GroundViewOptions) => THREE.Texture

function defaultTextureFactory(options: GroundViewOptions): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 2048
  paintCheckerCanvas(canvas, options)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/**
 * Lớp xem sàn UV checker (N6): một mặt phẳng riêng nằm trên sàn tài liệu, chỉ được Stage bật
 * ngay trước khi vẽ khung tương tác. Trạng thái tính từ tài liệu luôn tắt nó (applyEnvironment),
 * nên render/xuất/thumbnail không bao giờ dính checker. Không ghi gì vào tài liệu.
 */
export class GroundCheckerView {
  private plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null
  private textureSig = ''
  private activeFlag = false

  constructor(private readonly textureFactory: CheckerTextureFactory = defaultTextureFactory) {}

  get active(): boolean {
    return this.activeFlag
  }

  apply(scene: THREE.Scene, options: GroundViewOptions, groundHeight = 0): void {
    const normalized = normalizeGroundViewOptions(options)
    const plane = this.ensurePlane(scene)
    plane.visible = true
    plane.position.y = groundHeight + 0.004
    const sig = `${normalized.style}|${normalized.cellSize}`
    if (sig !== this.textureSig) {
      plane.material.map?.dispose()
      plane.material.map = this.textureFactory(normalized)
      plane.material.needsUpdate = true
      this.textureSig = sig
    }
    plane.material.opacity = normalized.opacity
    plane.material.depthWrite = normalized.opacity >= 1
    plane.renderOrder = normalized.opacity >= 1 ? 1 : 10
    for (const child of scene.children) {
      if (child.name === GROUND_NAME || child.name === GRID_NAME) child.visible = false
    }
    this.activeFlag = true
  }

  /** Tắt checker và trả sàn/lưới về đúng trạng thái tài liệu. */
  hide(scene: THREE.Scene, docGroundVisible: boolean): void {
    if (this.plane) this.plane.visible = false
    if (!this.activeFlag) return
    for (const child of scene.children) {
      if (child.name === GROUND_NAME || child.name === GRID_NAME) child.visible = docGroundVisible
    }
    this.activeFlag = false
  }

  dispose(scene?: THREE.Scene): void {
    if (this.plane) {
      this.plane.material.map?.dispose()
      this.plane.material.dispose()
      this.plane.geometry.dispose()
      if (scene) scene.remove(this.plane)
      this.plane = null
    }
    this.textureSig = ''
    this.activeFlag = false
  }

  private ensurePlane(scene: THREE.Scene): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    if (!this.plane) {
      const existing = scene.children.find((child) => child.name === GROUND_CHECKER_NAME)
      if (existing) {
        this.plane = existing as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
      } else {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
          new THREE.MeshBasicMaterial({
            toneMapped: false,
            transparent: true,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          }),
        )
        mesh.name = GROUND_CHECKER_NAME
        mesh.rotation.x = -Math.PI / 2
        mesh.userData.t3dKind = 'groundChecker'
        mesh.raycast = () => undefined
        this.plane = mesh
      }
    }
    if (this.plane.parent !== scene) scene.add(this.plane)
    return this.plane
  }
}
