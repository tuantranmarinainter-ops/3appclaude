import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import { makeEmptyDraft } from '@topview/3d-builder'
import { createCharacter, registerBaseModel, rebuildLibraryIndex, addCharacterActions } from '../../../packages/library/index'
import { libraryCharacterModel, libraryBaseGlb, unpackLibraryGlb } from '../src/libraryModels'
import { LocalHostAdapter } from '../src/LocalHostAdapter'
import { GET } from '../app/api/library/route'
import { addLibraryCharacterToProject, listLibraryCharacterDetails } from '../src/libraryCommands'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'

function png(red: number) {
  const chunk = (type: string, bytes: Buffer) => {
    const data = Buffer.concat([Buffer.from(type), bytes]); let crc = 0xffffffff
    for (const value of data) { crc ^= value; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    const head = Buffer.alloc(4), tail = Buffer.alloc(4); head.writeUInt32BE(bytes.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([head, data, tail])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,red,0,255-red,255]))), chunk('IEND', Buffer.alloc(0))])
}

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const temporary = mkdtempSync(path.join(tmpdir(), 'studio-library-characters-'))
const previousProjects = process.env.BBS_UNIFIED_PROJECTS_DIR, previousLibrary = process.env.W01_LIBRARY
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temporary, 'projects')
process.env.W01_LIBRARY = path.join(temporary, 'library')
test.after(() => {
  rmSync(temporary, { recursive: true, force: true })
  if (previousProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = previousProjects
  if (previousLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = previousLibrary
})

test('two library characters reuse one base asset and retain distinct per-node skins', { concurrency: false }, async () => {
  const modelFile = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
  const registered = registerBaseModel({ name: 'Shared synthetic model', rig: 'mixamo65', modelFile })
  assert.ok(registered.metadata.objects.length)
  const skins = [path.join(temporary, 'red'), path.join(temporary, 'blue')]
  for (const [index, directory] of skins.entries()) for (const object of registered.metadata.objects) {
    const file = path.join(directory, ...object.split('/'), 'default.png')
    mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, png(index * 255))
  }
  const first = createCharacter({ charId: 'shared-red', name: 'Shared Red', baseModelId: registered.modelId, skinDir: skins[0] })
  const second = createCharacter({ charId: 'shared-blue', name: 'Shared Blue', baseModelId: registered.modelId, skinDir: skins[1] })
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Character library scene', scene: makeEmptyDraft('Character library scene', 30, 180) } })
  const a = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: created.revision, charId: first.charId })
  const b = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: a.revision, charId: second.charId })
  const project = await readUnifiedProject(created.projectId)
  assert.equal(Object.values(project.assets).filter(asset => asset.kind === 'model').length, 1)
  assert.equal(a.assetId, b.assetId)
  const nodes = project.scene.content.nodes.filter(node => node.metadata?.libraryCharacterId)
  assert.deepEqual(nodes.map(node => node.metadata?.libraryCharacterId).sort(), ['shared-blue', 'shared-red'])
  assert.equal(nodes.every(node => node.metadata?.libraryBaseModelId === registered.modelId), true)
  const hashes = nodes.map(node => (node.metadata?.librarySkin as Array<{ sha256: string }>)[0]!.sha256)
  assert.notEqual(hashes[0], hashes[1])
  const rendered = []
  const adapter = new LocalHostAdapter('unified')
  for (const node of nodes) {
    const model = await libraryCharacterModel(String(node.metadata!.libraryCharacterId))
    assert.equal(adapter.resolveAssetUrl(String(node.metadata!.modelUrl)), node.metadata!.modelUrl)
    const response = await GET(new Request(`http://localhost/api/library?modelCharacter=${node.metadata!.libraryCharacterId}&fingerprint=${model.fingerprint}`))
    assert.equal(response.status, 200)
    const { json, binary } = unpackLibraryGlb(Buffer.from(await response.arrayBuffer()))
    const meshNode = json.nodes.find((item: any) => item.mesh !== undefined)
    const material = json.materials[json.meshes[meshNode.mesh].primitives[0].material]
    const image = json.images[json.textures[material.pbrMetallicRoughness.baseColorTexture.index].source]
    const view = json.bufferViews[image.bufferView]
    rendered.push(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength).toString('hex'))
    const stale = await GET(new Request(`http://localhost/api/library?modelCharacter=${node.metadata!.libraryCharacterId}&fingerprint=${'0'.repeat(64)}`))
    assert.equal(stale.status, 409)
    const skin = (await listLibraryCharacterDetails()).find(item => item.charId === node.metadata!.libraryCharacterId)!.textures[0]!
    writeFileSync(path.join(process.env.W01_LIBRARY!, skin.path), png(127))
    const changed = await GET(new Request(`http://localhost/api/library?modelCharacter=${node.metadata!.libraryCharacterId}&fingerprint=${model.fingerprint}`))
    assert.equal(changed.status, 409, 'previous fingerprint rejects mutated texture bytes')
  }
  assert.notEqual(rendered[0], rendered[1], 'actual mesh material texture bytes differ')
  assert.equal(nodes.every(node => Array.isArray(node.metadata?.libraryHiddenObjects) && node.metadata.libraryHiddenObjects.length === 0), true)
  const details = await listLibraryCharacterDetails()
  assert.equal(details.filter(item => item.baseModelId === registered.modelId).length, 2)
  assert.equal(readFileSync(modelFile).byteLength, project.assets[a.assetId as keyof typeof project.assets]!.source.byteLength)
})


