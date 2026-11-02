import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { migrateLibraryBaseModels, unusedBaseModels } from '../cli/migrateLibraryBaseModels.ts'
import { createCharacter, registerBaseModel, resolveCharacter, setCharacterBaseModel, setCharacterSkin } from '../../library/characters.ts'
import { bobjModelToGlb, parseBobjModel } from '../src/bobjModel.ts'

const armature = readFileSync(resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8')
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('skin')])
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
function files(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => statSync(join(dir, name)).isDirectory() ? files(join(dir, name), `${prefix}${name}/`) : [`${prefix}${name}`])
}
function character(root: string, charId: string, rig: string, extra: Record<string, unknown> = {}) {
  const dir = join(root, 'characters', charId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ kind: 'character', charId, libraryVersion: '1.0.0', name: charId, rig, createdAt: '2026-10-23T00:00:00.000Z', license: { id: 'internal-only', commitable: false }, model: 'model.glb', actions: [], ...extra }))
  return dir
}

test('migration gives old-schema characters a base model without touching their files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'w01-migrate-'))
  try {
    const mc = character(root, 'mc-hero', 'minecraft20', { model: 'model.bobj' })
    writeFileSync(join(mc, 'model.bobj'), armature); writeFileSync(join(mc, 'skin.png'), PNG)
    const other = character(root, 'mc-den', 'minecraft20', { model: 'model.bobj' })
    writeFileSync(join(other, 'model.bobj'), armature); writeFileSync(join(other, 'skin.png'), Buffer.concat([PNG, Buffer.from('2')]))
    const orig = character(root, 'verity-go', 'mixamo65')
    mkdirSync(join(orig, 'original', 'textures', 'verity_body'), { recursive: true })
    writeFileSync(join(orig, 'model.glb'), 'mixamo65 view')
    writeFileSync(join(orig, 'original', 'model.bbs.bobj'), armature.replace(/^arm_name.*$/m, '') + '\no verity_body\n')
    writeFileSync(join(orig, 'original', 'textures', 'verity_body', 'default.png'), PNG)
    // Same original model as verity-go, different body texture (Gỗ Xưa / Tiểu Nhị).
    const twin = character(root, 'verity-tieu', 'mixamo65')
    mkdirSync(join(twin, 'original', 'textures', 'verity_body'), { recursive: true })
    writeFileSync(join(twin, 'model.glb'), 'mixamo65 view')
    writeFileSync(join(twin, 'original', 'model.bbs.bobj'), readFileSync(join(orig, 'original', 'model.bbs.bobj')))
    writeFileSync(join(twin, 'original', 'textures', 'verity_body', 'default.png'), Buffer.concat([PNG, Buffer.from('tieu')]))
    const bare = character(root, 'bare', 'mixamo65'); writeFileSync(join(bare, 'model.glb'), 'x')

    const before = Object.fromEntries(['characters/mc-hero', 'characters/mc-den', 'characters/verity-go'].flatMap((dir) => files(join(root, dir)).filter((f) => f !== 'meta.json').map((f) => [`${dir}/${f}`, sha(join(root, dir, f))])))
    const originalSha = sha(join(orig, 'original', 'model.bbs.bobj'))

    const dry = await migrateLibraryBaseModels({ root, dryRun: true })
    assert.deepEqual(dry.map((item) => [item.charId, item.status]).sort(), [['bare', 'unsupported'], ['mc-den', 'would-migrate'], ['mc-hero', 'would-migrate'], ['verity-go', 'would-migrate'], ['verity-tieu', 'would-migrate']])
    // Dry runs are read-only: the library may not even create models/.
    assert.deepEqual(existsSync(join(root, 'models')) ? readdirSync(join(root, 'models')) : [], [])

    const results = await migrateLibraryBaseModels({ root })
    assert.deepEqual(results.map((item) => item.status).sort(), ['migrated', 'migrated', 'migrated', 'migrated', 'unsupported'])

    const hero = resolveCharacter({ root, charId: 'mc-hero' }), den = resolveCharacter({ root, charId: 'mc-den' })
    assert.equal(hero.baseModel?.format, 'bobj'); assert.equal(hero.baseModel?.rig, 'minecraft20')
    assert.notEqual(hero.baseModel?.modelId, den.baseModel?.modelId, 'each character owns its base model'); assert.equal(hero.baseModel?.ownerCharId, 'mc-hero'); assert.ok(!hero.character.skin)
    assert.equal(readFileSync(hero.textures.Body!).toString('latin1'), PNG.toString('latin1'))
    assert.equal(readFileSync(den.textures.Body!).toString('latin1'), Buffer.concat([PNG, Buffer.from('2')]).toString('latin1'))
    assert.equal(hero.character.rig, 'minecraft20'); assert.equal(hero.character.charId, 'mc-hero')
    const model = parseBobjModel(readFileSync(hero.modelPath, 'utf8')), glb = Buffer.from(bobjModelToGlb(model).bytes)
    assert.equal(model.armature.bones.length, 20); assert.deepEqual(model.objects.map((item) => item.name), ['Body'])
    assert.equal(model.objects[0]!.faces.length, 11 * 6 * 2); assert.equal(glb.toString('ascii', 0, 4), 'glTF')

    const go = resolveCharacter({ root, charId: 'verity-go' })
    assert.equal(go.baseModel?.rig, 'verity'); assert.equal(go.character.rig, 'mixamo65')
    assert.equal(sha(go.modelPath), originalSha)
    assert.equal(sha(join(orig, 'original', 'model.bbs.bobj')), originalSha)
    assert.ok(go.textures.verity_body)
    const tieu = resolveCharacter({ root, charId: 'verity-tieu' })
    assert.notEqual(tieu.baseModel?.modelId, go.baseModel?.modelId, 'identical original models still get one base each'); assert.equal(tieu.baseModel?.sha256, go.baseModel?.sha256); assert.equal(tieu.baseModel?.ownerCharId, 'verity-tieu')
    assert.equal(readFileSync(go.textures.verity_body!).toString('latin1'), PNG.toString('latin1'))
    assert.equal(readFileSync(tieu.textures.verity_body!).toString('latin1'), Buffer.concat([PNG, Buffer.from('tieu')]).toString('latin1'), 'each wears its own body texture')

    const after = Object.fromEntries(Object.keys(before).map((key) => [key, sha(join(root, key))]))
    for (const [key, value] of Object.entries(before)) assert.equal(after[key], value, key)
    assert.deepEqual(files(join(root, 'characters/verity-go')).sort(), ['meta.json', 'model.glb', 'original/model.bbs.bobj', 'original/textures/verity_body/default.png'])

    const snapshot = JSON.stringify(files(root).sort()) + ['mc-hero', 'mc-den', 'verity-go'].map((id) => readFileSync(join(root, 'characters', id, 'meta.json'), 'utf8')).join()
    const again = await migrateLibraryBaseModels({ root })
    assert.deepEqual(again.map((item) => item.status).sort(), ['already', 'already', 'already', 'already', 'unsupported'])
    assert.equal(JSON.stringify(files(root).sort()) + ['mc-hero', 'mc-den', 'verity-go'].map((id) => readFileSync(join(root, 'characters', id, 'meta.json'), 'utf8')).join(), snapshot)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('characters already sharing a base are split into own bases with own textures; idempotent, originals untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'w01-split-'))
  try {
    const bobj = armature.replace(/^arm_name.*$/m, '') + '\no verity_body\n'
    const ids = ['go', 'tieu', 'chi'], tex = (id: string) => Buffer.concat([PNG, Buffer.from(id)])
    const dirs = ids.map((id) => { const dir = character(root, id, 'mixamo65'); mkdirSync(join(dir, 'original', 'textures', 'verity_body'), { recursive: true }); writeFileSync(join(dir, 'model.glb'), 'v'); writeFileSync(join(dir, 'original', 'model.bbs.bobj'), bobj); writeFileSync(join(dir, 'original', 'textures', 'verity_body', 'default.png'), tex(id)); return dir })
    const mcs = ['hero', 'den'].map((id) => { const dir = character(root, `mc-${id}`, 'minecraft20', { model: 'model.bobj' }); writeFileSync(join(dir, 'skin.png'), tex(id)); return dir })
    // Previous migration state: one shared base for everyone with the same bytes, textures as character overrides.
    const shared = registerBaseModel({ root, name: 'shared', rig: 'verity', modelFile: join(dirs[0]!, 'original', 'model.bbs.bobj'), texturesDir: join(dirs[0]!, 'original', 'textures') })
    assert.equal(shared.metadata.ownerCharId, undefined)
    for (const [index, id] of ids.entries()) { setCharacterBaseModel({ root, charId: id, baseModelId: shared.modelId }); if (id !== 'chi') setCharacterSkin({ root, charId: id, skinDir: join(dirs[index]!, 'original', 'textures') }) } // 'chi' has no override at all
    const originalSha = sha(join(dirs[0]!, 'original', 'model.bbs.bobj'))
    assert.throws(() => createCharacter({ root, charId: 'thief', name: 'x', baseModelId: registerBaseModel({ root, name: 'own', rig: 'verity', modelFile: join(dirs[0]!, 'original', 'model.bbs.bobj'), texturesDir: join(dirs[0]!, 'original', 'textures'), ownerCharId: 'go' }).modelId }), /belongs to character go/)

    const dry = await migrateLibraryBaseModels({ root, dryRun: true })
    assert.equal(dry.filter((item) => item.status === 'would-migrate').length, 5)
    assert.equal(resolveCharacter({ root, charId: 'tieu' }).baseModel?.modelId, shared.modelId, 'dry run changes nothing')

    const results = await migrateLibraryBaseModels({ root })
    assert.deepEqual(results.map((item) => item.status), Array(5).fill('migrated'))
    const resolved = ids.map((id) => resolveCharacter({ root, charId: id }))
    assert.equal(new Set(resolved.map((item) => item.baseModel!.modelId)).size, 3, 'three characters, three modelIds')
    for (const [index, item] of resolved.entries()) {
      assert.notEqual(item.baseModel!.modelId, shared.modelId); assert.equal(item.baseModel!.ownerCharId, ids[index]); assert.ok(!item.character.skin)
      assert.equal(sha(item.modelPath), originalSha)
      assert.equal(readFileSync(item.textures.verity_body!).toString('latin1'), tex(ids[index]!).toString('latin1'), 'own body texture')
      assert.ok(item.textures.verity_body!.includes(item.baseModel!.modelId), 'texture lives in the own base')
    }
    const minecraft = ['mc-hero', 'mc-den'].map((id) => resolveCharacter({ root, charId: id }))
    assert.notEqual(minecraft[0]!.baseModel!.modelId, minecraft[1]!.baseModel!.modelId)
    assert.equal(readFileSync(minecraft[0]!.textures.Body!).toString('latin1'), tex('hero').toString('latin1')); assert.equal(readFileSync(minecraft[1]!.textures.Body!).toString('latin1'), tex('den').toString('latin1'))
    assert.equal(sha(join(dirs[0]!, 'original', 'model.bbs.bobj')), originalSha); assert.ok(mcs.length)
    assert.deepEqual(unusedBaseModels(root), [shared.modelId], 'old shared base is kept and reported')

    const snapshot = JSON.stringify(files(root).sort())
    assert.deepEqual((await migrateLibraryBaseModels({ root })).map((item) => item.status), Array(5).fill('already'))
    assert.equal(JSON.stringify(files(root).sort()), snapshot)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
