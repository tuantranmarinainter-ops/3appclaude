/**
 * Every library character owns its base model (mesh + skeleton + textures), never shared with another character, even when the files are byte-identical.
 *   old schema (no `baseModelId`):
 *     minecraft20 + skin.png          -> generated skinned block-character .bobj (armature + `Body` mesh), skin.png copied as its `Body` texture
 *     original/model.bbs.bobj present -> the native .bobj itself (rig `verity`), textures from original/textures
 *   base shared with another character, or without owner -> copied (same bytes) into a new own base; the character's resolved textures
 *     (skin override > original/textures > old base textures) become the base's textures, `baseModelId` is re-pointed and the skin override cleared.
 * charId, actions, drafts and `original/` are never touched; old unused bases stay on disk (listed by `unusedBaseModels`). Idempotent.
 *
 *   node --import tsx ../retarget/cli/migrateLibraryBaseModels.ts [--library <dir>] [--dry-run]     (from packages/builder)
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { listLibraryCharacters, registerBaseModel, resolveCharacter, resolveLibraryPath, setCharacterBaseModel, setCharacterSkin } from '../../library/index.ts'
import { SKIN_BOBJ_OBJECT, skinnedMinecraft20Bobj } from './minecraftBlockCharacters.ts'

const MINECRAFT20_ARMATURE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj')

export interface BaseModelMigration { charId: string; name: string; status: 'migrated' | 'would-migrate' | 'already' | 'unsupported'; kind?: 'minecraft20-skin' | 'original-bobj' | 'split-shared'; modelId?: string; previousModelId?: string; reason?: string }

function putTexture(dir: string, object: string, from: string): void {
  const to = join(dir, ...object.split('/'), 'default.png')
  mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to)
}

export async function migrateLibraryBaseModels(options: { root?: string; dryRun?: boolean } = {}): Promise<BaseModelMigration[]> {
  const root = resolveLibraryPath({ root: options.root }), results: BaseModelMigration[] = []
  for (const character of listLibraryCharacters({ root })) {
    const { charId, name } = character, directory = join(root, 'characters', charId)
    const original = join(directory, 'original', 'model.bbs.bobj'), skin = join(directory, 'skin.png'), ownTextures = join(directory, 'original', 'textures')
    let current
    if (character.baseModelId) {
      try { current = resolveCharacter({ root, charId }) } catch (error) { results.push({ charId, name, status: 'unsupported', reason: error instanceof Error ? error.message : String(error) }); continue }
      if (current.baseModel?.ownerCharId === charId) { results.push({ charId, name, status: 'already', modelId: character.baseModelId }); continue }
    }
    const kind = current ? 'split-shared' as const : existsSync(original) ? 'original-bobj' as const : character.rig === 'minecraft20' && existsSync(skin) ? 'minecraft20-skin' as const : undefined
    if (!kind) { results.push({ charId, name, status: 'unsupported', reason: 'no original/model.bbs.bobj and no minecraft20 skin.png' }); continue }
    if (options.dryRun) { results.push({ charId, name, status: 'would-migrate', kind, ...(current ? { previousModelId: character.baseModelId } : {}) }); continue }
    const staging = mkdtempSync(join(tmpdir(), 'w01-basemodel-'))
    try {
      const textures = join(staging, 'textures'); mkdirSync(textures)
      let modelFile: string, rig: string
      if (current) {
        // Same bytes as the shared base; textures = what the character currently renders (override first), then its own original/skin.png when the override is missing.
        modelFile = current.modelPath; rig = current.baseModel!.rig
        const bases = current.baseModel!.objects
        for (const object of bases) {
          const own = !character.skin && existsSync(original) ? join(ownTextures, ...object.split('/'), 'default.png') : !character.skin && object === SKIN_BOBJ_OBJECT && rig === 'minecraft20' ? skin : undefined
          const from = own && existsSync(own) ? own : current.textures[object]
          if (from) putTexture(textures, object, from)
        }
      } else if (kind === 'original-bobj') {
        modelFile = original; rig = 'verity'
        if (existsSync(ownTextures)) for (const object of readdirSync(ownTextures)) { const from = join(ownTextures, object, 'default.png'); if (existsSync(from)) putTexture(textures, object, from) }
      } else {
        // A native .bobj with a mesh keeps BBS FS export and the native Action sidecars (anim.bobj) working; skin.png is its `Body` texture.
        putTexture(textures, SKIN_BOBJ_OBJECT, skin)
        modelFile = join(staging, 'model.bobj'); rig = 'minecraft20'
        writeFileSync(modelFile, skinnedMinecraft20Bobj(readFileSync(MINECRAFT20_ARMATURE_PATH, 'utf8')))
      }
      const registered = registerBaseModel({ root, name, rig, modelFile, texturesDir: textures, license: character.license, ownerCharId: charId })
      if (current && registered.metadata.sha256 !== current.baseModel!.sha256) throw new Error('Copied base model SHA differs from the source')
      setCharacterBaseModel({ root, charId, baseModelId: registered.modelId })
      if (character.skin) setCharacterSkin({ root, charId }) // the override is now part of the character's own base textures
      results.push({ charId, name, status: 'migrated', kind, modelId: registered.modelId, ...(current ? { previousModelId: character.baseModelId } : {}) })
    } catch (error) { results.push({ charId, name, status: 'unsupported', kind, reason: error instanceof Error ? error.message : String(error) }) }
    finally { rmSync(staging, { recursive: true, force: true }) }
  }
  return results
}

/** Base models no character points at any more (e.g. the old shared ones). Never deleted automatically. */
export function unusedBaseModels(root?: string): string[] {
  const library = resolveLibraryPath({ root }), used = new Set(listLibraryCharacters({ root: library }).map((character) => character.baseModelId))
  const models = join(library, 'models')
  return existsSync(models) ? readdirSync(models).filter((id) => !id.startsWith('.') && !used.has(id)) : []
}

if (process.argv[1]?.endsWith('migrateLibraryBaseModels.ts')) {
  const { values } = parseArgs({ options: { library: { type: 'string' }, 'dry-run': { type: 'boolean' } } })
  void migrateLibraryBaseModels({ root: values.library, dryRun: values['dry-run'] }).then((results) => { for (const item of results) console.log(JSON.stringify(item)); console.log(JSON.stringify({ unusedBaseModels: unusedBaseModels(values.library) })) })
}
