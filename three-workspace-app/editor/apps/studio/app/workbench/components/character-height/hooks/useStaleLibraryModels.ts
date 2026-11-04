import { useEffect, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'

type LibraryNode = UnifiedProject['scene']['content']['nodes'][number]

/** B72: library characters whose base model/skin changed after they were added; the scene skips them until relinked. */
export function useStaleLibraryModels(project: UnifiedProject) {
  const nodes = project.scene.content.nodes.filter(node => node.type === 'character' && typeof node.metadata?.libraryCharacterId === 'string' && typeof node.metadata?.libraryModelFingerprint === 'string')
  const links = [...new Set(nodes.map(node => `${node.metadata!.libraryCharacterId}|${node.metadata!.libraryModelFingerprint}`))].sort()
  const linksKey = links.join(',')
  const [current, setCurrent] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState({ projectId: project.projectId, busy: false, message: '' })

  useEffect(() => {
    let alive = true
    void Promise.all(linksKey ? linksKey.split(',').map(async (link) => {
      const [charId, fingerprint] = link.split('|')
      try {
        const response = await fetch(`/api/library?modelCheck=${encodeURIComponent(charId!)}&fingerprint=${encodeURIComponent(fingerprint!)}`, { cache: 'no-store' })
        return [link, response.ok ? (await response.json()).current !== false : true] as const
      } catch { return [link, true] as const }
    }) : []).then(entries => { if (alive) setCurrent(Object.fromEntries(entries)) })
    return () => { alive = false }
  }, [linksKey, project.revision])

  const stale: LibraryNode[] = nodes.filter(node => current[`${node.metadata!.libraryCharacterId}|${node.metadata!.libraryModelFingerprint}`] === false)
  const relink = async () => {
    setStatus({ projectId: project.projectId, busy: true, message: '' })
    try {
      let revision = project.revision
      const byCharacter = new Map<string, string[]>()
      for (const node of stale) byCharacter.set(String(node.metadata!.libraryCharacterId), [...byCharacter.get(String(node.metadata!.libraryCharacterId)) ?? [], node.id])
      for (const [charId, nodeIds] of byCharacter) {
        const response = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'link-nodes', projectId: project.projectId, expectedRevision: revision, charId, nodeIds }) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        revision = result.revision
      }
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId: project.projectId } }))
      setStatus({ projectId: project.projectId, busy: false, message: 'Đã cập nhật nhân vật theo thư viện.' })
    } catch (error) {
      setStatus({ projectId: project.projectId, busy: false, message: error instanceof Error ? error.message : String(error) })
    }
  }
  const mine = status.projectId === project.projectId
  return { stale, relink, busy: mine && status.busy, message: mine ? status.message : '' }
}
