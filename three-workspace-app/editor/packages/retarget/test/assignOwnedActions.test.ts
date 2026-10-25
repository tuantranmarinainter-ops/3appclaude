import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { addCharacterActions, createCharacter, rebuildLibraryIndex, registerBaseModel } from '../../library/index.ts'
import { getAction } from '../../library/library.ts'
import { assignToCharacter } from '../cli/assignToCharacter.ts'
import { loadAsset } from '../cli/loadAsset.ts'
import { decodeGlb } from '../cli/glb.ts'
import { bobjModelToGlb, parseBobjModel } from '../src/bobjModel.ts'
import { parseBobjActions } from '../src/index.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const editor = resolve(here, '../../..')
const builtinCharacter = join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')

/** Animation duration + track ranges measured from a GLB, per RETARGET-LESSONS (numbers, not vibes). */
async function measureGlb(bytes: Uint8Array) {
  const scene = await loadAsset(bytes, 'glb', { skeletonOnly: true })
  const clip = scene.animations[0]
  assert.ok(clip, 'GLB carries an animation')
  const hips = clip.tracks.find((track) => /(^|\.)Hips\.position$/.test(track.name))
  let hipsRange = 0
  if (hips) {
    const values = (hips as unknown as { values: Float32Array }).values
    let min = Infinity, max = -Infinity
    for (let i = 1; i < values.length; i += 3) { min = Math.min(min, values[i]!); max = Math.max(max, values[i]!) }
    hipsRange = max - min
  }
  const { json } = decodeGlb(bytes)
  const jointNames = ((json.skins?.[0]?.joints ?? []) as number[]).map((index) => (json.nodes?.[index] as { name?: string } | undefined)?.name ?? '')
  return { duration: clip.duration, trackCount: clip.tracks.length, hipsRange, jointNames }
}

