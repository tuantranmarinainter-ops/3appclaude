import type { CharacterMetadata } from './types'

/** User-selected defaults; original native dimensions remain independently calibrated. */
export function characterHeightBlocks(character: Pick<CharacterMetadata, 'rig' | 'heightBlocks' | 'name' | 'charId'>): number | undefined {
  if (character.heightBlocks !== undefined) {
    if (!Number.isFinite(character.heightBlocks) || character.heightBlocks <= 0) throw new TypeError('Chiều cao (block) phải là số dương hữu hạn')
    return character.heightBlocks
  }
  if (character.rig === 'minecraft20') return 1.8
  const identity = `${character.charId} ${character.name}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (['verity', 'mixamo65+verity'].includes(character.rig) || /go[_ -]?xua|tieu[_ -]?nhi|chirity/.test(identity)) return 3.6
  return undefined
}
