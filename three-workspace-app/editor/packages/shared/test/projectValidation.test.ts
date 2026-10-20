import assert from 'node:assert/strict'
import test from 'node:test'
import { makeEmptyDraft, type DirectorDocument } from '@topview/3d-builder'
import { validateProject, type UnifiedProject } from '../src/index.ts'

const projectId = '00000000-0000-4000-8000-000000000001'
const assetHash = 'a'.repeat(64)
const assetId = `sha256:${assetHash}` as const
const blob = { path: `assets/${assetHash}/hero.glb`, sha256: assetHash, mediaType: 'model/gltf-binary', byteLength: 1 }
const provenance = { sourceKey: 'fixture', sourceVersion: '1', sourceHash: assetHash, original: blob }
const skeletonId = '00000000-0000-4000-8000-000000000002'
const characterId = '00000000-0000-4000-8000-000000000003'

function baseProject(): UnifiedProject {
  return {
    type: 'three-workspace-project', version: 1, projectId, name: 'Validation fixture', revision: 0,
    scene: makeEmptyDraft('Validation fixture', 30, 90), assets: {}, characters: {}, skeletons: {}, mappings: {}, motions: {}, bindings: {}, retargetSessions: {}, extensions: {}, origins: [],
  }
}

function populatedProject(): UnifiedProject {
  const project = baseProject()
  project.assets[assetId] = { id: assetId, kind: 'model', displayName: 'Hero', source: structuredClone(blob), derivatives: {}, provenance: structuredClone(provenance), license: null, dependencies: [] }
  project.skeletons[skeletonId] = {
    id: skeletonId, family: 'custom-preserved',
    bones: [{ id: 'root', name: 'Root', parentId: null, rest: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, deform: true }],
    rootBoneId: 'root', metersPerUnit: 1, basisToScene: [1, 0, 0, 0, 1, 0, 0, 0, 1], fingerprint: 'b'.repeat(64), nativeFingerprint: null, provenance: structuredClone(provenance),
  }
  const scene = project.scene as DirectorDocument
  scene.content.nodes.push({
    id: 'character_node', type: 'character', name: 'Hero', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    character: { placeholder: true, gender: 'unknown', motionId: null, appearance: { color: '#ffffff' }, label: { showLabel: true, scale: 1, yOffset: 0 }, animation: { mode: 'pose', controlValues: {} } },
  })
  project.characters[characterId] = { id: characterId, assetId, nodeId: 'character_node', skeletonId, name: 'Hero' }
  return project
}

test('accepts a validated Topview project with an asset, skeleton profile and character binding', () => {
  assert.equal(validateProject(populatedProject()), true)
})

test('rejects malformed content-addressed paths and mismatched record keys', () => {
  const badPath = populatedProject()
  badPath.assets[assetId].source.path = '../hero.glb'
  assert.equal(validateProject(badPath), false)

  const badKey = populatedProject()
  badKey.assets[assetId].id = `sha256:${'c'.repeat(64)}`
  assert.equal(validateProject(badKey), false)
})

test('rejects dangling character references and invalid skeleton hierarchy', () => {
  const missingAsset = populatedProject()
  missingAsset.characters[characterId].assetId = `sha256:${'c'.repeat(64)}`
  assert.equal(validateProject(missingAsset), false)

  const badParent = populatedProject()
  badParent.skeletons[skeletonId].bones.push({ id: 'child', name: 'Child', parentId: 'missing', rest: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, deform: true })
  assert.equal(validateProject(badParent), false)
})

test('validates Topview group references and rejects non-group parents and cycles', () => {
  const project = populatedProject()
  const scene = project.scene as DirectorDocument
  scene.content.nodes.push(
    { id: 'group_root', type: 'group', name: 'Root group', visible: true, locked: false, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, children: ['group_child'] },
    { id: 'group_child', type: 'group', name: 'Child group', visible: true, locked: false, parentId: 'group_root', transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
  )
  assert.equal(validateProject(project), true)

  const dangling = structuredClone(project)
  dangling.scene.content.nodes.find((node) => node.id === 'group_child')!.parentId = 'missing'
  assert.equal(validateProject(dangling), false)

  const cycle = structuredClone(project)
  cycle.scene.content.nodes.find((node) => node.id === 'group_root')!.parentId = 'group_child'
  assert.equal(validateProject(cycle), false)

  const nonGroupParent = structuredClone(project)
  nonGroupParent.scene.content.nodes.find((node) => node.id === 'group_child')!.parentId = 'character_node'
  assert.equal(validateProject(nonGroupParent), false)

  const danglingChild = structuredClone(project)
  danglingChild.scene.content.nodes.find((node) => node.id === 'group_root')!.children = ['missing']
  assert.equal(validateProject(danglingChild), false)

  const selfChild = structuredClone(project)
  selfChild.scene.content.nodes.find((node) => node.id === 'group_root')!.children = ['group_root']
  assert.equal(validateProject(selfChild), false)
})

test('validates shared project asset references stored on Scene model nodes', () => {
  const project = populatedProject()
  const scene = project.scene as DirectorDocument
  const modelUrl = `/api/unified/projects/${projectId}/assets/${encodeURIComponent(assetId)}/source`
  scene.content.nodes.push({
    id: 'prop_node', type: 'prop', name: 'Table', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    metadata: { assetId, modelUrl }, prop: { category: 'user' },
  })
  assert.equal(validateProject(project), true)

  const missingAsset = structuredClone(project)
  missingAsset.scene.content.nodes.find((node) => node.id === 'prop_node')!.metadata!.assetId = `sha256:${'c'.repeat(64)}`
  assert.equal(validateProject(missingAsset), false)

  const wrongProjectUrl = structuredClone(project)
  wrongProjectUrl.scene.content.nodes.find((node) => node.id === 'prop_node')!.metadata!.modelUrl = '/api/unified/projects/00000000-0000-4000-8000-000000000099/assets/x/source'
  assert.equal(validateProject(wrongProjectUrl), false)
})

test('validates imported model basis metadata against the Character source profile', () => {
  const project = populatedProject()
  const basis = [1, 0, 0, 0, 0, 1, 0, -1, 0]
  project.skeletons[skeletonId]!.basisToScene = basis
  const node = project.scene.content.nodes.find((item) => item.id === 'character_node')!
  node.metadata = { assetId, modelUrl: `/api/unified/projects/${projectId}/assets/${encodeURIComponent(assetId)}/source`, modelUnitMeters: 1, modelBasisToScene: basis }
  assert.equal(validateProject(project), true)

  const mismatched = structuredClone(project)
  mismatched.scene.content.nodes.find((item) => item.id === 'character_node')!.metadata!.modelBasisToScene = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  assert.equal(validateProject(mismatched), false)

  const invalid = structuredClone(project)
  invalid.scene.content.nodes.find((item) => item.id === 'character_node')!.metadata!.modelBasisToScene = [2, 0, 0, 0, 1, 0, 0, 0, 1]
  assert.equal(validateProject(invalid), false)
})

