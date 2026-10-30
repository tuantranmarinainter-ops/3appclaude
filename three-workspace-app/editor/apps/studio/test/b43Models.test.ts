import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createCharacter, registerBaseModel, resolveCharacter } from '../../../packages/library/index'
import { libraryCharacterModel, invalidateLibraryModels } from '../src/libraryModels'
import { GET } from '../app/api/library/route'
import { issueLocalSession } from '../src/unifiedSession'
import { GET as image } from '../app/api/unified/vfx-previews/[effect]/route'

test('unchanged model is reused; route validates before 304; texture mtime rebuilds without changing fingerprint format', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'b43-model-'))
  const old = process.env.W01_LIBRARY, oldVfx = process.env.W01_VFX_PREVIEWS
  process.env.W01_LIBRARY = path.join(temp, 'library')
  process.env.W01_VFX_PREVIEWS = path.join(temp, 'vfx')
  try {
    const model = path.join(temp, 'model.bobj'), textures = path.join(temp, 'textures')
    const armature = readFileSync('apps/studio/public/retarget/v9.12/minecraft20-armature.bobj', 'utf8')
    writeFileSync(model, `${armature}\no Body\no_arm minecraft20\nv 0 0 0\nvw body 1\nv 0 2 0\nvw head 1\nv 1 0 0\nvw body 1\nf 1 2 3\n`)
    mkdirSync(path.join(textures, 'Body'), { recursive: true })
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    writeFileSync(path.join(textures, 'Body/default.png'), png)
    const base = registerBaseModel({ name: 'Synthetic', rig: 'minecraft20', modelFile: model, texturesDir: textures })
    createCharacter({ charId: 'synthetic', name: 'Synthetic', baseModelId: base.modelId })
    const [a, b, c] = await Promise.all([libraryCharacterModel('synthetic'), libraryCharacterModel('synthetic'), libraryCharacterModel('synthetic')])
    assert.strictEqual(a, b); assert.strictEqual(b, c)
    assert.strictEqual(await libraryCharacterModel('synthetic'), a, 'no rebuild or rehash when dependencies unchanged')
    const url = `http://127.0.0.1/api/library?modelCharacter=synthetic&fingerprint=${a.fingerprint}`
    const response = await GET(new Request(url))
    assert.equal(response.status, 200); assert.equal(response.headers.get('etag'), `"${a.fingerprint}"`)
    assert.match(response.headers.get('cache-control')!, /immutable/)
    assert.equal((await GET(new Request(url, { headers: { 'If-None-Match': `"${a.fingerprint}"` } }))).status, 304)
    assert.strictEqual(await libraryCharacterModel('synthetic'), a)
    const file = resolveCharacter('synthetic').textures.Body!
    utimesSync(file, new Date(), new Date(Date.now() + 2000))
    const changed = await libraryCharacterModel('synthetic')
    assert.notStrictEqual(changed, a); assert.equal(changed.fingerprint, a.fingerprint, 'mtime alone preserves byte fingerprint')
    writeFileSync(file, Buffer.concat([png, Buffer.from('changed')]))
    const newer = await libraryCharacterModel('synthetic')
    assert.notEqual(newer.fingerprint, a.fingerprint)
    assert.equal((await GET(new Request(url, { headers: { 'If-None-Match': `"${a.fingerprint}"` } }))).status, 409)
    invalidateLibraryModels('synthetic')
    assert.notStrictEqual(await libraryCharacterModel('synthetic'), newer)
    mkdirSync(path.join(process.env.W01_VFX_PREVIEWS, 'aura01'), { recursive: true })
    writeFileSync(path.join(process.env.W01_VFX_PREVIEWS, 'aura01/sheet.png'), png)
    const cookie = issueLocalSession(new Request('http://127.0.0.1/api/unified/session')).headers.get('set-cookie')!.split(';')[0]!
    const context = { params: Promise.resolve({ effect: 'aura01' }) }
    const first = await image(new Request('http://127.0.0.1/api/unified/vfx-previews/aura01', { headers: { cookie } }), context)
    assert.equal(first.status, 200)
    const second = await image(new Request('http://127.0.0.1/api/unified/vfx-previews/aura01', { headers: { cookie, 'If-None-Match': first.headers.get('etag')! } }), context)
    assert.equal(second.status, 304); assert.equal((await second.arrayBuffer()).byteLength, 0)
  } finally {
    invalidateLibraryModels()
    if (old === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = old
    if (oldVfx === undefined) delete process.env.W01_VFX_PREVIEWS; else process.env.W01_VFX_PREVIEWS = oldVfx
    rmSync(temp, { recursive: true, force: true })
  }
})
