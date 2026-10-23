import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { createCharacter, registerBaseModel } from '../../../packages/library/index'
import { addLibraryCharacterToProject, listLibraryCharacterDetails } from '../src/libraryCommands'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const temporary = mkdtempSync(path.join(tmpdir(), 'studio-library-characters-'))
const previousProjects = process.env.BBS_UNIFIED_PROJECTS_DIR, previousLibrary = process.env.W01_LIBRARY
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temporary, 'projects')
process.env.W01_LIBRARY = path.join(temporary, 'library')
test.after(() => {
  rmSync(temporary, { recursive: true, force: true })
  if (previousProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = previousProjects
  if (previousLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = previousLibrary
})

test('two library characters reuse one base asset and retain distinct per-node skins', { concurrency: false }, async () => {
  const modelFile = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
  const registered = registerBaseModel({ name: 'Shared synthetic model', rig: 'mixamo65', modelFile })
  assert.ok(registered.metadata.objects.length)
  const skins = [path.join(temporary, 'red'), path.join(temporary, 'blue')]
  for (const [index, directory] of skins.entries()) for (const object of registered.metadata.objects) {
    const file = path.join(directory, ...object.split('/'), 'default.png')
    mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, Buffer.from(`skin-${index}-${object}`))
  }
  const first = createCharacter({ charId: 'shared-red', name: 'Shared Red', baseModelId: registered.modelId, skinDir: skins[0] })
  const second = createCharacter({ charId: 'shared-blue', name: 'Shared Blue', baseModelId: registered.modelId, skinDir: skins[1] })
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Character library scene', scene: makeEmptyDraft('Character library scene', 30, 180) } })
  const a = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: created.revision, charId: first.charId })
  const b = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: a.revision, charId: second.charId })
  const project = await readUnifiedProject(created.projectId)
  assert.equal(Object.values(project.assets).filter(asset => asset.kind === 'model').length, 1)
  assert.equal(a.assetId, b.assetId)
  const nodes = project.scene.content.nodes.filter(node => node.metadata?.libraryCharacterId)
  assert.deepEqual(nodes.map(node => node.metadata?.libraryCharacterId).sort(), ['shared-blue', 'shared-red'])
  assert.equal(nodes.every(node => node.metadata?.libraryBaseModelId === registered.modelId), true)
  const hashes = nodes.map(node => (node.metadata?.librarySkin as Array<{ sha256: string }>)[0]!.sha256)
  assert.notEqual(hashes[0], hashes[1])
  assert.equal(nodes.every(node => Array.isArray(node.metadata?.libraryHiddenObjects) && node.metadata.libraryHiddenObjects.length === 0), true)
  const details = await listLibraryCharacterDetails()
  assert.equal(details.filter(item => item.baseModelId === registered.modelId).length, 2)
  assert.equal(readFileSync(modelFile).byteLength, project.assets[a.assetId as keyof typeof project.assets]!.source.byteLength)
})
