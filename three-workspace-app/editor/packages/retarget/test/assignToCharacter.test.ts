import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { assignToCharacter } from '../cli/assignToCharacter.ts'
import { listCharacterActions } from '../../library/characterActions.ts'
import { getAction, importPack } from '../../library/library.ts'
import { loadAsset } from '../cli/loadAsset.ts'
import { runNormalize } from '../cli/normalizeCore.ts'
import { decodeGlb } from '../cli/glb.ts'
import { parseBobjActions } from '../src/index.ts'
import { MIXAMO_TO_VERITY, VERITY_METRES_PER_UNIT } from '../src/verityRig.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const editor = resolve(here, '../../..')

function makeGlb(): Buffer {
  const indices = new Map(MIXAMO65_BONE_PARENTS.map(([name], index) => [name, index]))
  const nodes: Array<{ name: string; children: number[]; mesh?: number; translation?: number[] }> = MIXAMO65_BONE_PARENTS.map(([name, parent]) => ({ name, ...(parent ? {} : { translation: [0, 1, 0] }), children: [] }))
  for (const [name, parent] of MIXAMO65_BONE_PARENTS) if (parent) nodes[indices.get(parent)!]!.children.push(indices.get(name)!)
  nodes.push({ name: 'Body', mesh: 0, children: [] })
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, nodes, meshes: [{ name: 'Body', primitives: [{ attributes: {} }] }], skins: [{ joints: nodes.slice(0, 65).map((_, index) => index) }], animations: [] }))
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]), header = Buffer.alloc(20)
  header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8)
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, padded])
}

function makeLegacyCharacter(root: string, charId: string, rig: string, model: string, modelBytes: Uint8Array, options: { skin?: boolean; original?: string } = {}) {
  const directory = join(root, 'characters', charId)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'meta.json'), JSON.stringify({
    kind: 'character', libraryVersion: '1.1.0', charId, name: charId, rig, createdAt: new Date(0).toISOString(),
    license: { id: 'internal-only', commitable: false }, model, actions: [],
  }))
  writeFileSync(join(directory, model), modelBytes)
  if (options.skin) writeFileSync(join(directory, 'skin.png'), Buffer.from('synthetic skin'))
  if (options.original) {
    const original = join(directory, 'original')
    mkdirSync(original, { recursive: true })
    writeFileSync(join(original, 'model.bbs.bobj'), options.original)
  }
}

test('Mixamo65 assignment creates one character draft and reports repeat assignment without duplication', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'assign-character-test-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  const root = join(workspace, 'library'), bytes = makeGlb(), model = join(workspace, 'character.glb')
  writeFileSync(model, bytes)
  makeLegacyCharacter(root, 'mixamo-test', 'mixamo65', 'model.glb', bytes)
  const source = join(workspace, 'source')
  mkdirSync(source)
  const sourceUuid = randomUUID(), digest = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(join(source, 'source.glb'), bytes)
  writeFileSync(join(source, 'source.manifest.json'), JSON.stringify({ version: '1.0.0', rig: 'mixamo65', glbSha256: digest,
    actions: [{ uuid: sourceUuid, name: 'Walk', durationSeconds: 1, fps: 30, glbAnimationIndex: 0 }] }))
  writeFileSync(join(source, 'source.report.json'), JSON.stringify({ status: 'PASS' }))
  importPack({ root, sourceDirectory: source })

  const [first] = await assignToCharacter({ actionUuids: [sourceUuid], charId: 'mixamo-test', libraryRoot: root })
  assert.equal(first?.status, 'ok')
  const directDraft = getAction({ root, actionUuid: first!.assignedUuid! })
  assert.equal(directDraft.rig, 'mixamo65')
  assert.deepEqual(readFileSync(directDraft.glbPath), bytes)
  assert.equal(listCharacterActions({ root, charId: 'mixamo-test' }).length, 1)
  const [again] = await assignToCharacter({ actionUuids: [sourceUuid], charId: 'mixamo-test', libraryRoot: root })
  assert.equal(again?.status, 'already-exists')
  assert.equal(listCharacterActions({ root, charId: 'mixamo-test' }).length, 1)
})

