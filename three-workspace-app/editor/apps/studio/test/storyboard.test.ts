import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { StoryboardError, actionNames, buildStoryboard, shotCameraPosition, validateStoryboard } from '../src/storyboard'
import { readUnifiedProject } from '../src/unifiedProjectStore'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..') // projects dir is read per call
const temp = mkdtempSync(path.join(tmpdir(), 'storyboard-'))
const priorProjects = process.env.BBS_UNIFIED_PROJECTS_DIR
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
test.after(() => { rmSync(temp, { recursive: true, force: true }); if (priorProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = priorProjects })


const character = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')

function normalizedActions(): { glb: string; manifest: string } {
  const source = path.join(editor, 'apps/studio/public/retarget/v9.12'), out = path.join(temp, 'actions')
  const run = spawnSync(process.execPath, ['--import', 'tsx', '../retarget/cli/normalize.ts', '--src', path.join(source, 'minecraft-actions.bobj'), '--armature',
    path.join(source, 'minecraft20-armature.bobj'), '--target', character, '--out', out, '--action', '0,1'], { cwd: path.join(editor, 'packages/builder'), encoding: 'utf8', timeout: 180000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const files = readdirSync(out)
  return { glb: path.join(out, files.find((name) => name.endsWith('.glb'))!), manifest: path.join(out, files.find((name) => name.endsWith('.manifest.json'))!) }
}

const storyboard = (actions: { glb: string; manifest: string }, names: string[]) => ({
  version: 'storyboard.v1', name: 'Storyboard test', fps: 30, area: 20, sequenceId: 'ep',
  actionSets: { mx: actions }, cast: { hero: { model: character, actions: 'mx' }, foe: { model: character, actions: 'mx' } },
  shots: [
    { id: '01', sec: 1, camera: { target: [0, 1, 0], az: 0, el: 5, dist: 5, motion: { presetId: 'dolly_in' } },
      actors: [{ who: 'hero', at: [0, 0, 0], yaw: 0, acts: [[names[0], 0, 1]], moves: [[0, 0, 0, 0], [1, 1, 0, 0, 90]] }],
      fx: [{ effect: 'aura01', at: [0, 0, 0], scale: 0.5, t0: 0, t1: 1 }], lines: [['Hero', 'Xin chào', 0.1]] },
    { id: '02', sec: 1.5, camera: { target: [0, 1, 0], az: 30, el: 0, dist: 4 },
      actors: [{ who: 'hero', at: [-1, 0, 0], yaw: 90, acts: [[names[1], 0, 1.5]] }, { who: 'foe', at: [1, 0, 0], yaw: -90, acts: [[names[0], 0, 1.5]] }] },
    { id: '03', sec: 0.5, camera: { target: [0, 1, 0], az: -20, el: 10, dist: 6 }, actors: [] },
  ],
})

test('validates structure with the path of each problem', () => {
  assert.throws(() => validateStoryboard({ version: 'storyboard.v0' }), StoryboardError)
  try {
    validateStoryboard({ version: 'storyboard.v1', name: 'x', actionSets: { mx: { glb: 'a.glb' } }, cast: { hero: { model: 'm.glb', actions: 'nope' } },
      shots: [{ id: '01', sec: 1, camera: { target: [0, 0, 0], az: 0, el: 0, dist: 0 }, actors: [{ who: 'ghost', at: [0, 0], acts: [['walk', 0, 2]] }] }] })
    assert.fail('expected StoryboardError')
  } catch (error) {
    const paths = (error as InstanceType<typeof StoryboardError>).issues.map((issue) => issue.path)
    assert.deepEqual(paths.sort(), ['cast.hero.actions', 'shots[0].actors[0].acts[0]', 'shots[0].actors[0].at', 'shots[0].actors[0].who', 'shots[0].camera'].sort())
  }
})

test('aims the camera from azimuth, elevation and distance', () => {
  const position = shotCameraPosition({ x: 10, y: 1, z: 0 }, 90, 0, 4)
  assert.ok(Math.abs(position.x - 14) < 1e-9 && Math.abs(position.y - 1) < 1e-9 && Math.abs(position.z) < 1e-9)
  assert.equal(shotCameraPosition({ x: 0, y: 0, z: 0 }, 0, -80, 5).y, 0.3)
})

test('builds one editable project: characters, actions, keys, cameras, camera move, sequence and VFX', { timeout: 300000 }, async () => {
  const actions = normalizedActions()
  const actionList = await actionNames(actions.glb, actions.manifest)
  assert.equal(actionList.length, 2)
  const built = await buildStoryboard(storyboard(actions, actionList), temp)
  assert.deepEqual(built.shots.map((shot) => [shot.shotId, shot.start, shot.end, shot.ox, shot.cameraId, shot.characterIds.length]),
    [['01', 0, 29, 0, 'camera_1', 1], ['02', 30, 74, 20, 'cam_02', 2], ['03', 75, 89, 40, 'cam_03', 0]])
  assert.deepEqual(built.shots[0]!.lines, [['Hero', 'Xin chào', 0.1]])
  const project = await readUnifiedProject(built.projectId)
  const content = project.scene.content
  assert.equal(Object.keys(project.characters).length, 3)
  assert.deepEqual(content.editorial!.sequences[0]!.clips.map((clip) => [clip.cameraNodeId, clip.sourceFrameStart, clip.sourceFrameEnd]),
    [['camera_1', 0, 29], ['cam_02', 30, 74], ['cam_03', 75, 89]])
  assert.equal(content.timeline.animation.cameraMotionClips.length, 1)
  assert.ok(content.timeline.animation.motionClips.length >= 3)
  const cam2 = content.nodes.find((node) => node.id === 'cam_02')!
  assert.deepEqual(cam2.camera!.lookAt, { x: 20, y: 1, z: 0 })
  const cues = (project.extensions as { vfxCues?: { cues: Array<{ effect: string; frameStart: number; frameEnd: number }> } }).vfxCues!.cues
  assert.deepEqual(cues.map((cue) => [cue.effect, cue.frameStart, cue.frameEnd]), [['aura01', 0, 29]])
  const fcurves = JSON.stringify(project.extensions.topview?.fcurves ?? null)
  assert.ok(fcurves.includes('transform.rotation') && fcurves.includes('transform.position'))

  // An Action the action set does not have fails before any project is created.
  const before = readdirSync(path.join(temp, 'projects')).length
  await assert.rejects(buildStoryboard(storyboard(actions, ['missing_action', actionList[1]!]), temp), (error: unknown) =>
    error instanceof StoryboardError && error.issues.some((issue) => issue.path === 'shots[0].actors[0].acts[0]'))
  assert.equal(readdirSync(path.join(temp, 'projects')).length, before)
  writeFileSync(path.join(temp, 'done'), '')
})
