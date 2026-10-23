import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { mergeOriginalBobjActions, selectOriginalBobj } from '../src/unifiedJobs.ts'

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

test('keeps the source BOBJ bytes and SHA unchanged when no Character action is appended', () => {
  const source = Buffer.from('arm_name verity.mdl\r\narm_bone Root 0 1 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1\r\nan idle\r\n')
  const selected = selectOriginalBobj(source)
  assert.strictEqual(selected, source)
  assert.equal(sha(selected), sha(source))
})

test('requires an appended Character-action BOBJ to preserve the complete raw source prefix', () => {
  const source = Buffer.from('mesh-and-eight-original-actions\r\n')
  const appended = Buffer.concat([source, Buffer.from('an character_action\r\n')])
  assert.deepEqual(selectOriginalBobj(source, appended).subarray(0, source.length), source)
  assert.throws(() => selectOriginalBobj(source, Buffer.from('rewritten-prefix\nan character_action\n')), /changed its source prefix/)
})

test('merges distinct Character actions from multiple original-rig sidecars after the unchanged base prefix', () => {
  const base = Buffer.from('arm_name verity.mdl\nan idle\nao Root\n')
  const a = Buffer.concat([base, Buffer.from('an wave\nao COG\n')])
  const b = Buffer.concat([base, Buffer.from('an wave\nao COG\nan jump\nao COG\n')])
  const merged = mergeOriginalBobjActions(base, [a, b])
  assert.deepEqual(merged.subarray(0, base.length), base)
  assert.equal(merged.toString().match(/^an wave$/gm)?.length, 1)
  assert.equal(merged.toString().match(/^an jump$/gm)?.length, 1)
})

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerBaseModel, createCharacter } from '../../../packages/library/index.ts'
import { stageConvertedLibrarySkinProfile, stageOriginalLibraryBobjProfile } from '../src/unifiedJobs.ts'

