import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import { AssetLoader } from '../io/AssetLoader'
import type { DirectorDocument } from '../../contract/types'

function templateWithSpies(): {
  root: THREE.Object3D
  counts: { geometry: number; map: number; material: number }
} {
  const counts = { geometry: 0, map: 0, material: 0 }
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const map = new THREE.Texture()
  const material = new THREE.MeshStandardMaterial({ map })
  geometry.dispose = () => { counts.geometry += 1 }
  map.dispose = () => { counts.map += 1 }
  material.dispose = () => { counts.material += 1 }
  return { root: new THREE.Mesh(geometry, material), counts }
}

test('clear() 释放私有素材模板的 GPU 资源', () => {
  const loader = new AssetLoader(async (ref) => String(ref))
  const character = templateWithSpies()
  const prop = templateWithSpies()
  loader.characterTemplates.set('canvas/3d-builder/user/u1/char.glb', character.root)
  loader.propTemplates.set('canvas/3d-builder/user/u1/prop.glb', prop.root)

  loader.clear()

  for (const { counts } of [character, prop]) {
    assert.equal(counts.geometry, 1)
    assert.equal(counts.map, 1)
    assert.equal(counts.material, 1)
  }
  assert.equal(loader.characterTemplates.size, 0)
  assert.equal(loader.propTemplates.size, 0)
})

test('motion preload forwards the clip index selected by the timeline', async () => {
  const loader = new AssetLoader(async (ref) => String(ref.sourcePath))
  const document = {
    content: {
      asset: { motionPath: [{ id: 'motion-1', path: 'assets/walk.fbx' }] },
      timeline: { animation: { motionClips: [{ motion: { assetId: 'motion-1', clipIndex: 3 } }] } },
    },
  } as unknown as DirectorDocument
  let loaded: [string, string, number?] | null = null
  await loader.preloadMotions(document, async (id, url, clipIndex) => { loaded = [id, url, clipIndex] })
  assert.deepEqual(loaded, ['motion-1', 'assets/walk.fbx', 3])
})

test('motion preload loads each distinct clip index for a shared FBX asset once', async () => {
  const loader = new AssetLoader(async (ref) => String(ref.sourcePath))
  const document = {
    content: {
      asset: { motionPath: [{ id: 'motion-1', path: 'assets/walk.fbx' }] },
      timeline: { animation: { motionClips: [0, 1, 1].map((clipIndex) => ({ motion: { assetId: 'motion-1', clipIndex } })) } },
    },
  } as unknown as DirectorDocument
  const loaded: number[] = []
  await loader.preloadMotions(document, async (_id, _url, clipIndex) => { loaded.push(clipIndex ?? 0) })
  assert.deepEqual(loaded.sort(), [0, 1])
})

test('explicit FBX model metadata selects the FBX loader and reuses the Character template', async () => {
  const loader = new AssetLoader(async (ref) => String(ref.sourcePath))
  const template = new THREE.Group()
  template.name = 'FBX model'
  let calls = 0
  ;(loader as unknown as { fbx: { loadAsync: () => Promise<THREE.Object3D> } }).fbx = { loadAsync: async () => { calls++; return template } }
  assert.equal(await loader.loadCharacterTemplate('/private/character/source', undefined, 'fbx'), template)
  assert.equal(await loader.loadCharacterTemplate('/private/character/source', undefined, 'fbx'), template)
  assert.equal(calls, 1)
  const prop = await loader.loadPropTemplate('/private/prop/source', 'fbx')
  assert.equal(prop.name, template.name)
  assert.notEqual(prop, template)
  assert.equal(calls, 2)
  loader.clear()
})
