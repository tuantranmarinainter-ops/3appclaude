import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { FEATURES, searchFeatures } from '../../../../../src/workspaceNavigation'
import { isEditing, restoreExpansion, visibleFeatures } from '../utils'

const groups = FEATURES.filter((node) => !node.panelId).map((node) => node.id)

export function useFeatureTree(projectId: string) {
  const key = `bbs-feature-tree-v1:${projectId}`
  const [expanded, setExpanded] = useState(() => {
    try { return restoreExpansion(localStorage.getItem(key), groups) } catch { return restoreExpansion(null, groups) }
  })
  const [search, setSearch] = useState('')
  const [searchCollapsed, setSearchCollapsed] = useState<Set<string>>(() => new Set())
  const [focusedId, setFocusedId] = useState('1.4')
  const beforeSearch = useRef('1.4')
  const searchRef = useRef<HTMLInputElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const results = useMemo(() => searchFeatures(FEATURES, search), [search])
  const searching = !!search.trim()
  const shownExpansion = searching ? new Set(groups.filter((id) => !searchCollapsed.has(id))) : expanded
  const visible = visibleFeatures(results.nodes, shownExpansion)
  const focusId = visible.some((node) => node.id === focusedId) ? focusedId : visible.find((node) => node.id === FEATURES.find((item) => item.id === focusedId)?.parentId)?.id ?? visible[0]?.id

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify([...expanded])) } catch { /* Private/storage-disabled browsers keep in-memory preferences. */ }
  }, [expanded, key])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!event.isComposing && !isEditing(event.target) && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  function changeSearch(value: string) {
    if (!searching && value.trim()) beforeSearch.current = focusedId
    if (!value.trim()) setFocusedId(beforeSearch.current)
    setSearch(value)
    setSearchCollapsed(new Set())
  }
  function focus(id: string) {
    setFocusedId(id)
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-feature-id="${id}"]`)?.focus())
  }
  function setOpen(ids: string[], open: boolean) {
    if (searching) setSearchCollapsed((old) => { const next = new Set(old); ids.forEach((id) => open ? next.delete(id) : next.add(id)); return next })
    else setExpanded((old) => { const next = new Set(old); ids.forEach((id) => open ? next.add(id) : next.delete(id)); return next })
  }
  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    changeSearch('')
    focus(searching ? beforeSearch.current : focusId)
  }
  function onTreeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-feature-id]')
    const index = visible.findIndex((node) => node.id === target?.dataset.featureId)
    if (index < 0) return
    const node = visible[index]
    const child = results.nodes.find((item) => item.parentId === node.id)
    let next: string | undefined
    if (event.key === 'ArrowDown') next = visible[Math.min(index + 1, visible.length - 1)].id
    else if (event.key === 'ArrowUp') next = visible[Math.max(index - 1, 0)].id
    else if (event.key === 'Home') next = visible[0]?.id
    else if (event.key === 'End') next = visible[visible.length - 1]?.id
    else if (event.key === 'ArrowRight' && child) {
      if (shownExpansion.has(node.id)) next = child.id
      else setOpen([node.id], true)
    } else if (event.key === 'ArrowLeft') {
      if (child && shownExpansion.has(node.id)) setOpen([node.id], false)
      else next = node.parentId ?? undefined
    } else if (event.key === 'Escape') { escape(event); return }
    else return
    event.preventDefault()
    if (next) focus(next)
  }
  return { search, changeSearch, searchRef, treeRef, results, visible, focusId, setFocusedId, shownExpansion, setOpen, escape, onTreeKeyDown }
}
