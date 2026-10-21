// FBX 动作加载与逐帧确定性播放。
//
// 加载产物保持「原始」：clip（mixamorig 轨道）+ FBX 骨架 group（rest 状态）。
// - mixamorig 命名的角色：按**目标骨架** rest 对齐烘焙（见 retargetClip）。
//   厘米绑定位移比 ≈ 1；米制 Child 位移比 ≈ destHips/srcHips（约 0.006）。
// - UAL1 命名的角色：原始 clip + group 交给 Ual1Retargeter
//   做世界系增量 FK 传递（见 applyRetarget.ts）。
// - 每角色一个 AnimationMixer，用 mixer.setTime() 绝对时间驱动，不用 deltaTime 累加。
import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mixamorigBindKey, mixamorigPositionScale, mixamoBindName } from '../rig/mixamorigBind'
import { libraryAssetCacheKey } from '../io/libraryAssetCache'
import { isFbxBoneAlias } from '../../evaluate/retarget/fbxSourceBones'


interface BoneBind {
  name: string
  quat: THREE.Quaternion
  pos: THREE.Vector3
}

interface BoneRetarget {
  name: string
  pre: THREE.Quaternion // destRest · fbxRest⁻¹
  fbxRestPos: THREE.Vector3
  glbRestPos: THREE.Vector3
  posScale: number
}

function captureBind(root: THREE.Object3D): Map<string, BoneBind> {
  const bind = new Map<string, BoneBind>()
  root.traverse((obj) => {
    if (!obj.name || isFbxBoneAlias(obj)) return
    const value = { name: obj.name, quat: obj.quaternion.clone(), pos: obj.position.clone() }
    bind.set(obj.name, value)
    bind.set(mixamoBindName(obj.name), value)
  })
  return bind
}

function destBindOf(
  destRoot: THREE.Object3D,
  restQuat?: Map<string, THREE.Quaternion>,
  restPos?: Map<string, THREE.Vector3>,
): Map<string, BoneBind> {
  if (restQuat && restPos) {
    const bind = new Map<string, BoneBind>()
    destRoot.traverse((obj) => {
      if (!obj.name || isFbxBoneAlias(obj)) return
      const quat = restQuat.get(obj.name)
      const pos = restPos.get(obj.name)
      if (quat && pos) bind.set(mixamoBindName(obj.name), { name: obj.name, quat, pos })
    })
    if (bind.size > 0) return bind
  }
  return captureBind(destRoot)
}

/** 用冻结的 rest 建表。禁止读 live quaternion——播到一半再烘会把手腕姿态写进整段。 */
function buildRetargetContext(
  destBind: Map<string, BoneBind>,
  fbxBind: Map<string, BoneBind>,
): Map<string, BoneRetarget> {
  const map = new Map<string, BoneRetarget>()
  const destHips = destBind.get('mixamorigHips')
  const fbxHips = fbxBind.get('mixamorigHips')
  const hipsScale =
    destHips && fbxHips
      ? mixamorigPositionScale(destHips.pos.length(), fbxHips.pos.length(), 1)
      : 1
  for (const [name, fbx] of fbxBind) {
    const dest = destBind.get(name)
    if (!dest) continue
    map.set(name, {
      name: dest.name,
      pre: dest.quat.clone().multiply(fbx.quat.clone().invert()),
      fbxRestPos: fbx.pos,
      glbRestPos: dest.pos,
      posScale: mixamorigPositionScale(dest.pos.length(), fbx.pos.length(), hipsScale),
    })
  }
  return map
}

const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()

/** 把 FBX 轨道的值原地改写到目标骨骼空间（修正 hips 的 -90°X 与单位差）。 */
function retargetClip(clip: THREE.AnimationClip, ctx: Map<string, BoneRetarget>): void {
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.')
    const r = ctx.get(mixamoBindName(track.name.slice(0, dot)))
    if (!r) continue
    const prop = track.name.slice(dot + 1)
    track.name = `${r.name}.${prop}`
    const vals = track.values
    if (prop === 'quaternion') {
      for (let i = 0; i + 3 < vals.length; i += 4) {
        _q.set(vals[i], vals[i + 1], vals[i + 2], vals[i + 3]).premultiply(r.pre)
        vals[i] = _q.x
        vals[i + 1] = _q.y
        vals[i + 2] = _q.z
        vals[i + 3] = _q.w
      }
    } else if (prop === 'position') {
      for (let i = 0; i + 2 < vals.length; i += 3) {
        _v.set(vals[i], vals[i + 1], vals[i + 2])
          .sub(r.fbxRestPos)
          .multiplyScalar(r.posScale)
          .applyQuaternion(r.pre)
          .add(r.glbRestPos)
        vals[i] = _v.x
        vals[i + 1] = _v.y
        vals[i + 2] = _v.z
      }
    }
  }
}

