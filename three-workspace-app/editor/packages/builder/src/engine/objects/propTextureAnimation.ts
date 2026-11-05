import * as THREE from 'three'

/**
 * Minecraft-style animated texture on a prop (vertical strip of square frames, `.png.mcmeta`).
 * Stored in glTF material extras as `w01TextureAnimation`; GLTFLoader copies extras to `material.userData`.
 * The mesh UVs address frame `uvFrame` (normally 0), so viewers without this feature still show one frame.
 */
export type PropTextureAnimation = {
  version: 1
  layout: 'vertical-strip'
  frameCount: number
  frameOrder?: number[]
  frametimeTicks?: number
  ticksPerSecond?: number
  uvFrame?: number
}

type AnimatedTexture = { texture: THREE.Texture; animation: PropTextureAnimation }

const KEY = 'w01TextureAnimations'

export function readPropTextureAnimation(value: unknown): PropTextureAnimation | null {
  if (!value || typeof value !== 'object') return null
  const a = value as Partial<PropTextureAnimation>
  if (a.version !== 1 || a.layout !== 'vertical-strip') return null
  if (!Number.isInteger(a.frameCount) || a.frameCount! < 2 || a.frameCount! > 1024) return null
  if (a.frameOrder !== undefined && (!Array.isArray(a.frameOrder) || !a.frameOrder.length ||
      a.frameOrder.some((f) => !Number.isInteger(f) || f < 0 || f >= a.frameCount!))) return null
  return a as PropTextureAnimation
}

/** Sheet frame index shown at a timeline frame. Minecraft advances one entry every `frametimeTicks` game ticks (20/s). */
export function propTextureFrameAt(animation: PropTextureAnimation, timelineFrame: number, fps: number): number {
  const order = animation.frameOrder?.length ? animation.frameOrder : [...Array(animation.frameCount).keys()]
  const ticksPerSecond = animation.ticksPerSecond && animation.ticksPerSecond > 0 ? animation.ticksPerSecond : 20
  const frametime = animation.frametimeTicks && animation.frametimeTicks > 0 ? animation.frametimeTicks : 1
  const seconds = Math.max(0, timelineFrame) / (fps > 0 ? fps : 30)
  const step = Math.floor(seconds * ticksPerSecond / frametime + 1e-6)
  return order[step % order.length]!
}

/**
 * Called on a freshly cloned prop material. Gives the prop instance its own texture objects (the template's
 * textures are shared between instances) and records them on the prop root for `syncPropTextureAnimations`.
 */
export function preparePropTextureAnimation(root: THREE.Object3D, material: THREE.Material): void {
  const animation = readPropTextureAnimation(material.userData?.w01TextureAnimation)
  if (!animation) return
  const std = material as THREE.MeshStandardMaterial
  const owned = new Map<THREE.Texture, THREE.Texture>()
  const list: AnimatedTexture[] = root.userData[KEY] ?? (root.userData[KEY] = [])
  for (const slot of ['map', 'emissiveMap'] as const) {
    const source = std[slot]
    if (!source) continue
    let texture = owned.get(source)
    if (!texture) {
      texture = source.clone()
      texture.needsUpdate = true
      owned.set(source, texture)
      list.push({ texture, animation })
    }
    std[slot] = texture
  }
}

export function syncPropTextureAnimations(props: Iterable<THREE.Object3D>, frame: number, fps: number): boolean {
  let changed = false
  for (const root of props) {
    const list = root.userData[KEY] as AnimatedTexture[] | undefined
    if (!list) continue
    for (const { texture, animation } of list) {
      const offset = (propTextureFrameAt(animation, frame, fps) - (animation.uvFrame ?? 0)) / animation.frameCount
      if (texture.offset.y !== offset) {
        texture.offset.y = offset
        // Built-in materials refresh this while rendering; the BBS-look shader reads texture.matrix directly.
        texture.updateMatrix()
        changed = true
      }
    }
  }
  return changed
}
