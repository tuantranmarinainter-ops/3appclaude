import * as THREE from 'three'

// 连续重绘（拖拽 / 播放 / 相机移动）时把像素比压到 1.5，避免 2x/3x 屏片元量暴涨掉帧；
// 静止约 180ms 后再用清晰档（上限 2）补一帧，平时看起来不降级。
// 导出与缩略图走 render target / 离屏渲染器，不受视口像素比影响。
const SHARP_PIXEL_RATIO_CAP = 2
const MOTION_PIXEL_RATIO_CAP = 1.5
/** 相邻两次主视口渲染间隔小于它即视为连续运动；停下后同样等它过去再补清晰帧。 */
export const PIXEL_RATIO_SETTLE_MS = 180

export function viewportPixelRatio(devicePixelRatio: number, inMotion: boolean): number {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1
  return Math.min(dpr, inMotion ? MOTION_PIXEL_RATIO_CAP : SHARP_PIXEL_RATIO_CAP)
}

export function createCanvasRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(viewportPixelRatio(window.devicePixelRatio, false))
  return renderer
}

export function fitRenderer(r: THREE.WebGLRenderer): boolean {
  const c = r.domElement
  const w = c.clientWidth
  const h = c.clientHeight
  if (w === 0 || h === 0) return false
  const pr = r.getPixelRatio()
  if (c.width !== Math.floor(w * pr) || c.height !== Math.floor(h * pr)) {
    r.setSize(w, h, false)
  }
  return true
}

/**
 * 主视口按运动状态切像素比。切换必须发生在同一帧的渲染之前：
 * setPixelRatio 会重设画布尺寸并清空内容，提前切会闪一帧空白。
 */
export class MotionPixelRatio {
  private lastRenderAt = Number.NEGATIVE_INFINITY
  private settleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly onSettle: () => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** 每次主视口渲染前调用。 */
  apply(renderer: THREE.WebGLRenderer, devicePixelRatio: number): void {
    const t = this.now()
    const inMotion = t - this.lastRenderAt < PIXEL_RATIO_SETTLE_MS
    this.lastRenderAt = t
    const ratio = viewportPixelRatio(devicePixelRatio, inMotion)
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio)
    this.clearTimer()
    if (inMotion) {
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null
        this.onSettle()
      }, PIXEL_RATIO_SETTLE_MS)
    }
  }

  dispose(): void {
    this.clearTimer()
    this.lastRenderAt = Number.NEGATIVE_INFINITY
  }

  private clearTimer(): void {
    if (this.settleTimer === null) return
    clearTimeout(this.settleTimer)
    this.settleTimer = null
  }
}
