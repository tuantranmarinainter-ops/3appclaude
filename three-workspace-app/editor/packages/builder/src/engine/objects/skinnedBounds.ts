import * as THREE from 'three'

/** @types/three 把这两个字段写成非空，运行时默认是 null，three 自己也按 null 判断是否重算。 */
interface SkinnedBoundsCache {
  boundingBox: THREE.Box3 | null
  boundingSphere: THREE.Sphere | null
}

const _v = new THREE.Vector3()
const _inv = new THREE.Matrix4()
const _box = new THREE.Box3()
const installed = new WeakSet<THREE.SkinnedMesh>()
const bonesByRoot = new WeakMap<THREE.Object3D, THREE.Bone[]>()
const topMarginByRoot = new WeakMap<THREE.Object3D, number>()

/**
 * SkinnedMesh 的 boundingBox / boundingSphere 只在为 null 时算一次就长期缓存，
 * Box3.setFromObject（量标签高度、框选、取景）也会顺手把当时的体积写进去。
 * 骨骼摆过姿势后这份缓存还是旧体积，而 SkinnedMesh.raycast 会先拿它做剔除，
 * 身体一旦离开旧盒子，射线直接返回，人物在视口里就点不中。
 *
 * 姿势变更后置空，交给下一次 raycast 按当时的骨骼世界矩阵重算；不要在这里重算，
 * 此刻骨骼的 matrixWorld 还没随本帧更新。
 */
export function clearSkinnedRaycastBounds(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    const cache = mesh as unknown as SkinnedBoundsCache
    cache.boundingBox = null
    cache.boundingSphere = null
  })
}

/** 骨骼关节在网格本地空间（与 getVertexPosition 同一空间）的包围盒。 */
function boneBoxLocal(mesh: THREE.SkinnedMesh, target: THREE.Box3): THREE.Box3 {
  target.makeEmpty()
  for (const bone of mesh.skeleton.bones) {
    target.expandByPoint(_v.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(mesh.bindMatrixInverse))
  }
  return target
}

/**
 * 把 SkinnedMesh 的包围体改成「骨骼关节盒 + 统一外扩」。
 *
 * three 原版逐顶点做 CPU 蒙皮，而渲染排序每帧都要包围球中心，配合上面的逐帧置空，
 * 每个角色每帧要整网格蒙皮好几遍。边距在装配时按当前姿势精确量一次，取六个方向的
 * 最大值，任何姿势下都只会比真实体积大：raycast / 视锥剔除只拿它做粗筛，偏大无害。
 */
export function installBoneBounds(root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh || installed.has(mesh) || !mesh.skeleton?.bones.length) return
    const position = mesh.geometry.getAttribute('position')
    if (!position) return
    const precise = new THREE.Box3()
    for (let i = 0; i < position.count; i++) precise.expandByPoint(mesh.getVertexPosition(i, _v))
    const bones = boneBoxLocal(mesh, new THREE.Box3())
    if (precise.isEmpty() || bones.isEmpty()) return
    const margin = Math.max(
      0,
      precise.max.x - bones.max.x,
      precise.max.y - bones.max.y,
      precise.max.z - bones.max.z,
      bones.min.x - precise.min.x,
      bones.min.y - precise.min.y,
      bones.min.z - precise.min.z,
    )
    installed.add(mesh)
    const cache = mesh as unknown as SkinnedBoundsCache
    mesh.computeBoundingBox = () => {
      const box = cache.boundingBox ?? new THREE.Box3()
      boneBoxLocal(mesh, box).expandByScalar(margin)
      cache.boundingBox = box
    }
    mesh.computeBoundingSphere = () => {
      const sphere = cache.boundingSphere ?? new THREE.Sphere()
      boneBoxLocal(mesh, _box).expandByScalar(margin).getBoundingSphere(sphere)
      cache.boundingSphere = sphere
    }
  })
}

function skinnedBones(root: THREE.Object3D): THREE.Bone[] {
  let bones = bonesByRoot.get(root)
  if (bones) return bones
  const set = new Set<THREE.Bone>()
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh
    if (mesh.isSkinnedMesh) for (const bone of mesh.skeleton?.bones ?? []) set.add(bone)
  })
  bones = [...set]
  bonesByRoot.set(root, bones)
  return bones
}

/**
 * 蒙皮对象顶部在 parent 本地的 Y：骨骼最高点 + 首次精确测得的「顶点高出骨骼」余量。
 * 不是蒙皮对象返回 null。调用方须先 `parent.updateMatrixWorld(true)`。
 */
export function skinnedTopYInParent(object: THREE.Object3D, parent: THREE.Object3D): number | null {
  const bones = skinnedBones(object)
  if (!bones.length) return null
  _inv.copy(parent.matrixWorld).invert()
  let boneTop = -Infinity
  for (const bone of bones) {
    boneTop = Math.max(boneTop, _v.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(_inv).y)
  }
  let margin = topMarginByRoot.get(object)
  if (margin === undefined) {
    let vertexTop = -Infinity
    object.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      const position = mesh.geometry.getAttribute('position')
      if (!position) return
      for (let i = 0; i < position.count; i++) {
        mesh.getVertexPosition(i, _v).applyMatrix4(mesh.matrixWorld).applyMatrix4(_inv)
        if (_v.y > vertexTop) vertexTop = _v.y
      }
    })
    margin = Number.isFinite(vertexTop) ? Math.max(0, vertexTop - boneTop) : 0
    topMarginByRoot.set(object, margin)
  }
  return boneTop + margin
}
