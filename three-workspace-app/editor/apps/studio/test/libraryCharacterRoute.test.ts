import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createCharacter, listLibraryCharacters, registerBaseModel, registerLibraryCharacter } from '../../../packages/library/index'
import { GET } from '../app/api/library/character/[id]/route'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const temporary = mkdtempSync(path.join(tmpdir(), 'studio-library-character-route-'))
const previousLibrary = process.env.W01_LIBRARY
process.env.W01_LIBRARY = path.join(temporary, 'library')
test.after(() => {
  rmSync(temporary, { recursive: true, force: true })
  if (previousLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = previousLibrary
})

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('body-texture')])
const armature = readFileSync(path.join(editor, 'apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8')
const bobjFile = path.join(temporary, 'hero.bobj')
writeFileSync(bobjFile, `${armature}\no Body\no_arm minecraft20\nv 0 0 0\nvw body 1\nv 0 2 0\nvw head 1\nv 1 0 0\nvw body 1\nf 1 2 3\n`)

const call = (id: string) => GET(new Request(`http://127.0.0.1/api/library/character/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) })
function glbJson(bytes: Buffer) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', 'response is a GLB')
  return JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12))) as { skins?: unknown[]; meshes?: unknown[]; images?: unknown[] }
}

test('nhân vật .bobj có base model (Minecraft20) được phục vụ dạng GLB kèm texture', async () => {
  const texturesDir = path.join(temporary, 'hero-textures')
  mkdirSync(path.join(texturesDir, 'Body'), { recursive: true })
  writeFileSync(path.join(texturesDir, 'Body', 'default.png'), PNG)
  const registered = registerBaseModel({ name: 'Hero', rig: 'minecraft20', modelFile: bobjFile, texturesDir, ownerCharId: 'hero-bobj' })
  createCharacter({ charId: 'hero-bobj', name: 'Hero', baseModelId: registered.modelId })
  assert.equal(listLibraryCharacters().find((item) => item.charId === 'hero-bobj')?.model, 'model.bbs.bobj', 'fixture đúng dạng E7')

  const response = await call('hero-bobj')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'model/gltf-binary')
  const json = glbJson(Buffer.from(await response.arrayBuffer()))
  assert.ok((json.skins?.length ?? 0) >= 1, 'GLB có skeleton')
  assert.ok((json.meshes?.length ?? 0) >= 1, 'GLB có mesh')
  assert.ok((json.images?.length ?? 0) >= 1, 'texture Body được nhúng vào GLB')
})

test('nhân vật .bobj cũ chưa có base model vẫn xem được trong Thư viện', async () => {
  registerLibraryCharacter({ charId: 'legacy-bobj', name: 'Legacy', rig: 'minecraft20', modelFile: bobjFile })
  assert.equal(listLibraryCharacters().find((item) => item.charId === 'legacy-bobj')?.model, 'model.bobj')
  const response = await call('legacy-bobj')
  assert.equal(response.status, 200)
  const json = glbJson(Buffer.from(await response.arrayBuffer()))
  assert.ok((json.skins?.length ?? 0) >= 1, 'GLB có skeleton')
  assert.ok((json.meshes?.length ?? 0) >= 1, 'GLB có mesh')
})

test('nhân vật model.glb giữ nguyên đường đi cũ, trả đúng từng byte', async () => {
  const source = path.join(editor, '..', 'builtin-assets', 'characters', 'a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
  registerLibraryCharacter({ charId: 'glb-char', name: 'GLB', rig: 'mixamo65', modelFile: source })
  const response = await call('glb-char')
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync(source))
})

test('id không tồn tại hoặc sai định dạng trả 404', async () => {
  assert.equal((await call('khong-ton-tai')).status, 404)
  assert.equal((await call('bad id!')).status, 404)
})
