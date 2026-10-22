import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore.ts'
import { stageAssetUpload } from '../src/unifiedAssetFiles.ts'
import { evaluateVfxCuesAtFrame } from '../src/vfxCues.ts'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const projectRoot = mkdtempSync(path.join(tmpdir(), 'bbs-vfx-bone-eval-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(projectRoot, 'projects')
test.after(() => rmSync(projectRoot, { recursive: true, force: true }))
const builtin = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')

test('bone-attached cue follows actual CPU-evaluated Character bone matrices at requested frames', { skip: existsSync(builtin) ? false : 'Built-in GLB fixture is unavailable' }, async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: {
    name: 'VFX bone evaluation', scene: makeEmptyDraft('VFX bone evaluation', 30, 29, { fov: 50, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }),
  } })
  const projectId = String(created.projectId)
  const upload = await stageAssetUpload('builtin-vfx-bone.glb', new ReadableStream({ start(controller) { controller.enqueue(readFileSync(builtin)); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'glb' } })
  const assetId = (imported.result.assetIds as string[])[0]!, skeletonId = (imported.result.skeletonIds as string[])[0]!
  const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: imported.revision, command: 'character.add', args: { assetId, skeletonId, name: 'Bone follower' } })
  const project = await readUnifiedProject(projectId)
  const characterId = String(added.result.characterId), character = project.characters[characterId]!, profile = project.skeletons[character.skeletonId]!
  const root = profile.bones.find((bone) => bone.deform) ?? profile.bones.find((bone) => bone.id === profile.rootBoneId)!
  project.extensions.topview = { fcurves: { version: 1, encoding: 'compact-v1', fcurves: [
    { id: 'move-character', t: ['node', character.nodeId], p: 'transform.position', i: 0, k: [[0, 0, 'linear', 'start'], [29, 3, 'linear', 'end']] },
  ] } }
  project.extensions.vfxCues = { version: 1, cues: [{ id: 'bone-cue', effect: 'aura01', frameStart: 0, frameEnd: 29,
    position: { x: 0, y: 0, z: 0 }, yaw: 0, scale: 1, attachNodeId: character.nodeId, attachBone: root.name }] }

  const start = await evaluateVfxCuesAtFrame(project, 0)
  const end = await evaluateVfxCuesAtFrame(project, 29)
  assert.equal(start[0]?.cue.attachBone, root.name)
  assert.ok(Math.abs((end[0]?.position.x ?? 0) - (start[0]?.position.x ?? 0) - 3) < 0.05)
})