for (const count of [84, 101, 20]) test(`native BOBJ placement preserves ${count} bones and eight Actions`, { concurrency: false }, async () => {
  let source = `arm_name verity.mdl\n` + Array.from({ length: count }, (_, i) => `arm_bone B${i} ${i ? 'B0 ' : ''}0 1 0 1 0 0 0 0 1 0 ${i} 0 0 1 0 0 0 0 1`).join('\n') + `
 o Body
 o_arm verity.mdl
 v 0 0 0
 vw B0 1
 v 0 2 0
 vw B1 1
 v 1 0 0
 vw B0 1
 f 1 2 3
` .replace(/^ /gm, '') + Array.from({length: 8}, (_, i) => `an idle${i}\nao B0\nag location 0\nkf 0 0 LINEAR\nkf 20 0 LINEAR\n`).join('')
  if (count === 20) {
    const armature = readFileSync(path.join(editor, 'apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8')
    source = armature + '\no Body\no_arm minecraft20\nv 0 0 0\nvw body 1\nv 0 2 0\nvw head 1\nv 1 0 0\nvw body 1\nf 1 2 3\n' + Array.from({ length: 8 }, (_, i) => `an idle${i}\nao body\nag location 0\nkf 0 0 LINEAR\nkf 20 0 LINEAR\n`).join('')
  }
  const modelFile = path.join(temporary, `native${count}.bobj`)
  writeFileSync(modelFile, source)
  const registered = registerBaseModel({ name: `Native${count}`, rig: count === 20 ? 'minecraft20' : 'verity', modelFile })
  const character = createCharacter({ charId: `native${count}`, name: `Native${count}`, baseModelId: registered.modelId })
  const bytes = await libraryBaseGlb(character.charId), { json } = unpackLibraryGlb(bytes)
  assert.equal(json.skins[0].joints.length, count)
  assert.equal(json.animations.length, 8)
  assert.equal(readFileSync(modelFile, 'utf8'), source)
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Native', scene: makeEmptyDraft('Native', 30, 180) } })
  const placed = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: created.revision, charId: character.charId })
  const project = await readUnifiedProject(created.projectId)
  assert.equal(project.skeletons[project.characters[String(placed.characterId)]!.skeletonId]!.bones.filter(bone => count === 20 ? bone.name !== 'bobj-model' : /^B\d+$/.test(bone.name)).length, count)
  const actionUuid = randomUUID(), packId = String(count).padStart(16, '0'), directory = path.join(process.env.W01_LIBRARY!, 'packs', packId)
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'anim.glb'), 'canonical data must not be loaded for native placement')
  writeFileSync(path.join(directory, 'anim.original.bbs.bobj'), source + '\nan added\nao B0\nag location 0\nkf 0 0 LINEAR\nkf 20 1 LINEAR\n')
  writeFileSync(path.join(directory, 'meta.json'), JSON.stringify({ kind: 'motion-pack', libraryVersion: '1.1.0', packId, rig: 'mixamo65', glbSha256: 'a'.repeat(64), createdAt: new Date().toISOString(), license: { id: 'test', commitable: false }, actions: [{ uuid: actionUuid, name: 'Added', durationSeconds: 1, fps: 30, category: 'idle', tags: [], loop: false, inPlace: true, glbAnimationIndex: 0, ownerCharId: character.charId, status: 'draft', version: 1 }] }))
  if (count === 20) {
    writeFileSync(path.join(directory, 'anim.bobj'), 'an added\nao body\nag location 0\nkf 0 0 LINEAR\nkf 20 1 LINEAR\n')
    writeFileSync(path.join(directory, 'anim.glb'), bytes)
    const metadata = JSON.parse(readFileSync(path.join(directory, 'meta.json'), 'utf8'))
    metadata.rig = 'minecraft20'; metadata.glbSha256 = createHash('sha256').update(bytes).digest('hex')
    writeFileSync(path.join(directory, 'meta.json'), JSON.stringify(metadata))
    writeFileSync(path.join(directory, 'anim.manifest.json'), JSON.stringify({ version: '1.0.0', rig: 'minecraft20', glbSha256: metadata.glbSha256, actions: [{ uuid: actionUuid, name: 'idle0', durationSeconds: 1, fps: 30, glbAnimationIndex: 0 }] }))
  }
  rebuildLibraryIndex()
  const actionPlaced = await executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: placed.revision, command: 'library.place', args: { actionUuid, characterId: placed.characterId } })
  const withAction = await readUnifiedProject(created.projectId)
  assert.ok(withAction.motions[actionUuid])
  assert.equal(withAction.scene.content.timeline.animation.motionClips.length, 1)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: actionPlaced.revision, command: 'history.undo', args: {} })
  const afterUndo = await readUnifiedProject(created.projectId)
  assert.deepEqual(afterUndo.scene, project.scene)
  assert.deepEqual(afterUndo.motions, project.motions)
  assert.deepEqual(afterUndo.assets, project.assets)
  addCharacterActions({ charId: character.charId, actions: [actionUuid], defaultAction: actionUuid })
  const secondProject = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Native default', scene: makeEmptyDraft('Native default', 30, 180) } })
  const withDefault = await addLibraryCharacterToProject({ projectId: secondProject.projectId, expectedRevision: secondProject.revision, charId: character.charId })
  const defaultProject = await readUnifiedProject(secondProject.projectId)
  assert.ok(defaultProject.motions[actionUuid])
  assert.equal(defaultProject.scene.content.timeline.animation.motionClips.length, 1)
  assert.equal(defaultProject.scene.content.nodes.find(node => node.id === withDefault.nodeId)!.metadata!.libraryDefaultAction, actionUuid)
  if (count === 20) {
    const skinCharacters = []
    for (const [index, charId] of ['minecraft-red', 'minecraft-blue'].entries()) {
      const skinDir = path.join(temporary, charId), file = path.join(skinDir, 'Body', 'default.png')
      mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, png(index * 255))
      skinCharacters.push(createCharacter({ charId, name: charId, baseModelId: registered.modelId, skinDir }))
    }
    const skinScene = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'MC skins', scene: makeEmptyDraft('MC skins', 30, 180) } })
    const red = await addLibraryCharacterToProject({ projectId: skinScene.projectId, expectedRevision: skinScene.revision, charId: skinCharacters[0]!.charId })
    const blue = await addLibraryCharacterToProject({ projectId: skinScene.projectId, expectedRevision: red.revision, charId: skinCharacters[1]!.charId })
    assert.equal(red.assetId, blue.assetId)
    assert.equal(Object.values((await readUnifiedProject(skinScene.projectId)).assets).filter(asset => asset.kind === 'model').length, 1)
    const rendered = []
    for (const character of skinCharacters) {
      const { json, binary } = unpackLibraryGlb((await libraryCharacterModel(character.charId)).bytes)
      const node = json.nodes.find((node: any) => node.extras?.bobjObject === 'Body')
      const material = json.materials[json.meshes[node.mesh].primitives[0].material]
      const view = json.bufferViews[json.images[json.textures[material.pbrMetallicRoughness.baseColorTexture.index].source].bufferView]
      rendered.push(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength))
    }
    assert.deepEqual(rendered, [png(0), png(255)], 'Minecraft mesh material embeds the selected skin pixels')
  }
  const before = structuredClone(afterUndo)
  await assert.rejects(addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: 0, charId: character.charId }), /revision/i)
  assert.deepEqual(await readUnifiedProject(created.projectId), before)
})
