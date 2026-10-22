import { CompassView } from '../interact/camera/CompassView'
import * as THREE from 'three'
import { type EditorViewDirection } from '../interact/camera/axisView'
import { FALLBACK_ASPECT } from '../../contract/aspectRatio'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CamInstance } from '../objects/types'
import { CAMERA_RESET_DURATION_MS, DEFAULT_RESET_CAMERA_FOV } from '../interact/camera/constants'
import { EditorCameraController } from '../interact/camera/EditorCameraController'
import { computeFocusCameraPose } from '../interact/frameSelection'
import { UnifiedGizmo, type GizmoDuplicateItem } from '../interact/UnifiedGizmo'
import { computeViewCenterPivot } from '../interact/camera/viewCenterPivot'
import { bindViewportNavigation, type ViewportNavPickHandlers } from '../interact/ViewportNavigation'
import { createCanvasRenderer, fitRenderer, MotionPixelRatio } from './Renderer'
import { exportCameraLayerMask } from './Layers'
import { SelectionOutline } from './SelectionOutline'

/** 小于这个尺寸的机位预览已经看不出内容，不值得为它多渲一遍整场景。 */
const MIN_PREVIEW_PX = 48

/** 取景框占主画布的上限，必须与 viewport.css `.t3d-pilot-frame` 的 86cqw / 78cqh 一致。 */
const FRAME_MAX_WIDTH = 0.86
const FRAME_MAX_HEIGHT = 0.78

/** 取景框在画布里的尺寸：宽高比固定，居中，先撞到哪条上限就按哪条缩。 */
export function framedRect(canvasWidth: number, canvasHeight: number, aspect: number): { width: number; height: number } {
  const width = Math.min(FRAME_MAX_WIDTH * canvasWidth, FRAME_MAX_HEIGHT * canvasHeight * aspect)
  return { width, height: width / aspect }
}

/** 按画幅在画布里撑到最大并居中，余下的留黑边；机位预览和成片监看共用。 */
export function letterboxRect(canvasWidth: number, canvasHeight: number, aspect: number): { x: number; y: number; width: number; height: number } {
  let width = canvasWidth
  let height = canvasWidth / aspect
  if (height > canvasHeight) {
    height = canvasHeight
    width = canvasHeight * aspect
  }
  return { x: (canvasWidth - width) / 2, y: (canvasHeight - height) / 2, width, height }
}

/** Largest centered frame for a film aspect inside the viewport. */
export function filmFrameRect(viewW: number, viewH: number, aspect: number): { x: number; y: number; width: number; height: number } {
  if (![viewW, viewH, aspect].every(Number.isFinite) || viewW <= 0 || viewH <= 0 || aspect <= 0) {
    throw new RangeError('Viewport dimensions and film aspect must be positive finite numbers')
  }
  return letterboxRect(viewW, viewH, aspect)
}

/** Film framing only affects a live camera view while BBS look is active. */
export function filmFrameAspectForView(enabled: boolean, cameraView: boolean, aspect: number | null): number | null {
  if (!enabled || !cameraView || aspect === null) return null
  if (!Number.isFinite(aspect) || aspect <= 0) throw new RangeError('Film aspect must be a positive finite number')
  return aspect
}

export function viewportLetterboxRect(
  width: number,
  height: number,
  filmAspect: number | null,
  letterboxAspect: number | null,
): { x: number; y: number; width: number; height: number } | null {
  // Film framing uses the normal viewport render with an expanded camera frustum; the overlay shades outside the frame.
  if (filmAspect !== null) return null
  return letterboxAspect ? letterboxRect(width, height, letterboxAspect) : null
}

/** Project the film-sized view onto the largest centered area of the editor canvas. */
export function applyFilmFrameProjection(cam: THREE.PerspectiveCamera, width: number, height: number, aspect: number): void {
  const frame = filmFrameRect(width, height, aspect)
  const view = cam.view
  const same = view?.enabled
    && Math.abs(view.fullWidth - frame.width) < 1e-3
    && Math.abs(view.fullHeight - frame.height) < 1e-3
    && view.width === width
    && view.height === height
  if (same) return
  cam.aspect = aspect
  cam.setViewOffset(frame.width, frame.height, (frame.width - width) / 2, (frame.height - height) / 2, width, height)
}

