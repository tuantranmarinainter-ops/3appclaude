import * as THREE from 'three'
import { EDITOR_LAYER } from '../core/Layers'
import type { StageGraph } from '../objects/graph'

export function ndcFromClient(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -(((clientY - rect.top) / rect.height) * 2 - 1),
  }
}

export class Picker {
  readonly raycaster = new THREE.Raycaster()

  constructor(private readonly source: THREE.Camera | (() => THREE.Camera)) {}

  private get camera(): THREE.Camera { return typeof this.source === 'function' ? this.source() : this.source }

  pickNodeHit(graph: StageGraph, ndcX: number, ndcY: number): { id: string; dist: number } | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    // 分组自己没有网格，可见的是挂在它下面的图元。父节点只表示编组，
    // 点中的仍是这一块本身；滤掉 parentId 会让 agent 编进组里的模型点不中。
    const targets: [string, THREE.Object3D][] = [
      ...[...graph.characters.entries()].map(([id, ch]) => [id, ch.root] as [string, THREE.Object3D]),
      ...[...graph.props.entries()],
      ...graph.primitives.entries(),
    ]
    let best: { id: string; dist: number } | null = null
    for (const [id, obj] of targets) {
      const node = graph.nodeById.get(id) ?? graph.doc?.content.nodes.find((n) => n.id === id)
      if (node?.visible === false) continue
      const hits = this.raycaster.intersectObject(obj, true)
      if (hits.length > 0 && (!best || hits[0].distance < best.dist)) {
        best = { id, dist: hits[0].distance }
      }
    }
    return best
  }

  pickNode(graph: StageGraph, ndcX: number, ndcY: number): string | null {
    return this.pickNodeHit(graph, ndcX, ndcY)?.id ?? null
  }

  pickCameraHit(graph: StageGraph, ndcX: number, ndcY: number): { id: string; dist: number } | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    this.raycaster.layers.set(EDITOR_LAYER)
    const prevThreshold = this.raycaster.params.Line?.threshold ?? 1
    this.raycaster.params.Line = { ...this.raycaster.params.Line, threshold: 0.15 }
    let best: { id: string; dist: number } | null = null
    for (const [id, cam] of graph.cameras) {
      if (!cam.gizmo.group.visible) continue
      const hits = this.raycaster.intersectObjects(cam.gizmo.pickTargets, true)
      if (hits.length > 0 && (!best || hits[0].distance < best.dist)) {
        best = { id, dist: hits[0].distance }
      }
    }
    this.raycaster.params.Line.threshold = prevThreshold
    this.raycaster.layers.set(0)
    return best
  }

  groundPoint(ndcX: number, ndcY: number, y: number): [number, number, number] | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y)
    const pt = new THREE.Vector3()
    return this.raycaster.ray.intersectPlane(plane, pt) ? [pt.x, y, pt.z] : null
  }
}
