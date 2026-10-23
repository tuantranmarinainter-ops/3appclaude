import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { assignToCharacter } from '../cli/assignToCharacter.ts'
import { createCharacter, registerBaseModel } from '../../library/characters.ts'
import { listCharacterActions } from '../../library/characterActions.ts'
import { importPack } from '../../library/library.ts'

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
