// Two synchronized three.js panes: left = source as authored, right = the normalized GLB played on the target character.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export const FPS = 30
const draco = new DRACOLoader().setDecoderPath('/vendor/three/examples/jsm/libs/draco/gltf/')
const gltfLoader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder)

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

/** Loads glTF/GLB/FBX from a URL and returns { scene, animations }. */
export async function loadModel(url, format) {
  if (format === 'fbx') {
    const fbx = await new FBXLoader().loadAsync(url)
    return { scene: fbx, animations: fbx.animations }
  }
  const gltf = await gltfLoader.loadAsync(url)
  return { scene: gltf.scene, animations: gltf.animations }
}

class Pane {
  /** `metricGrid`: floor cells are a fixed 0.25 m (results are always metres) instead of following the framed size. */
  constructor(host, { metricGrid = false } = {}) {
    this.host = host
    this.metricGrid = metricGrid
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    host.appendChild(this.renderer.domElement)
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(2, 4, 3)
    this.scene.add(sun)
    this.grid = null
    this.holder = new THREE.Group()
    this.scene.add(this.holder)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    // Same in every W01 3D view: left orbit, middle pan, wheel zoom (right also pans).
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }
    this.mixer = null; this.clip = null; this.helper = null; this.object = null
    this.show = { mesh: true, skeleton: true, grid: true }
    this.applyTheme()
    new ResizeObserver(() => this.resize()).observe(host)
    this.resize()
  }

  applyTheme() {
    this.scene.background = new THREE.Color(cssVar('--viewer-bg', '#1c2128'))
    const line = new THREE.Color(cssVar('--viewer-grid', '#39414d'))
    const grid = new THREE.GridHelper(2, 20, line, line)
    if (this.grid) { grid.position.copy(this.grid.position); grid.scale.copy(this.grid.scale); grid.visible = this.grid.visible; this.scene.remove(this.grid); this.grid.geometry.dispose() }
    this.grid = grid
    this.scene.add(grid)
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  clear() {
    this.holder.clear()
    if (this.helper) { this.scene.remove(this.helper); this.helper.dispose?.(); this.helper = null }
    this.mixer?.stopAllAction()
    this.mixer = null; this.clip = null; this.object = null
  }

  /** Puts `object` in the pane (it may be shared between runs, so it is never disposed here). */
  /** `frameLike`: frame the camera on another object's bounds (Minecraft 20 shown at the Mixamo target's framing). */
  setModel(object, frameLike = null) {
    this.clear()
    this.object = object
    this.frameLike = frameLike
    this.holder.add(object)
    object.traverse((node) => { if (node.isMesh) node.frustumCulled = false })
    let hasBone = false
    object.traverse((node) => { if (node.isBone) hasBone = true })
    if (hasBone) {
      this.helper = new THREE.SkeletonHelper(object)
      this.helper.material.depthTest = false
      this.helper.material.color?.set?.(cssVar('--viewer-bone', '#ffd34d'))
      this.helper.renderOrder = 999
      this.scene.add(this.helper)
    }
    this.mixer = new THREE.AnimationMixer(object)
    this.applyVisibility()
    this.updateBounds()
    this.frame()
  }

  applyVisibility() {
    this.object?.traverse((node) => { if (node.isMesh) node.visible = this.show.mesh })
    if (this.helper) this.helper.visible = this.show.skeleton
    this.grid.visible = this.show.grid
  }

  setClip(clip) {
    if (!this.mixer) return
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.object)
    this.clip = clip
    if (clip) this.mixer.clipAction(clip).play()
  }

  setTime(seconds) {
    if (!this.mixer) return
    this.mixer.setTime(this.clip && this.clip.duration > 0 ? seconds % this.clip.duration : 0)
    this.object.updateMatrixWorld(true)
  }

  /** Extent from bone positions when there is a skeleton (mesh bounding boxes ignore skinning), else from geometry. */
  updateBounds() {
    if (!this.object) { this.bounds = null; return }
    const box = new THREE.Box3()
    const subject = this.frameLike ?? this.object
    subject.updateMatrixWorld(true)
    const point = new THREE.Vector3()
    subject.traverse((node) => { if (node.isBone) box.expandByPoint(node.getWorldPosition(point)) })
    // Meshes too (posed skinned bounds, wings left out): bone boxes stop at the neck/head joint on rigs without a head-top joint.
    const part = new THREE.Box3()
    subject.traverse((node) => {
      if (!node.isSkinnedMesh || !node.visible || /wing/i.test(node.name)) return
      node.computeBoundingBox(); box.union(part.copy(node.boundingBox).applyMatrix4(node.matrixWorld))
    })
    if (box.isEmpty()) box.setFromObject(subject)
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1))
    this.bounds = box
  }

  frame() {
    if (!this.bounds) return
    const center = this.bounds.getCenter(new THREE.Vector3()), size = this.bounds.getSize(new THREE.Vector3())
    const extent = Math.max(size.x, size.y, size.z, 1e-3)
    const distance = extent * 1.6 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / 1.6
    this.camera.near = extent / 500; this.camera.far = extent * 200
    this.camera.position.copy(center).add(new THREE.Vector3(0.55, 0.3, 1).normalize().multiplyScalar(distance))
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(center)
    this.controls.update()
    this.grid.scale.setScalar(this.metricGrid ? 2.5 : extent * 1.5 / 2)
    this.grid.position.set(center.x, this.bounds.min.y, center.z)
  }

  render() {
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
}

