'use client'

/**
 * Bộ ghi Debug (nút "Debug" ở cột trái App 2): khi bật, ghi phím bấm, cú bấm chuột, các lệnh gửi lên
 * server (lệnh, revision, kết quả, thời gian), lỗi của trang và ghi chú của người dùng. Bản ghi giữ trong
 * bộ nhớ và gửi dần lên server (`/api/unified/debug-log`) thành file JSONL để đọc lại khi gỡ lỗi.
 */
export type DebugEntryKind = 'start' | 'stop' | 'key' | 'click' | 'api' | 'error' | 'note' | 'event'
export interface DebugEntry { at: string; kind: DebugEntryKind; text: string; data?: Record<string, unknown> }

const ENABLED_KEY = 'bbs-debug-recording'
const MAX_ENTRIES = 5000
const FLUSH_MS = 2000
const ENDPOINT = '/api/unified/debug-log'

let active = false
let sessionId = ''
let logPath = ''
let entries: DebugEntry[] = []
let pending: DebugEntry[] = []
let flushTimer = 0
let originalFetch: typeof fetch | null = null
let originalConsoleError: typeof console.error | null = null
const listeners = new Set<() => void>()
const detachers: Array<() => void> = []

type DebugSnapshot = { active: boolean; entries: readonly DebugEntry[]; logPath: string; sessionId: string }
let snapshot: DebugSnapshot = { active, entries, logPath, sessionId }
/** Rebuilds the cached snapshot (React's useSyncExternalStore needs a stable object between changes). */
const notify = () => {
  snapshot = { active, entries, logPath, sessionId }
  for (const listener of listeners) listener()
}
export function subscribeDebug(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function debugState(): DebugSnapshot { return snapshot }

export function record(kind: DebugEntryKind, text: string, data?: Record<string, unknown>): void {
  if (!active && kind !== 'stop') return
  const entry: DebugEntry = { at: new Date().toISOString(), kind, text, ...(data ? { data } : {}) }
  entries = entries.length >= MAX_ENTRIES ? [...entries.slice(-MAX_ENTRIES + 1), entry] : [...entries, entry]
  pending.push(entry)
  notify()
}

/** Short, human-readable name of what the user touched (button label, field, panel). */
export function describeTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) return 'trang'
  if (target.closest('.t3d-viewport') && !target.closest('button,input,select,textarea,[role="button"]')) return 'Khung 3D'
  const labelled = target.closest('[aria-label],button,a,[role="button"],[role="menuitem"],[role="tab"],label,input,select,textarea,summary,canvas')
  // The whole workbench shell is a labelled dialog; never report it as the thing that was touched.
  const element = labelled && !labelled.classList.contains('wb-unified-shell') ? labelled : target
  const tag = element.tagName.toLowerCase()
  if (tag === 'canvas') return element.classList.contains('t3d-viewport-canvas') ? 'Khung 3D' : 'canvas'
  const text = (element.getAttribute('aria-label') || element.getAttribute('title') || (element as HTMLElement).innerText || element.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim()
  const area = target.closest('.t3d-timeline') ? 'Timeline' : target.closest('.t3d-side') ? 'Bảng phải' : target.closest('.t3d-leftrail-slot') ? 'Cột trái' : target.closest('.wb-drawer') ? 'Bảng nổi' : target.closest('.wb-host-bar,header') ? 'Thanh trên' : ''
  return [area, text ? `${tag} “${text.slice(0, 60)}”` : `${tag}${element.className && typeof element.className === 'string' ? `.${element.className.split(/\s+/)[0]}` : ''}`].filter(Boolean).join(' › ')
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))
}

export function keyLabel(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  const parts = [event.ctrlKey && 'Ctrl', event.metaKey && 'Meta', event.altKey && 'Alt', event.shiftKey && event.key.length > 1 && 'Shift'].filter(Boolean)
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key
  return [...parts, key].join('+')
}

/** Extracts the command/operation name and revision from a request body so saves can be followed in the log. */
export function describeRequestBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'string' || !body.startsWith('{')) return {}
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const out: Record<string, unknown> = {}
    if (typeof parsed.command === 'string') out.command = parsed.command
    if (typeof parsed.operation === 'string') out.operation = parsed.operation
    if (typeof parsed.expectedRevision === 'number') out.expectedRevision = parsed.expectedRevision
    const operations = (parsed.args as { operations?: Array<{ type?: string }> } | undefined)?.operations
    if (Array.isArray(operations)) out.operations = operations.map((item) => item?.type).filter(Boolean)
    return out
  } catch { return {} }
}

/** Only app API calls are logged; model/texture downloads and the log endpoint itself are skipped. */
const skipUrl = (path: string) => !path.startsWith('/api/') || path.startsWith(ENDPOINT) || path.includes('/assets/')

