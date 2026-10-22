import * as THREE from 'three'
import { CHARACTER_LABEL_KIND, GRID_NAME, GROUND_NAME, OBJECT_LABEL_KIND } from './environment'

// 「像 BBS 一样看」：只改观看方式，不写文档。按 BBS FS 2.7（Minecraft 1.20.1）正午的样子画：
// 实体光照（两盏固定方向光，sRGB 空间相乘）、贴图最近邻采样、天空按仰角从雾色渐变到天色、y=groundHeight 处无限草地。
// 颜色取自 BBS FS 实机截图（C:\w01-samples\calib）：天顶 (120,167,255)，地平线雾色 (181,209,255)，草地均值 (78,102,48)。
export const BBS_SKY = new THREE.Color().setRGB(120 / 255, 167 / 255, 255 / 255, THREE.NoColorSpace)
export const BBS_FOG = new THREE.Color().setRGB(181 / 255, 209 / 255, 255 / 255, THREE.NoColorSpace)
export const BBS_GRASS: readonly [number, number, number] = [78, 102, 48]
const SKY_NAME = 't3d-bbs-sky'
const FLOOR_NAME = 't3d-bbs-floor'
/** Minecraft 1.20 default render distance (12 chunks) and its terrain fog band: start = distance - clamp(distance / 10, 4, 64). */
export const BBS_RENDER_DISTANCE = 192
export const BBS_FOG_START = BBS_RENDER_DISTANCE - Math.min(64, Math.max(4, BBS_RENDER_DISTANCE / 10))

/** Minecraft entity lighting (Lighting.setupLevel): two fixed world-space lights, 0.6 diffuse each plus 0.4 ambient. */
export const ENTITY_LIGHT_0 = new THREE.Vector3(0.2, 1, -0.7).normalize()
export const ENTITY_LIGHT_1 = new THREE.Vector3(-0.2, 1, 0.7).normalize()
export function entityLight(normal: THREE.Vector3): number {
  return Math.min(1, (Math.max(0, normal.dot(ENTITY_LIGHT_0)) + Math.max(0, normal.dot(ENTITY_LIGHT_1))) * 0.6 + 0.4)
}

/** Sky blend from fog colour at the horizon to sky colour overhead, fitted to the BBS FS screenshots (elevation in degrees). */
export function skyBlend(elevationDegrees: number): number {
  return 1 - Math.exp(-0.08 * Math.max(0, elevationDegrees - 2))
}

const SRGB_GLSL = /* glsl */ `
vec3 bbsLinearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}`

// Output is written as display (sRGB) values: no colorspace or tone-mapping chunks, like Minecraft's shaders.
const ENTITY_VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec2 vUv;
varying vec3 vWorldNormal;
#ifdef BBS_VERTEX_COLORS
attribute vec3 color;
varying vec3 vColor;
#endif
void main() {
  vUv = uv;
#ifdef BBS_VERTEX_COLORS
  vColor = color;
#endif
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
}`

const ENTITY_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform vec3 tint;
uniform float opacity;
uniform vec3 light0;
uniform vec3 light1;
varying vec2 vUv;
varying vec3 vWorldNormal;
#ifdef BBS_VERTEX_COLORS
varying vec3 vColor;
#endif
${SRGB_GLSL}
void main() {
  vec4 texel = vec4(1.0);
#ifdef BBS_MAP
  texel = texture2D(map, vUv);
#endif
  vec3 base = bbsLinearToSrgb(texel.rgb) * tint;
#ifdef BBS_VERTEX_COLORS
  base *= bbsLinearToSrgb(vColor);
#endif
  if (texel.a * opacity < 0.1) discard;
  vec3 n = normalize(vWorldNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  float light = min(1.0, (max(0.0, dot(light0, n)) + max(0.0, dot(light1, n))) * 0.6 + 0.4);
  gl_FragColor = vec4(base * light, 1.0);
}`

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = clip.xyww;
}`

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 sky;
uniform vec3 fog;
varying vec3 vDirection;
void main() {
  float elevation = degrees(asin(clamp(normalize(vDirection).y, -1.0, 1.0)));
  gl_FragColor = vec4(mix(fog, sky, 1.0 - exp(-0.08 * max(0.0, elevation - 2.0))), 1.0);
}`

// The floor follows the camera like loaded chunks do: a square of render-distance half size around it.
const FLOOR_VERTEX = /* glsl */ `
varying vec2 vBlock;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  world.xz += cameraPosition.xz;
  vBlock = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`

const FLOOR_FRAGMENT = /* glsl */ `
uniform sampler2D grass;
uniform vec3 fog;
uniform vec2 fogRange;
varying vec2 vBlock;
void main() {
  float fade = clamp((length(vBlock - cameraPosition.xz) - fogRange.x) / (fogRange.y - fogRange.x), 0.0, 1.0);
  gl_FragColor = vec4(mix(texture2D(grass, fract(vBlock)).rgb, fog, fade), 1.0);
}`

/** 16x16 grass-top pattern around the measured mean (procedural; no Minecraft asset). */
export function grassTexture(seed = 15): THREE.DataTexture {
  const data = new Uint8Array(16 * 16 * 4)
  let state = seed >>> 0
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
  for (let i = 0; i < 256; i++) {
    const shade = 0.82 + random() * 0.36
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(BBS_GRASS[c]! * shade)))
    data[i * 4 + 3] = 255
  }
  const texture = new THREE.DataTexture(data, 16, 16, THREE.RGBAFormat)
  texture.colorSpace = THREE.NoColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

