import { AnimationClip, Bone, BufferGeometry, Float32BufferAttribute, DoubleSide, Group, Matrix4, MeshStandardMaterial, Quaternion, QuaternionKeyframeTrack, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, VectorKeyframeTrack, type Object3D, type Texture, type KeyframeTrack } from 'three'
import { evaluateBobjAction, parseBobjActions, type BobjAction } from './index'
import { parseBobjArmature, type BobjArmature } from './reverse'

export interface BobjModelObject { name: string; faces: Array<Array<[number, number | null, number | null]>> }
export interface BobjModel {
  armature: BobjArmature
  actions: Map<string, BobjAction>
  objects: BobjModelObject[]
  positions: number[][]
  uvs: number[][]
  normals: number[][]
  weights: Array<Array<{ bone: string; weight: number }>>
  unitMeters: number
  unitSource: 'option' | 'verity-preset' | 'default'
  armatureName: string
  motionScale: number | null
}
export interface BobjModelReport {
  objects: string[]; boneCount: number; actionCount: number; vertexCount: number
  heightMeters: number; hipHeightMeters: number | null; unitMeters: number
  unitSource: BobjModel['unitSource']; motionScale: number | null; floorNative: number
  helperObjects: string[]; restFacing: BobjFacing | null; actionFacing: BobjFacing | null
  framingBoundsMeters: { min: number[]; max: number[] } | null
  missingTextures: string[]; warnings: string[]
}
export interface BobjFacing { left: number[]; forward: number[]; yawDegrees: number }
export interface BobjModelOptions {
  /** Metres per native BOBJ unit. Overrides the armature preset; motion_scale is never a unit. */
  unitMeters?: number
  /** Resolves the relative BBS path, e.g. textures/verity.mdl/Verity.smd/default.png. No I/O in the parser. */
  readTexture?: (path: string) => Uint8Array | undefined
  decodeTexture?: (bytes: Uint8Array) => Texture
}
export const bobjModelNodeName = (name: string) => name.replace(/[.\[\]:/]/g, '_')