test('stages library BOBJ behind a GLB asset, keeps bytes and blocks visible missing textures', async (t) => {
  const temp = mkdtempSync(path.join(tmpdir(), 'film-original-'))
  const oldLibrary = process.env.W01_LIBRARY, oldProjects = process.env.BBS_UNIFIED_PROJECTS_DIR
  process.env.W01_LIBRARY = path.join(temp, 'library'); process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
  t.after(() => { if (oldLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = oldLibrary
    if (oldProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = oldProjects
    rmSync(temp, { recursive: true, force: true }) })
  const matrix = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1'
  const original = Buffer.from(`arm_name verity.mdl\narm_bone Root 0 0 0 ${matrix}\narm_bone COG Root 0 1 0 1 0 0 0 0 1 0 2 0 0 1 0 0 0 0 1\no Body\nv 0 0 0\nvw COG 1\no Missing\nan idle\nao Root\n`)
  const sourceFile = path.join(temp, 'source.bobj'); writeFileSync(sourceFile, original)
  const base = registerBaseModel({ name: 'Synthetic', rig: 'verity', modelFile: sourceFile })
  const char = createCharacter({ name: 'A', baseModelId: base.modelId })
  writeFileSync(path.join(process.env.W01_LIBRARY!, 'skin.png'), 'skin-A')
  const source = Buffer.from('project GLB representation')
  const folder = path.join(process.env.BBS_UNIFIED_PROJECTS_DIR!, 'project'); mkdirSync(folder, { recursive: true }); writeFileSync(path.join(folder, 'model.glb'), source)
  const model = { characterId: 'character', nodeId: 'actor', assetId: 'asset', metersPerUnit: 1, source: { path: 'model.glb', sha256: sha(source), byteLength: source.length } }
  const metadata = { libraryCharacterId: char.charId, librarySkin: [{ object: 'Body', path: 'skin.png', sha256: sha(Buffer.from('skin-A')) }], libraryHiddenObjects: [] as string[] }
  const snapshot = { projectId: 'project', assets: { asset: { source: model.source } }, motions: {}, scene: { content: { nodes: [{ id: 'actor', metadata }], timeline: { animation: { motionClips: [] } } } } }
  await assert.rejects(stageOriginalLibraryBobjProfile(snapshot as never, model as never, path.join(temp, 'blocked')), /missing visible textures: Missing/)
  metadata.libraryHiddenObjects = ['Missing']
  const staged = await stageOriginalLibraryBobjProfile(snapshot as never, model as never, path.join(temp, 'staged'))
  assert.ok(staged?.originalRig)
  assert.equal(staged.sourceSha256, sha(source))
  assert.equal(staged.bones.find((bone) => bone.name === 'COG')!.bobjRestMatrixRowMajor[7], 2, 'native rest-world translation stays row-major')
  assert.deepEqual(readFileSync(staged.files[0]!.sourcePath), original)
  assert.equal(staged.files[0]!.sha256, sha(original))
  assert.equal(staged.files[1]!.targetPath, 'textures/Body/default.png')
  const convertedSkinA = await stageConvertedLibrarySkinProfile(snapshot as never, model as never, { ...staged, originalRig: undefined, files: [staged.files[0]!] })
  writeFileSync(path.join(process.env.W01_LIBRARY!, 'skin-b.png'), 'skin-B')
  metadata.librarySkin = [{ object: 'Body', path: 'skin-b.png', sha256: sha(Buffer.from('skin-B')) }]
  const second = await stageOriginalLibraryBobjProfile(snapshot as never, model as never, path.join(temp, 'skin-b'))
  assert.notEqual(second!.modelId, staged.modelId)
  assert.equal(second!.files[0]!.sha256, staged.files[0]!.sha256)
  assert.notEqual(second!.files[1]!.sha256, staged.files[1]!.sha256)
  const convertedSkinB = await stageConvertedLibrarySkinProfile(snapshot as never, model as never, { ...staged, originalRig: undefined, files: [staged.files[0]!] })
  assert.notEqual(convertedSkinA.modelId, convertedSkinB.modelId)
  assert.equal(convertedSkinA.files[0]!.sha256, convertedSkinB.files[0]!.sha256)
  assert.notEqual(convertedSkinA.files[1]!.sha256, convertedSkinB.files[1]!.sha256)
  const actionUuid = 'df7ac5ff-0000-4000-8000-000000000001', packId = 'a'.repeat(16)
  const pack = path.join(process.env.W01_LIBRARY!, 'packs', packId); mkdirSync(pack, { recursive: true })
  writeFileSync(path.join(pack, 'meta.json'), JSON.stringify({ kind: 'motion-pack', libraryVersion: '1.1.0', packId,
    glbSha256: 'a'.repeat(64), rig: 'mixamo65', createdBy: 'app1', createdAt: new Date().toISOString(),
    license: { id: 'internal-only', commitable: false }, boundCharacter: null, source: { file: null, sha256: null },
    actions: [{ uuid: actionUuid, name: 'Character wave', durationSeconds: 1, fps: 20, category: 'idle', tags: [], loop: false,
      inPlace: true, parentUuid: null, cover: null, glbAnimationIndex: 0 }] }))
  Object.assign(metadata, { libraryDefaultAction: actionUuid })
  await assert.rejects(stageOriginalLibraryBobjProfile(snapshot as never, model as never, path.join(temp, 'no-sidecar')), /lacks its original-rig BOBJ/)
  writeFileSync(path.join(pack, 'anim.original.bbs.bobj'), Buffer.concat([original, Buffer.from('an character_wave\nao COG\n')]))
  const animated = await stageOriginalLibraryBobjProfile(snapshot as never, model as never, path.join(temp, 'animated'))
  const animatedBytes = readFileSync(animated!.files[0]!.sourcePath)
  assert.deepEqual(animatedBytes.subarray(0, original.length), original)
  assert.deepEqual(animated!.actions, ['idle', 'character_wave'])
})

test('rejects different selected actions that would overwrite the same original action name', () => {
  const base = Buffer.from('arm_name rig\nan idle\nao Root\n')
  const a = Buffer.concat([base, Buffer.from('an wave\nao COG\nag location 0\nkf 0 1\n')])
  const b = Buffer.concat([base, Buffer.from('an wave\nao COG\nag location 0\nkf 0 2\n')])
  assert.throws(() => mergeOriginalBobjActions(base, [a, b]), /actions conflict: wave/)
})
