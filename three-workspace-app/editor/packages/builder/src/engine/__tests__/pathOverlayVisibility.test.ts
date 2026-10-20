import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import type { DraftNode } from '../../contract/types'
import { buildPathInstance, syncPathSelection, type PathViewHost } from '../objects/PathObject'

function pathNode(id: string, visible: boolean): DraftNode {
  return {
    id,
    type: 'path',
    name: id,
    visible,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    path: {
      source: 'click',
      curve: 'catmullRom',
      closed: false,
      groundSnap: false,
      parameterization: 'arc-length',
      smoothing: 0.5,
      points: [
        { id: `${id}-a`, position: { x: 0, y: 0, z: 0 } },
        { id: `${id}-b`, position: { x: 1, y: 0, z: 0 } },
      ],
    },
  }
}

function host(): PathViewHost {
  return {
    scene: new THREE.Scene(),
    editorCamera: new THREE.PerspectiveCamera(),
    nodeById: new Map(),
    pathNodes: new Map(),
    pathViews: new Map(),
    pathPickTargets: new Map(),
    pathMaterials: new Map(),
    selectedPathId: null,
    visiblePathIds: new Set(),
  } as unknown as PathViewHost
}

test('机位视角藏起轨迹后，退出仍按原来的可见集恢复', () => {
  const graph = host()
  const shown = pathNode('walk', false)
  const other = pathNode('other', true)
  buildPathInstance(graph, shown)
  buildPathInstance(graph, other)
  syncPathSelection(graph, 'walk', ['walk'])
  assert.equal(graph.pathViews.get('walk')?.visible, true)
  assert.equal(graph.pathViews.get('other')?.visible, true)

  syncPathSelection(graph, null, [], true)
  assert.equal(graph.pathViews.get('walk')?.visible, false)
  assert.equal(graph.pathViews.get('other')?.visible, false)
  assert.deepEqual([...graph.visiblePathIds], ['walk'])
  assert.equal(graph.selectedPathId, 'walk')

  syncPathSelection(graph, 'walk', graph.visiblePathIds)
  assert.equal(graph.pathViews.get('walk')?.visible, true)
  assert.equal(graph.pathViews.get('other')?.visible, true)
})
