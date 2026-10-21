import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { stageAssetUpload } from '../src/unifiedAssetFiles'
import { getUnifiedJob, readUnifiedJobFile } from '../src/unifiedJobs'
import { unzipPackage } from '../src/shotPackage'

// H4: a real skinned scene (two builtin Characters, App 1 Action, G2 layout) exported through H1 GLB and H2 .blend/FBX,
// reopened in Blender and compared bone-by-bone with scene.evaluate. Runs only where Blender 4.2+ is installed.
const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const temp = mkdtempSync(path.join(tmpdir(), 'scene-roundtrip-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
test.after(() => rmSync(temp, { recursive: true, force: true }))
const blender = process.env.BBS_BLENDER_EXE || 'blender'
const available = spawnSync(blender, ['--version']).status === 0
const builtin = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
const fixture = path.join(editor, 'apps/studio/public/retarget/v9.12')
const BONES = ['Hips', 'Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot']
const FRAMES = [0, 10, 20, 29]

const READ_BACK = `
import bpy, json, sys
args = sys.argv[sys.argv.index('--') + 1:]
path, frames, bones = args[0], json.loads(args[1]), json.loads(args[2])
if path.endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=path)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30; bpy.context.scene.render.fps_base = 1
    bpy.ops.import_scene.fbx(filepath=path, anim_offset=0)
sc = bpy.context.scene
out = {'fps': sc.render.fps, 'frameEnd': max((a.frame_range[1] for a in bpy.data.actions), default=0), 'rigs': {}}
for frame in frames:
    sc.frame_set(frame)
    for arm in (o for o in bpy.data.objects if o.type == 'ARMATURE'):
        rig = out['rigs'].setdefault(arm.name, {})
        for name in bones:
            pb = next((b for b in arm.pose.bones if b.name.split(':')[-1].replace('mixamorig', '') == name), None)
            if pb: rig.setdefault(str(frame), {})[name] = list(arm.matrix_world @ pb.head)
print('READBACK' + json.dumps(out))
`

async function waitJob(jobId: string, projectId: string) {
  let job = await getUnifiedJob(jobId, projectId)
  for (let i = 0; i < 1200 && (job.state === 'queued' || job.state === 'running'); i++) { await new Promise((r) => setTimeout(r, 250)); job = await getUnifiedJob(jobId, projectId) }
  assert.equal(job.state, 'succeeded', JSON.stringify(job.error))
  return job
}

function readBack(file: string) {
  const script = path.join(temp, 'readback.py'); writeFileSync(script, READ_BACK)
  const run = spawnSync(blender, ['-b', '--factory-startup', '--python', script, '--', file, JSON.stringify(FRAMES), JSON.stringify(BONES)], { encoding: 'utf8', maxBuffer: 64 << 20 })
  const line = run.stdout.split(/\r?\n/).find((item) => item.startsWith('READBACK'))
  assert.ok(line, run.stdout.slice(-2000) + run.stderr.slice(-2000))
  return JSON.parse(line.slice('READBACK'.length)) as { fps: number; frameEnd: number; rigs: Record<string, Record<string, Record<string, number[]>>> }
}

test('H4: scene GLB → .blend/FBX reopened in Blender matches scene.evaluate bone positions within 1 cm', { timeout: 900_000, skip: available ? false : 'NOT_RUN: Blender 4.2+ is not installed (set BBS_BLENDER_EXE)' }, async () => {
  const out = path.join(temp, 'normalized')
  const normalized = spawnSync(process.execPath, ['--import', 'tsx', '../retarget/cli/normalize.ts', '--src', path.join(fixture, 'minecraft-actions.bobj'), '--armature', path.join(fixture, 'minecraft20-armature.bobj'), '--target', builtin, '--out', out, '--action', '27'], { cwd: path.join(editor, 'packages/builder'), encoding: 'utf8', timeout: 300_000 })
  assert.equal(normalized.status, 0, normalized.stdout + normalized.stderr)
  const names = readdirSync(out), glb = readFileSync(path.join(out, names.find((n) => n.endsWith('.glb'))!))
  const manifest = JSON.parse(readFileSync(path.join(out, names.find((n) => n.endsWith('.manifest.json'))!), 'utf8'))
  assert.equal(manifest.actions[0].name, 'emote_floss')
  const upload = (bytes: Buffer, name: string) => stageAssetUpload(name, new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } }))

  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'H4 roundtrip', scene: makeEmptyDraft('H4 roundtrip', 30, 29, { fov: 50, position: { x: 1, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }) } })
  const projectId = String(created.projectId)
  const motion = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [(await upload(glb, 'app1.glb')).id], format: 'glb', manifest } })
  const model = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: motion.revision, command: 'asset.import', args: { files: [(await upload(readFileSync(builtin), 'builtin.glb')).id], format: 'glb' } })
  let revision = model.revision
  const characterIds: string[] = []
  for (const name of ['A', 'B']) {
    const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'character.add', args: { assetId: (model.result.assetIds as string[])[0], skeletonId: (model.result.skeletonIds as string[])[0], name } })
    characterIds.push(String(added.result.characterId)); revision = added.revision
    const placed = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'motion.place', args: { characterId: added.result.characterId, motionId: manifest.actions[0].uuid, frameStart: 0 } })
    revision = placed.revision
  }
  const layout = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'scene.layout.apply', args: { placements: [{ characterId: characterIds[1], relativeTo: characterIds[0], relation: 'right', distanceMeters: 1.5, lookAt: { characterId: characterIds[0] } }] } })
  revision = layout.revision

  const exported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'scene.export.glb', args: { frameStart: 0, frameEnd: 29 } })
  const glbJobId = String(exported.result.jobId)
  const converted = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'scene.export.blend-fbx', args: { glbJobId } })
  const job = await waitJob(String(converted.result.jobId), projectId)
  const files = unzipPackage((await readUnifiedJobFile(job.jobId, projectId, job.result!.files[0]!.id))!.bytes)
  const paths: Record<string, string> = {}
  for (const name of ['scene.blend', 'scene.fbx']) { paths[name] = path.join(temp, name); writeFileSync(paths[name]!, Buffer.from(files[name]!)) }

  // Evaluator truth in three.js Y-up; Blender is Z-up: (x, y, z)_three = (x, z, -y)_blender.
  const project = await readUnifiedProject(projectId)
  const nodeOf = new Map(characterIds.map((id) => [id, project.characters[id]!.nodeId]))
  const truth: Record<string, Record<number, Record<string, Vector3>>> = {}
  for (const frame of FRAMES) {
    const evaluated = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame } }) as { result: { skeletonSamples: Array<{ nodeId: string; bones: Array<{ name: string; worldMatrix: number[] }> }> } }
    for (const sample of evaluated.result.skeletonSamples) for (const name of BONES) {
      const bone = sample.bones.find((b) => b.name.split(':').pop()!.replace('mixamorig', '') === name)!
      ;((truth[sample.nodeId] ??= {})[frame] ??= {})[name] = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(bone.worldMatrix))
    }
  }
  // Guard against a vacuous comparison: the Action must move the hands, and G2 must have separated the Characters.
  const [nodeA, nodeB] = characterIds.map((id) => nodeOf.get(id)!)
  const handTravel = truth[nodeA!]![0]!.LeftHand!.distanceTo(truth[nodeA!]![20]!.LeftHand!)
  assert.ok(handTravel > 0.05, `Action barely moves the hand (${handTravel.toFixed(3)} m)`)
  const at = (nodeId: string) => project.scene.content.nodes.find((node) => node.id === nodeId)!.transform.position
  const apart = Math.hypot(at(nodeB!).x - at(nodeA!).x, at(nodeB!).z - at(nodeA!).z)
  assert.ok(Math.abs(apart - 1.5) < 0.05, `Characters are ${apart.toFixed(3)} m apart`)
  const report: Record<string, unknown> = {}
  for (const [file, label] of [['scene.blend', 'blend'], ['scene.fbx', 'fbx']] as const) {
    const back = readBack(paths[file]!)
    assert.equal(back.fps, 30, `${label} fps`)
    assert.ok(back.frameEnd >= 29, `${label} animation ends at ${back.frameEnd}`)
    let worst = 0, compared = 0
    for (const characterId of characterIds) {
      const nodeId = nodeOf.get(characterId)!
      const rigName = Object.keys(back.rigs).find((name) => name.includes(nodeId))
      assert.ok(rigName, `${label}: no armature for ${nodeId} in ${Object.keys(back.rigs).join(', ')}`)
      for (const frame of FRAMES) for (const name of BONES) {
        const b = back.rigs[rigName][String(frame)]?.[name]
        assert.ok(b, `${label}: ${name} missing at frame ${frame}`)
        const expected = truth[nodeId]![frame]![name]!
        worst = Math.max(worst, expected.distanceTo(new Vector3(b[0], b[2], -b[1]))); compared++
      }
    }
    report[label] = { compared, maxErrorMeters: +worst.toFixed(5), frameEnd: back.frameEnd }
    assert.ok(worst <= 0.01, `${label}: max bone error ${worst.toFixed(4)} m`)
  }
  console.log('H4 roundtrip', JSON.stringify({ handTravelMeters: +handTravel.toFixed(3), nodesApartMeters: +apart.toFixed(3), ...report }))
})
