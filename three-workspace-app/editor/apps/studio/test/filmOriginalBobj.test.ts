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
import { bobjModelToGlb, parseBobjModel } from '../../../packages/retarget/src/bobjModel.ts'
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
  // B30: Verity keeps the original bytes and only appends the empty idle-slot rest action.
  const stagedBytes = readFileSync(staged.files[0]!.sourcePath)
  assert.deepEqual(stagedBytes.subarray(0, original.toString('utf8').replace(/\s*$/, '').length), Buffer.from(original.toString('utf8').replace(/\s*$/, '')))
  assert.match(stagedBytes.toString('utf8'), /\nan w01_rest\nao Root\nag location 0\nkf 0 /)
  assert.ok(staged.actions.includes('w01_rest'))
  assert.equal(staged.files[0]!.sha256, sha(stagedBytes))
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
  assert.deepEqual(animated!.actions, ['idle', 'character_wave', 'w01_rest'])
  // Actual L3 convention: native base clips are project Motions, not library actions.
  const nativeGlb = Buffer.from(bobjModelToGlb(parseBobjModel(original.toString())).bytes)
  writeFileSync(path.join(folder, 'model.glb'), nativeGlb)
  Object.assign(model.source, { sha256: sha(nativeGlb), byteLength: nativeGlb.length })
  const nativeUuid = 'df7ac5ff-0000-4000-8000-000000000002'
  Object.assign(snapshot, { motions: { [nativeUuid]: { id: nativeUuid, assetId: 'asset', sourceClip: { sha256: sha(nativeGlb) }, edit: null, derivedFrom: null } },
    extensions: { retargetMotionMetadata: { [nativeUuid]: { name: 'idle', clipIndex: 0 } } } })
  Object.assign(snapshot.scene.content.timeline.animation, { motionClips: [{ target: { nodeId: 'actor' }, motion: { assetId: nativeUuid, clipIndex: 0 } }] })
  const native = await stageOriginalLibraryBobjProfile(snapshot as never, model as never, path.join(temp, 'native-project-action'))
  const nativeBytes = readFileSync(native!.files[0]!.sourcePath).toString('utf8')
  assert.equal(nativeBytes.replace(/\nan w01_rest\n[\s\S]*$/, ''), original.toString('utf8').replace(/\s*$/, ''), 'native project action needs no appended sidecar, only the rest action')
  const nativeMetadata = (snapshot as unknown as { extensions: { retargetMotionMetadata: Record<string, { name: string; clipIndex: number }> } }).extensions.retargetMotionMetadata[nativeUuid]!
  nativeMetadata.clipIndex = 1
  await assert.rejects(stageOriginalLibraryBobjProfile(snapshot as never, model as never, path.join(temp, 'wrong-index')), /native action identity/)
  nativeMetadata.clipIndex = 0; nativeMetadata.name = 'forged'
  await assert.rejects(stageOriginalLibraryBobjProfile(snapshot as never, model as never, path.join(temp, 'wrong-name')), /native action identity/)
})

test('rejects different selected actions that would overwrite the same original action name', () => {
  const base = Buffer.from('arm_name rig\nan idle\nao Root\n')
  const a = Buffer.concat([base, Buffer.from('an wave\nao COG\nag location 0\nkf 0 1\n')])
  const b = Buffer.concat([base, Buffer.from('an wave\nao COG\nag location 0\nkf 0 2\n')])
  assert.throws(() => mergeOriginalBobjActions(base, [a, b]), /actions conflict: wave/)
})

test('B17: an action saved against an older mesh of the same rest skeleton rebases onto the new base', () => {
  const matrix = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1'
  const armature = `arm_name minecraft20\narm_bone anchor  0 0 0 ${matrix}\narm_bone body anchor 0 1 0 1 0 0 0 0 1 0 1 0 0 1 0 0 0 0 1\n`
  const emoticons = Buffer.from(`${armature}o body\nv 0 0 0\nv 0 2 0\nvw body 1\n`)
  const oldSidecar = Buffer.from(`# Retarget V9.12 Minecraft20 rest armature\n${armature}o Body\nv 1 1 1\nvw body 1\nan app3_stun\nao body\nag rotation 0\nkf 0 0.5 LINEAR\n`)
  const merged = mergeOriginalBobjActions(emoticons, [oldSidecar]).toString('utf8')
  assert.ok(merged.startsWith(emoticons.toString('utf8')))
  assert.match(merged, /an app3_stun\nao body\nag rotation 0\nkf 0 0.5 LINEAR/)
  assert.equal(merged.match(/^v /gm)!.length, 2, 'old mesh vertices are not copied')
  const otherRest = Buffer.from(oldSidecar.toString('utf8').replace('arm_bone body anchor', 'arm_bone torso anchor'))
  assert.throws(() => mergeOriginalBobjActions(emoticons, [otherRest]), /changed its source prefix/)
})