/** Track names `Hips.quaternion` → `mixamorigHips.quaternion` for the builtin targets; reports how many tracks found a node. */
export function retargetTrackNames(clip, scene) {
  const names = new Set()
  scene.traverse((node) => names.add(node.name))
  let bound = 0
  const tracks = clip.tracks.map((track) => {
    const dot = track.name.indexOf('.')
    const node = track.name.slice(0, dot), rest = track.name.slice(dot)
    const wanted = [`mixamorig${node}`, `mixamorig:${node}`, node].find((name) => names.has(name))
    const copy = track.clone()
    if (wanted) { copy.name = wanted + rest; bound++ }
    return copy
  })
  return { clip: new THREE.AnimationClip(clip.name, clip.duration, tracks), bound, total: tracks.length }
}

/** BOBJ bone names contain dots (`low_left_arm.end`), which three.js track paths cannot address. */
const steveNode = (name) => `steve_${name.replace(/[^\w]/g, '_')}`

/** Height of the visible body in the current pose: skinned bounds follow the bones; wing meshes (Chirity) are left out. */
function bodyHeight(object) {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3(), part = new THREE.Box3()
  object.traverse((node) => {
    if (!node.isMesh || /wing/i.test(node.name)) return
    if (node.isSkinnedMesh) { node.computeBoundingBox(); part.copy(node.boundingBox).applyMatrix4(node.matrixWorld) }
    else { node.geometry.computeBoundingBox(); part.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld) }
    box.union(part)
  })
  return box.isEmpty() ? 0 : box.max.y - box.min.y
}

/** Minecraft20 preview SkinnedMesh (mannequin with vertex colors, or textured Steve); bind = rest world, vertices in rest world space. */
export async function buildSteve(data, textureUrl) {
  const group = new THREE.Group()
  const bones = data.bones.map((bone) => {
    const node = new THREE.Bone(); node.name = steveNode(bone.name)
    new THREE.Matrix4().fromArray(bone.restLocal).decompose(node.position, node.quaternion, node.scale)
    return node
  })
  data.bones.forEach((bone, index) => { const parent = data.bones.findIndex((other) => other.name === bone.parent); (parent >= 0 ? bones[parent] : group).add(bones[index]) })
  group.updateMatrixWorld(true)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(data.skinIndices, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(data.skinWeights, 4))
  geometry.computeVertexNormals()
  let material
  if (textureUrl) {
    const texture = await new THREE.TextureLoader().loadAsync(textureUrl)
    texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.colorSpace = THREE.SRGBColorSpace
    material = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide, alphaTest: 0.5 })
  } else {
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3))
    material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
  }
  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.bind(new THREE.Skeleton(bones), new THREE.Matrix4())
  group.add(mesh)
  return group
}

/** Server clip JSON (per-tick bone-local tracks) → AnimationClips addressing the Steve bones. */
export function steveClips(clips) {
  return clips.map((clip) => new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.flatMap((track) => [
    new THREE.VectorKeyframeTrack(`${steveNode(track.bone)}.position`, clip.times, track.position),
    new THREE.QuaternionKeyframeTrack(`${steveNode(track.bone)}.quaternion`, clip.times, track.quaternion),
    new THREE.VectorKeyframeTrack(`${steveNode(track.bone)}.scale`, clip.times, track.scale),
  ])))
}

