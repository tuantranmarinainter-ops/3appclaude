import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Quaternion, Vector3 } from 'three'
import { makeEmptyDraft } from '@topview/3d-builder'
import { sampleProjectCameraSequence } from '../src/unifiedSkeletonEvaluation'
import { cameraSamplesToFilm } from '../src/filmCamera'
import { bbsCameraToThree } from '../src/bbsPreview'
import { applyFilmWorldAnchor, resolveFilmWorldAnchor } from '../src/filmWorldAnchor'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'

const root = mkdtempSync(path.join(tmpdir(), 'camera-bbs-native-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(root, 'projects')
test.after(() => rmSync(root, { recursive: true, force: true }))
const nativeEnabled = process.env.BBS_CAMERA_NATIVE_TEST === '1'

test('App 2 0–149 at 30fps: animated camera, 16:9 and F3+C anchor survive native BBS codec', { skip: !nativeEnabled }, async () => {
  const vfov = (mm: number) => 2 * Math.atan(24 / (2 * mm)) * 180 / Math.PI
  const scene = makeEmptyDraft('Camera native parity', 30, 149, {
    fov: vfov(50), position: { x: 1, y: 2, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 1, y: 2, z: 0 },
  })
  scene.content.editorial = { version: 1, activeSequenceId: 'seq', sequences: [{ id: 'seq', clips: [
    { id: 'moving', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 149 },
    { id: 'cut', cameraNodeId: 'camera_2', sourceFrameStart: 0, sourceFrameEnd: 14 },
  ] }] }
  const tracking = structuredClone(scene.content.nodes[0]!)
  tracking.id = 'camera_2'; tracking.name = 'Tracking camera'; tracking.camera!.isPrimary = false
  tracking.camera!.lookAtTarget = { nodeId: 'subject' }
  scene.content.nodes.push(tracking, {
    id: 'subject', type: 'primitive', name: 'Subject', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    primitive: { kind: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } },
  })
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Native parity', scene } })
  const project = await readUnifiedProject(String(created.result.projectId))
  const key = (id: string, frame: number, value: number[]) => ({ id, frame, value, interpolation: 'linear' })
  project.extensions.topview = { ...project.extensions.topview, fcurves: { version: 1, encoding: 'compact-v1', fcurves: [], userKeys: { camera_1: {
    position: [key('p0', 0, [1, 2, 5]), key('p1', 149, [4, 2, 5])],
    rotation: [key('r0', 0, [0, 0, 0]), key('r1', 149, [0, 45, 0])],
    fov: [key('f0', 0, [vfov(50)]), key('f1', 149, [vfov(35)])],
  }, subject: { position: [key('s0', 0, [0, 0, 0]), key('s1', 14, [3, 1, 0])] } } } }
  const samples = []
  for await (const sample of sampleProjectCameraSequence(project, 'seq', 20, 16 / 9)) samples.push(sample)
  const film = cameraSamplesToFilm(samples)
  assert.equal(film.cameras.length, 2)
  assert.equal(film.cameras[0]!.durationTicks, 100)
  assert.equal(film.cameras[1]!.startTick, 100)
  assert.ok(Math.abs(samples[0]!.position[0]! - samples[100]!.position[0]!) > 2.99, 'dolly survives App 2 sampling')
  assert.ok(Math.abs(samples[0]!.quaternion[1]! - samples[100]!.quaternion[1]!) > 0.3, 'pan survives sampling')
  assert.ok(Math.abs(samples[0]!.verticalFov - samples[100]!.verticalFov) > 9, 'zoom survives sampling')
  assert.ok(Math.abs(samples[101]!.quaternion[1]! - samples[111]!.quaternion[1]!) > 0.1, 'look-at target motion survives sampling')
  const anchor = resolveFilmWorldAnchor({ destination: [107.63, -58.72, 210.34], pivot: [1, 0, 2], yawDegrees: 37 }, [0, 0, 0])
  applyFilmWorldAnchor({ actors: [], cameras: film.cameras }, anchor)
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -37 * Math.PI / 180)
  let maximumPosition = 0, maximumAngle = 0, maximumFov = 0
  for (const sample of samples) {
    const clip = film.cameras.find((camera) => camera.id === sample.shotId)!
    const tick = Math.round(sample.shotTimeSeconds * 20)
    const actual = bbsCameraToThree(clip.keyframes[tick]!, film.aspect)
    const expectedPosition = new Vector3(...sample.position).sub(new Vector3(1, 0, 2)).applyQuaternion(turn).add(new Vector3(107.63, -58.72, 210.34))
    const expectedRotation = turn.clone().multiply(new Quaternion(...sample.quaternion))
    maximumPosition = Math.max(maximumPosition, actual.position.distanceTo(expectedPosition))
    maximumAngle = Math.max(maximumAngle, actual.quaternion.angleTo(expectedRotation) * 180 / Math.PI)
    maximumFov = Math.max(maximumFov, Math.abs(actual.fov - sample.verticalFov))
  }
  assert.ok(maximumPosition <= 0.01, `position ${maximumPosition} m`)
  assert.ok(maximumAngle <= 0.1, `angle ${maximumAngle} degrees`)
  assert.ok(maximumFov <= 0.1, `FOV ${maximumFov} degrees`)
  const manifest = { schemaVersion: 1, targetVersion: '2.4', projectId: 'camera-native', sourceRevision: 0, mode: 'playback', filmName: 'camera-native', durationTicks: film.durationTicks,
    models: [], actors: [{ characterId: 'actor', name: 'Actor', actorType: 'male', transformSamples: [0, film.durationTicks].map((tick) => ({ tick, x: 107, y: -59, z: 210, pitch: 0, yaw: 0 })) }], cameras: film.cameras }
  const spec = path.join(root, 'manifest.json'), output = path.join(root, 'output')
  writeFileSync(spec, JSON.stringify(manifest)); mkdirSync(output)
  const worker = spawnSync('python', ['-m', 'agent.unified_cli', 'film', 'export', spec, '--output-dir', output], { cwd: fileURLToPath(new URL('../../../../', import.meta.url)), encoding: 'utf8', timeout: 120_000 })
  assert.equal(worker.status, 0, worker.stderr || worker.stdout)
  const report = JSON.parse(readFileSync(path.join(output, 'camera-native/export-report.json'), 'utf8'))
  assert.equal(report.cameraReadback.valuesCompared, samples.length * 7)
  assert.equal(report.cameraReadback.maxAbsoluteError, 0)
  console.log(JSON.stringify({ samples: samples.length, nativeValuesCompared: report.cameraReadback.valuesCompared, nativeError: report.cameraReadback.maxAbsoluteError, maximumPosition, maximumAngle, maximumFov }))
})
