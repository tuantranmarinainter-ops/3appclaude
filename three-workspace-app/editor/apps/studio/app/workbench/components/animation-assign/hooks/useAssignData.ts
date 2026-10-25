import { useCallback, useEffect, useState } from 'react'
import type { AssignActionItem } from '../utils'

export interface AssignLibraryCharacter { charId: string; name: string; rig: string }

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin' })
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Yêu cầu thất bại (${response.status})`)
  return body
}

/** Library data for the assign panel: character list once, Action lists per owner on demand. */
export function useAssignData() {
  const [characters, setCharacters] = useState<AssignLibraryCharacter[]>([])
  const [ownActions, setOwnActions] = useState<AssignActionItem[]>([])
  const [otherActions, setOtherActions] = useState<AssignActionItem[]>([])
  const [sharedActions, setSharedActions] = useState<AssignActionItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getJson<{ characters: AssignLibraryCharacter[] }>('/api/library?characters=1')
      .then((body) => { if (!cancelled) setCharacters(body.characters) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    getJson<{ actions: AssignActionItem[] }>('/api/library?raw=1')
      .then((body) => { if (!cancelled) setSharedActions(body.actions) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [])

  const loadOwn = useCallback(async (charId: string | null) => {
    if (!charId) { setOwnActions([]); return }
    try { setOwnActions((await getJson<{ actions: AssignActionItem[] }>(`/api/library?charId=${encodeURIComponent(charId)}`)).actions) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [])

  const loadOther = useCallback(async (charId: string | null) => {
    if (!charId) { setOtherActions([]); return }
    try { setOtherActions((await getJson<{ actions: AssignActionItem[] }>(`/api/library?charId=${encodeURIComponent(charId)}`)).actions) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [])

  return { characters, ownActions, otherActions, sharedActions, loadOwn, loadOther, error, setError }
}
