import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { stageAssetUpload } from '../src/unifiedAssetFiles'
import { importPack, rebuildLibraryIndex } from '../../../packages/library/index'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const temp = mkdtempSync(path.join(tmpdir(), 'library-place-'))
const priorProjects = process.env.BBS_UNIFIED_PROJECTS_DIR, priorLibrary = process.env.W01_LIBRARY
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
process.env.W01_LIBRARY = path.join(temp, 'library')
test.after(() => { rmSync(temp, { recursive: true, force: true }); if (priorProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = priorProjects; if (priorLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = priorLibrary })

let generated: { directory: string; manifest: any; actionUuid: string; actionGlbHash: string } | undefined
function preparePack() {
  if (generated) return generated
  const source = path.join(editor, 'apps/studio/public/retarget/v9.12')
  const directory = path.join(temp, 'normalized')
  const run = spawnSync(process.execPath, ['--import', 'tsx', '../retarget/cli/normalize.ts', '--src', path.join(source, 'minecraft-actions.bobj'), '--armature', path.join(source, 'minecraft20-armature.bobj'), '--target', path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb'), '--out', directory, '--action', '0'], { cwd: path.join(editor, 'packages/builder'), encoding: 'utf8', timeout: 120000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const files = readdirSync(directory), glb = readFileSync(path.join(directory, files.find(name => name.endsWith('.glb'))!)), manifest = JSON.parse(readFileSync(path.join(directory, files.find(name => name.endsWith('.manifest.json'))!), 'utf8'))
  importPack({ libraryRoot: process.env.W01_LIBRARY!, sourceDirectory: directory, license: { id: 'test', commitable: false } })
  generated = { directory, manifest, actionUuid: manifest.actions[0].uuid, actionGlbHash: createHash('sha256').update(glb).digest('hex') }
  return generated
}

async function send(projectId: string, expectedRevision: number, command: string, args: Record<string, unknown>) {
  return executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision, command, args })
}

async function targetCharacter(projectId: string) {
  const targetBytes = readFileSync(path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb'))
  const staged = await stageAssetUpload('mixamo-character.glb', new ReadableStream({ start(controller) { controller.enqueue(targetBytes); controller.close() } }))
  const imported = await send(projectId, 0, 'asset.import', { files: [staged.id], format: 'glb' })
  const added = await send(projectId, imported.revision, 'character.add', { assetId: imported.result.assetIds[0], skeletonId: imported.result.skeletonIds[0], name: 'Builtin Mixamo' })
  return { revision: added.revision, characterId: added.result.characterId as string }
}

test('library.place preserves the Action UUID and one undo removes both import and placement', { concurrency: false }, async () => {
  const pack = preparePack()
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Library placement', scene: makeEmptyDraft('Library placement', 30, 180) } })
  const projectId = created.projectId
  const target = await targetCharacter(projectId)
  const before = await readUnifiedProject(projectId)
  const placed = await send(projectId, target.revision, 'library.place', { actionUuid: pack.actionUuid, characterId: target.characterId })
  assert.equal(placed.result.libraryPlacement.actionUuid, pack.actionUuid)
  let project = await readUnifiedProject(projectId)
  assert.ok(project.motions[pack.actionUuid])
  assert.equal(project.motions[pack.actionUuid]!.sourceClip.sha256, pack.actionGlbHash)
  assert.equal(project.scene.content.timeline.animation.motionClips.length, 1)
  await send(projectId, placed.revision, 'history.undo', {})
  project = await readUnifiedProject(projectId)
  assert.deepEqual(project.motions, before.motions)
  assert.deepEqual(project.bindings, before.bindings)
  assert.deepEqual(project.scene, before.scene)
  assert.deepEqual(Object.keys(project.assets).sort(), Object.keys(before.assets).sort())
})

test('library.place reuses an already imported Action UUID when placing it again', { concurrency: false }, async () => {
  const pack = preparePack()
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Library repeat', scene: makeEmptyDraft('Library repeat', 30, 180) } })
  const projectId = created.projectId, target = await targetCharacter(projectId)
  const first = await send(projectId, target.revision, 'library.place', { actionUuid: pack.actionUuid, characterId: target.characterId })
  const second = await send(projectId, first.revision, 'library.place', { actionUuid: pack.actionUuid, characterId: target.characterId })
  const project = await readUnifiedProject(projectId)
  assert.equal(Object.keys(project.motions).filter(id => id === pack.actionUuid).length, 1)
  assert.equal(project.scene.content.timeline.animation.motionClips.length, 2)
  await send(projectId, second.revision, 'history.undo', {})
  assert.equal((await readUnifiedProject(projectId)).scene.content.timeline.animation.motionClips.length, 1)
})

test('library.place rejects a rig mismatch without changing the project revision or snapshot', { concurrency: false }, async () => {
  const pack = preparePack()
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Library mismatch', scene: makeEmptyDraft('Library mismatch', 30, 180) } })
  const projectId = created.projectId, target = await targetCharacter(projectId)
  const metaFile = path.join(process.env.W01_LIBRARY!, 'packs', pack.actionGlbHash.slice(0, 16), 'meta.json')
  const metadata = JSON.parse(readFileSync(metaFile, 'utf8'))
  metadata.rig = 'minecraft20'
  await import('node:fs/promises').then(({ writeFile }) => writeFile(metaFile, JSON.stringify(metadata)))
  rebuildLibraryIndex()
  const before = await readUnifiedProject(projectId)
  await assert.rejects(send(projectId, before.revision, 'library.place', { actionUuid: pack.actionUuid, characterId: target.characterId }), /does not match Character rig/)
  assert.deepEqual(await readUnifiedProject(projectId), before)
  metadata.rig = 'mixamo65'
  await import('node:fs/promises').then(({ writeFile }) => writeFile(metaFile, JSON.stringify(metadata)))
  rebuildLibraryIndex()
})
