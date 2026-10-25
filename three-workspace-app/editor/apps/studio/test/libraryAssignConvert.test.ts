import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { addCharacterActions, createCharacter, rebuildLibraryIndex, registerBaseModel } from '../../../packages/library/index'
import { addLibraryCharacterToProject, placeLibraryActionForNode } from '../src/libraryCommands'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const builtinCharacter = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')

// N1b end-to-end: a Mixamo65-owned Action assigned to a Minecraft20-linked scene node is
// converted into a Draft of the receiving character and placed, with the quality warning.
test('place-for-node converts a cross-skeleton character-owned Action and places the Draft', { timeout: 300000 }, async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'w01-n1b-'))
  const libraryRoot = path.join(temp, 'library')
  mkdirSync(libraryRoot, { recursive: true })
  process.env.W01_LIBRARY = libraryRoot
  process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')

  // Minecraft20 receiving character (same fixture shape as the N1 panel test).
  const armature = readFileSync(path.join(editor, 'apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8')
  const modelSource = armature + '\no Body\no_arm minecraft20\nv 0 0 0\nvw body 1\nv 0 2 0\nvw head 1\nv 1 0 0\nvw body 1\nf 1 2 3\n'
    + 'an idle\nao body\nag location 0\nkf 0 0 LINEAR\nkf 20 0 LINEAR\n'
  const modelFile = path.join(libraryRoot, 'go-xua-model.bobj')
  writeFileSync(modelFile, modelSource)
  const mcRegistered = registerBaseModel({ name: 'Gỗ Xưa', rig: 'minecraft20', modelFile })
  createCharacter({ charId: 'go-xua', name: 'Gỗ Xưa', baseModelId: mcRegistered.modelId })

  // Mixamo65 character owning one real normalized Action.
  const heroRegistered = registerBaseModel({ name: 'Hero', rig: 'mixamo65', modelFile: builtinCharacter })
  createCharacter({ charId: 'hero', name: 'Hero', baseModelId: heroRegistered.modelId })
  const sourceDir = path.join(editor, 'apps/studio/public/retarget/v9.12'), out = path.join(temp, 'actions')
  const run = spawnSync(process.execPath, ['--import', 'tsx', '../retarget/cli/normalize.ts', '--src', path.join(sourceDir, 'minecraft-actions.bobj'), '--armature',
    path.join(sourceDir, 'minecraft20-armature.bobj'), '--target', builtinCharacter, '--out', out, '--action', '0'], { cwd: path.join(editor, 'packages/builder'), encoding: 'utf8', timeout: 180000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const files = readdirSync(out)
  const glb = readFileSync(path.join(out, files.find((name) => name.endsWith('.glb'))!))
  const manifest = JSON.parse(readFileSync(path.join(out, files.find((name) => name.endsWith('.manifest.json'))!), 'utf8')) as { actions: Array<{ name: string; durationSeconds: number }> }
  const heroActionUuid = randomUUID(), heroAction = manifest.actions[0]!
  const glbSha256 = createHash('sha256').update(glb).digest('hex')
  const packDir = path.join(libraryRoot, 'packs', '2000000000000002')
  mkdirSync(packDir, { recursive: true })
  writeFileSync(path.join(packDir, 'anim.glb'), glb)
  writeFileSync(path.join(packDir, 'meta.json'), JSON.stringify({
    kind: 'motion-pack', libraryVersion: '1.1.0', packId: '2000000000000002', rig: 'mixamo65', glbSha256, createdAt: new Date().toISOString(),
    license: { id: 'test', commitable: false },
    actions: [{ uuid: heroActionUuid, name: heroAction.name, durationSeconds: heroAction.durationSeconds, fps: 30, category: 'idle', tags: [], loop: false, inPlace: true, glbAnimationIndex: 0, ownerCharId: 'hero', status: 'draft', version: 1 }],
  }))
  writeFileSync(path.join(packDir, 'anim.manifest.json'), JSON.stringify({
    version: '1.0.0', rig: 'mixamo65', glbSha256,
    actions: [{ uuid: heroActionUuid, name: heroAction.name, durationSeconds: heroAction.durationSeconds, fps: 30, glbAnimationIndex: 0 }],
  }))
  rebuildLibraryIndex()
  addCharacterActions({ charId: 'hero', actions: [heroActionUuid] })

  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'N1b', scene: makeEmptyDraft('N1b', 30, 600) } })
  const added = await addLibraryCharacterToProject({ projectId: created.projectId!, expectedRevision: created.revision, charId: 'go-xua' })

  const placed = await placeLibraryActionForNode({ projectId: created.projectId!, actionUuid: heroActionUuid, nodeId: added.nodeId! })
  assert.equal(placed.converted, true)
  assert.notEqual(placed.placedActionUuid, heroActionUuid)
  assert.ok(placed.warning?.includes('chuyển xương'), `warning surfaced: ${placed.warning}`)
  const project = await readUnifiedProject(created.projectId!)
  const clip = project.scene.content.timeline.animation.motionClips.find((item) => item.id === placed.clipId)
  assert.ok(clip, 'the converted Draft clip is on the timeline')
  assert.equal(clip.target.nodeId, added.nodeId)
  assert.ok(project.motions[placed.placedActionUuid], 'converted Draft motion is in the project')
})
