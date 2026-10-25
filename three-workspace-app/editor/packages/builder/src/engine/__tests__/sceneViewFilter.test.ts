import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  computeViewHiddenNodeIds,
  isBackgroundNode,
  type SceneViewFilter,
} from '../../contract/sceneView'
import type { DirectorDocument, DraftNode } from '../../contract/types'
import { applyNodeVisibility, applyViewVisibility } from '../objects/visibility'
import type { StageGraph } from '../objects/graph'

const NO_FILTER: SceneViewFilter = { charactersOnly: false, backgroundHidden: false }
const BACKGROUND_OFF: SceneViewFilter = { charactersOnly: false, backgroundHidden: true }
const CHARACTERS_ONLY: SceneViewFilter = { charactersOnly: true, backgroundHidden: false }

function node(
  id: string,
  type: DraftNode['type'],
  name: string,
  parentId?: string,
  visible = true,
): DraftNode {
  return {
    id,
    type,
    name,
    visible,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ...(parentId ? { parentId } : {}),
  } as DraftNode
}

/** Cảnh kiểu Tập 15: nhân vật theo shot, prop set_* ở gốc, một nhóm set chứa prop, một camera. */
function sampleNodes(): DraftNode[] {
  return [
    node('go1', 'character', 'go 01_1'),
    node('hero1', 'character', 'hero 01_1'),
    node('cam1', 'camera', 'Main Camera'),
    node('ban', 'prop', 'set_ban'),
    node('tuong', 'prop', 'set_tuong'),
    node('setNha', 'group', 'set_nha'),
    node('cot', 'primitive', 'cot', 'setNha'),
    node('den', 'prop', 'den ban', 'go1'),
    node('nhomNhanVat', 'group', 'Nhom nhan vat'),
    node('ga1', 'character', 'ga 01_1', 'nhomNhanVat'),
  ]
}

function docOf(nodes: DraftNode[]): DirectorDocument {
  return {
    content: { nodes, environment: {}, timeline: { fps: 30, animation: { motionClips: [] } } },
  } as unknown as DirectorDocument
}

function fakeGraph(doc: DirectorDocument) {
  const characters = new Map<string, { root: THREE.Object3D }>()
  const props = new Map<string, THREE.Object3D>()
  const primitives = new Map<string, THREE.Object3D>()
  const groups = new Map<string, THREE.Object3D>()
  const cameras = new Map<string, { gizmo: { group: THREE.Object3D } }>()
  for (const n of doc.content.nodes) {
    if (n.type === 'character') characters.set(n.id, { root: new THREE.Group() })
    else if (n.type === 'prop') props.set(n.id, new THREE.Group())
    else if (n.type === 'primitive') primitives.set(n.id, new THREE.Group())
    else if (n.type === 'group') groups.set(n.id, new THREE.Group())
    else if (n.type === 'camera') cameras.set(n.id, { gizmo: { group: new THREE.Group() } })
  }
  const graph = {
    doc,
    nodeById: new Map(doc.content.nodes.map((n) => [n.id, n])),
    characters,
    props,
    primitives,
    groups,
    cameras,
  } as unknown as StageGraph
  return { graph, characters, props, primitives, groups, cameras }
}

describe('N5 isBackgroundNode', () => {
  it('classifies props, primitives and set_* groups as background', () => {
    expect(isBackgroundNode(node('a', 'prop', 'ban go'))).toBe(true)
    expect(isBackgroundNode(node('b', 'primitive', 'cot'))).toBe(true)
    expect(isBackgroundNode(node('c', 'group', 'set_nha'))).toBe(true)
    expect(isBackgroundNode(node('d', 'group', 'SET-Tuong'))).toBe(true)
  })

  it('never treats characters, cameras or paths as background, even when named set_*', () => {
    expect(isBackgroundNode(node('a', 'character', 'set_hero'))).toBe(false)
    expect(isBackgroundNode(node('b', 'camera', 'set_cam'))).toBe(false)
    expect(isBackgroundNode(node('c', 'path', 'set_path'))).toBe(false)
    expect(isBackgroundNode(node('d', 'group', 'Nhom nhan vat'))).toBe(false)
  })
})

