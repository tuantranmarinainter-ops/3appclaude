/** Session cache for character profiles; other reads only share concurrent requests. */
export const LIBRARY_CHANGED = 'bbs-library-changed'
const pending = new Map<string, Promise<unknown>>()
let characters: Promise<unknown> | undefined
let listening = false

function listen(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener(LIBRARY_CHANGED, () => { characters = undefined; pending.clear() })
  // A restored library page may have changed profiles while App 2 was suspended.
  window.addEventListener('pageshow', (event) => { if (event.persisted) invalidateLibrary() })
  window.addEventListener('message', (event) => {
    if (event.origin === window.location.origin && event.data?.type === LIBRARY_CHANGED) invalidateLibrary(false)
  })
}

export function invalidateLibrary(notifyOpener = true): void {
  characters = undefined
  pending.clear()
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(LIBRARY_CHANGED))
  if (notifyOpener && window.opener) window.opener.postMessage({ type: LIBRARY_CHANGED }, window.location.origin)
}

export function libraryJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  listen()
  const read = !init?.method || init.method.toUpperCase() === 'GET'
  const profile = read && url === '/api/library?characters=1'
  const existing = profile ? characters : read ? pending.get(url) : undefined
  if (existing) return existing as Promise<T>
  const request = (async () => {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init })
    const body = await response.json()
    if (!response.ok) throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), { code: body.code })
    if (!read) invalidateLibrary()
    return body as T
  })()
  if (profile) characters = request
  if (read) pending.set(url, request)
  void request.then(() => { if (pending.get(url) === request) pending.delete(url) }, () => {
    if (characters === request) characters = undefined
    if (pending.get(url) === request) pending.delete(url)
  })
  return request
}