/** BBS exporter indices are global across objects; vw records belong to the preceding v. */
export function parseBobjModel(text: string, options: Pick<BobjModelOptions, 'unitMeters'> = {}): BobjModel {
  const armatureName = text.match(/^arm_name\s+(.+)$/m)?.[1].trim() ?? ''
  const unitMeters = options.unitMeters ?? (armatureName === 'verity.mdl' ? 0.4915394 : 1)
  if (!(unitMeters > 0) || !Number.isFinite(unitMeters)) throw new Error('BOBJ unitMeters must be finite and positive')
  const scale = text.match(/^#.*BBSFix.*\bmotion_scale\s*=\s*(\S+)/mi)
  const motionScale = scale && Number.isFinite(Number(scale[1])) ? Number(scale[1]) : null
  const model: BobjModel = { armature: parseBobjArmature(text), actions: parseBobjActions(text), objects: [], positions: [], uvs: [], normals: [], weights: [], unitMeters,
    unitSource: options.unitMeters !== undefined ? 'option' : armatureName === 'verity.mdl' ? 'verity-preset' : 'default', armatureName, motionScale }
  let object: BobjModelObject | undefined
  const fail = (line: number, reason: string): never => { throw new Error(`BOBJ line ${line}: ${reason}`) }
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const [kind, ...parts] = raw.trim().split(/\s+/), line = i + 1
    const numbers = (count: number) => {
      const values = parts.map(Number)
      if (values.length !== count || values.some(v => !Number.isFinite(v))) fail(line, `invalid ${kind}`)
      return values
    }
    if (kind === 'o') {
      const name = parts.join(' ')
      // Object names are also texture paths. Refuse traversal on every platform.
      if (!name || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..') || /^[A-Za-z]:/.test(name)) fail(line, 'unsafe object name')
      if (model.objects.some(o => o.name === name)) fail(line, 'duplicate object')
      object = { name, faces: [] }; model.objects.push(object)
    } else if (kind === 'v') { model.positions.push(numbers(3)); model.weights.push([]) }
    else if (kind === 'vt') model.uvs.push(numbers(2))
    else if (kind === 'vn') model.normals.push(numbers(3))
    else if (kind === 'vw') {
      const weight = Number(parts[1])
      if (!model.weights.length || parts.length !== 2 || !Number.isFinite(weight) || weight < 0 || !model.armature.bones.some(b => b.name === parts[0])) fail(line, 'invalid vertex weight')
      model.weights[model.weights.length - 1].push({ bone: parts[0], weight })
    } else if (kind === 'f') {
      if (!object || parts.length < 3) fail(line, 'face needs an object and at least three corners')
      const limits = [model.positions.length, model.uvs.length, model.normals.length]
      const face = parts.map(corner => {
        const fields = corner.split('/')
        if (fields.length > 3 || !fields[0]) fail(line, 'invalid face corner')
        return limits.map((limit, axis) => {
          if (!fields[axis]) return null
          const index = Number(fields[axis]), resolved = index < 0 ? limit + index : index - 1
          if (!Number.isInteger(index) || index === 0 || resolved < 0 || resolved >= limit) fail(line, 'face index out of bounds')
          return resolved
        }) as [number, number | null, number | null]
      })
      object!.faces.push(face)
    }
  }
  const names = model.armature.bones.map(b => bobjModelNodeName(b.name))
  if (new Set(names).size !== names.length) throw new Error('BOBJ bone names collide after track-name sanitization')
  return model
}

/** Builds a metre/Y-up model with native rest/mesh/action coordinates beneath a scale/floor wrapper. */
export function buildBobjModel(model: BobjModel, options: BobjModelOptions = {}) {
  const root = new Group(); root.name = 'bobj-model'
  const unit = options.unitMeters ?? model.unitMeters
  if (!(unit > 0) || !Number.isFinite(unit)) throw new Error('BOBJ unitMeters must be finite and positive')
  const unitSource = options.unitMeters !== undefined ? 'option' : model.unitSource
  const nodes = new Map<string, Bone>()
  for (const bone of model.armature.bones) {
    const node = new Bone(); node.name = bobjModelNodeName(bone.name); node.userData.bobjName = bone.name; node.userData.bobjRestLocal = [...bone.restLocal]; node.userData.bobjRestWorld = [...bone.restWorld]
    new Matrix4().fromArray([...bone.restLocal]).decompose(node.position, node.quaternion, node.scale)
    ;(bone.parent ? nodes.get(bone.parent)! : root).add(node); nodes.set(bone.name, node)
  }
  // Bind inverses stay in the native/common model frame; the wrapper is applied only after binding.
  root.updateMatrixWorld(true)
  const skeleton = new Skeleton([...nodes.values()]); skeleton.calculateInverses()
  const helperObjects: string[] = [], visibleVertices = new Set<number>()
  const images = new Map<string, Uint8Array>(), missingTextures: string[] = [], warnings: string[] = []
  let vertexCount = 0
  for (const object of model.objects) {
    const vertices = new Set(object.faces.flatMap(face => face.map(c => c[0])))
    const helper = vertices.size > 0 && [...vertices].every(v => {
      const influences = model.weights[v].filter(w => w.weight > 0)
      return influences.length > 0 && influences.every(w => /^camera(?:_|$)/i.test(w.bone))
    })
    if (helper) {
      helperObjects.push(object.name)
      const node = new Group(); node.name = `BOBJ_helper_${helperObjects.length}`; node.userData = { bobjObject: object.name, bobjHelper: true, reason: 'camera-only weights' }; root.add(node)
      continue
    }
    for (const v of vertices) visibleVertices.add(v)
    const position: number[] = [], uv: number[] = [], normal: number[] = [], joints: number[] = [], weights: number[] = []
    let allNormals = true
    for (const face of object.faces) for (let i = 1; i < face.length - 1; i++) for (const [v, vt, vn] of [face[0], face[i], face[i + 1]]) {
      position.push(...model.positions[v]); /* OBJ/Blender v starts at the image bottom; glTF and decoded PNG rows start at the top. */ uv.push(...(vt === null ? [0, 0] : [model.uvs[vt][0], 1 - model.uvs[vt][1]])); normal.push(...(vn === null ? [0, 0, 0] : model.normals[vn])); allNormals &&= vn !== null
      const influences = model.weights[v].filter(w => w.weight > 0).sort((a, b) => b.weight - a.weight)
      if (!influences.length) throw new Error(`BOBJ object ${object.name}: vertex ${v + 1} has no bone influence`)
      if (influences.length > 4) warnings.push(`Object ${object.name} vertex ${v + 1}: truncated ${influences.length} influences to four`)
      const kept = influences.slice(0, 4), sum = kept.reduce((n, w) => n + w.weight, 0)
      for (let k = 0; k < 4; k++) { joints.push(kept[k] ? model.armature.bones.findIndex(b => b.name === kept[k].bone) : 0); weights.push(kept[k] ? kept[k].weight / sum : 0) }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(position, 3)); geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
    geometry.setAttribute('normal', new Float32BufferAttribute(normal, 3)); if (!allNormals) geometry.computeVertexNormals()
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4)); geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
    const path = `textures/${object.name}/default.png`, image = options.readTexture?.(path)
    if (image) images.set(object.name, image); else missingTextures.push(object.name)
    const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, alphaTest: 0.5, side: DoubleSide }); material.name = object.name; material.userData.bobjTexturePath = path
    if (image && options.decodeTexture) material.map = options.decodeTexture(image)
    const mesh = new SkinnedMesh(geometry, material)
    // Track binding must use bone names for the normalizer. Keep object identity in metadata when a node name collides.
    const used = new Set([...nodes.values()].map(n => n.name).concat(root.children.map(n => n.name)))
    let meshName = object.name
    while (used.has(meshName)) meshName = `BOBJ_object_${meshName}`
    mesh.name = meshName; mesh.userData.bobjObject = object.name
    root.add(mesh); mesh.bind(skeleton, new Matrix4()); vertexCount += position.length / 3
  }
  root.animations = [...model.actions.values()].map(action => {
    const duration = action.durationTicks / 20
    // 60 Hz includes every integer BBS tick and every 30 FPS normalization sample.
    const times = Array.from({ length: Math.ceil(duration * 60) + 1 }, (_, i) => Math.min(i / 60, duration))
    const values = new Map(model.armature.bones.map(b => [b.name, { p: [] as number[], q: [] as number[], s: [] as number[] }]))
    for (const time of times) {
      const worlds = new Map(evaluateBobjAction(model.armature, action, time * 20).map(b => [b.name, new Matrix4().fromArray([...b.worldMatrix])]))
      for (const bone of model.armature.bones) {
        const local = bone.parent ? worlds.get(bone.parent)!.clone().invert().multiply(worlds.get(bone.name)!) : worlds.get(bone.name)!
        const p = new Vector3(), q = new Quaternion(), s = new Vector3(); local.decompose(p, q, s)
        const entry = values.get(bone.name)!; entry.p.push(...p.toArray()); entry.q.push(...q.normalize().toArray()); entry.s.push(...s.toArray())
      }
    }
    const tracks: KeyframeTrack[] = model.armature.bones.flatMap(b => {
      const entry = values.get(b.name)!, name = nodes.get(b.name)!.name
      return [new VectorKeyframeTrack(`${name}.position`, times, entry.p), new QuaternionKeyframeTrack(`${name}.quaternion`, times, entry.q), new VectorKeyframeTrack(`${name}.scale`, times, entry.s)]
    })
    return new AnimationClip(action.name, duration, tracks)
  })
  const points = [...visibleVertices].map(v => model.positions[v])
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity]
  for (const point of points) for (let axis = 0; axis < 3; axis++) { minimum[axis] = Math.min(minimum[axis], point[axis]); maximum[axis] = Math.max(maximum[axis], point[axis]) }
  const floor = points.length ? minimum[1] : 0, ceiling = points.length ? maximum[1] : 0
  const hips = ['COG', 'Hips', 'Pelvis', 'body'].map(name => model.armature.bones.find(b => b.name.toLowerCase() === name.toLowerCase())).find(Boolean)
  const hipHeightMeters = hips ? (new Matrix4().fromArray([...hips.restWorld]).elements[13] - floor) * unit : null
  if (hipHeightMeters === null) warnings.push('Hip height unavailable: no COG/Hips/Pelvis/body bone')
  else if (hipHeightMeters < 0.5 || hipHeightMeters > 3) warnings.push(`Hip height ${hipHeightMeters.toFixed(6)} m outside 0.5–3 m; verify unitMeters`)
  for (const object of missingTextures) warnings.push(`Object ${object}: missing textures/${object}/default.png`)
  const restFacing = modelFacing(model)
  let actionFacing = restFacing
  const first = model.actions.values().next().value as BobjAction | undefined
  const rootBone = model.armature.bones.find(b => b.name === 'Root')
  if (restFacing && first && rootBone) {
    const pose = evaluateBobjAction(model.armature, first, 0).find(b => b.name === rootBone.name)!
    const delta = new Matrix4().fromArray([...pose.worldMatrix]).multiply(new Matrix4().fromArray([...rootBone.restWorld]).invert())
    actionFacing = facingFromLeft(new Vector3().fromArray(restFacing.left).transformDirection(delta), new Vector3().fromArray(restFacing.forward).transformDirection(delta))
  }
  root.scale.setScalar(unit); root.position.y = -floor * unit; root.updateMatrixWorld(true)
  const framingBoundsMeters = points.length ? { min: minimum.map((v, axis) => (v - (axis === 1 ? floor : 0)) * unit), max: maximum.map((v, axis) => (v - (axis === 1 ? floor : 0)) * unit) } : null
  const report: BobjModelReport = { objects: model.objects.map(o => o.name), helperObjects, boneCount: nodes.size, actionCount: root.animations.length, vertexCount, heightMeters: (ceiling - floor) * unit, hipHeightMeters, unitMeters: unit, unitSource, motionScale: model.motionScale, floorNative: floor, restFacing, actionFacing, framingBoundsMeters, missingTextures, warnings: [...new Set(warnings)] }
  root.userData.bobjModel = report
  return { root, report, images }
}