/** 深拷贝 clip（KeyframeTrack.clone 可能共享 TypedArray，这里手动复制）。 */
function cloneClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.map((t) => {
    const Ctor = t.constructor as new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack
    return new Ctor(t.name, Array.from(t.times), Array.from(t.values as ArrayLike<number>))
  })
  return new THREE.AnimationClip(clip.name, clip.duration, tracks)
}

export interface RawMotion {
  clip: THREE.AnimationClip
  group: THREE.Object3D
  /** FBX 载入瞬间的 bind，之后不得再读 group 的 live 姿态 */
  bind: Map<string, BoneBind>
}

const MAX_LIBRARY_MOTIONS = 64
const libraryMotions = new Map<string, RawMotion>()
const motionKey = (assetId: string, clipIndex: number) => `${assetId}\0${clipIndex}`

function rememberLibraryMotion(url: string, clipIndex: number, entry: RawMotion): void {
  const key = libraryAssetCacheKey(url)
  if (!key) return
  libraryMotions.set(`${key}#${clipIndex}`, entry)
  while (libraryMotions.size > MAX_LIBRARY_MOTIONS) {
    const oldest = libraryMotions.keys().next().value
    if (oldest === undefined) break
    libraryMotions.delete(oldest)
  }
}

export class MotionPlayer {
  private loader = new FBXLoader()
  private gltfLoader = new GLTFLoader()
  private raw = new Map<string, RawMotion>()
  private pending = new Map<string, Promise<RawMotion>>()
  private bakedDirectBind = new Map<string, THREE.AnimationClip>()
  private mixamorigTemplate: THREE.Object3D | null = null

  setMixamorigTemplate(template: THREE.Object3D): void {
    this.mixamorigTemplate = template
  }

  /** 按动作库 assetId 加载 FBX（内部缓存，同名不重复请求）。保持原始轨道。 */
  load(assetId: string, url: string, clipIndex = 0): Promise<RawMotion> {
    if (!Number.isInteger(clipIndex) || clipIndex < 0) return Promise.reject(new RangeError('Motion clip index must be a non-negative integer'))
    const key = motionKey(assetId, clipIndex)
    const cached = this.raw.get(key)
    if (cached) return Promise.resolve(cached)
    const libraryKey = libraryAssetCacheKey(url)
    const libraryHit = libraryKey ? libraryMotions.get(`${libraryKey}#${clipIndex}`) : undefined
    if (libraryHit) {
      this.raw.set(key, libraryHit)
      return Promise.resolve(libraryHit)
    }
    let p = this.pending.get(key)
    if (!p) {
      const loaded = url.includes('format=glb')
        ? this.gltfLoader.loadAsync(url).then((gltf) => { gltf.scene.animations = gltf.animations; return gltf.scene })
        : this.loader.loadAsync(url)
      p = loaded.then((group) => {
          const clip = group.animations[clipIndex]
          if (!clip) throw new Error(`FBX animation ${clipIndex} was not found: ${url}`)
          const entry: RawMotion = { clip, group, bind: captureBind(group) }
          this.raw.set(key, entry)
          rememberLibraryMotion(url, clipIndex, entry)
          return entry
        })
        .finally(() => {
          this.pending.delete(key)
        })
      this.pending.set(key, p)
    }
    return p
  }

  getRaw(assetId: string, clipIndex = 0): RawMotion | null {
    return this.raw.get(motionKey(assetId, clipIndex)) ?? null
  }

