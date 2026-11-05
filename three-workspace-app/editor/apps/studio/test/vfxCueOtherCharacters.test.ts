import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { stageAssetUpload } from '../src/unifiedAssetFiles'
import { evaluateVfxCuesAtFrame } from '../src/vfxCues'

// Tập 15 Shot 03: eye-glow cues attached to Đen's head failed film export with "legacy Character has no shared model/profile
// source binding" because the CPU sample selected only Đen but kept the motion playback of every other Character.
const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const temp = mkdtempSync(path.join(tmpdir(), 'vfx-other-chars-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
process.env.W01_LIBRARY = path.join(temp, 'w01-library')
test.after(() => rmSync(temp, { recursive: true, force: true }))
const fixtureDir = path.join(editor, 'apps/studio/public/retarget/v9.12')
const targetGlb = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
const upload = (data: Buffer | Uint8Array, name: string) => stageAssetUpload(name, new ReadableStream({ start(c) { c.enqueue(data); c.close() } }))

test('bone-attached cue evaluates while other Characters play motions', async () => {
  const out = path.join(temp, 'normalized')
  const run = spawnSync(process.execPath, ['--import', 'tsx', '../retarget/cli/normalize.ts', '--src', path.join(fixtureDir, 'minecraft-actions.bobj'), '--armature', path.join(fixtureDir, 'minecraft20-armature.bobj'), '--target', targetGlb, '--out', out, '--action', '0'], { cwd: path.join(editor, 'packages/builder'), encoding: 'utf8', timeout: 120000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const files = readdirSync(out)
  const glb = readFileSync(path.join(out, files.find((x) => x.endsWith('.glb'))!))
  const manifest = JSON.parse(readFileSync(path.join(out, files.find((x) => x.endsWith('.manifest.json'))!), 'utf8'))
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'VFX others', scene: makeEmptyDraft('VFX others', 30, 29, { fov: 50, position: { x: 0, y: 2, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }) } })
  const projectId = created.projectId
  let revision = 0
  const send = async (command: string, args: Record<string, unknown>) => { const r = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command, args }); revision = r.revision; return r }
  await send('asset.import', { files: [(await upload(glb, 'actions.glb')).id], format: 'glb', manifest })
  const model = await send('asset.import', { files: [(await upload(readFileSync(targetGlb), 'target.glb')).id], format: 'glb' })
  const ids: string[] = []
  for (const name of ['Đen', 'Gỗ Xưa', 'Hero']) {
    const added = await send('character.add', { assetId: (model.result.assetIds as string[])[0], skeletonId: (model.result.skeletonIds as string[])[0], name })
    ids.push(String(added.result.characterId))
    await send('motion.place', { characterId: ids.at(-1), motionId: manifest.actions[0].uuid, frameStart: 0 })
  }
  const project = await readUnifiedProject(projectId)
  const den = project.characters[ids[0]!]!, profile = project.skeletons[den.skeletonId]!
  const bone = profile.bones.find((b) => b.deform) ?? profile.bones[0]!
  project.extensions.vfxCues = { version: 1, cues: [{ id: 'eye', effect: 'eye_glow_skyblue', frameStart: 0, frameEnd: 29,
    position: { x: 0, y: 0, z: 0 }, yaw: 0, scale: 1, attachNodeId: den.nodeId, attachBone: bone.name }] }
  const poses = await evaluateVfxCuesAtFrame(project, 10)
  assert.equal(poses.length, 1)
  assert.equal(poses[0]!.cue.attachBone, bone.name)
  assert.ok(Number.isFinite(poses[0]!.position.y))
})