function syntheticVerity(): string {
  const arm = (name: string, parent: string | null, x: number, y: number, z: number) => {
    const world = new Matrix4().makeTranslation(x, y, z), tail = new Vector3(x, y, z).add(new Vector3(0, 0.1, 0))
    return `arm_bone ${name}${parent ? ` ${parent}` : ''} ${tail.toArray().join(' ')} ${world.clone().transpose().toArray().join(' ')}`
  }
  const lines = ['arm_name verity.mdl', arm('Root', null, 0, 0, 0), arm('COG', 'Root', 0, 1.2, 0), arm('Pelvis', 'COG', 0, 1.15, 0)]
  for (const [target, parentTarget] of MIXAMO65_BONE_PARENTS) {
    if (target === 'Hips') continue
    const name = MIXAMO_TO_VERITY[target]!
    const parent = target.endsWith('UpLeg') ? 'Pelvis' : parentTarget === 'Hips' ? 'COG' : MIXAMO_TO_VERITY[parentTarget!]!
    lines.push(arm(name, parent, target.includes('Left') ? 0.1 : target.includes('Right') ? -0.1 : 0, target.includes('Leg') ? 0.5 : 1.5, 0))
  }
  lines.push(arm('Jaw', 'Head', 0, 1.6, 0), arm('Wing_Bone_L', 'Chest', 0.3, 1.6, 0), arm('camera', 'Root', 0, -2, 0),
    'o body', 'v -0.2 0 0', 'vw COG 1', 'v 0.2 0 0', 'vw COG 1', 'v 0 3.8 0', 'vw Head 1', 'vt 0 0', 'vt 1 0', 'vt 0.5 1', 'vn 0 0 1', 'f 1/1/1 2/2/1 3/3/1',
    'o camera_helper', 'v -1 -2 0', 'vw camera 1', 'v 1 -2 0', 'vw camera 1', 'v 0 -1 0', 'vw camera 1', 'f 4/1/1 5/2/1 6/3/1',
    'an idle', 'ao Root', 'ag rotation 1', 'kf 0 0 LINEAR 0 0 0 0', 'kf 4 0.3 LINEAR 4 0.3 4 0.3')
  return `${lines.join('\n')}\n`
}

