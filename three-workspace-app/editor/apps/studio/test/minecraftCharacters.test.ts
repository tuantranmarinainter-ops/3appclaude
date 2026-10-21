import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { stageAssetUpload } from '../src/unifiedAssetFiles'
import { actionsGlb, characterGlb, loadMinecraft20, ROLES } from '../../../packages/retarget/cli/minecraftBlockCharacters.ts'

const temp = mkdtempSync(path.join(tmpdir(), 'mc20-characters-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
test.after(() => rmSync(temp, { recursive: true, force: true }))
const upload = (bytes: Uint8Array, name: string) => stageAssetUpload(name, new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } }))

test('Minecraft20 block characters share one rig in a scene and play the native V9.12 Actions by bone name', async () => {
  const root = await loadMinecraft20()
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'MC20', scene: makeEmptyDraft('MC20', 30, 60) } })
  const projectId = created.projectId
  const actions = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [(await upload(actionsGlb(root), 'actions.glb')).id], format: 'glb' } })
  assert.equal((actions.result.skeletonIds as string[]).length, 1, 'the mesh-less skin makes the Actions carry their skeleton')
  assert.equal((actions.result.motionIds as string[]).length, root.animations.length)
  let revision = actions.revision
  const placed: string[] = []
  for (const role of ROLES.filter((item) => ['herobrine', 'enderman'].includes(item.name))) {
    const model = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'asset.import', args: { files: [(await upload(characterGlb(root, role), `${role.name}.glb`)).id], format: 'glb' } })
    // Both models reuse the Actions' profile (same fingerprint); character.add must still accept it for each model.
    assert.deepEqual(model.result.skeletonIds, actions.result.skeletonIds)
    const character = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: model.revision, command: 'character.add', args: { assetId: (model.result.assetIds as string[])[0], skeletonId: (model.result.skeletonIds as string[])[0], name: role.name } })
    const motion = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: character.revision, command: 'motion.place', args: { characterId: character.result.characterId, motionId: (actions.result.motionIds as string[])[placed.length + 1], frameStart: 0 } })
    revision = motion.revision; placed.push(String(character.result.nodeId))
  }
  const evaluated = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 10 } }) as { result: { issues: unknown[]; skeletonSamples: Array<{ nodeId: string; bones: Array<{ name: string }> }> } }
  assert.deepEqual(evaluated.result.issues, [])
  for (const nodeId of placed) assert.equal(evaluated.result.skeletonSamples.find((sample) => sample.nodeId === nodeId)?.bones.length, 17)
  const project = await readUnifiedProject(projectId)
  assert.equal(new Set(Object.values(project.characters).map((character) => character.skeletonId)).size, 1)
})

test('character.add still rejects a profile from an unrelated rig', async () => {
  const root = await loadMinecraft20()
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Mismatch', scene: makeEmptyDraft('Mismatch', 30, 60) } })
  const projectId = created.projectId
  const actions = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [(await upload(actionsGlb(root), 'actions.glb')).id], format: 'glb' } })
  const { readFileSync } = await import('node:fs')
  const female = readFileSync(path.resolve(import.meta.dirname, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb'))
  const model = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: actions.revision, command: 'asset.import', args: { files: [(await upload(female, 'female.glb')).id], format: 'glb' } })
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: model.revision, command: 'character.add', args: { assetId: (model.result.assetIds as string[])[0], skeletonId: (actions.result.skeletonIds as string[])[0], name: 'Wrong rig' } }), /PROFILE_MISMATCH|must belong/)
})
