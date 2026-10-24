import assert from 'node:assert/strict'
import test from 'node:test'
import { validateFeatureTree, type UnifiedProject } from '@bbs/animation-workspace-shared'
import { featureUnavailable, FEATURES, FEATURE_PANELS, searchFeatures } from './workspaceNavigation.ts'
import { restoreExpansion, visibleFeatures } from '../app/workbench/components/feature-navigation/utils.ts'

test('workspace search ignores Vietnamese diacritics and case', () => {
  assert.deepEqual(searchFeatures(FEATURES, 'xuong').nodes.map((node) => node.id), ['1.3', '1.3.2'])
  assert.deepEqual(searchFeatures(FEATURES, 'XƯƠNG'), searchFeatures(FEATURES, 'xuong'))
})

test('workspace search matches feature IDs and keywords while retaining the parent workspace', () => {
  assert.deepEqual(searchFeatures(FEATURES, '1.3.2'), searchFeatures(FEATURES, 'xuong'))
  assert.deepEqual(searchFeatures(FEATURES, 'camera').nodes.map((node) => node.id), ['1.2', '1.2.4', '1.4', '1.4.2'])
  assert.equal(searchFeatures(FEATURES, '1.3').count, 3)
})

test('an empty query restores the complete workspace list', () => {
  assert.deepEqual(searchFeatures(FEATURES, '  ').nodes, FEATURES)
  assert.equal(searchFeatures(FEATURES, '').count, 28)
  assert.equal(searchFeatures(FEATURES, 'not-present').nodes.length, 0)
})

test('registry rejects duplicate IDs, missing parents, cycles and unknown panels/commands with the offending ID', () => {
  const group = FEATURES[0], leaf = FEATURES[1]
  const panels = Object.keys(FEATURE_PANELS)
  assert.doesNotThrow(() => validateFeatureTree(FEATURES, panels))
  assert.throws(() => validateFeatureTree([...FEATURES, leaf], panels), /1.1.1.*duplicate/)
  assert.throws(() => validateFeatureTree([{ ...leaf, parentId: 'absent' }], panels), /1.1.1.*missing parent/)
  assert.throws(() => validateFeatureTree([{ ...group, parentId: leaf.id }, leaf], panels), /1.1.*cycle/)
  assert.throws(() => validateFeatureTree([group, { ...leaf, panelId: 'absent' }], panels), /1.1.1.*unknown panel/)
  assert.throws(() => validateFeatureTree([group, { ...leaf, command: 'absent' }], panels), /1.1.1.*unknown command/)
  assert.throws(() => validateFeatureTree([{ ...group, label: '' }, leaf], panels), /1.1.*metadata/)
})

test('collapsed search branches do not change the normal expansion preference', () => {
  const expansion = restoreExpansion('["1.2", "1.4", "unknown"]', ['1.2', '1.4'])
  const original = visibleFeatures(FEATURES, expansion)
  assert.deepEqual(visibleFeatures(searchFeatures(FEATURES, 'camera').nodes, new Set()).map((node) => node.id), ['1.2', '1.4'])
  assert.deepEqual(visibleFeatures(searchFeatures(FEATURES, '').nodes, expansion), original)
  assert.deepEqual([...restoreExpansion('not json', [])], ['1.4'])
  assert.deepEqual([...restoreExpansion('[]', ['1.4'])], [])
})

test('unavailable features explain what input is missing and never disappear', () => {
  const feature = (id: string) => FEATURES.find((node) => node.id === id)!
  const project = { scene: { content: { nodes: [{ id: 'prop' }, { id: 'rig' }] } }, characters: { person: { nodeId: 'rig' } }, motions: {}, skeletons: {} } as unknown as UnifiedProject
  assert.match(featureUnavailable(feature('1.3.2'), project, null, 'vi')!, /FBX Motion/)
  assert.match(featureUnavailable(feature('1.5.1'), project, 'prop', 'vi')!, /Character/)
  assert.equal(featureUnavailable(feature('1.5.1'), project, 'rig', 'vi'), null)
  assert.equal(featureUnavailable(feature('1.2.2'), project, 'prop', 'en'), null)
  assert.match(featureUnavailable(feature('1.2.2'), project, 'deleted', 'en')!, /Select an object/)
  assert.equal(featureUnavailable(feature('1.7.1'), project, null, 'en'), null)
  assert.match(featureUnavailable(feature('2.1'), project, null, 'en')!, /Documentation/)
})

test('animation navigation focuses the iframe host without waiting for the unmounted scene editor', () => {
  assert.equal(FEATURE_PANELS['animation-motion'].editorPanel, undefined)
  assert.equal(FEATURE_PANELS['animation-motion'].selector, '.wb-animation-creation')
})