type Materials = THREE.Material | THREE.Material[]

function entityMaterial(source: THREE.Material): THREE.ShaderMaterial {
  const src = source as THREE.MeshStandardMaterial
  const map = src.map ?? null
  const tint = src.color ? src.color.clone().convertLinearToSRGB() : new THREE.Color(1, 1, 1)
  const material = new THREE.ShaderMaterial({
    name: 'bbs-entity',
    vertexShader: ENTITY_VERTEX,
    fragmentShader: ENTITY_FRAGMENT,
    uniforms: {
      map: { value: map }, tint: { value: new THREE.Vector3(tint.r, tint.g, tint.b) }, opacity: { value: src.opacity ?? 1 },
      light0: { value: ENTITY_LIGHT_0 }, light1: { value: ENTITY_LIGHT_1 },
    },
    defines: { ...(map ? { BBS_MAP: '' } : {}), ...(src.vertexColors ? { BBS_VERTEX_COLORS: '' } : {}) },
    side: src.side ?? THREE.FrontSide,
  })
  material.userData.bbsLook = true
  return material
}

export class BbsLookView {
  private active = false
  private readonly materials = new Map<THREE.Mesh, Materials>()
  private readonly visibility = new Map<THREE.Object3D, boolean>()
  private readonly filters = new Map<THREE.Texture, [THREE.MagnificationTextureFilter, THREE.MinificationTextureFilter]>()
  private background: THREE.Color | THREE.Texture | null = null
  private fog: THREE.Fog | THREE.FogExp2 | null = null
  private readonly grass = grassTexture()
  private readonly sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    name: 'bbs-sky', vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false,
    uniforms: { sky: { value: new THREE.Vector3(BBS_SKY.r, BBS_SKY.g, BBS_SKY.b) }, fog: { value: new THREE.Vector3(BBS_FOG.r, BBS_FOG.g, BBS_FOG.b) } },
  }))
  private readonly floor = new THREE.Mesh(new THREE.PlaneGeometry(BBS_RENDER_DISTANCE * 2, BBS_RENDER_DISTANCE * 2), new THREE.ShaderMaterial({
    name: 'bbs-floor', vertexShader: FLOOR_VERTEX, fragmentShader: FLOOR_FRAGMENT,
    uniforms: { grass: { value: this.grass }, fog: { value: new THREE.Vector3(BBS_FOG.r, BBS_FOG.g, BBS_FOG.b) }, fogRange: { value: new THREE.Vector2(BBS_FOG_START, BBS_RENDER_DISTANCE) } },
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  }))

  constructor() {
    this.sky.name = SKY_NAME
    this.sky.frustumCulled = false
    this.sky.renderOrder = -1000
    this.floor.name = FLOOR_NAME
    this.floor.rotation.x = -Math.PI / 2
    this.floor.frustumCulled = false
  }

  get enabled(): boolean { return this.active }

  /**
   * Called before every render while enabled. Idempotent: meshes loaded after the toggle are swapped on the next frame,
   * and the sky/floor are re-pinned even if the environment was re-applied.
   */
  apply(scene: THREE.Scene, actors: Iterable<THREE.Object3D>, groundHeight = 0): void {
    if (!this.active) {
      this.active = true
      this.background = scene.background as THREE.Color | THREE.Texture | null
      this.fog = scene.fog
    }
    scene.background = BBS_FOG
    scene.fog = null
    if (this.sky.parent !== scene) scene.add(this.sky)
    if (this.floor.parent !== scene) scene.add(this.floor)
    this.floor.position.y = groundHeight
    for (const child of scene.children) if (child.name === GROUND_NAME || child.name === GRID_NAME) this.hide(child)
    for (const root of actors) this.paint(root)
  }

  restore(scene: THREE.Scene): void {
    if (!this.active) return
    for (const [mesh, material] of this.materials) {
      for (const swapped of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) swapped.dispose()
      mesh.material = material
    }
    for (const [object, visible] of this.visibility) object.visible = visible
    for (const [texture, [mag, min]] of this.filters) { texture.magFilter = mag; texture.minFilter = min; texture.needsUpdate = true }
    this.materials.clear(); this.visibility.clear(); this.filters.clear()
    scene.remove(this.sky, this.floor)
    scene.background = this.background
    scene.fog = this.fog
    this.background = null; this.fog = null
    this.active = false
  }

  dispose(): void {
    this.grass.dispose()
    this.sky.geometry.dispose(); (this.sky.material as THREE.Material).dispose()
    this.floor.geometry.dispose(); (this.floor.material as THREE.Material).dispose()
  }

  private hide(object: THREE.Object3D): void {
    if (!this.visibility.has(object)) this.visibility.set(object, object.visible)
    object.visible = false
  }

  private paint(root: THREE.Object3D): void {
    root.traverse((object) => {
      const kind = object.userData.t3dKind
      if (kind === CHARACTER_LABEL_KIND || kind === OBJECT_LABEL_KIND) { this.hide(object); return }
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || this.materials.has(mesh)) return
      const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (sources.some((material) => material.userData.bbsLook)) return
      for (const source of sources) {
        const map = (source as THREE.MeshStandardMaterial).map
        if (map && !this.filters.has(map)) {
          this.filters.set(map, [map.magFilter, map.minFilter])
          map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestFilter; map.needsUpdate = true
        }
      }
      this.materials.set(mesh, mesh.material)
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(entityMaterial) : entityMaterial(mesh.material)
    })
  }
}
