import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { copyLibraryForMinecraft20, migrateMinecraft20Emoticons, validateEmoticonsModel } from '../cli/migrateMinecraft20Emoticons.ts'
import { bobjModelToGlb, parseBobjModel } from '../src/bobjModel.ts'
import { loadBobj } from '../cli/loadBobj.ts'
import { SkinnedMesh } from 'three'
import { evaluateBobjAction, parseBobjActions } from '../src/index.ts'
import { resolveCharacter } from '../../library/characters.ts'

const armature = readFileSync(new URL('../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj', import.meta.url), 'utf8')
// Synthetic triangle, never advertised as Emoticons. All binary fixtures live in temp directories.
function skinPng() {
  const chunk = (kind: string, data: Buffer) => {
    const tag = Buffer.from(kind), head = Buffer.alloc(4), tail = Buffer.alloc(4)
    let crc = 0xffffffff
    for (const b of Buffer.concat([tag, data])) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
    head.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([head, tag, data, tail])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(64, 0); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 6
  const row = Buffer.alloc(257); for (let x = 0; x < 64; x++) { row[1+x*4] = 127; row[4+x*4] = 255 }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array.from({length:64},()=>row)))), chunk('IEND', Buffer.alloc(0))])
}
const mesh = armature + '\no synthetic\nv 0 0 0\nvw body 1\nv 0 2 0\nvw head 1\nv 1 1 0\nvw body 1\nf 1 2 3\n'
function fixture() {
  const temp = mkdtempSync(join(tmpdir(), 'a9-mc20-')), source = join(temp, 'source'), copy = join(temp, 'copy'), bases = join(temp, 'external')
  mkdirSync(bases); writeFileSync(join(bases, 'default.bobj'), mesh)
  for (const id of ['hero', 'den']) {
    const dir = join(source, 'characters', id); mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ kind: 'character', charId: id, libraryVersion: '1.0.0', name: id, rig: 'minecraft20', model: 'model.bobj', createdAt: '2026-10-25T00:00:00Z', license: { id: 'internal-only', commitable: false }, actions: [] }))
    writeFileSync(join(dir, 'model.bobj'), armature)
    writeFileSync(join(dir, 'skin.png'), skinPng())
  }
  return { temp, source, copy, bases }
}
test('safe physical copy gets own bases/textures; source/action files unchanged and idempotent', () => {
  const f = fixture()
  try {
    const original = readFileSync(join(f.source, 'characters/hero/meta.json'))
    copyLibraryForMinecraft20(f.source, f.copy)
    const options = { sourceLibrary: f.source, copiedLibrary: f.copy, baseDir: f.bases }
    assert.equal(migrateMinecraft20Emoticons({ ...options, dryRun: true }).length, 2)
    const result = migrateMinecraft20Emoticons(options); assert.equal(result.length, 2); assert.notEqual(result[0].modelId, result[1].modelId)
    const hero = resolveCharacter({ root: f.copy, charId: 'hero' }); assert.equal(hero.baseModel?.ownerCharId, 'hero'); assert.ok(hero.textures.synthetic)
    const loaded = loadBobj(readFileSync(hero.modelPath, 'utf8'), '', { resourceDir: dirname(hero.modelPath) })
    const skinned = loaded.children.find(n => n.isSkinnedMesh) as SkinnedMesh
    assert.equal((skinned.material as any).map.image.width, 64); assert.equal((skinned.material as any).map.image.height, 64)
    const converted = bobjModelToGlb(parseBobjModel(readFileSync(hero.modelPath, 'utf8')), { readTexture: path => readFileSync(join(dirname(hero.modelPath), path)) })
    const jsonLength = Buffer.from(converted.bytes).readUInt32LE(12), gltf = JSON.parse(Buffer.from(converted.bytes).subarray(20, 20+jsonLength).toString())
    assert.equal(gltf.images.length, 1); assert.equal(gltf.materials[0].pbrMetallicRoughness.baseColorTexture.index, 0)
    assert.deepEqual(readFileSync(hero.textures.synthetic!), readFileSync(join(f.source, 'characters/hero/skin.png')))
    assert.deepEqual(readFileSync(join(f.source, 'characters/hero/meta.json')), original)
    assert.deepEqual(migrateMinecraft20Emoticons(options), result)
    assert.throws(() => migrateMinecraft20Emoticons({ ...options, copiedLibrary: f.source }), /separate/)
    writeFileSync(join(f.bases, 'bad.bobj'), mesh.replace('v 0 2 0', 'v 0 200 0')); assert.throws(() => validateEmoticonsModel(join(f.bases, 'bad.bobj')), /scale/)
    assert.throws(() => migrateMinecraft20Emoticons({ ...options, variant: '../bad' }), /Unsafe/)
    assert.equal(readdirSync(join(f.copy, 'models')).filter(n => !n.startsWith('.')).length, 2)
  } finally { rmSync(f.temp, { recursive: true, force: true }) }
})
test('reject copied-library links; dereference links when making a new copy', { skip: process.platform === 'win32' ? 'Requires symlink privilege' : false }, () => {
  const f = fixture()
  try {
    symlinkSync(join(f.source, 'characters/hero/skin.png'), join(f.source, 'linked.png'))
    copyLibraryForMinecraft20(f.source, f.copy)
    symlinkSync(f.source, join(f.copy, 'unsafe'))
    assert.throws(() => migrateMinecraft20Emoticons({ sourceLibrary: f.source, copiedLibrary: f.copy, baseDir: f.bases }), /symlinks/)
  } finally { rmSync(f.temp, { recursive: true, force: true }) }
})
test('optional external real Emoticons model validation', { skip: !process.env.W01_MC20_BASE_DIR ? 'NOT_RUN: external Emoticons fixture unavailable' : false }, () => {
  assert.equal(validateEmoticonsModel(join(process.env.W01_MC20_BASE_DIR!, 'default.bobj')).armature.bones.length, 20)
})

