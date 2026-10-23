import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { assignToCharacter } from '../cli/assignToCharacter.ts'
import { createCharacter, registerBaseModel } from '../../library/characters.ts'
import { listCharacterActions } from '../../library/characterActions.ts'
import { importPack } from '../../library/library.ts'
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

test('Mixamo65 assignment creates one character draft and reports repeat assignment without duplication', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'assign-character-test-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  const root = join(workspace, 'library'), bytes = makeGlb(), model = join(workspace, 'character.glb')
  writeFileSync(model, bytes)
  const base = registerBaseModel({ root, name: 'Synthetic Mixamo', rig: 'mixamo65', modelFile: model })
  const character = createCharacter({ root, charId: 'mixamo-test', name: 'Mixamo test', baseModelId: base.modelId })
  const source = join(workspace, 'source')
  mkdirSync(source)
  const sourceUuid = randomUUID(), digest = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(join(source, 'source.glb'), bytes)
  writeFileSync(join(source, 'source.manifest.json'), JSON.stringify({ version: '1.0.0', rig: 'mixamo65', glbSha256: digest,
    actions: [{ uuid: sourceUuid, name: 'Walk', durationSeconds: 1, fps: 30, glbAnimationIndex: 0 }] }))
  writeFileSync(join(source, 'source.report.json'), JSON.stringify({ status: 'PASS' }))
  importPack({ root, sourceDirectory: source })

  const [first] = await assignToCharacter({ actionUuids: [sourceUuid], charId: character.charId, libraryRoot: root })
  assert.equal(first?.status, 'ok')
  assert.equal(listCharacterActions({ root, charId: character.charId }).length, 1)
  const [again] = await assignToCharacter({ actionUuids: [sourceUuid], charId: character.charId, libraryRoot: root })
  assert.equal(again?.status, 'already-exists')
  assert.equal(listCharacterActions({ root, charId: character.charId }).length, 1)
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

test('native Minecraft20 and Verity assignments write the per-character sidecars', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'assign-native-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  const root = join(workspace, 'library'), modelDir = join(workspace, 'models')
  mkdirSync(modelDir)
  const mcArmature = readFileSync(join(editor, 'apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8')
  const mcModelPath = join(modelDir, 'minecraft.bobj')
  writeFileSync(mcModelPath, `${mcArmature}\no Body\n`)
  const mcBase = registerBaseModel({ root, name: 'Synthetic Minecraft20', rig: 'minecraft20', modelFile: mcModelPath })
  const mcCharacter = createCharacter({ root, charId: 'minecraft-test', name: 'Minecraft test', baseModelId: mcBase.modelId })
  const verityText = syntheticVerity(), verityModelPath = join(modelDir, 'verity.bobj')
  writeFileSync(verityModelPath, verityText)
  const verityBase = registerBaseModel({ root, name: 'Synthetic Verity', rig: 'verity', modelFile: verityModelPath })
  const verityCharacter = createCharacter({ root, charId: 'verity-test', name: 'Verity test', baseModelId: verityBase.modelId })

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

  const minecraft = await assignToCharacter({ actionUuids: [actionUuid], charId: mcCharacter.charId, libraryRoot: root })
  assert.equal(minecraft[0]?.status, 'ok', minecraft[0]?.reason)
  const minecraftDraft = listCharacterActions({ root, charId: mcCharacter.charId })[0]!
  const mcPack = join(root, 'packs', minecraftDraft.packId)
  assert.equal(parseBobjActions(readFileSync(join(mcPack, 'anim.bobj'), 'utf8')).size, 1)
  assert.equal(readFileSync(join(mcPack, 'anim.bobj'), 'utf8').match(/^an ([^\r\n]+)/m)?.[1], 'Idle')
  assert.equal(decodeGlb(readFileSync(join(mcPack, 'anim.glb'))).json.animations.length, 1)
  assert.equal(minecraftDraft.nameVi, 'Đứng yên')
  assert.deepEqual(minecraftDraft.tags, ['idle'])
  assert.equal((await assignToCharacter({ actionUuids: [actionUuid], charId: mcCharacter.charId, libraryRoot: root }))[0]?.status, 'already-exists')

  const verity = await assignToCharacter({ actionUuids: [actionUuid], charId: verityCharacter.charId, libraryRoot: root })
  assert.equal(verity[0]?.status, 'ok', verity[0]?.reason)
  const verityDraft = listCharacterActions({ root, charId: verityCharacter.charId })[0]!
  const verityPack = join(root, 'packs', verityDraft.packId), originalBytes = readFileSync(verityModelPath)
  assert.deepEqual(readFileSync(join(verityPack, 'anim.original.bbs.bobj')).subarray(0, originalBytes.length), originalBytes)
  assert.equal(decodeGlb(readFileSync(join(verityPack, 'anim.glb'))).json.animations.length, 1)
  assert.equal(verityDraft.nameVi, 'Đứng yên')
  assert.deepEqual(verityDraft.tags, ['idle'])
  assert.equal(parseBobjActions(readFileSync(join(verityPack, 'anim.original.bbs.bobj'), 'utf8')).size, 2)
  assert.equal((await assignToCharacter({ actionUuids: [actionUuid], charId: verityCharacter.charId, libraryRoot: root }))[0]?.status, 'already-exists')
})