/** Apply the existing viewport projection policy, with film framing as a conditional override. */
export function applyViewportProjection(
  cam: THREE.PerspectiveCamera,
  width: number,
  height: number,
  box: { width: number; height: number } | null,
  filmAspect: number | null,
  framedAspect: number | null,
): void {
  if (box) {
    const aspect = box.width / box.height
    if (!cam.view && Math.abs(cam.aspect - aspect) <= 1e-3) return
    if (cam.view) cam.clearViewOffset()
    cam.aspect = aspect
    cam.updateProjectionMatrix()
    return
  }
  if (filmAspect) {
    applyFilmFrameProjection(cam, width, height, filmAspect)
    return
  }
  if (framedAspect && framedAspect > 0) {
    const frame = framedRect(width, height, framedAspect)
    const view = cam.view
    const same = view?.enabled
      && Math.abs(view.fullWidth - frame.width) < 1e-3
      && Math.abs(view.fullHeight - frame.height) < 1e-3
      && view.width === width
      && view.height === height
    if (same) return
    cam.aspect = framedAspect
    cam.setViewOffset(frame.width, frame.height, (frame.width - width) / 2, (frame.height - height) / 2, width, height)
    return
  }
  const aspect = width / height
  if (cam.view) cam.clearViewOffset()
  else if (Math.abs(cam.aspect - aspect) <= 1e-3) return
  cam.aspect = aspect
  cam.updateProjectionMatrix()
}

const _clearColor = new THREE.Color()

export type GizmoMode = 'select' | 'translate' | 'rotate' | 'scale'

export const DEFAULT_EDITOR_CAMERA = {
  position: [7, 4.5, 9] as const,
  target: [0, 1, 0] as const,
  fov: 50,
}

export interface ViewportHost {
  onInvalidate(): void
  /** 只有编辑相机变了：预览画的是机位，不用重画。 */
  onInvalidateMain(): void
  onEditorCameraChange(): void
  onContextLostChange(lost: boolean): void
  onContextRestored(): void
  getSceneMeshes(): THREE.Object3D[]
  getSceneBounds(): THREE.Box3
  getOrbitPivot(): { x: number; y: number; z: number }
}

export class DualViewport {
  rendererMain: THREE.WebGLRenderer | null = null
  rendererPreview: THREE.WebGLRenderer | null = null
  controls: OrbitControls | null = null
  unified: UnifiedGizmo | null = null
  cameraRig: EditorCameraController | null = null
  private unbindNavigation: (() => void) | null = null
  private navHandlers: ViewportNavPickHandlers | null = null
  private navEnabled = true
  private leftPointerReserved = false
  private gizmoSuppressed = false
  private unbindBoxSelectGuard: (() => void) | null = null
  private focusRaf = 0
  private readonly compass = new CompassView()