test('external skeleton contract retains all85 native actions and their channels', () => {
  const actions = parseBobjActions(readFileSync(new URL('../../../apps/studio/public/retarget/v9.12/minecraft-actions.bobj', import.meta.url), 'utf8'))
  assert.equal(actions.size, 85)
  const f = fixture()
  try {
    const model = validateEmoticonsModel(join(f.bases, 'default.bobj'))
    assert.equal(model.armature.bones.length, 20)
    // Every action targets this same unmodified native skeleton; no action file is rewritten.
    const before = readFileSync(join(f.bases, 'default.bobj'))
    copyLibraryForMinecraft20(f.source, f.copy)
    migrateMinecraft20Emoticons({ sourceLibrary: f.source, copiedLibrary: f.copy, baseDir: f.bases })
    const migrated = parseBobjModel(readFileSync(resolveCharacter({ root: f.copy, charId: 'hero' }).modelPath, 'utf8'))
    assert.deepEqual(readFileSync(resolveCharacter({ root: f.copy, charId: 'hero' }).modelPath), before)
    let nonRest = 0
    for (const action of actions.values()) {
      let moved = false
      for (const tick of [0, 10, 30]) {
        const originalPose = evaluateBobjAction(model.armature, action, tick), migratedPose = evaluateBobjAction(migrated.armature, action, tick)
        assert.equal(migratedPose.length, 20)
        for (let i = 0; i < migratedPose.length; i++) for (let j = 0; j < 16; j++) {
          const value = migratedPose[i].worldMatrix[j]
          assert(Number.isFinite(value)); assert(Math.abs(value - originalPose[i].worldMatrix[j]) < 1e-9)
          if (Math.abs(value - migrated.armature.bones[i].restWorld[j]) > 1e-5) moved = true
        }
      }
      if (moved) nonRest++
    }
    assert(nonRest > 60, `Expected animated native clips, got ${nonRest}`)
  } finally { rmSync(f.temp, { recursive: true, force: true }) }
})

test('unsafe BOBJ object paths never reach texture staging', () => {
  const f = fixture()
  try {
    for (const name of ['../escape', '/absolute', 'C:/drive', 'a/../../escape', 'a\\escape']) {
      writeFileSync(join(f.bases, 'bad.bobj'), mesh.replace('o synthetic', `o ${name}`))
      assert.throws(() => validateEmoticonsModel(join(f.bases, 'bad.bobj')), /unsafe object name/)
    }
  } finally { rmSync(f.temp, { recursive: true, force: true }) }
})
