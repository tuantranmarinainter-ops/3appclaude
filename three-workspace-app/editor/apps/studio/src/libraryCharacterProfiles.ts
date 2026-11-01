import { readFile } from 'node:fs/promises'
import { characterHeightBlocks, type CharacterMetadata } from '../../../packages/library/index'
import { resolveLibraryPath, safeChild, safeId } from '../../../packages/library/store'

/** Read only profile JSON; height checks must never scan packs or convert/hash model bytes. */
export async function readLibraryCharacterHeight(charId: string) {
  const file = safeChild(resolveLibraryPath(), 'characters', safeId(charId, 'character id'), 'meta.json')
  const character = JSON.parse(await readFile(file, 'utf8')) as CharacterMetadata
  if (character.kind !== 'character' || character.charId !== charId) throw new Error('Invalid character metadata')
  return { charId, heightBlocks: characterHeightBlocks(character) }
}
