import * as THREE from 'three'
import { OUTLINE_LAYER } from './Layers'

/** 选中外轮廓线颜色，sRGB 直接写进画布，不走色彩管理。 */
export const SELECTION_OUTLINE_RGB = [250, 156, 51] as const
/** 轮廓线宽度，单位 CSS 像素；乘 devicePixelRatio 换成设备像素。 */
const OUTLINE_WIDTH_CSS_PX = 2
/** 超过这个数量的多选退化成一次性合并描边，避免每个对象各跑一遍整屏 pass。 */
const MAX_INDEPENDENT_OUTLINES = 8

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// 遮罩 alpha 在对象内部为 1。轮廓 = 对象外、且一圈半径内能采到对象的像素。
// 遮罩用 4x MSAA 渲，边缘 alpha 是渐变的，所以轮廓线自带抗锯齿。
const FRAGMENT = /* glsl */ `
uniform sampler2D tMask;
uniform vec2 texel;
uniform float radius;
uniform vec3 color;
varying vec2 vUv;
void main() {
  float center = texture2D(tMask, vUv).a;
  float hit = 0.0;
  for (int i = 0; i < 16; i++) {
    float a = 6.2831853 * float(i) / 16.0;
    vec2 dir = vec2(cos(a), sin(a)) * texel;
    hit = max(hit, texture2D(tMask, vUv + dir * radius).a);
    hit = max(hit, texture2D(tMask, vUv + dir * radius * 0.5).a);
  }
  float alpha = hit * (1.0 - center);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(color, alpha);
}
`

function isOutlineMesh(object: THREE.Object3D): object is THREE.Mesh {
  if (!(object as THREE.Mesh).isMesh) return false
  const material = (object as THREE.Mesh).material
  const list = Array.isArray(material) ? material : [material]
  // 拾取用的隐形碰撞盒 material.visible=false，不能被描出来。
  return list.some((m) => m.visible !== false)
}

function collectMeshes(root: THREE.Object3D, into: THREE.Mesh[]): void {
  root.traverse((object) => {
    if (isOutlineMesh(object)) into.push(object)
  })
}

/**
 * 选中对象的外轮廓线：把选中对象单独画进遮罩，再在整屏上沿遮罩边缘描一圈。
 * 遮罩里只有选中对象，所以描边完全不受场景深度影响，始终盖在最上层。
 * 只管编辑视口；导出、机位预览走别的渲染路径，看不到它。
 */
export class SelectionOutline {
  private target: THREE.WebGLRenderTarget | null = null
  private readonly maskMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  })
  private readonly quadMaterial = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      tMask: { value: null as THREE.Texture | null },
      texel: { value: new THREE.Vector2(1, 1) },
      radius: { value: OUTLINE_WIDTH_CSS_PX },
      color: {
        value: new THREE.Vector3(
          SELECTION_OUTLINE_RGB[0] / 255,
          SELECTION_OUTLINE_RGB[1] / 255,
          SELECTION_OUTLINE_RGB[2] / 255,
        ),
      },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  private readonly quadGeometry = new THREE.PlaneGeometry(2, 2)
  private readonly quadScene = new THREE.Scene()
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly size = new THREE.Vector2()
  private readonly prevViewport = new THREE.Vector4()
  private readonly prevClear = new THREE.Color()

  constructor() {
    const quad = new THREE.Mesh(this.quadGeometry, this.quadMaterial)
    quad.frustumCulled = false
    this.quadScene.add(quad)
  }

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    roots: readonly THREE.Object3D[],
  ): void {
    if (roots.length === 0) return
    const groups: THREE.Mesh[][] = []
    if (roots.length <= MAX_INDEPENDENT_OUTLINES) {
      for (const root of roots) {
        const meshes: THREE.Mesh[] = []
        collectMeshes(root, meshes)
        if (meshes.length) groups.push(meshes)
      }
    } else {
      const meshes: THREE.Mesh[] = []
      for (const root of roots) collectMeshes(root, meshes)
      if (meshes.length) groups.push(meshes)
    }
    if (groups.length === 0) return

    renderer.getDrawingBufferSize(this.size)
    const width = Math.max(1, Math.floor(this.size.x))
    const height = Math.max(1, Math.floor(this.size.y))
    const pixelRatio = renderer.getPixelRatio()
    const target = this.ensureTarget(width, height)

    const prevTarget = renderer.getRenderTarget()
    const prevAutoClear = renderer.autoClear
    const prevClearAlpha = renderer.getClearAlpha()
    const prevScissorTest = renderer.getScissorTest()
    const prevBackground = scene.background
    const prevOverride = scene.overrideMaterial
    const prevMask = camera.layers.mask
    renderer.getClearColor(this.prevClear)
    renderer.getViewport(this.prevViewport)

    scene.background = null
    scene.overrideMaterial = this.maskMaterial
    camera.layers.set(OUTLINE_LAYER)
    renderer.autoClear = false
    renderer.setScissorTest(false)
    this.quadMaterial.uniforms.tMask.value = target.texture
    this.quadMaterial.uniforms.texel.value.set(1 / width, 1 / height)
    this.quadMaterial.uniforms.radius.value = OUTLINE_WIDTH_CSS_PX * pixelRatio

    try {
      for (const meshes of groups) {
        for (const mesh of meshes) mesh.layers.enable(OUTLINE_LAYER)
        renderer.setRenderTarget(target)
        renderer.setClearColor(0x000000, 0)
        renderer.clear(true, true, false)
        renderer.render(scene, camera)
        for (const mesh of meshes) mesh.layers.disable(OUTLINE_LAYER)

        renderer.setRenderTarget(null)
        renderer.setViewport(0, 0, width / pixelRatio, height / pixelRatio)
        renderer.render(this.quadScene, this.quadCamera)
      }
    } finally {
      for (const meshes of groups) for (const mesh of meshes) mesh.layers.disable(OUTLINE_LAYER)
      camera.layers.mask = prevMask
      scene.background = prevBackground
      scene.overrideMaterial = prevOverride
      renderer.setRenderTarget(prevTarget)
      renderer.setClearColor(this.prevClear, prevClearAlpha)
      renderer.setViewport(this.prevViewport)
      renderer.setScissorTest(prevScissorTest)
      renderer.autoClear = prevAutoClear
    }
  }

  private ensureTarget(width: number, height: number): THREE.WebGLRenderTarget {
    if (this.target && this.target.width === width && this.target.height === height) return this.target
    this.target?.dispose()
    this.target = new THREE.WebGLRenderTarget(width, height, {
      samples: 4,
      depthBuffer: true,
      type: THREE.UnsignedByteType,
    })
    return this.target
  }

  dispose(): void {
    this.target?.dispose()
    this.target = null
    this.maskMaterial.dispose()
    this.quadMaterial.dispose()
    this.quadGeometry.dispose()
  }
}
