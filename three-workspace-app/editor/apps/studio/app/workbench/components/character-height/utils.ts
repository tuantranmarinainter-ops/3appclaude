export type HeightProfile = { charId: string; fingerprint: string }

/** Successful requests and in-flight requests share the same fingerprint entry. */
export function createHeightProfileCache(load: (charId: string) => Promise<number | undefined>) {
  const entries = new Map<string, { charId: string; request: Promise<number | undefined> }>()
  return {
    read(profile: HeightProfile) {
      const key = JSON.stringify([profile.charId, profile.fingerprint])
      const existing = entries.get(key)
      if (existing) return existing.request
      const entry = { charId: profile.charId, request: Promise.resolve().then(() => load(profile.charId)) }
      entries.set(key, entry)
      void entry.request.catch(() => { if (entries.get(key) === entry) entries.delete(key) })
      return entry.request
    },
    invalidate(charId: string) {
      for (const [key, entry] of entries) if (entry.charId === charId) entries.delete(key)
    },
  }
}

export const HEIGHT_PROFILE_EVENT = 'bbs-library-character-profile-changed'
export const HEIGHT_PROFILE_STORAGE = 'bbs.library.character-profile-change.v1'

export const characterHeightCache = createHeightProfileCache(async charId => {
  const response = await fetch(`/api/library?heightCharacter=${encodeURIComponent(charId)}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Library character profile unavailable')
  const data = await response.json()
  return Number.isFinite(data.heightBlocks) ? data.heightBlocks as number : undefined
})

// Keep invalidating cached entries even when App 2 is temporarily unmounted (App 5 navigation).
if (typeof window !== 'undefined') {
  window.addEventListener(HEIGHT_PROFILE_EVENT, event => {
    const charId = (event as CustomEvent<{ charId?: string }>).detail?.charId
    if (typeof charId === 'string') characterHeightCache.invalidate(charId)
  })
  window.addEventListener('storage', event => {
    if (event.key !== HEIGHT_PROFILE_STORAGE || !event.newValue) return
    try {
      const charId = JSON.parse(event.newValue).charId
      if (typeof charId === 'string') characterHeightCache.invalidate(charId)
    } catch { /* Ignore malformed storage. */ }
  })
}

/** Publish only after a successful profile save, including to an App 2 open in another tab. */
export function notifyCharacterProfileChanged(charId: string) {
  window.dispatchEvent(new CustomEvent(HEIGHT_PROFILE_EVENT, { detail: { charId } }))
  try { window.localStorage.setItem(HEIGHT_PROFILE_STORAGE, JSON.stringify({ charId, nonce: `${Date.now()}-${Math.random()}` })) } catch { /* Same-window notification still works when storage is unavailable. */ }
}