function normalizedMixamoActions(temp: string): { glb: Buffer; actions: Array<{ name: string; durationSeconds: number }> } {
  const source = join(editor, 'apps/studio/public/retarget/v9.12'), out = join(temp, 'actions')
  const run = spawnSync(process.execPath, ['--import', 'tsx', '../retarget/cli/normalize.ts', '--src', join(source, 'minecraft-actions.bobj'), '--armature',
    join(source, 'minecraft20-armature.bobj'), '--target', builtinCharacter, '--out', out, '--action', '0'], { cwd: join(editor, 'packages/builder'), encoding: 'utf8', timeout: 180000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const files = readdirSync(out)
  const manifest = JSON.parse(readFileSync(join(out, files.find((name) => name.endsWith('.manifest.json'))!), 'utf8')) as { actions: Array<{ name: string; durationSeconds: number }> }
  return { glb: readFileSync(join(out, files.find((name) => name.endsWith('.glb'))!)), actions: manifest.actions }
}

test('N1b: character-owned Actions convert across skeletons and keep parentUuid', { timeout: 300000 }, async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'assign-owned-'))
  t.after(() => { /* keep temp for debugging on failure */ })
  const root = join(temp, 'library')
  mkdirSync(root, { recursive: true })
  const options = { root }

  // Minecraft20 library character with one native Draft (pack GLB composed like the native pipeline).
  const armature = readFileSync(join(editor, 'apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8')
  const modelSource = armature + '\no Body\no_arm minecraft20\nv 0 0 0\nvw body 1\nv 0 2 0\nvw head 1\nv 1 0 0\nvw body 1\nf 1 2 3\n'
    + 'an idle\nao body\nag location 0\nkf 0 0 LINEAR\nkf 20 0 LINEAR\n'
  const modelFile = join(temp, 'go-xua-model.bobj')
  writeFileSync(modelFile, modelSource)
  const mcRegistered = registerBaseModel({ ...options, name: 'Gỗ Xưa', rig: 'minecraft20', modelFile })
  createCharacter({ ...options, charId: 'go-xua', name: 'Gỗ Xưa', baseModelId: mcRegistered.modelId })
  const draftAnim = 'an Wave\nao body\nag location 0\nkf 0 0 LINEAR\nkf 10 0.5 LINEAR\nkf 20 1 LINEAR\n'
  const mcModel = parseBobjModel(modelSource)
  mcModel.actions = parseBobjActions(draftAnim)
  const mcPackGlb = Buffer.from(bobjModelToGlb(mcModel, { faceForward: true }).bytes)
  const mcSha = createHash('sha256').update(mcPackGlb).digest('hex')
  const mcDraftUuid = randomUUID()
  const mcPack = join(root, 'packs', '2000000000000001')
  mkdirSync(mcPack, { recursive: true })
  writeFileSync(join(mcPack, 'anim.bobj'), draftAnim)
  writeFileSync(join(mcPack, 'anim.glb'), mcPackGlb)
  writeFileSync(join(mcPack, 'meta.json'), JSON.stringify({
    kind: 'motion-pack', libraryVersion: '1.1.0', packId: '2000000000000001', rig: 'minecraft20', glbSha256: mcSha, createdAt: new Date().toISOString(),
    license: { id: 'test', commitable: false },
    actions: [{ uuid: mcDraftUuid, name: 'Wave', durationSeconds: 1, fps: 30, category: 'idle', tags: [], loop: false, inPlace: true, glbAnimationIndex: 0, ownerCharId: 'go-xua', status: 'draft', version: 1 }],
  }))
  writeFileSync(join(mcPack, 'anim.manifest.json'), JSON.stringify({
    version: '1.0.0', rig: 'minecraft20', glbSha256: mcSha,
    actions: [{ uuid: mcDraftUuid, name: 'Wave', durationSeconds: 1, fps: 30, glbAnimationIndex: 0 }],
  }))

  // Mixamo65 library character (builtin GLB base model) owning one normalized Action.
  const heroRegistered = registerBaseModel({ ...options, name: 'Hero', rig: 'mixamo65', modelFile: builtinCharacter })
  createCharacter({ ...options, charId: 'hero', name: 'Hero', baseModelId: heroRegistered.modelId })
  const normalized = normalizedMixamoActions(temp)
  const heroSha = createHash('sha256').update(normalized.glb).digest('hex')
  const heroActionUuid = randomUUID(), heroAction = normalized.actions[0]!
  const heroPack = join(root, 'packs', '2000000000000002')
  mkdirSync(heroPack, { recursive: true })
  writeFileSync(join(heroPack, 'anim.glb'), normalized.glb)
  writeFileSync(join(heroPack, 'meta.json'), JSON.stringify({
    kind: 'motion-pack', libraryVersion: '1.1.0', packId: '2000000000000002', rig: 'mixamo65', glbSha256: heroSha, createdAt: new Date().toISOString(),
    license: { id: 'test', commitable: false },
    actions: [{ uuid: heroActionUuid, name: heroAction.name, durationSeconds: heroAction.durationSeconds, fps: 30, category: 'idle', tags: [], loop: false, inPlace: true, glbAnimationIndex: 0, ownerCharId: 'hero', status: 'draft', version: 1 }],
  }))
  writeFileSync(join(heroPack, 'anim.manifest.json'), JSON.stringify({
    version: '1.0.0', rig: 'mixamo65', glbSha256: heroSha,
    actions: [{ uuid: heroActionUuid, name: heroAction.name, durationSeconds: heroAction.durationSeconds, fps: 30, glbAnimationIndex: 0 }],
  }))
  rebuildLibraryIndex(options)
  addCharacterActions({ ...options, charId: 'go-xua', actions: [mcDraftUuid] })
  addCharacterActions({ ...options, charId: 'hero', actions: [heroActionUuid] })

  const sourceMc = await measureGlb(mcPackGlb)
  const sourceHero = await measureGlb(normalized.glb)

  // Direction 1: Minecraft20-owned .bobj Action -> Mixamo65 character (normalize pipeline).
  const [toHero] = await assignToCharacter({ actionUuids: [mcDraftUuid], charId: 'hero', libraryRoot: root })
  assert.equal(toHero?.status, 'ok', toHero?.reason)
  assert.ok(toHero?.warning?.includes('chuyển xương'), 'conversion carries the quality warning')
  const heroDraft = getAction({ root, actionUuid: toHero!.assignedUuid! })
  assert.equal(heroDraft.ownerCharId, 'hero')
  assert.equal(heroDraft.parentUuid, mcDraftUuid)
  assert.equal(heroDraft.rig, 'mixamo65')
  const heroMeasure = await measureGlb(readFileSync(heroDraft.glbPath))
  assert.ok(heroMeasure.jointNames.includes('Hips'), `converted GLB uses Mixamo65 joints (got ${heroMeasure.jointNames.slice(0, 5)}…)`)
  assert.ok(Math.abs(heroMeasure.duration - sourceMc.duration) <= 0.05, `duration preserved: ${sourceMc.duration}s -> ${heroMeasure.duration}s`)
  assert.ok(heroMeasure.trackCount >= 30, `converted clip animates the Mixamo65 body (${heroMeasure.trackCount} tracks)`)

  // Repeat assignment reports already-exists instead of duplicating.
  const [again] = await assignToCharacter({ actionUuids: [mcDraftUuid], charId: 'hero', libraryRoot: root })
  assert.equal(again?.status, 'already-exists')
  assert.equal(again?.assignedUuid, toHero!.assignedUuid)

  // Direction 2: Mixamo65-owned Action -> Minecraft20 character (reverse retarget).
  const [toMc] = await assignToCharacter({ actionUuids: [heroActionUuid], charId: 'go-xua', libraryRoot: root })
  assert.equal(toMc?.status, 'ok', toMc?.reason)
  assert.ok(toMc?.warning?.includes('chuyển xương'))
  const mcDraft = getAction({ root, actionUuid: toMc!.assignedUuid! })
  assert.equal(mcDraft.ownerCharId, 'go-xua')
  assert.equal(mcDraft.parentUuid, heroActionUuid)
  assert.equal(mcDraft.rig, 'minecraft20')
  const mcMeasure = await measureGlb(readFileSync(mcDraft.glbPath))
  assert.equal(mcMeasure.jointNames.length, 20, `Minecraft20 draft keeps 20 joints (got ${mcMeasure.jointNames.length})`)
  assert.ok(Math.abs(mcMeasure.duration - sourceHero.duration) <= 0.1, `duration preserved: ${sourceHero.duration}s -> ${mcMeasure.duration}s`)
})