export class Viewer {
  constructor(leftHost, rightHost, onFrame) {
    this.left = new Pane(leftHost)
    this.right = new Pane(rightHost, { metricGrid: true })
    this.onFrame = onFrame
    this.time = 0; this.duration = 1; this.playing = true; this.speed = 1
    this.source = null // { scene, animations }
    this.targetScene = null
    this.result = null // { mode, animations, scene }
    this.renamed = new Map()
    this.last = performance.now()
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(() => { this.left.applyTheme(); this.right.applyTheme() }, 50))
    const tick = (now) => {
      const dt = Math.min(0.1, (now - this.last) / 1000)
      this.last = now
      if (this.playing && this.duration > 0) this.time = (this.time + dt * this.speed) % this.duration
      this.apply()
      this.left.render(); this.right.render()
      this.onFrame?.(this.time)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  apply() { this.left.setTime(this.time); this.right.setTime(this.time) }

  seek(seconds) { this.time = Math.max(0, Math.min(seconds, this.duration)) }

  async loadSource(url, format) {
    this.source = null
    this.left.clear()
    this.source = await loadModel(url, format)
    this.left.setModel(this.source.scene)
    return this.source.animations.length
  }

  clearSource() { this.source = null; this.left.clear() }

  async loadTarget(url) {
    this.targetScene = (await loadModel(url, 'glb')).scene
    this.result = null
    this.renamed.clear()
    if (!this.steveMode) this.right.setModel(this.targetScene)
    else { this.fitSteveToTarget(); this.right.setModel(this.steve.scene) }
  }

  /** `offset`: animations before the normalized ones (an original-skeleton result keeps the character's built-in Actions first). */
  async loadResult(url, mode, offset = 0) {
    const loaded = await loadModel(url, 'glb')
    this.result = { mode, animations: loaded.animations, scene: loaded.scene, offset }
    this.renamed.clear()
    if (this.steveMode) return
    if (mode === 'model') this.right.setModel(loaded.scene)
    else if (this.targetScene) this.right.setModel(this.targetScene)
  }

  clearResult() {
    this.result = null
    this.renamed.clear()
    if (this.steve) { this.steve.clips = []; this.right.setModel(this.steve.scene) }
    else if (this.targetScene) this.right.setModel(this.targetScene)
    this.right.setClip(null)
  }

  /** Right pane shows Steve (Minecraft20) instead of the Mixamo target; clips come later from a run's .bobj. */
  async showSteve(skinId = null) {
    if (this.steve && this.steve.skinId !== skinId) { this.right.setModel(this.targetScene); this.steve = null }
    if (!this.steve) {
      const info = await (await fetch(skinId ? `/api/mc20/${encodeURIComponent(skinId)}` : '/api/steve')).json()
      const scene = await buildSteve(info.mesh, info.textureUrl)
      // The mannequin is authored in BBS model units; show it at the target character's height so both panes compare
      // at one scale (display only, the exported .bobj is untouched).
      const holder = new THREE.Group(); holder.name = 'steve-holder'; holder.add(scene)
      this.steve = { kind: info.mesh.kind, scene: holder, model: scene, clips: [], skinId }
    }
    this.fitSteveToTarget()
    this.steveMode = true
    // Frame on the mannequin itself: the target's bone box can be much shorter than its body (Verity rigs have no head-top
    // joint), which made the mannequin overflow the view.
    this.right.setModel(this.steve.scene)
  }

  /** Scale the mannequin to the target's body height (wings and other add-ons left out; 1.8 m before a target loads). */
  fitSteveToTarget() {
    if (!this.steve) return
    this.steve.scene.scale.setScalar(1)
    this.steve.scene.updateMatrixWorld(true)
    const own = bodyHeight(this.steve.model)
    const wanted = (this.targetScene && bodyHeight(this.targetScene)) || 1.8
    if (own > 0) this.steve.scene.scale.setScalar(wanted / own)
  }

  /** Back to the Mixamo target (and its GLB result, if any). */
  hideSteve() {
    this.steveMode = false
    if (this.result?.mode === 'model') this.right.setModel(this.result.scene)
    else if (this.targetScene) this.right.setModel(this.targetScene)
  }

  async loadSteveClips(runId) {
    const response = await fetch(`/api/runs/${runId}/steve`)
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    this.steve.clips = steveClips(body.clips)
  }

  /** Plays source Action `sourceIndex` (left) and GLB animation `glbIndex` (right, if a result exists). Returns binding facts for the UI. */
  select({ sourceIndex, glbIndex, duration }) {
    const sourceClip = sourceIndex === null || sourceIndex === undefined ? null : this.source?.animations[sourceIndex] ?? null
    this.left.setClip(sourceClip)
    let rightInfo = null
    if (this.steveMode) {
      // .bobj Actions follow the GLB animation order (exportMinecraft20 walks the GLB), so glbIndex addresses both.
      const clip = glbIndex === null || glbIndex === undefined ? null : this.steve?.clips[glbIndex] ?? null
      this.right.setClip(clip)
      if (clip) rightInfo = { bound: clip.tracks.length, total: clip.tracks.length }
    } else if (this.result && glbIndex !== null && glbIndex !== undefined && this.result.animations[glbIndex + this.result.offset]) {
      const raw = this.result.animations[glbIndex + this.result.offset]
      if (this.result.mode === 'model') { this.right.setClip(raw); rightInfo = { bound: raw.tracks.length, total: raw.tracks.length } }
      else {
        if (!this.renamed.has(glbIndex)) this.renamed.set(glbIndex, retargetTrackNames(raw, this.targetScene))
        const entry = this.renamed.get(glbIndex)
        this.right.setClip(entry.clip); rightInfo = { bound: entry.bound, total: entry.total }
      }
    } else this.right.setClip(null)
    this.duration = duration ?? this.right.clip?.duration ?? sourceClip?.duration ?? 1
    this.time = 0
    // Re-frame on the first pose so cameras fit the character as animated (root offsets included at t=0).
    this.apply()
    this.left.updateBounds(); this.right.updateBounds()
    return { source: sourceClip ? { duration: sourceClip.duration, tracks: sourceClip.tracks.length } : null, right: rightInfo }
  }

  setToggle(key, value) { for (const pane of [this.left, this.right]) { pane.show[key] = value; pane.applyVisibility() } }

  frameAll() { this.left.updateBounds(); this.right.updateBounds(); this.left.frame(); this.right.frame() }
}
