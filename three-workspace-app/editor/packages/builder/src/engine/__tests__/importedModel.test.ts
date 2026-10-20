import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import * as THREE from 'three'
import { buildCharacterInstance } from '../objects/CharacterObject'
import { attachProp } from '../objects/PropObject'
import type { StageGraph } from '../objects/graph'
import type { DraftNode } from '../../contract/types'

vi.mock('../objects/labels', async (original) => ({
  ...await original<typeof import('../objects/labels')>(),
  makeLabel: () => new THREE.Sprite(),
}))

function setup() {
  const template = new THREE.Group()
  template.position.y = 10
  template.scale.set(2, 3, 4)
  const hips = Object.assign(new THREE.Bone(), { name: 'mixamorigHips', ID: 10 })
  hips.position.y = 100; hips.userData.transformData = {}; hips.userData.originalName = 'mixamorig:Hips'
  const alias = Object.assign(new THREE.Bone(), { name: hips.name, ID: 10 })
  alias.userData.originalName = hips.userData.originalName
  hips.add(alias); template.add(hips)
  const materials = [new THREE.MeshPhongMaterial({ color: '#ff0000', transparent: true, opacity: 0.4 }), new THREE.MeshPhongMaterial({ color: '#00ff00' })]
  template.add(new THREE.Mesh(new THREE.BoxGeometry(), materials))
  const node = { id: 'imported', type: 'character', name: 'Imported', visible: true, locked: false,
    transform: { position: { x: 3, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 } },
    metadata: { rig: 'direct', modelFormat: 'fbx', modelUnitMeters: 0.01, preserveMaterials: true },
    character: { animation: { mode: 'pose', controlValues: {} }, appearance: { color: '#0000ff' } },
  } as unknown as DraftNode
  const graph = { scene: new THREE.Scene(), characters: new Map(), nodeById: new Map(), props: new Map() } as unknown as StageGraph
  return { template, node, graph, materials }
}

test('imported Character keeps model transforms/material groups, explicit units and the canonical rest bind', () => {
  const { template, node, graph, materials } = setup()
  buildCharacterInstance(graph, node, template, false)
  const character = graph.characters.get(node.id)!
  assert.equal(character.rig, 'direct')
  assert.equal(character.retargeter, null)
  assert.deepEqual(character.inner.scale.toArray(), [0.01, 0.01, 0.01])
  assert.deepEqual(character.inner.children[0].scale.toArray(), [2, 3, 4])
  assert.equal(character.inner.children[0].position.y, 10)
  assert.equal(character.root.scale.x, 2)
  assert.equal(character.restPos.get('mixamorigHips')?.y, 100)
  let mesh: THREE.Mesh | undefined
  character.inner.traverse((object) => { if (object instanceof THREE.Mesh) mesh = object })
  const copied = mesh!.material as THREE.MeshPhongMaterial[]
  assert.equal(copied.length, 2)
  assert.notEqual(copied[0], materials[0])
  assert.equal(copied[0].color.getHex(), materials[0].color.getHex())
  assert.equal(copied[0].opacity, 0.4)
  assert.equal(copied[1].color.getHex(), materials[1].color.getHex())
  assert.deepEqual(template.scale.toArray(), [2, 3, 4])
})

test('imported Character and prop apply the source-to-scene basis once around the source model', () => {
  const basis = [1, 0, 0, 0, 0, 1, 0, -1, 0]
  const { template, node, graph } = setup()
  node.metadata = { ...node.metadata, modelBasisToScene: basis }
  buildCharacterInstance(graph, node, template, false)
  const character = graph.characters.get(node.id)!
  const adapter = character.inner.children[0]!
  assert.deepEqual(adapter.matrix.elements, [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1])
  const modelPoint = new THREE.Vector3(0, 0, 1).applyMatrix4(adapter.matrix)
  assert.deepEqual(modelPoint.toArray(), [0, 1, 0])

  const propSetup = setup()
  propSetup.node.type = 'prop'
  propSetup.node.metadata = { ...propSetup.node.metadata, modelBasisToScene: basis }
  attachProp(propSetup.graph, propSetup.node, propSetup.template.clone(true))
  const prop = propSetup.graph.props.get(propSetup.node.id)!
  const propAdapter = prop.children[0]!
  const propModelPoint = new THREE.Vector3(0, 0, 1).applyMatrix4(propAdapter.matrix)
  assert.deepEqual(propModelPoint.toArray(), [0, 1, 0])
})

test('imported prop applies its model unit once and preserves source material colors', () => {
  const { template, node, graph, materials } = setup()
  node.type = 'prop'
  attachProp(graph, node, template.clone(true))
  const prop = graph.props.get(node.id)!
  assert.deepEqual(prop.children[0].scale.toArray(), [0.02, 0.03, 0.04])
  assert.equal(prop.scale.x, 2)
  const mesh = prop.children[0].children.find((object) => object instanceof THREE.Mesh) as THREE.Mesh
  assert.equal((mesh.material as THREE.MeshPhongMaterial[])[0].color.getHex(), materials[0].color.getHex())
  assert.deepEqual(template.scale.toArray(), [2, 3, 4])
})