describe('N5 computeViewHiddenNodeIds', () => {
  it('hides nothing when both switches are off', () => {
    expect(computeViewHiddenNodeIds(sampleNodes(), NO_FILTER).size).toBe(0)
  })

  it('backgroundHidden hides every background node but keeps characters and cameras', () => {
    const hidden = computeViewHiddenNodeIds(sampleNodes(), BACKGROUND_OFF)
    expect([...hidden].sort()).toEqual(['ban', 'cot', 'den', 'setNha', 'tuong'])
  })

  it('backgroundHidden still hides a prop parented to a character (its own subtree has no character)', () => {
    const hidden = computeViewHiddenNodeIds(sampleNodes(), BACKGROUND_OFF)
    expect(hidden.has('den')).toBe(true)
    expect(hidden.has('go1')).toBe(false)
  })

  it('charactersOnly hides props, primitives, plain groups and camera gizmos — never characters or their containers', () => {
    const hidden = computeViewHiddenNodeIds(sampleNodes(), CHARACTERS_ONLY)
    expect(hidden.has('ban')).toBe(true)
    expect(hidden.has('cot')).toBe(true)
    expect(hidden.has('setNha')).toBe(true)
    expect(hidden.has('cam1')).toBe(true)
    expect(hidden.has('den')).toBe(true)
    expect(hidden.has('go1')).toBe(false)
    expect(hidden.has('hero1')).toBe(false)
    expect(hidden.has('ga1')).toBe(false)
    // Nhóm đang chứa nhân vật Gà phải ở lại, nếu không nhân vật bên trong cũng biến mất.
    expect(hidden.has('nhomNhanVat')).toBe(false)
  })

  it('does not mutate the node list', () => {
    const nodes = sampleNodes()
    const before = JSON.stringify(nodes)
    computeViewHiddenNodeIds(nodes, CHARACTERS_ONLY)
    computeViewHiddenNodeIds(nodes, BACKGROUND_OFF)
    expect(JSON.stringify(nodes)).toBe(before)
  })
})

describe('N5 view visibility layer', () => {
  it('toggling view modes never changes the project JSON', () => {
    const nodes = sampleNodes()
    nodes.push(node('anSan', 'prop', 'set_san', undefined, false))
    const doc = docOf(nodes)
    const before = JSON.stringify(doc)
    const { graph, characters, props, groups, cameras } = fakeGraph(doc)

    for (const filter of [BACKGROUND_OFF, CHARACTERS_ONLY, NO_FILTER]) {
      // Đúng trình tự Stage làm: evaluate đặt visibility theo tài liệu, lớp xem chồng lên khi render.
      applyNodeVisibility(graph)
      applyViewVisibility(graph, computeViewHiddenNodeIds(doc.content.nodes, filter))
      expect(JSON.stringify(doc)).toBe(before)
    }

    // Sau khi tắt hết bộ lọc và áp lại visibility của tài liệu, khung nhìn trở về đúng trạng thái tài liệu.
    applyNodeVisibility(graph)
    expect(props.get('ban')!.visible).toBe(true)
    expect(props.get('anSan')!.visible).toBe(false)
    expect(characters.get('go1')!.root.visible).toBe(true)
    expect(groups.get('nhomNhanVat')!.visible).toBe(true)
    expect(cameras.get('cam1')!.gizmo.group.visible).toBe(true)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('charactersOnly hides background objects in the graph but keeps characters visible', () => {
    const doc = docOf(sampleNodes())
    const { graph, characters, props, groups, cameras } = fakeGraph(doc)
    applyNodeVisibility(graph)
    applyViewVisibility(graph, computeViewHiddenNodeIds(doc.content.nodes, CHARACTERS_ONLY))
    expect(props.get('ban')!.visible).toBe(false)
    expect(groups.get('setNha')!.visible).toBe(false)
    expect(cameras.get('cam1')!.gizmo.group.visible).toBe(false)
    expect(characters.get('go1')!.root.visible).toBe(true)
    expect(characters.get('ga1')!.root.visible).toBe(true)
    expect(groups.get('nhomNhanVat')!.visible).toBe(true)
  })
})
