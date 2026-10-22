import * as THREE from 'three'

// VFX 预览：App 2 的 VFX cue 在视口里以朝向相机的序列帧 billboard 播放（表由 App 4 用 Effekseer 烘焙）。
// 只改观看方式，不写文档；没有序列帧表时画一个带名字的彩框，位置和时间仍可审。

export interface VfxSheetMeta {
  frames: number
  columns: number
  rows: number
  fps: number
  sizeMeters: number
  pivot: [number, number]
  blend: 'add' | 'alpha'
  loop: boolean
}

export interface VfxSpriteCue {
  id: string
  effect: string
  frameStart: number
  frameEnd: number
  position: { x: number; y: number; z: number }
  yaw: number
  scale: number
  attachNodeId?: string
  attachBone?: string
}

export interface VfxSheet { url: string; meta: VfxSheetMeta }

export const VFX_LAYER_NAME = 't3d-vfx-sprites'
const PLACEHOLDER_SIZE = 1

export function validVfxSheetMeta(value: unknown): value is VfxSheetMeta {
  const meta = value as VfxSheetMeta
  return !!meta && typeof meta === 'object' &&
    Number.isSafeInteger(meta.frames) && meta.frames > 0 && Number.isSafeInteger(meta.columns) && meta.columns > 0 &&
    Number.isSafeInteger(meta.rows) && meta.rows > 0 && meta.frames <= meta.columns * meta.rows &&
    Number.isFinite(meta.fps) && meta.fps > 0 && Number.isFinite(meta.sizeMeters) && meta.sizeMeters > 0 &&
    Array.isArray(meta.pivot) && meta.pivot.length === 2 && meta.pivot.every((v) => Number.isFinite(v)) &&
    (meta.blend === 'add' || meta.blend === 'alpha') && typeof meta.loop === 'boolean'
}

/** Inclusive frame range, like the cue editor and the Film schedule. */
export function vfxCueActive(cue: Pick<VfxSpriteCue, 'frameStart' | 'frameEnd'>, frame: number): boolean {
  return frame >= cue.frameStart && frame <= cue.frameEnd
}

/** Sheet cell shown `frame - frameStart` timeline frames into a cue, or null once a non-looping sheet has finished. */
export function vfxSheetCell(meta: Pick<VfxSheetMeta, 'frames' | 'fps' | 'loop'>, cueFrame: number, timelineFps: number): number | null {
  if (!(timelineFps > 0) || cueFrame < 0) return null
  const index = Math.floor(cueFrame / timelineFps * meta.fps + 1e-9)
  if (meta.loop) return index % meta.frames
  return index < meta.frames ? index : null
}

/** UV offset/repeat of a cell; rows count from the top of the image like the baker writes them. */
export function vfxCellUv(meta: Pick<VfxSheetMeta, 'columns' | 'rows'>, cell: number): { offset: [number, number]; repeat: [number, number] } {
  const column = cell % meta.columns, row = Math.floor(cell / meta.columns)
  return { offset: [column / meta.columns, 1 - (row + 1) / meta.rows], repeat: [1 / meta.columns, 1 / meta.rows] }
}