test('legacy Minecraft20 skin and Mixamo65 original-rig assignments convert and deduplicate', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'assign-native-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  const root = join(workspace, 'library'), modelDir = join(workspace, 'models')
  mkdirSync(modelDir)
  const mcArmature = readFileSync(join(editor, 'apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8')
  const mcModelPath = join(modelDir, 'minecraft.bobj')
  writeFileSync(mcModelPath, `${mcArmature}\no Body\n`)
  const verityText = syntheticVerity(), verityModelPath = join(modelDir, 'verity.bobj')
  writeFileSync(verityModelPath, verityText)
  makeLegacyCharacter(root, 'minecraft-test', 'minecraft20', 'model.bbs.bobj', readFileSync(mcModelPath), { skin: true })
  makeLegacyCharacter(root, 'verity-test', 'mixamo65', 'model.glb', makeGlb(), { original: verityText })

  const armaturePath = join(editor, 'apps/studio/public/retarget/v9.12/minecraft20-armature.bobj')
  const actionsPath = join(editor, 'apps/studio/public/retarget/v9.12/minecraft-actions.bobj')
  const targetPath = resolve(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
  const armatureBytes = readFileSync(armaturePath), actionsBytes = readFileSync(actionsPath), targetBytes = readFileSync(targetPath)
  const names = [...parseBobjActions(actionsBytes.toString('utf8')).keys()], actionIndex = names.indexOf('idle')
  const normalized = await runNormalize({ source: await loadAsset(actionsBytes, 'bobj', { bobjArmature: armatureBytes }), sourceLabel: 'minecraft-actions.bobj', sourceSha256: '1'.repeat(64),
    target: await loadAsset(targetBytes, 'glb', { skeletonOnly: true }), targetLabel: 'mixamo65.glb', targetSha256: '2'.repeat(64), actions: [actionIndex], ground: 'off' })
  assert.equal(normalized.status, 'PASS')
  const sourceDirectory = join(workspace, 'source'); mkdirSync(sourceDirectory)
  const actionUuid = randomUUID(), digest = createHash('sha256').update(normalized.glb!).digest('hex')
  writeFileSync(join(sourceDirectory, 'source.glb'), normalized.glb!)
  writeFileSync(join(sourceDirectory, 'source.manifest.json'), JSON.stringify({ version: '1.0.0', rig: 'mixamo65', glbSha256: digest,
    source: { file: 'idle.fbx', sha256: null }, actions: [{ uuid: actionUuid, name: 'Idle', sourceName: 'Idle', nameVi: 'Đứng yên', durationSeconds: normalized.report.actions[0]!.durationSeconds, fps: 30, glbAnimationIndex: 0 }] }))
  writeFileSync(join(sourceDirectory, 'source.report.json'), JSON.stringify({ status: 'PASS' }))
  importPack({ root, sourceDirectory, tags: ['idle'] })

  const minecraft = await assignToCharacter({ actionUuids: [actionUuid], charId: 'minecraft-test', libraryRoot: root })
  assert.equal(minecraft[0]?.status, 'ok', minecraft[0]?.reason)
  const minecraftDraft = listCharacterActions({ root, charId: 'minecraft-test' })[0]!
  assert.equal(minecraftDraft.rig, 'minecraft20')
  const mcPack = join(root, 'packs', minecraftDraft.packId)
  assert.equal(parseBobjActions(readFileSync(join(mcPack, 'anim.bobj'), 'utf8')).size, 1)
  assert.equal(readFileSync(join(mcPack, 'anim.bobj'), 'utf8').match(/^an ([^\r\n]+)/m)?.[1], 'Idle')
  const minecraftGlb = decodeGlb(readFileSync(join(mcPack, 'anim.glb'))).json
  assert.equal(minecraftGlb.skins?.[0]?.joints?.length, 20, 'library GLB must contain a skinned Minecraft20 rig')
  assert.equal(minecraftGlb.animations.length, 1)
  assert.equal(minecraftGlb.animations[0]?.name, 'Idle')
  assert.equal(minecraftDraft.nameVi, 'Đứng yên')
  assert.deepEqual(minecraftDraft.tags, ['idle'])
  assert.equal((await assignToCharacter({ actionUuids: [actionUuid], charId: 'minecraft-test', libraryRoot: root }))[0]?.status, 'already-exists')

  const verity = await assignToCharacter({ actionUuids: [actionUuid], charId: 'verity-test', libraryRoot: root })
  assert.equal(verity[0]?.status, 'ok', verity[0]?.reason)
  const verityDraft = listCharacterActions({ root, charId: 'verity-test' })[0]!
  assert.equal(verityDraft.rig, 'mixamo65', 'library GLB remains the normalized Mixamo65 action')
  const verityPack = join(root, 'packs', verityDraft.packId), originalBytes = Buffer.from(verityText)
  assert.deepEqual(readFileSync(join(verityPack, 'anim.original.bbs.bobj')).subarray(0, originalBytes.length), originalBytes)
  const verityLibraryGlb = decodeGlb(readFileSync(join(verityPack, 'anim.glb'))).json
  assert.equal(verityLibraryGlb.skins?.[0]?.joints?.length, 65, 'library GLB remains the normalized Mixamo65 action')
  assert.equal(verityLibraryGlb.animations.length, 1)
  const verityOriginalGlb = decodeGlb(readFileSync(join(verityPack, 'anim.original.glb'))).json
  assert.ok((verityOriginalGlb.skins?.[0]?.joints?.length ?? 0) > 20, 'original GLB must contain the native Verity rig')
  assert.equal(verityOriginalGlb.animations.length, 2, 'original GLB preserves original actions and adds the assigned Action')
  assert.equal(minecraftDraft.parentUuid, actionUuid); assert.equal(verityDraft.parentUuid, actionUuid)
  const packs = readdirSync(join(root, 'packs')).filter((id) => !id.startsWith('.'))
  assert.equal(packs.length, 3, 'only the shared source pack and the two drafts; conversions leave no shared copy')
  assert.equal(verityDraft.nameVi, 'Đứng yên')
  assert.deepEqual(verityDraft.tags, ['idle'])
  assert.equal(parseBobjActions(readFileSync(join(verityPack, 'anim.original.bbs.bobj'), 'utf8')).size, 2)
  assert.equal((await assignToCharacter({ actionUuids: [actionUuid], charId: 'verity-test', libraryRoot: root }))[0]?.status, 'already-exists')

  // N1b both ways between owned Actions. 'verity-test' is labelled mixamo65 but keeps its original Verity skeleton; its Action pack is
  // labelled mixamo65 too, so routing must follow the owner's real skeleton, not the label.
  const cross = await assignToCharacter({ actionUuids: [verityDraft.uuid], charId: 'minecraft-test', libraryRoot: root, createNew: true })
  assert.equal(cross[0]?.status, 'ok', `Verity -> Minecraft20: ${cross[0]?.reason}`)
  const fromVerity = getAction({ root, actionUuid: cross[0]!.assignedUuid! })
  assert.equal(fromVerity.rig, 'minecraft20'); assert.equal(fromVerity.parentUuid, verityDraft.uuid); assert.equal(fromVerity.ownerCharId, 'minecraft-test')
  const fromVerityJson = decodeGlb(readFileSync(fromVerity.glbPath)).json
  assert.equal(fromVerityJson.skins?.at(-1)?.joints?.length, 20, 'Verity Action lands on all 20 Minecraft20 joints')
  assert.ok(Math.abs(fromVerity.durationSeconds - verityDraft.durationSeconds) <= 0.1, 'duration preserved Verity -> Minecraft20')

  const back = await assignToCharacter({ actionUuids: [minecraftDraft.uuid], charId: 'verity-test', libraryRoot: root, createNew: true })
  assert.equal(back[0]?.status, 'ok', `Minecraft20 -> Verity: ${back[0]?.reason}`)
  const toVerity = getAction({ root, actionUuid: back[0]!.assignedUuid! })
  assert.equal(toVerity.rig, 'mixamo65', 'stored with the Verity character label'); assert.equal(toVerity.parentUuid, minecraftDraft.uuid); assert.equal(toVerity.ownerCharId, 'verity-test')
  const toVerityPack = join(root, 'packs', toVerity.packId)
  assert.ok((decodeGlb(readFileSync(join(toVerityPack, 'anim.original.glb'))).json.skins?.[0]?.joints?.length ?? 0) > 20, 'native Verity GLB written')
  assert.ok(parseBobjActions(readFileSync(join(toVerityPack, 'anim.original.bbs.bobj'), 'utf8')).size >= 2)
})
