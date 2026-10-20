'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'

export function HostDrawer({ open, title, closeLabel = 'Close panel', className = '', onClose, children }: { open: boolean; title: string; closeLabel?: string; className?: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return <dialog ref={ref} className={`wb-drawer ${className}`} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => {
    if (event.target !== event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
  }}>
    <header className="wb-drawer-header"><h2 id={titleId}>{title}</h2><button type="button" className="wb-icon-button" aria-label={closeLabel} onClick={onClose}>×</button></header>
    <div className="wb-drawer-content">{children}</div>
  </dialog>
}