  register(assetId: string, group: THREE.Object3D, clipIndex = 0): void {
    if (!Number.isInteger(clipIndex) || clipIndex < 0 || !group.animations[clipIndex]) throw new RangeError('Motion clip index was not found')
    const key = motionKey(assetId, clipIndex)
    if (this.raw.has(key)) throw new Error('Motion source is already registered')
    this.raw.set(key, { group, clip: group.animations[clipIndex], bind: captureBind(group) })
  }

  /** 骨骼名同源的直绑路径：按目标 rest / 单位烘焙（厘米、米各一份）。 */
  getClipForDirectBind(
    assetId: string,
    destRoot?: THREE.Object3D,
    destRestQuat?: Map<string, THREE.Quaternion>,
    destRestPos?: Map<string, THREE.Vector3>,
    clipIndex = 0,
  ): THREE.AnimationClip | null {
    const dest = destRoot ?? this.mixamorigTemplate
    if (!dest) {
      console.warn('[MotionPlayer] mixamorig 模板未就绪')
      return null
    }
    const key = `v2:${motionKey(assetId, clipIndex)}@${dest.uuid}:${mixamorigBindKey(dest)}`
    const cached = this.bakedDirectBind.get(key)
    if (cached) return cached
    const entry = this.raw.get(motionKey(assetId, clipIndex))
    if (!entry) return null
    const clip = cloneClip(entry.clip)
    const fbxBind = entry.bind ?? captureBind(entry.group)
    if (!entry.bind) entry.bind = fbxBind
    retargetClip(clip, buildRetargetContext(destBindOf(dest, destRestQuat, destRestPos), fbxBind))
    this.bakedDirectBind.set(key, clip)
    return clip
  }
}

/**
 * 单角色动画驱动器（mixamorig 直绑路径）。clip 切换用 clipAction，
 * 定位用 mixer.setTime()（绝对时间，不依赖 rAF deltaTime），同一帧多次求值结果一致。
 */
export class CharacterAnimator {
  readonly mixer: THREE.AnimationMixer
  private root: THREE.Object3D
  private actions = new Map<string, THREE.AnimationAction>()
  private filtered = new WeakMap<THREE.AnimationClip, THREE.AnimationClip>()
  private activeClipId: string | null = null

  constructor(root: THREE.Object3D) {
    this.root = root
    this.mixer = new THREE.AnimationMixer(root)
  }

  /** 过滤掉目标骨架里不存在的节点轨道，避免 PropertyBinding 警告。 */
  private filterClip(clip: THREE.AnimationClip): THREE.AnimationClip {
    let c = this.filtered.get(clip)
    if (!c) {
      const tracks = clip.tracks.filter((t) => {
        const dot = t.name.lastIndexOf('.')
        const nodeName = t.name.slice(0, dot)
        return !!this.root.getObjectByName(nodeName)
      })
      c = new THREE.AnimationClip(clip.name, clip.duration, tracks)
      this.filtered.set(clip, c)
    }
    return c
  }

  /** 把某条时间线 clip 定位到源时间 timeSec（秒）。 */
  playAt(clipId: string, clip: THREE.AnimationClip, timeSec: number, loop = true): void {
    const filtered = this.filterClip(clip)
    let action = this.actions.get(clipId)
    if (action && action.getClip() !== filtered) {
      action.stop()
      this.mixer.uncacheAction(action.getClip(), this.root)
      this.actions.delete(clipId)
      action = undefined
    }
    if (!action) {
      action = this.mixer.clipAction(filtered)
      this.actions.set(clipId, action)
    }
    const loopMode = loop ? THREE.LoopRepeat : THREE.LoopOnce
    if (action.loop !== loopMode || action.repetitions !== (loop ? Infinity : 1) || action.clampWhenFinished === loop) {
      action.setLoop(loopMode, loop ? Infinity : 1)
      action.clampWhenFinished = !loop
    }
    if (this.activeClipId === clipId && !loop) { action.reset(); action.play() }
    if (this.activeClipId !== clipId) {
      for (const [id, a] of this.actions) {
        if (id !== clipId && a.isRunning()) a.stop()
      }
      action.reset()
      action.play()
      this.activeClipId = clipId
    }
    this.mixer.setTime(Math.max(0, timeSec))
  }

  stopAll(): void {
    if (this.activeClipId === null) return
    const a = this.actions.get(this.activeClipId)
    a?.stop()
    this.activeClipId = null
  }
}
