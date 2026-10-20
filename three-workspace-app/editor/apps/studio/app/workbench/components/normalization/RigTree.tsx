'use client'

import { useMemo, useState } from 'react'
import type { RetargetRig } from '@bbs/retarget'

type Bone = RetargetRig['bones'][number]

export function buildRigTreeRows(bones: readonly Bone[], expanded: ReadonlySet<string>, query = '') {
  const byId = new Map(bones.map((bone) => [bone.id, bone]))
  const children = new Map<string, Bone[]>()
  for (const bone of bones) if (bone.parentId && byId.has(bone.parentId)) {
    const list = children.get(bone.parentId)
    if (list) list.push(bone)
    else children.set(bone.parentId, [bone])
  }
  const roots = bones.filter((bone) => !bone.parentId || !byId.has(bone.parentId))
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matches = new Set<string>()
  if (normalizedQuery) for (const bone of bones) {
    if (`${bone.name ?? ''} ${bone.id}`.toLocaleLowerCase().includes(normalizedQuery)) {
      let current: Bone | undefined = bone
      while (current && !matches.has(current.id)) {
        matches.add(current.id)
        current = current.parentId ? byId.get(current.parentId) : undefined
      }
    }
  }
  const rows: Array<{ bone: Bone; depth: number; childCount: number }> = []
  const visited = new Set<string>()
  const stack = roots.slice().reverse().map((bone) => ({ bone, depth: 0 }))
  while (stack.length) {
    const { bone, depth } = stack.pop()!
    if (visited.has(bone.id) || (normalizedQuery && !matches.has(bone.id))) continue
    visited.add(bone.id)
    const descendants = children.get(bone.id) ?? []
    const visibleDescendants = normalizedQuery ? descendants.filter((child) => matches.has(child.id)) : descendants
    rows.push({ bone, depth, childCount: visibleDescendants.length })
    if (!normalizedQuery && !expanded.has(bone.id)) continue
    if (normalizedQuery && !visibleDescendants.length) continue
    for (const child of descendants.slice().reverse()) stack.push({ bone: child, depth: depth + 1 })
  }
  return rows
}

export function RigTree({ rig, profileBoneLinks, vi }: { rig: RetargetRig; profileBoneLinks: Array<{ status: 'matched' | 'ambiguous' | 'missing' }>; vi: boolean }) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const rows = useMemo(() => buildRigTreeRows(rig.bones, expanded, query), [rig.bones, expanded, query])
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const matched = profileBoneLinks.filter((link) => link.status === 'matched').length
  const unresolved = profileBoneLinks.length - matched
  return <details className="wb-retarget-settings-group">
    <summary>{vi ? `Cây xương nguồn · ${rig.bones.length} bones` : `Source bone tree · ${rig.bones.length} bones`}</summary>
    <label>{vi ? 'Tìm bone' : 'Search bones'}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <p role="status">{vi ? `Profile links: ${matched} khớp, ${unresolved} thiếu hoặc mơ hồ` : `Profile links: ${matched} matched, ${unresolved} missing or ambiguous`}</p>
    <div role="list" aria-label={vi ? 'Cây xương nguồn' : 'Source bone tree'} style={{ maxHeight: 280, overflow: 'auto' }}>
      {rows.map(({ bone, depth, childCount }) => <div key={bone.id} role="listitem" style={{ display: 'flex', alignItems: 'center', minHeight: 28, paddingInlineStart: depth * 18 }}>
        {childCount > 0 ? <button type="button" disabled={!!query} aria-expanded={query ? true : expanded.has(bone.id)} aria-label={`${expanded.has(bone.id) ? 'Collapse' : 'Expand'} ${bone.name ?? bone.id}`} onClick={() => toggle(bone.id)}>{query || expanded.has(bone.id) ? '−' : '+'}</button> : <span aria-hidden="true" style={{ width: 24 }} />}
        <span>{bone.name || bone.id}</span><small style={{ marginInlineStart: 6, opacity: 0.7 }}>{bone.id !== bone.name ? bone.id : ''}</small>
      </div>)}
      {!rows.length && <p>{vi ? 'Không tìm thấy bone.' : 'No bones match this search.'}</p>}
    </div>
  </details>
}