/** Self-contained GLB writer: copies PNG bytes without canvas, DOM, image decoding, or re-encoding. */
export function bobjModelToGlb(model: BobjModel, options: BobjModelOptions = {}): { bytes: Uint8Array; report: BobjModelReport } {
  const { root, report, images } = buildBobjModel(model, options)
  const json: Record<string, any> = { asset: { version: '2.0', generator: 'BOBJ model importer' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], skins: [], materials: [], images: [], textures: [], samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 }], animations: [], accessors: [], bufferViews: [], buffers: [], extras: { bobjModel: report } }
  const chunks: Uint8Array[] = []; let length = 0
  const view = (bytes: Uint8Array) => { const index = json.bufferViews.length; json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length }); chunks.push(bytes); length += Math.ceil(bytes.length / 4) * 4; return index }
  const accessor = (array: Float32Array | Uint16Array, size: number, bounds = false) => {
    const result: Record<string, any> = { bufferView: view(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)), componentType: array instanceof Uint16Array ? 5123 : 5126, count: array.length / size, type: ({ 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4', 16: 'MAT4' } as Record<number, string>)[size] }
    if (bounds) {
      result.min = Array.from({ length: size }, () => Infinity); result.max = Array.from({ length: size }, () => -Infinity)
      for (let i = 0; i < array.length; i++) { result.min[i % size] = Math.min(result.min[i % size], array[i]); result.max[i % size] = Math.max(result.max[i % size], array[i]) }
    }
    json.accessors.push(result); return json.accessors.length - 1
  }
  const objects: Object3D[] = []; root.traverse(node => objects.push(node))
  const index = new Map(objects.map((node, i) => [node, i]))
  for (const node of objects) {
    const entry: Record<string, any> = { name: node.name, translation: node.position.toArray(), rotation: node.quaternion.toArray(), scale: node.scale.toArray(), extras: node.userData }
    const children = node.children.map(n => index.get(n))
    if (children.length) entry.children = children
    if (node === root) json.scenes[0].nodes.push(index.get(node))
    json.nodes.push(entry)
  }
  for (const node of objects) if (node instanceof SkinnedMesh) {
    const attributes: Record<string, number> = {}
    for (const [attribute, gltf] of [['position', 'POSITION'], ['normal', 'NORMAL'], ['uv', 'TEXCOORD_0'], ['skinIndex', 'JOINTS_0'], ['skinWeight', 'WEIGHTS_0']]) {
      const a = node.geometry.getAttribute(attribute)
      attributes[gltf] = accessor(a.array as Float32Array | Uint16Array, a.itemSize, attribute === 'position')
    }
    const material: Record<string, any> = { name: String(node.userData.bobjObject), pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true }
    const objectName = String(node.userData.bobjObject)
    const image = images.get(objectName)
    if (image) {
      const texture = json.textures.length
      json.images.push({ name: objectName, mimeType: 'image/png', bufferView: view(image) }); json.textures.push({ sampler: 0, source: json.images.length - 1 })
      material.pbrMetallicRoughness.baseColorTexture = { index: texture }; material.alphaMode = 'MASK'; material.alphaCutoff = 0.5
    }
    json.materials.push(material)
    const mesh = json.meshes.length; json.meshes.push({ name: objectName, primitives: [{ attributes, material: json.materials.length - 1, mode: 4 }] })
    const inverses = new Float32Array(node.skeleton.boneInverses.flatMap(m => m.toArray()))
    const skin = json.skins.length; json.skins.push({ joints: node.skeleton.bones.map(b => index.get(b)), inverseBindMatrices: accessor(inverses, 16) })
    Object.assign(json.nodes[index.get(node)!], { mesh, skin })
  }
  const byName = new Map(objects.filter(n => n instanceof Bone).map(n => [n.name, index.get(n)!]))
  for (const clip of root.animations) {
    const animation: Record<string, any> = { name: clip.name, samplers: [], channels: [] }
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.'), name = track.name.slice(0, dot), property = track.name.slice(dot + 1)
      const path = ({ position: 'translation', quaternion: 'rotation', scale: 'scale' } as Record<string, string>)[property]
      animation.channels.push({ sampler: animation.samplers.length, target: { node: byName.get(name), path } })
      animation.samplers.push({ input: accessor(new Float32Array(track.times), 1, true), output: accessor(new Float32Array(track.values), track.getValueSize()), interpolation: 'LINEAR' })
    }
    json.animations.push(animation)
  }
  json.buffers = [{ byteLength: length }]
  const text = new TextEncoder().encode(JSON.stringify(json)), jsonLength = Math.ceil(text.length / 4) * 4
  const bytes = new Uint8Array(28 + jsonLength + length), header = new DataView(bytes.buffer)
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, bytes.length, true)
  header.setUint32(12, jsonLength, true); header.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + jsonLength); bytes.set(text, 20)
  header.setUint32(20 + jsonLength, length, true); header.setUint32(24 + jsonLength, 0x004e4942, true)
  let cursor = 28 + jsonLength
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += Math.ceil(chunk.length / 4) * 4 }
  return { bytes, report }
}

