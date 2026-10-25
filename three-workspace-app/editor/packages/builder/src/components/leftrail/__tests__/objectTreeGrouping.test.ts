import { describe, expect, it } from 'vitest'
import type { DraftNode } from '../../../contract/types'
import type { TranslateFn } from '../../../locale'
import { buildObjectRows } from '../utils'

function node(
  id: string,
  type: DraftNode['type'],
  name: string,
  parentId?: string,
): DraftNode {
  return {
    id,
    type,
    name,
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ...(parentId ? { parentId } : {}),
  } as DraftNode
}

function sampleNodes(): DraftNode[] {
  return [
    node('go1', 'character', 'go 01_1'),
    node('hero1', 'character', 'hero 01_1'),
    node('cam1', 'camera', 'Main Camera'),
    node('ban', 'prop', 'set_ban'),
    node('tuong', 'prop', 'set_tuong'),
    node('setNha', 'group', 'set_nha'),
    node('cot', 'primitive', 'cot', 'setNha'),
    node('den', 'prop', 'den ban', 'go1'),
    node('nhomNhanVat', 'group', 'Nhom nhan vat'),
    node('ga1', 'character', 'ga 01_1', 'nhomNhanVat'),
  ]
}

const t = ((key: string) => key) as unknown as TranslateFn

describe('N5 object tree grouping', () => {
  it('moves root background clusters under one "Hậu cảnh" header at the end', () => {
    const rows = buildObjectRows(sampleNodes(), '', t)
    expect(rows[0]!.type).toBe('scene')
    const headerIndex = rows.findIndex((row) => row.type === 'background')
    expect(headerIndex).toBeGreaterThan(0)
    const header = rows[headerIndex]!
    expect(header.id).toBe('__background__')
    const before = rows.slice(1, headerIndex).map((row) => row.id)
    expect(before).toEqual(['go1', 'den', 'hero1', 'cam1', 'nhomNhanVat', 'ga1'])
    const after = rows.slice(headerIndex + 1)
    expect(after.map((row) => row.id)).toEqual(['ban', 'tuong', 'setNha', 'cot'])
    // Các dòng trong nhóm được thụt thêm một cấp so với gốc.
    expect(after.every((row) => row.depth >= 1)).toBe(true)
  })

  it('keeps a flat list while searching (no group header)', () => {
    const rows = buildObjectRows(sampleNodes(), 'set', t)
    expect(rows.some((row) => row.type === 'background')).toBe(false)
    expect(rows.map((row) => row.id)).toEqual(['ban', 'tuong', 'setNha'])
  })

  it('leaves scenes without background nodes untouched', () => {
    const rows = buildObjectRows(
      [node('go1', 'character', 'go 01_1'), node('cam1', 'camera', 'Main Camera')],
      '',
      t,
    )
    expect(rows.map((row) => row.type)).toEqual(['scene', 'character', 'camera'])
  })
})
