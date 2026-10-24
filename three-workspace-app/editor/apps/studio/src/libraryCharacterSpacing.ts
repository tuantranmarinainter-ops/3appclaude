import { Box3, Matrix4, Quaternion, Vector3 } from 'three'
import { unpackLibraryGlb } from './libraryModels'

const MIN_SPACING_METERS = 1.2

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function numbers(value: unknown, length: number, fallback: number[]): number[] {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? value as number[] : fallback
}

function localMatrix(node: JsonObject): Matrix4 {
  if (Array.isArray(node.matrix) && node.matrix.length === 16 && node.matrix.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return new Matrix4().fromArray(node.matrix as number[])
  }
  return new Matrix4().compose(
    new Vector3().fromArray(numbers(node.translation, 3, [0, 0, 0])),
    new Quaternion().fromArray(numbers(node.rotation, 4, [0, 0, 0, 1])),
    new Vector3().fromArray(numbers(node.scale, 3, [1, 1, 1])),
  )
}

/** Returns the model-space X width of the visible mesh bounds in a library GLB. */
export function libraryCharacterBoundingBoxWidth(bytes: Buffer): number {
  const { json } = unpackLibraryGlb(bytes)
  const nodes: Array<JsonObject | null> = Array.isArray(json.nodes) ? (json.nodes as unknown[]).map(object) : []
  const meshes: Array<JsonObject | null> = Array.isArray(json.meshes) ? (json.meshes as unknown[]).map(object) : []
  const accessors: Array<JsonObject | null> = Array.isArray(json.accessors) ? (json.accessors as unknown[]).map(object) : []
  const roots = object(Array.isArray(json.scenes) ? json.scenes[typeof json.scene === 'number' ? json.scene : 0] : null)?.nodes
  const parented = new Set<number>()
  for (const node of nodes) for (const child of (Array.isArray(node?.children) ? node.children : [])) if (typeof child === 'number') parented.add(child)
  const rootIds = Array.isArray(roots) ? roots.filter((id): id is number => typeof id === 'number') : nodes.map((_, id) => id).filter((id) => !parented.has(id))
  const bounds = new Box3()
  const visited = new Set<number>()
  const visit = (id: number, parent: Matrix4) => {
    if (visited.has(id)) return
    visited.add(id)
    const node = nodes[id]
    if (!node) return
    const world = parent.clone().multiply(localMatrix(node))
    const mesh = typeof node.mesh === 'number' ? meshes[node.mesh] : null
    for (const primitive of (Array.isArray(mesh?.primitives) ? mesh.primitives : [])) {
      const attributes = object(object(primitive)?.attributes)
      const accessor = typeof attributes?.POSITION === 'number' ? accessors[attributes.POSITION] : null
      const min = numbers(accessor?.min, 3, []), max = numbers(accessor?.max, 3, [])
      if (min.length !== 3 || max.length !== 3) continue
      bounds.union(new Box3(new Vector3().fromArray(min), new Vector3().fromArray(max)).applyMatrix4(world))
    }
    for (const child of (Array.isArray(node.children) ? node.children : [])) if (typeof child === 'number') visit(child, world)
  }
  for (const id of rootIds) visit(id, new Matrix4())
  for (let id = 0; id < nodes.length; id++) visit(id, new Matrix4())
  const width = bounds.max.x - bounds.min.x
  if (!(width > 0) || !Number.isFinite(width)) throw new TypeError('Library character model has no measurable mesh bounds')
  return width
}

export function nextLibraryCharacterX(existingX: number[], bboxWidth: number): number {
  if (!Number.isFinite(bboxWidth) || bboxWidth <= 0) throw new TypeError('Character bounding box width must be positive')
  if (!existingX.length) return 0
  if (existingX.some((value) => !Number.isFinite(value))) throw new TypeError('Character positions must be finite')
  return Math.max(...existingX) + Math.max(MIN_SPACING_METERS, 1.25 * bboxWidth)
}
