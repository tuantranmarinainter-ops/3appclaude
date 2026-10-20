import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three'
import type { DraftNode } from '../../../contract/types'
import type { StageGraph } from '../../objects/graph'
import { Picker } from '../Picker'

function primitive(id: string, parentId?: string): DraftNode {
  return {
    id,
    type: 'primitive',
    name: id,
    visible: true,
    locked: false,
    parentId,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }
}

describe('分组图元点选', () => {
  it('点中挂在组里的模型时选中这一块，而不是落空', () => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(0, 0.5, 5)
    camera.lookAt(0, 0.5, 0)
    camera.updateMatrixWorld(true)

    const group = new Group()
    group.position.set(1, 0, 0)
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    mesh.position.set(-1, 0.5, 0)
    group.add(mesh)
    group.updateMatrixWorld(true)

    const graph = {
      characters: new Map(),
      props: new Map(),
      primitives: new Map([['coffee_machine', mesh]]),
      nodeById: new Map([
        ['material_1', { ...primitive('material_1'), type: 'group' }],
        ['coffee_machine', primitive('coffee_machine', 'material_1')],
      ]),
    } as unknown as StageGraph

    assert.equal(new Picker(camera).pickNode(graph, 0, 0), 'coffee_machine')
  })
})
