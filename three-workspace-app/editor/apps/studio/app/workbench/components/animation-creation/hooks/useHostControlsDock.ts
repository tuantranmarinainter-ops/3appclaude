import { useCallback, useEffect, useRef, useState } from 'react'

// The editor creates its sidebar asynchronously after the iframe load event.
// Keep the host controls in React so their state and event handlers survive docking.
export function useHostControlsDock() {
  const [controlsDock, setControlsDock] = useState<HTMLElement | null>(null)
  // Modal layer appended to the editor's <body>, outside every column/stacking context, so dialogs sit above
  // the editor's floating panels (#floatingAnimationList z-index 90 etc.).
  const [dialogLayer, setDialogLayer] = useState<HTMLElement | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])
  const attachControlsDock = useCallback((doc: Document) => {
    cleanup.current?.()
    setControlsDock(null)
    setDialogLayer(null)
    const layer = doc.createElement('div')
    layer.id = 'bbsHostDialogs'
    layer.setAttribute('data-bbs-host-dialogs', 'true')
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
#bbsHostDialogs { position:fixed; inset:0; z-index:2147483000; display:flex; align-items:center; justify-content:center; padding:16px; box-sizing:border-box; background:rgba(8,9,12,.66); color:#f3f4f6; font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif; }
#bbsHostDialogs:empty { display:none; }
#bbsHostDialogs .wb-merge-dialog { display:grid; gap:8px; box-sizing:border-box; width:min(520px,100%); max-height:min(80vh,100%); overflow:auto; margin:0; padding:16px; border:1px solid #8f77e8; border-radius:10px; background:#181a1f; color:#f3f4f6; box-shadow:0 18px 60px rgba(0,0,0,.65); }
#bbsHostDialogs .wb-merge-dialog h3 { margin:0; font-size:15px; }
#bbsHostDialogs .wb-merge-dialog label { display:grid; gap:4px; font-size:12px; color:#b7bdc7; }
#bbsHostDialogs .wb-merge-dialog fieldset { display:grid; gap:8px; margin:0; padding:8px; border:1px solid #383c45; border-radius:6px; min-width:0; }
#bbsHostDialogs .wb-merge-dialog input, #bbsHostDialogs .wb-merge-dialog textarea { box-sizing:border-box; width:100%; min-width:0; padding:6px 8px; border:1px solid #444958; border-radius:6px; background:#202228; color:#f3f4f6; font:inherit; }
#bbsHostDialogs .wb-merge-dialog :disabled { opacity:.6; }
#bbsHostDialogs .wb-animation-creation-status { margin:0; font-size:12px; color:#b7bdc7; overflow-wrap:anywhere; }
#bbsHostDialogs .wb-merge-dialog-actions { display:flex; justify-content:flex-end; gap:8px; }
#bbsHostDialogs .wb-merge-dialog-actions button { min-height:34px; padding:6px 12px; border:1px solid #444958; border-radius:6px; background:#202228; color:#f3f4f6; font:inherit; cursor:pointer; }
#bbsHostDialogs .wb-merge-dialog-actions button:disabled { opacity:.5; cursor:default; }
#bbsHostDialogs .wb-merge-dialog-actions .wb-host-primary { border-color:#8f77e8; background:#b5a0ff; color:#14121b; font-weight:600; }
`
    doc.head.append(style)
    // Animation Studio 1.34 "layout-modes" hides #minimalSidebar and shows panels in #layoutLeft;
    // dock into whichever column is visible and re-dock if the editor rebuilds its layout.
    const target = () => doc.body.classList.contains('layout-modes')
      ? doc.getElementById('layoutLeft') ?? doc.getElementById('minimalSidebar')
      : doc.getElementById('minimalSidebar') ?? doc.getElementById('layoutLeft')
    const attach = () => {
      const column = target()
      if (!column) return
      if (dock.parentElement !== column) column.prepend(dock)
      setControlsDock(dock)
    }
    const observer = new MutationObserver(attach)
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    attach()
    doc.body.append(layer)
    setDialogLayer(layer)
    cleanup.current = () => { observer.disconnect(); dock.remove(); layer.remove(); style.remove() }
  }, [])
  return { controlsDock, dialogLayer, attachControlsDock }
}
