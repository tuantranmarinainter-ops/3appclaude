import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { readFilmAnchorLocations, writeFilmAnchorLocation } from '../src/filmAnchorLocations'

const directory = mkdtempSync(path.join(tmpdir(), 'film-locations-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = directory
test.after(() => rmSync(directory, { recursive: true, force: true }))

test('named game locations persist with revision checks, dry-run and undo/redo', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Locations', scene: makeEmptyDraft('Locations', 30, 29) } })
  const projectId = String(created.result.projectId)
  const args = { name: 'Lâu đài', anchor: { mode: 'local-origin', destination: [107.08, -60, 207.13], yawDegrees: -64.47, dimension: 'minecraft:overworld', pivot: [10, 2, 20] } }
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'film.anchor.location.set', args }), /expectedRevision/)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, dryRun: true, command: 'film.anchor.location.set', args })
  assert.equal((await readUnifiedProject(projectId)).revision, 0)
  const saved = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'film.anchor.location.set', args })
  const locations = readFilmAnchorLocations((await readUnifiedProject(projectId)).extensions)
  assert.equal(locations.length, 1); assert.equal(locations[0]!.anchor.yawDegrees, -64.47)
  assert.equal(locations[0]!.anchor.pivot, undefined)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'film.anchor.location.set', args }), /thay đổi/)
  const undo = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: saved.revision, command: 'history.undo', args: {} })
  assert.equal(readFilmAnchorLocations((await readUnifiedProject(projectId)).extensions).length, 0)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: undo.revision, command: 'history.redo', args: {} })
  assert.equal(readFilmAnchorLocations((await readUnifiedProject(projectId)).extensions).length, 1)
})

test('locations replace the same name without mutating unrelated extensions', () => {
  const source = { other: { value: 1 } }
  const anchor = { mode: 'local-origin' as const, destination: [1, 2, 3] as [number, number, number] }
  const first = writeFilmAnchorLocation(source, 'Place', anchor)
  const second = writeFilmAnchorLocation(first, 'Place', { ...anchor, yawDegrees: 90 })
  assert.equal(readFilmAnchorLocations(second).length, 1)
  assert.deepEqual(source, { other: { value: 1 } })
  assert.throws(() => writeFilmAnchorLocation(source, '', anchor))
})