function wrapFetch(): void {
  if (originalFetch) return
  originalFetch = window.fetch
  const base = originalFetch
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = url.replace(window.location.origin, '')
    if (!active || skipUrl(path)) return base(input, init)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const info = describeRequestBody(init?.body)
    const started = performance.now()
    try {
      const response = await base(input, init)
      const ms = Math.round(performance.now() - started)
      const data: Record<string, unknown> = { method, path: path.slice(0, 160), status: response.status, ms, ...info }
      if (method !== 'GET' && path.startsWith('/api/')) {
        try {
          const body = await response.clone().json() as { revision?: unknown; error?: unknown }
          if (typeof body.revision === 'number') data.revision = body.revision
          if (!response.ok || body.error) data.error = typeof body.error === 'string' ? body.error : (body.error as { message?: string } | undefined)?.message ?? JSON.stringify(body.error).slice(0, 300)
        } catch { /* Non-JSON response: status is enough. */ }
      }
      const name = [info.command, info.operation].filter(Boolean).join(' ') || ''
      record(response.ok ? 'api' : 'error', `${method} ${path.split('?')[0]}${name ? ` · ${name}` : ''} → ${response.status}${typeof data.revision === 'number' ? ` · rev ${data.revision}` : ''}${data.error ? ` · ${String(data.error).slice(0, 160)}` : ''} (${ms} ms)`, data)
      return response
    } catch (error) {
      record('error', `${method} ${path.split('?')[0]} thất bại: ${error instanceof Error ? error.message : String(error)}`, { method, path, ...info })
      throw error
    }
  }
}

function attach(): void {
  wrapFetch()
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
    const typing = isEditable(event.target) && !['Enter', 'Escape', 'Tab'].includes(event.key) && !event.ctrlKey && !event.metaKey
    record('key', `${typing ? '(gõ chữ)' : keyLabel(event)} · ${describeTarget(event.target)}`, { key: typing ? undefined : event.key, code: typing ? undefined : event.code })
  }
  const onPointer = (event: PointerEvent) => {
    const button = event.button === 2 ? 'Chuột phải' : event.button === 1 ? 'Chuột giữa' : 'Bấm'
    record('click', `${button}${event.ctrlKey ? ' + Ctrl' : ''}${event.shiftKey ? ' + Shift' : ''} · ${describeTarget(event.target)}`, { x: Math.round(event.clientX), y: Math.round(event.clientY) })
  }
  // Browsers report this harmless layout notice as an error; it only adds noise to the log.
  const onError = (event: ErrorEvent) => /ResizeObserver loop/.test(event.message) ? undefined : record('error', `Lỗi trang: ${event.message}`, { stack: event.error instanceof Error ? event.error.stack?.slice(0, 600) : undefined, source: event.filename })
  const onRejection = (event: PromiseRejectionEvent) => record('error', `Lỗi chưa xử lý: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`, { stack: event.reason instanceof Error ? event.reason.stack?.slice(0, 600) : undefined })
  const onSaved = (event: Event) => record('event', `Đã lưu project · rev ${(event as CustomEvent<{ revision?: number }>).detail?.revision ?? '?'}`)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('pointerdown', onPointer, true)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('bbs-unified-project-saved', onSaved)
  detachers.push(() => {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('pointerdown', onPointer, true)
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    window.removeEventListener('bbs-unified-project-saved', onSaved)
  })
  if (!originalConsoleError) {
    originalConsoleError = console.error
    const base = originalConsoleError
    console.error = (...args: unknown[]) => {
      record('error', `console.error: ${args.map((item) => item instanceof Error ? item.message : typeof item === 'string' ? item : JSON.stringify(item)).join(' ').slice(0, 400)}`)
      base.apply(console, args)
    }
    detachers.push(() => { if (originalConsoleError) console.error = originalConsoleError; originalConsoleError = null })
  }
}

async function flush(): Promise<void> {
  if (!pending.length || !originalFetch) return
  const batch = pending.splice(0, 500)
  try {
    const response = await originalFetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, entries: batch }) })
    const body = await response.json() as { path?: string }
    if (response.ok && body.path && body.path !== logPath) { logPath = body.path; notify() }
    if (!response.ok) pending.unshift(...batch)
  } catch { pending.unshift(...batch) }
}

export function startDebug(): void {
  if (active || typeof window === 'undefined') return
  active = true
  sessionId = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`
  logPath = ''
  try { localStorage.setItem(ENABLED_KEY, '1') } catch { /* Recording still works for this page. */ }
  document.body.classList.add('bbs-debug-recording')
  attach()
  record('start', `Bắt đầu ghi · ${window.location.pathname}${window.location.search} · cửa sổ ${window.innerWidth}×${window.innerHeight}`, { userAgent: navigator.userAgent })
  flushTimer = window.setInterval(() => { void flush() }, FLUSH_MS)
}

export function stopDebug(): void {
  if (!active) return
  record('stop', 'Dừng ghi')
  active = false
  try { localStorage.removeItem(ENABLED_KEY) } catch { /* ignore */ }
  document.body.classList.remove('bbs-debug-recording')
  window.clearInterval(flushTimer)
  void flush()
  while (detachers.length) detachers.pop()!()
  if (originalFetch) { window.fetch = originalFetch; originalFetch = null }
  notify()
}

export function addDebugNote(text: string): void { if (text.trim()) record('note', `GHI CHÚ: ${text.trim()}`) }
export function clearDebug(): void { entries = []; notify() }

/** Resume recording after a reload when the user left it on. */
export function resumeDebugIfEnabled(): void {
  try { if (localStorage.getItem(ENABLED_KEY) === '1') startDebug() } catch { /* ignore */ }
}

export function formatDebugLog(list: readonly DebugEntry[]): string {
  const kinds: Record<DebugEntryKind, string> = { start: 'BẮT ĐẦU', stop: 'DỪNG', key: 'PHÍM', click: 'CHUỘT', api: 'SERVER', error: 'LỖI', note: 'GHI CHÚ', event: 'SỰ KIỆN' }
  return list.map((entry) => `${entry.at.slice(11, 23)}  [${kinds[entry.kind]}] ${entry.text}`).join('\n')
}