  get viewCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.compass.direction ? this.compass.camera : this.editorCamera
  }

  get viewDirection(): EditorViewDirection | null { return this.compass.direction }

  private exitCompassView(): void {
    if (!this.compass.direction) return
    this.compass.exit()
    if (this.unified) this.unified.camera = this.editorCamera
    this.cameraRig?.snapFromCamera()
    this.host.onEditorCameraChange()
    this.host.onInvalidateMain()
  }
  followMode = false
  cameraPilot = false
  jointBusy = false
  previewAspect = FALLBACK_ASPECT
  /** 非空时主视口按机位取景：机位画面正好落在居中的取景框里，框外是延伸出去的场景。 */
  framedAspect: number | null = null
  /** 非空时主视口是成片监看：机位画面按画幅撑满画布，四周黑边，不露框外场景。 */
  letterboxAspect: number | null = null
  private filmAspect: number | null = null
  private filmFramePreviewEnabled = false
  /** 要描橙色外轮廓的选中对象根节点；由 Stage 每帧按 gizmo 同一套显隐条件填，空数组就是不描。 */
  outlineRoots: readonly THREE.Object3D[] = []
  private selectionOutline: SelectionOutline | null = null
  private readonly mainPixelRatio = new MotionPixelRatio(() => this.host.onInvalidateMain())
  private lostMain = false
  private lostPreview = false
  private unbindMain: (() => void) | null = null
  private unbindPreview: (() => void) | null = null
  private tcAttachedId: string | null = null
  private syncedTargets = new Map<string, THREE.Object3D>()
  private followPrev: { id: string; position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null
  private preFollow: {
    position: THREE.Vector3
    quaternion: THREE.Quaternion
    target: THREE.Vector3
    fov: number
  } | null = null
  /** 操控中的机位 id；属性面板改焦距只落到机位实例，视口相机要靠它逐帧跟。 */
  private pilotCameraId: string | null = null
  private prePilot: {
    position: THREE.Vector3
    quaternion: THREE.Quaternion
    target: THREE.Vector3
    fov: number
  } | null = null

  constructor(
    private readonly editorCamera: THREE.PerspectiveCamera,
    private readonly host: ViewportHost,
  ) {}

  /** Host hook: a null aspect clears the stored film frame for this viewport. */
  setFilmFrameAspect(aspect: number | null): void {
    if (aspect !== null && (!Number.isFinite(aspect) || aspect <= 0)) {
      throw new RangeError('Film aspect must be a positive finite number or null')
    }
    this.filmAspect = aspect
  }

  /** Host hook: keep film framing restricted to BBS look camera views. */
  setFilmFramePreviewEnabled(enabled: boolean): void {
    this.filmFramePreviewEnabled = enabled
  }

  attachMain(canvas: HTMLCanvasElement): void {
    this.rendererMain = createCanvasRenderer(canvas)
    this.controls = new OrbitControls(this.editorCamera, canvas)
    this.controls.target.set(...DEFAULT_EDITOR_CAMERA.target)
    this.controls.enableDamping = false
    this.controls.enabled = false
    this.controls.enableZoom = false
    this.controls.enableRotate = false
    this.controls.enablePan = false
    this.controls.addEventListener('change', this.onOrbitChange)
    this.unified = new UnifiedGizmo(this.editorCamera, canvas)
    this.unified.addEventListener('change', this.onOrbitChange)
    // 按需渲染：拖拽时环视已关掉，必须由 gizmo 自己 invalidate。
    this.unified.addEventListener('objectChange', this.onOrbitChange)
    this.unified.addEventListener('dragging-changed', this.onOrbitChange)
    this.cameraRig = new EditorCameraController(this.editorCamera, {
      invalidate: () => {
        this.host.onEditorCameraChange()
        this.host.onInvalidateMain()
      },
      beforeNavigate: () => this.exitCompassView(),
      getSceneMeshes: () => this.host.getSceneMeshes(),
      getOrbitPivot: () => this.host.getOrbitPivot(),
      syncLookTarget: (_position, target) => {
        if (this.controls) this.controls.target.copy(target)
      },
    })
    this.resetEditorView()
    this.unbindBoxSelectGuard = this.bindBoxSelectGuard(canvas.parentElement ?? canvas)
    this.unbindNavigation = bindViewportNavigation({
      camera: this.cameraRig,
      canvas,
      container: canvas.parentElement ?? canvas,
      isHandleActive: () => !this.gizmoSuppressed
        && (!!this.unified?.dragging || this.unified?.axis != null || this.jointBusy),
      isEnabled: () => this.navEnabled && !this.followMode,
      reservesLeftPointer: () => this.leftPointerReserved,
      getHandlers: () => this.navHandlers,
    })
    this.tcAttachedId = null
    this.unbindMain = this.bindCanvas(canvas, 'main')
    this.host.onInvalidate()
  }

  attachTcHelper(scene: THREE.Scene): void {
    if (this.unified) {
      if (this.unified.visual.parent !== scene) scene.add(this.unified.visual)
      if (this.unified.pivot.parent !== scene) scene.add(this.unified.pivot)
    }
    this.host.onInvalidate()
  }

  detachMain(): void {
    this.exitCompassView()
    cancelAnimationFrame(this.focusRaf)
    this.unbindBoxSelectGuard?.()
    this.unbindBoxSelectGuard = null
    this.unbindNavigation?.()
    this.unbindNavigation = null
    this.cameraRig = null
    this.unified?.removeEventListener('change', this.onOrbitChange)
    this.unified?.removeEventListener('objectChange', this.onOrbitChange)
    this.unified?.removeEventListener('dragging-changed', this.onOrbitChange)
    this.unified?.dispose()
    this.unified = null
    this.unbindMain?.()
    this.unbindMain = null
    this.lostMain = false
    this.syncLost()
    this.tcAttachedId = null
    this.controls?.removeEventListener('change', this.onOrbitChange)
    this.controls?.dispose()
    this.controls = null
    this.selectionOutline?.dispose()
    this.selectionOutline = null
    this.mainPixelRatio.dispose()
    this.rendererMain?.dispose()
    this.rendererMain = null
  }

  attachPreview(canvas: HTMLCanvasElement): void {
    this.rendererPreview = createCanvasRenderer(canvas)
    this.unbindPreview = this.bindCanvas(canvas, 'preview')
    this.host.onInvalidate()
  }

  mainCanvas(): HTMLCanvasElement | null {
    return this.rendererMain?.domElement ?? null
  }

  mainAspect(): number {
    const el = this.rendererMain?.domElement
    const w = el?.clientWidth ?? 0
    const h = el?.clientHeight ?? 0
    if (w > 0 && h > 0) return w / h
    return FALLBACK_ASPECT
  }

  detachPreview(): void {
    this.unbindPreview?.()
    this.unbindPreview = null
    this.lostPreview = false
    this.syncLost()
    this.rendererPreview?.dispose()
    this.rendererPreview = null
  }

  /**
   * Ctrl/Cmd + 左键拖拽固定走框选：在容器捕获阶段先把 Gumball 关掉，
   * 否则手柄命中会抢走这次 pointerdown，框选永远起不来。
   */
  private bindBoxSelectGuard(container: HTMLElement): () => void {
    const suppress = (e: PointerEvent) => {
      if (e.button !== 0 || (!e.ctrlKey && !e.metaKey)) return
      const gizmo = this.unified
      if (!gizmo || gizmo.dragging) return
      gizmo.axis = null
      gizmo.enabled = false
      this.gizmoSuppressed = true
    }
    const restore = () => {
      if (!this.gizmoSuppressed) return
      this.gizmoSuppressed = false
      if (this.unified) this.unified.enabled = true
    }
    container.addEventListener('pointerdown', suppress, true)
    window.addEventListener('pointerup', restore)
    window.addEventListener('pointercancel', restore)
    return () => {
      restore()
      container.removeEventListener('pointerdown', suppress, true)
      window.removeEventListener('pointerup', restore)
      window.removeEventListener('pointercancel', restore)
    }
  }

  setOrbitEnabled(enabled: boolean): void {
    this.navEnabled = enabled
    this.cameraRig?.setEnabled(enabled && !this.followMode)
  }

  setLeftPointerReserved(reserved: boolean): void {
    this.leftPointerReserved = reserved
  }

  setNavPickHandlers(handlers: ViewportNavPickHandlers | null): void {
    this.navHandlers = handlers
  }

  setGizmoDuplicateHandler(fn: ((items: GizmoDuplicateItem[]) => void) | null): void {
    this.unified?.setDuplicateHandler(fn)
  }

  gizmoIsDuplicating(): boolean {
    return this.unified?.isDuplicating() ?? false
  }

  consumeGizmoDuplicateDrag(): boolean {
    return this.unified?.consumeDuplicateDrag() ?? false
  }

  orbitLookAt(): THREE.Vector3 | null {
    return this.controls ? this.controls.target.clone() : null
  }

  /** 当前画面正中的场景点，右键环绕绕这里转，不跟选中物体走。 */
  viewCenterPivot(): { x: number; y: number; z: number } {
    const look = this.orbitLookAt()
    return computeViewCenterPivot(
      this.editorCamera,
      this.host.getSceneMeshes(),
      look ? { x: look.x, y: look.y, z: look.z } : null,
    )
  }

  setEditorView(direction: EditorViewDirection): void {
    if (this.cameraPilot || this.followMode) return
    cancelAnimationFrame(this.focusRaf)
    this.compass.fit(direction, this.host.getSceneBounds(), this.mainAspect(), this.editorCamera)
    this.controls?.target.copy(this.compass.center)
    if (this.unified) this.unified.camera = this.viewCamera
    this.cameraRig?.snapFromCamera()
    this.host.onEditorCameraChange()
    this.host.onInvalidateMain()
  }

  resetEditorView(): void {
    this.exitCompassView()
    const [px, py, pz] = DEFAULT_EDITOR_CAMERA.position
    const [tx, ty, tz] = DEFAULT_EDITOR_CAMERA.target
    this.editorCamera.position.set(px, py, pz)
    if (this.editorCamera.fov !== DEFAULT_EDITOR_CAMERA.fov) {
      this.editorCamera.fov = DEFAULT_EDITOR_CAMERA.fov
      this.editorCamera.updateProjectionMatrix()
    }
    this.editorCamera.rotation.order = 'YXZ'
    this.editorCamera.lookAt(tx, ty, tz)
    if (this.controls) this.controls.target.set(tx, ty, tz)
    this.cameraRig?.snapFromCamera()
    this.host.onEditorCameraChange()
    this.host.onInvalidateMain()
  }

  beginFollow(): void {
    this.exitCompassView()
    if (!this.controls) return
    this.preFollow = {
      position: this.editorCamera.position.clone(),
      quaternion: this.editorCamera.quaternion.clone(),
      target: this.controls.target.clone(),
      fov: this.editorCamera.fov,
    }
    this.followPrev = null
    this.followMode = true
  }

  endFollow(): void {
    this.followPrev = null
    this.followMode = false
    if (this.preFollow && this.controls) {
      this.editorCamera.position.copy(this.preFollow.position)
      this.editorCamera.quaternion.copy(this.preFollow.quaternion)
      this.controls.target.copy(this.preFollow.target)
      if (this.editorCamera.fov !== this.preFollow.fov) {
        this.editorCamera.fov = this.preFollow.fov
        this.editorCamera.updateProjectionMatrix()
      }
      this.controls.update()
      this.host.onEditorCameraChange()
    }
    this.preFollow = null
  }

  beginCameraPilot(cam: CamInstance): boolean {
    this.exitCompassView()
    if (!this.controls || this.cameraPilot) return this.cameraPilot
    this.prePilot = {
      position: this.editorCamera.position.clone(),
      quaternion: this.editorCamera.quaternion.clone(),
      target: this.controls.target.clone(),
      fov: this.editorCamera.fov,
    }
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    cam.camera.getWorldPosition(pos)
    cam.camera.getWorldQuaternion(quat)
    this.editorCamera.position.copy(pos)
    this.editorCamera.quaternion.copy(quat)
    if (Math.abs(this.editorCamera.fov - cam.camera.fov) > 1e-4) {
      this.editorCamera.fov = cam.camera.fov
      this.editorCamera.updateProjectionMatrix()
    }
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat)
    this.controls.target.copy(pos).addScaledVector(forward, 4)
    this.cameraRig?.snapFromCamera()
    this.cameraPilot = true
    this.pilotCameraId = cam.node.id
    this.host.onEditorCameraChange()
    this.host.onInvalidate()
    return true
  }

  endCameraPilot(): { position: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number } } | null {
    const pose = this.cameraPilot ? this.readCameraPilotPose() : null
    this.cameraPilot = false
    this.pilotCameraId = null
    if (this.prePilot && this.controls) {
      this.editorCamera.position.copy(this.prePilot.position)
      this.editorCamera.quaternion.copy(this.prePilot.quaternion)
      this.controls.target.copy(this.prePilot.target)
      if (Math.abs(this.editorCamera.fov - this.prePilot.fov) > 1e-4) {
        this.editorCamera.fov = this.prePilot.fov
        this.editorCamera.updateProjectionMatrix()
      }
      this.controls.update()
      this.cameraRig?.snapFromCamera()
      this.host.onEditorCameraChange()
    }
    this.prePilot = null
    this.host.onInvalidate()
    return pose
  }

  private readCameraPilotPose(): { position: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number } } {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.editorCamera.quaternion).normalize()
    return {
      position: {
        x: this.editorCamera.position.x,
        y: this.editorCamera.position.y,
        z: this.editorCamera.position.z,
      },
      forward: { x: forward.x, y: forward.y, z: forward.z },
    }
  }

  gizmoBusy(): boolean {
    // 只认 dragging。松手后 axis 常停在悬停轴上，若也算 busy，
    // applyCameraSnapshot / gizmo.sync 会被跳过，下一帧用旧相机位姿把 gizmo 拽回去。
    return !!this.unified?.dragging
  }

  gizmoAttachedNodeId(): string | null {
    return this.tcAttachedId
  }

  gizmoAttachedNodeIds(): string[] {
    const ids = this.unified?.ids()
    if (ids?.length) return ids
    return this.tcAttachedId ? [this.tcAttachedId] : []
  }

  gizmoPivot(): { x: number; y: number; z: number } | null {
    return this.unified?.pivotWorld() ?? null
  }

  gizmoInteractionProp(): 'position' | 'rotation' | 'scale' {
    return this.unified?.interactionProp() ?? 'position'
  }

  gizmoHandleHit(
    ndcX: number,
    ndcY: number,
    _raycaster: THREE.Raycaster,
  ): { name: string; dist: number } | null {
    return this.unified?.hit(ndcX, ndcY) ?? null
  }

  syncTargets(scene: THREE.Scene, targets: Map<string, THREE.Object3D>): void {
    if (this.gizmoBusy()) return
    this.unified?.attach(scene, targets)
    this.tcAttachedId = targets.keys().next().value ?? null
    // forceRender 每帧都会走到这里；目标没变还 invalidate 会让按需渲染变成逐帧空转。
    const prev = this.syncedTargets
    const same = prev.size === targets.size && [...targets].every(([id, obj]) => prev.get(id) === obj)
    if (same) return
    this.syncedTargets = new Map(targets)
    this.host.onInvalidate()
  }

  syncGizmo(
    scene: THREE.Scene,
    cameras: Map<string, CamInstance>,
    characters: Map<string, { root: THREE.Object3D }>,
    props: Map<string, THREE.Object3D>,
    nodeId: string | null,
    _mode: GizmoMode,
    suspended: boolean,
    nodeIds?: string[],
    primitives?: Map<string, THREE.Object3D>,
    groups?: Map<string, THREE.Object3D>,
  ): void {
    const targets = new Map<string, THREE.Object3D>()
    if (nodeId && !suspended) {
      for (const id of nodeIds?.length ? nodeIds : [nodeId]) {
        const object = characters.get(id)?.root
          ?? props.get(id)
          ?? primitives?.get(id)
          ?? groups?.get(id)
          ?? cameras.get(id)?.gizmo.group
        if (object) targets.set(id, object)
      }
    }
    const scaleOk = ![...(nodeIds?.length ? nodeIds : nodeId ? [nodeId] : [])].some((id) => {
      const cam = cameras.get(id)
      return !!cam && targets.get(id) === cam.gizmo.group
    })
    this.unified?.setScaleVisible(scaleOk)
    this.syncTargets(scene, targets)
  }

  focusBounds(box: THREE.Box3): void {
    this.exitCompassView()
    if (box.isEmpty()) return
    cancelAnimationFrame(this.focusRaf)
    const target = box.getCenter(new THREE.Vector3())
    const halfSize = box.getSize(new THREE.Vector3()).multiplyScalar(0.6)
    const pose = computeFocusCameraPose({
      center: target,
      halfSize: { x: halfSize.x, y: halfSize.y, z: halfSize.z },
      aspect: this.editorCamera.aspect,
      fovDeg: DEFAULT_RESET_CAMERA_FOV,
    })
    const fromPos = this.editorCamera.position.clone()
    this.editorCamera.rotation.order = 'YXZ'
    const fromRot = this.editorCamera.rotation.clone()
    const fromFov = this.editorCamera.fov
    const toRot = new THREE.Euler(
      THREE.MathUtils.degToRad(pose.rotation.x),
      THREE.MathUtils.degToRad(pose.rotation.y),
      THREE.MathUtils.degToRad(pose.rotation.z),
      'YXZ',
    )
    const start = performance.now()
    const step = (now: number) => {
      const raw = Math.min(1, (now - start) / CAMERA_RESET_DURATION_MS)
      const eased = raw * raw * (3 - 2 * raw)
      this.editorCamera.position.lerpVectors(fromPos, pose.position, eased)
      this.editorCamera.rotation.set(
        fromRot.x + (toRot.x - fromRot.x) * eased,
        fromRot.y + (toRot.y - fromRot.y) * eased,
        fromRot.z + (toRot.z - fromRot.z) * eased,
        'YXZ',
      )
      const nextFov = fromFov + (DEFAULT_RESET_CAMERA_FOV - fromFov) * eased
      if (Math.abs(this.editorCamera.fov - nextFov) > 1e-4) {
        this.editorCamera.fov = nextFov
        this.editorCamera.updateProjectionMatrix()
      }
      if (this.controls) this.controls.target.copy(target)
      if (raw >= 1) this.cameraRig?.snapFromCamera()
      this.host.onEditorCameraChange()
      this.host.onInvalidateMain()
      if (raw < 1) this.focusRaf = requestAnimationFrame(step)
    }
    this.focusRaf = requestAnimationFrame(step)
  }

  readAttachedTransform(prop: 'position' | 'rotation' | 'scale', nodeId?: string): number[] | null {
    const id = nodeId ?? this.tcAttachedId
    const obj = id ? this.unified?.object(id) : null
    if (!obj) return null
    if (prop === 'position') return [obj.position.x, obj.position.y, obj.position.z]
    if (prop === 'rotation') {
      const R2D = 180 / Math.PI
      return [obj.rotation.x * R2D, obj.rotation.y * R2D, obj.rotation.z * R2D]
    }
    if (prop === 'scale') return [obj.scale.x, obj.scale.y, obj.scale.z]
    return null
  }

  /** 按当前 gizmo 朝向（本地 -Z）把看点放在视线前方 `lookDistance` 米处 */
  readAttachedCameraAim(lookDistance: number): { x: number; y: number; z: number } | null {
    const obj = this.tcAttachedId ? this.unified?.object(this.tcAttachedId) : null
    if (!obj) return null
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.quaternion)
    const dist = lookDistance > 1e-4 ? lookDistance : 2
    return {
      x: obj.position.x + dir.x * dist,
      y: obj.position.y + dir.y * dist,
      z: obj.position.z + dir.z * dist,
    }
  }

  render(
    scene: THREE.Scene,
    cameras: Map<string, CamInstance>,
    activeCameraId: string | null,
    hideOverlays = false,
    selectedIds?: ReadonlySet<string>,
    pass: 'both' | 'main' | 'preview' = 'both',
  ): void {
    if (pass === 'preview') {
      this.renderPreview(scene, cameras, activeCameraId)
      return
    }
    this.unified?.update()
    const followCamInst = this.followMode && activeCameraId ? cameras.get(activeCameraId) : null
    if (followCamInst) this.trackFollowCamera(followCamInst)
    const pilotCamInst = this.cameraPilot && this.pilotCameraId ? cameras.get(this.pilotCameraId) : null
    if (pilotCamInst) this.syncPilotFov(pilotCamInst)
    const skipGizmoIds = this.gizmoBusy() ? new Set(this.gizmoAttachedNodeIds()) : null
    for (const [id, cam] of cameras) {
      // 橙色是选中态。预览用的 active camera 未选中时保持蓝色。
      cam.gizmo.setActive(selectedIds?.has(id) ?? false)
      if (!skipGizmoIds?.has(id)) cam.gizmo.sync(cam.camera)
      cam.gizmo.group.visible = !hideOverlays && !followCamInst && cam.node.visible !== false
    }
    if (rendererAlive(this.rendererMain)) this.mainPixelRatio.apply(this.rendererMain, window.devicePixelRatio)
    if (rendererAlive(this.rendererMain) && fitRenderer(this.rendererMain)) {
      const r = this.rendererMain
      const c = r.domElement
      const width = c.clientWidth
      const height = Math.max(1, c.clientHeight)
      const aspect = width / height
      const cameraView = Boolean(this.followMode || this.cameraPilot || this.letterboxAspect !== null)
      const filmAspect = filmFrameAspectForView(this.filmFramePreviewEnabled, cameraView, this.filmAspect)
      const box = viewportLetterboxRect(width, height, filmAspect, this.letterboxAspect)
      this.syncEditorProjection(width, height, box, filmAspect)
      // 机位视角 / 操控相机要藏轨迹和 gizmo，地面网格在另一层，不能一起关掉。
      this.compass.resize(aspect)
      const viewCamera = this.viewCamera
      const prevMask = viewCamera.layers.mask
      if (hideOverlays) viewCamera.layers.mask = exportCameraLayerMask(prevMask)
      if (box) {
        r.getClearColor(_clearColor)
        const clearAlpha = r.getClearAlpha()
        r.setScissorTest(false)
        r.setViewport(0, 0, width, height)
        r.setClearColor(0x000000, 1)
        r.clear()
        r.setClearColor(_clearColor, clearAlpha)
        r.setViewport(box.x, box.y, box.width, box.height)
        r.setScissor(box.x, box.y, box.width, box.height)
        r.setScissorTest(true)
      }
      r.render(scene, viewCamera)
      if (box) {
        r.setScissorTest(false)
        r.setViewport(0, 0, width, height)
      }
      // 描边和 gizmo 同显同隐：hideOverlays（成片监看 / 机位视角 / 操控相机）时不画。
      if (!hideOverlays && !box && this.outlineRoots.length > 0) {
        this.selectionOutline ??= new SelectionOutline()
        this.selectionOutline.render(r, scene, viewCamera, this.outlineRoots)
      }
      if (hideOverlays) viewCamera.layers.mask = prevMask
    }
    if (pass === 'both') this.renderPreview(scene, cameras, activeCameraId)
  }

  /**
   * 取景时机位的垂直 FOV 只对应取景框的高度，不是整块画布；
   * 用负偏移的 view offset 把视锥向四周外扩，框内画面才和机位预览、导出一致。
   */
  private syncEditorProjection(width: number, height: number, box: { width: number; height: number } | null, filmAspect: number | null): void {
    applyViewportProjection(this.editorCamera, width, height, box, filmAspect, this.framedAspect)
  }

  /**
   * 操控相机时视口相机是独立的 editorCamera，位姿由用户飞；焦距却属于机位节点，
   * 属性面板改它只更新机位实例。每帧把 fov 对齐过来，视口才会实时变焦。
   * updateProjectionMatrix 会沿用当前 view offset，取景框的外扩不受影响。
   */
  private syncPilotFov(cam: CamInstance): void {
    if (Math.abs(this.editorCamera.fov - cam.camera.fov) <= 1e-4) return
    this.editorCamera.fov = cam.camera.fov
    this.editorCamera.updateProjectionMatrix()
    this.cameraRig?.syncFov(cam.camera.fov)
    this.host.onEditorCameraChange()
  }

  private trackFollowCamera(cam: CamInstance): void {
    if (!this.controls) return
    const p = cam.camera.position
    const q = cam.camera.quaternion
    const prev = this.followPrev
    if (!prev || prev.id !== cam.node.id) {
      this.editorCamera.position.copy(p)
      this.editorCamera.quaternion.copy(q)
      this.controls.target.copy(cam.lookAt)
    } else {
      const dq = q.clone().multiply(prev.quaternion.clone().invert())
      const applyDelta = (v: THREE.Vector3) => {
        v.sub(prev.position).applyQuaternion(dq).add(p)
      }
      applyDelta(this.editorCamera.position)
      applyDelta(this.controls.target)
      this.editorCamera.quaternion.premultiply(dq)
    }
    if (this.editorCamera.fov !== cam.camera.fov) {
      this.editorCamera.fov = cam.camera.fov
      this.editorCamera.updateProjectionMatrix()
    }
    this.controls.update()
    this.host.onEditorCameraChange()
    this.followPrev = { id: cam.node.id, position: p.clone(), quaternion: q.clone() }
  }

  private renderPreview(
    scene: THREE.Scene,
    cameras: Map<string, CamInstance>,
    activeCameraId: string | null,
  ): void {
    const r = this.rendererPreview
    if (!rendererAlive(r) || !fitRenderer(r)) return
    // 面板收起时画布只剩十几个像素，但整场景仍要逐物体 setProgram：
    // 这一趟等于每帧白跑一次渲染，直接跳过。
    if (r.domElement.clientWidth < MIN_PREVIEW_PX || r.domElement.clientHeight < MIN_PREVIEW_PX / 2) return
    r.setScissorTest(false)
    r.setViewport(0, 0, r.domElement.clientWidth, r.domElement.clientHeight)
    r.setClearColor(0x000000, 1)
    r.clear()
    const cam = activeCameraId ? cameras.get(activeCameraId)?.camera : null
    if (!cam) return
    const w = r.domElement.clientWidth
    const h = r.domElement.clientHeight
    const targetAspect = this.previewAspect > 0 ? this.previewAspect : FALLBACK_ASPECT
    const { x: vx, y: vy, width: vw, height: vh } = letterboxRect(w, h, targetAspect)
    if (Math.abs(cam.aspect - vw / vh) > 1e-3) {
      cam.aspect = vw / vh
      cam.updateProjectionMatrix()
    }
    r.setViewport(vx, vy, vw, vh)
    r.setScissor(vx, vy, vw, vh)
    r.setScissorTest(true)
    r.render(scene, cam)
    r.setScissorTest(false)
  }

  private readonly onOrbitChange = (): void => {
    this.host.onEditorCameraChange()
    this.host.onInvalidate()
  }

  private bindCanvas(canvas: HTMLCanvasElement, slot: 'main' | 'preview'): () => void {
    const onLost = (e: Event) => {
      e.preventDefault()
      if (slot === 'main') this.lostMain = true
      else this.lostPreview = true
      this.syncLost()
    }
    const onRestored = () => {
      if (slot === 'main') this.lostMain = false
      else this.lostPreview = false
      this.syncLost()
      this.host.onContextRestored()
    }
    const ro = new ResizeObserver(() => this.host.onInvalidate())
    ro.observe(canvas)
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    return () => {
      ro.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    }
  }

  private syncLost(): void {
    this.host.onContextLostChange(this.lostMain)
  }
}

function rendererAlive(renderer: THREE.WebGLRenderer | null): renderer is THREE.WebGLRenderer {
  return !!renderer && !renderer.getContext().isContextLost()
}
