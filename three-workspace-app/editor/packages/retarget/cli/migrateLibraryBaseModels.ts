/**
 * Give old-schema library characters (no `baseModelId`) a base model so App 2 can place them ("Thêm vào cảnh App 2", `library.place`).
 *   minecraft20 + skin.png          -> generated skinned block-character .bobj (armature + `Body` mesh, skin.png as its texture; a bare armature .bobj has no mesh)
 *   original/model.bbs.bobj present -> the native .bobj itself, textures from original/textures (rig `verity`)
 * charId, actions, drafts and the character's own files are never touched; only `meta.json` gains `baseModelId`. Idempotent.
 *
 *   node --import tsx ../retarget/cli/migrateLibraryBaseModels.ts [--library <dir>] [--dry-run]     (from packages/builder)
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { listLibraryCharacters, registerBaseModel, resolveLibraryPath, setCharacterBaseModel, setCharacterSkin } from '../../library/index.ts'
import { SKIN_BOBJ_OBJECT, skinnedMinecraft20Bobj } from './minecraftBlockCharacters.ts'

const MINECRAFT20_ARMATURE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj')

export interface BaseModelMigration { charId: string; name: string; status: 'migrated' | 'would-migrate' | 'already' | 'unsupported'; kind?: 'minecraft20-skin' | 'original-bobj'; modelId?: string; reason?: string }

export async function migrateLibraryBaseModels(options: { root?: string; dryRun?: boolean } = {}): Promise<BaseModelMigration[]> {
  const root = resolveLibraryPath({ root: options.root }), results: BaseModelMigration[] = []
  for (const character of listLibraryCharacters({ root })) {
    const { charId, name } = character, directory = join(root, 'characters', charId)
    const original = join(directory, 'original', 'model.bbs.bobj'), skin = join(directory, 'skin.png')
    // Characters sharing one original .bobj (Gỗ Xưa, Tiểu Nhị) differ by textures: each wears its own original/textures as a skin.
    const ownTextures = join(directory, 'original', 'textures'), needsOwnTextures = existsSync(original) && existsSync(ownTextures) && !character.skin
    if (character.baseModelId) {
      if (needsOwnTextures && !options.dryRun) setCharacterSkin({ root, charId, skinDir: ownTextures })
      results.push({ charId, name, status: 'already', modelId: character.baseModelId }); continue
    }
    const kind = existsSync(original) ? 'original-bobj' as const : character.rig === 'minecraft20' && existsSync(skin) ? 'minecraft20-skin' as const : undefined
    if (!kind) { results.push({ charId, name, status: 'unsupported', reason: 'no original/model.bbs.bobj and no minecraft20 skin.png' }); continue }
    if (options.dryRun) { results.push({ charId, name, status: 'would-migrate', kind }); continue }
    const staging = mkdtempSync(join(tmpdir(), 'w01-basemodel-'))
    try {
      let registered
      if (kind === 'original-bobj') registered = registerBaseModel({ root, name, rig: 'verity', modelFile: original, texturesDir: join(directory, 'original', 'textures'), license: character.license })
      else {
        // A native .bobj with a mesh keeps BBS FS export and the native Action sidecars (anim.bobj) working; the skin is the character's `Body` texture override (skin/textures).
        mkdirSync(join(staging, 'skin', SKIN_BOBJ_OBJECT), { recursive: true }); mkdirSync(join(staging, 'textures'))
        copyFileSync(skin, join(staging, 'skin', SKIN_BOBJ_OBJECT, 'default.png'))
        const file = join(staging, 'model.bobj')
        writeFileSync(file, skinnedMinecraft20Bobj(readFileSync(MINECRAFT20_ARMATURE_PATH, 'utf8')))
        registered = registerBaseModel({ root, name, rig: 'minecraft20', modelFile: file, texturesDir: join(staging, 'textures'), license: character.license })
      }
      setCharacterBaseModel({ root, charId, baseModelId: registered.modelId })
      // The base model is shared (content-addressed); each Minecraft character wears its own skin.png as a character override.
      if (kind === 'minecraft20-skin') setCharacterSkin({ root, charId, skinDir: join(staging, 'skin') })
      else if (needsOwnTextures) setCharacterSkin({ root, charId, skinDir: ownTextures })
      results.push({ charId, name, status: 'migrated', kind, modelId: registered.modelId })
    } catch (error) { results.push({ charId, name, status: 'unsupported', kind, reason: error instanceof Error ? error.message : String(error) }) }
    finally { rmSync(staging, { recursive: true, force: true }) }
  }
  return results
}

if (process.argv[1]?.endsWith('migrateLibraryBaseModels.ts')) {
  const { values } = parseArgs({ options: { library: { type: 'string' }, 'dry-run': { type: 'boolean' } } })
  void migrateLibraryBaseModels({ root: values.library, dryRun: values['dry-run'] }).then((results) => { for (const item of results) console.log(JSON.stringify(item)) })
}