function canonicalBoneName(value: string): string {
  return value.split(':').at(-1)!.replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

export interface VfxAttachResolver {
  /** World matrix of a scene node (character root including any view-only turn, prop, primitive). */
  node(nodeId: string): THREE.Matrix4 | null
  /** World matrix of a character bone, matched by canonical name. */
  bone(nodeId: string, bone: string): THREE.Matrix4 | null
}

/** World position and size of an active cue; attachments carry the cue offset in the attached frame. */
export function vfxCueWorld(cue: VfxSpriteCue, resolve: VfxAttachResolver): { position: THREE.Vector3; scale: number } | null {
  const local = new THREE.Vector3(cue.position.x, cue.position.y, cue.position.z)
  if (!cue.attachNodeId) return { position: local, scale: cue.scale }
  const matrix = cue.attachBone ? resolve.bone(cue.attachNodeId, cue.attachBone) : resolve.node(cue.attachNodeId)
  if (!matrix) return null
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3()
  matrix.decompose(position, rotation, scale)
  // Bone matrices carry model-unit scale; only the offset direction follows the bone, distances stay in metres.
  const offset = local.applyQuaternion(rotation)
  return { position: position.add(offset), scale: cue.scale * (cue.attachBone ? 1 : scale.x) }
}

export function findBoneByCanonicalName(root: THREE.Object3D, bone: string): THREE.Object3D | null {
  const wanted = canonicalBoneName(bone)
  let found: THREE.Object3D | null = null
  root.traverse((object) => { if (!found && (object as THREE.Bone).isBone && canonicalBoneName(object.name) === wanted) found = object })
  return found
}

interface SpriteEntry { sprite: THREE.Sprite; effect: string; texture: THREE.Texture | null; meta: VfxSheetMeta | null }

/** Owns one THREE.Sprite per cue under a scene-level group; textures are shared per effect. */
export class VfxSpriteLayer {
  readonly group = new THREE.Group()
  private cues: VfxSpriteCue[] = []
  private sheets = new Map<string, VfxSheet>()
  private readonly textures = new Map<string, THREE.Texture>()
  private readonly views = new Map<string, Set<THREE.Texture>>()
  private readonly loads = new Map<string, Promise<void>>()
  private readonly entries = new Map<string, SpriteEntry>()
  private readonly loader = new THREE.TextureLoader()

  constructor() {
    this.group.name = VFX_LAYER_NAME
    this.group.renderOrder = 30
  }

  setCues(cues: readonly VfxSpriteCue[], sheets: Record<string, VfxSheet>): void {
    this.cues = cues.map((cue) => structuredClone(cue))
    this.sheets = new Map(Object.entries(sheets).filter(([, sheet]) => validVfxSheetMeta(sheet.meta)))
    for (const [id, entry] of this.entries) {
      const cue = this.cues.find((item) => item.id === id)
      const meta = this.sheets.get(cue?.effect ?? '')?.meta ?? null
      if (!cue || cue.effect !== entry.effect || JSON.stringify(meta) !== JSON.stringify(entry.meta)) this.removeEntry(id)
    }
  }

  get cueCount(): number { return this.cues.length }

  /** Start loading every cue's sheet and resolve once all have loaded or failed (headless renders wait on this). */
  async ready(): Promise<void> {
    for (const cue of this.cues) this.entry(cue)
    await Promise.all([...this.loads.values()])
  }

  /** Position and animate sprites for one evaluated frame; inactive cues are hidden. */
  update(frame: number, timelineFps: number, resolve: VfxAttachResolver): void {
    for (const cue of this.cues) {
      const entry = this.entry(cue)
      if (!vfxCueActive(cue, frame)) { entry.sprite.visible = false; continue }
      const world = vfxCueWorld(cue, resolve)
      const cell = entry.meta ? vfxSheetCell(entry.meta, frame - cue.frameStart, timelineFps) : 0
      if (!world || cell === null) { entry.sprite.visible = false; continue }
      entry.sprite.visible = true
      entry.sprite.position.copy(world.position)
      const size = (entry.meta?.sizeMeters ?? PLACEHOLDER_SIZE) * world.scale
      entry.sprite.scale.set(size, size, 1)
      ;(entry.sprite.material.userData.depthBias as { value: number }).value = size / 2
      if (entry.meta && entry.texture) {
        const uv = vfxCellUv(entry.meta, cell)
        entry.texture.offset.set(...uv.offset)
        entry.texture.repeat.set(...uv.repeat)
      }
    }
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.removeEntry(id)
    for (const texture of this.textures.values()) texture.dispose()
    this.textures.clear(); this.views.clear(); this.loads.clear()
  }

  private entry(cue: VfxSpriteCue): SpriteEntry {
    const prior = this.entries.get(cue.id)
    if (prior) return prior
    const sheet = this.sheets.get(cue.effect) ?? null
    let texture: THREE.Texture | null = null
    let material: THREE.SpriteMaterial
    if (sheet) {
      // Each sprite animates its own cell, so it gets its own texture view onto the shared image.
      let base = this.textures.get(cue.effect)
      if (!base) {
        const effect = cue.effect
        // Clones share the image but keep their own upload version: re-flag every view once the sheet arrives.
        let settle = () => {}
        this.loads.set(effect, new Promise<void>((resolve) => { settle = resolve }))
        base = this.loader.load(sheet.url, () => { for (const view of this.views.get(effect) ?? []) view.needsUpdate = true; settle() }, undefined, () => settle())
        base.colorSpace = THREE.SRGBColorSpace
        this.textures.set(effect, base)
      }
      texture = base.clone()
      if (base.image) texture.needsUpdate = true
      if (!this.views.has(cue.effect)) this.views.set(cue.effect, new Set())
      this.views.get(cue.effect)!.add(texture)
      material = new THREE.SpriteMaterial({
        map: texture, transparent: true, depthWrite: false, toneMapped: false,
        blending: sheet.meta.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
    } else {
      texture = placeholderTexture(cue.effect)
      material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })
    }
    withDepthBias(material)
    const sprite = new THREE.Sprite(material)
    sprite.name = `vfx:${cue.id}`
    sprite.renderOrder = 30
    if (sheet) sprite.center.set(sheet.meta.pivot[0], sheet.meta.pivot[1])
    sprite.visible = false
    this.group.add(sprite)
    const entry = { sprite, effect: cue.effect, texture, meta: sheet?.meta ?? null }
    this.entries.set(cue.id, entry)
    return entry
  }

  private removeEntry(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.group.remove(entry.sprite)
    entry.sprite.material.dispose()
    if (entry.texture) { this.views.get(entry.effect)?.delete(entry.texture); entry.texture.dispose() }
    this.entries.delete(id)
  }
}

/**
 * An effect is a flat billboard standing for a volume around its origin: plain depth testing lets the floor cut off the
 * lower half (rings on the ground, domes). Test depth as if the quad were `depthBias` metres nearer the camera (half its
 * size), so the floor and anything inside the effect stay behind it while nearer objects still hide it.
 */
function withDepthBias(material: THREE.SpriteMaterial): void {
  const depthBias = { value: 0 }
  material.userData.depthBias = depthBias
  material.onBeforeCompile = (shader) => {
    shader.uniforms.depthBias = depthBias
    shader.vertexShader = shader.vertexShader
      .replace('uniform float rotation;', 'uniform float rotation;\nuniform float depthBias;')
      .replace('gl_Position = projectionMatrix * mvPosition;', `gl_Position = projectionMatrix * mvPosition;
  // Never move the test point past the near plane (a close camera would clip the whole effect).
  float nearDistance = projectionMatrix[ 3 ][ 2 ] / ( projectionMatrix[ 2 ][ 2 ] - 1.0 );
  vec4 biased = projectionMatrix * vec4( mvPosition.xy, min( mvPosition.z + depthBias, - nearDistance * 1.05 ), 1.0 );
  gl_Position.z = biased.z / biased.w * gl_Position.w;`)
  }
  material.customProgramCacheKey = () => 'vfx-depth-bias'
}

function placeholderTexture(label: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) return null
  context.strokeStyle = '#ff3fd2'; context.lineWidth = 6; context.strokeRect(3, 3, 122, 122)
  context.fillStyle = '#ff3fd2'; context.font = 'bold 16px sans-serif'; context.textAlign = 'center'
  context.fillText(label.slice(0, 14), 64, 70)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
