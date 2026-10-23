export type WorkspaceId = 'normalize' | 'scene' | 'animation' | 'vfx' | 'library'

export type WorkspaceUrls = Partial<Record<Exclude<WorkspaceId, 'scene' | 'library'>, string | undefined>>

export const WORKSPACES: ReadonlyArray<{ id: WorkspaceId; number: number; label: string }> = [
  { id: 'normalize', number: 1, label: 'Chuẩn hoá' },
  { id: 'scene', number: 2, label: 'Dựng cảnh' },
  { id: 'animation', number: 3, label: 'Animation' },
  { id: 'vfx', number: 4, label: 'VFX' },
  { id: 'library', number: 5, label: 'Thư viện' },
]

export function withUnified(url: string, unified: string | null): string {
  if (!unified) return url
  const parsed = new URL(url, 'http://workspace.local')
  parsed.searchParams.set('unified', unified)
  return parsed.origin === 'http://workspace.local' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString()
}

export function safeWorkspaceUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch { return null }
}

export function workspaceHref(id: WorkspaceId, urls: WorkspaceUrls, unified: string | null): string | null {
  if (id === 'scene') return withUnified('/', unified)
  if (id === 'library') return withUnified('/library', unified)
  const url = safeWorkspaceUrl(urls[id])
  return url ? withUnified(url, unified) : null
}