function facingFromLeft(left: Vector3, forward: Vector3): BobjFacing {
  left.y = 0; forward.y = 0; left.normalize(); forward.normalize()
  return { left: left.toArray(), forward: forward.toArray(), yawDegrees: Math.atan2(forward.x, forward.z) * 180 / Math.PI }
}

/** Native facing from leg separation, with toe/foot direction disambiguating the forward sign. */
function modelFacing(model: BobjModel): BobjFacing | null {
  const position = (name: string) => {
    const bone = model.armature.bones.find(b => b.name === name)
    return bone ? new Vector3().setFromMatrixPosition(new Matrix4().fromArray([...bone.restWorld])) : null
  }
  const l = position('Upper_Leg_L'), r = position('Upper_Leg_R'), toeL = position('Toe_L'), toeR = position('Toe_R')
  if (!l || !r || !toeL || !toeR) return null
  const left = l.clone().sub(r); left.y = 0
  if (left.lengthSq() < 1e-12) return null
  left.normalize()
  const forward = left.clone().cross(new Vector3(0, 1, 0)).normalize()
  const toes = toeL.clone().add(toeR).sub((position('Foot_L') ?? l).clone().add(position('Foot_R') ?? r)); toes.y = 0
  if (toes.lengthSq() > 1e-12 && toes.dot(forward) < 0) forward.negate()
  return facingFromLeft(left, forward)
}
