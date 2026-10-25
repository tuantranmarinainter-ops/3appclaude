import { useCallback, useEffect, useRef, useState } from 'react'

// The editor creates its sidebar asynchronously after the iframe load event.
// Keep the host controls in React so their state and event handlers survive docking.
export function useHostControlsDock() {
  const [controlsDock, setControlsDock] = useState<HTMLElement | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])
  const attachControlsDock = useCallback((doc: Document) => {
    cleanup.current?.()
    setControlsDock(null)
    const dock = doc.createElement('section')
    dock.id = 'bbsHostControls'
    dock.setAttribute('aria-label', 'Dự án & trao đổi với cảnh')
    const style = doc.createElement('style')
    style.textContent = `
#minimalSidebar:has(#bbsHostControls) { overflow:auto; }
#minimalSidebar:has(#bbsHostControls)>.panel:not([hidden]) { flex:1 0 220px; }
#bbsHostControls { flex:none; min-width:0; color:#f3f4f6; background:#181a1f; border-bottom:1px solid #383c45; }
#bbsHostControls details { margin:0; padding:10px; }
#bbsHostControls summary { cursor:pointer; font-weight:600; padding:4px 0 8px; }
#bbsHostControls .wb-animation-creation-toolbar { display:grid; height:auto; min-height:0; flex:none; gap:8px; padding:8px 0; border:0; background:transparent; }
#bbsHostControls label { display:grid; gap:4px; min-width:0; font-size:12px; color:#b7bdc7; }
#bbsHostControls label:has(input[type=checkbox]) { display:flex; align-items:center; }
#bbsHostControls select, #bbsHostControls input, #bbsHostControls button { box-sizing:border-box; width:100%; min-width:0; min-height:32px; padding:6px 8px; border:1px solid #444958; border-radius:6px; background:#202228; color:#f3f4f6; font:inherit; }
#bbsHostControls input[type=checkbox] { width:auto; min-height:0; }
#bbsHostControls button { white-space:normal; cursor:pointer; }
#bbsHostControls :disabled { opacity:.5; cursor:default; }
#bbsHostControls .wb-host-primary { background:#b5a0ff; color:#14121b; border-color:#8f77e8; font-weight:600; }
#bbsHostControls .cross-app-button { border:2px solid #ff8c1a; box-shadow:0 0 8px rgba(255,140,26,.45); }
#bbsHostControls .wb-animation-creation-status, #bbsHostControls .wb-animation-creation-error { margin:0; padding:5px 0; font-size:12px; overflow-wrap:anywhere; }
#bbsHostControls .wb-animation-creation-error { color:#ff9d9d; }
`
    doc.head.append(style)
    const attach = () => {
      const sidebar = doc.getElementById('minimalSidebar')
      if (!sidebar) return
      sidebar.prepend(dock)
      setControlsDock(dock)
      observer.disconnect()
    }
    const observer = new MutationObserver(attach)
    observer.observe(doc.body, { childList: true, subtree: true })
    attach()
    cleanup.current = () => { observer.disconnect(); dock.remove(); style.remove() }
  }, [])
  return { controlsDock, attachControlsDock }
}
