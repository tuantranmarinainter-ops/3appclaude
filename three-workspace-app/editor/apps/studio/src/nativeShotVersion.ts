import { readFile } from 'node:fs/promises'
import { resolveCharacter } from '../../../packages/library/index'
import { nativeActionBobj } from '../../../packages/retarget/src/nativeActionBobj'
import { sha256 } from './shotPackage'

export async function nativeShotBobj(charId: string, bytes: Buffer, uuid: string) {
  const character=resolveCharacter(charId), original=await readFile(character.modelPath)
  if(character.baseModel?.format!=='bobj'||sha256(original)!==character.baseModel.sha256)throw new Error('Native base checksum mismatch')
  return nativeActionBobj(original,bytes,uuid)
}
