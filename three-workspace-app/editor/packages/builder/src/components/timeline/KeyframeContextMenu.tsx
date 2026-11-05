import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { makeTimelineBoxSelection, type KeyframeRef } from '../../stores/types'
import type { FcurveKeyRef } from '../../evaluate/curves/FCurveSet'
import { canPasteWithoutUserKeys, copyTransform, getTransformClipboard, selectedPasteTargets, type TransformProp } from '../../sync/transformPaste'
import { clampMenuPosition, emitTimelineNotice } from './utils/clipMenu'
import { contextTimelineKeySelection, selectedTimelineRefs } from './utils/fcurveSelection'
import { cameraMotionOwnsKeyframes } from '../../evaluate/camera/cameraMotionExclusive'

type Open = (event: MouseEvent, nodeId: string, frame: number, keys: KeyframeRef[], curves: FcurveKeyRef[], highlighted: boolean) => void
const MenuContext = createContext<Open>(() => {})
export const useKeyframeContextMenu = () => useContext(MenuContext)

export function KeyframeContextMenuProvider({ children }: { children: ReactNode }) {
  const { useStore, session } = useDirector()
  const t = useT()
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string; frame: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const selection = useStore((s) => s.selection)
  const keys = useStore((s) => s.userKeys)
  const curves = useStore((s) => s.fcurves)
  const locked = useStore((s) => s.writeLocked)
  const enabled = useStore((s) => s.userKeysEnabled)
  const doc = useStore((s) => s.doc)
  const targets = selectedPasteTargets(selection, keys)
  const editable = targets.filter(({ nodeId }) => {
    const node = doc?.content.nodes.find((item) => item.id === nodeId)
    return node && !node.locked && !cameraMotionOwnsKeyframes(doc, nodeId)
  })
  const open: Open = (event, nodeId, frame, refs, fcRefs, highlighted) => {
    event.preventDefault(); event.stopPropagation()
    const state = useStore.getState()
    const next = contextTimelineKeySelection(state.selection, refs, fcRefs, highlighted, state.userKeys, state.fcurves)
    if (next !== state.selection) state.select(next)
    setMenu({ x: event.clientX, y: event.clientY, nodeId, frame })
  }
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const point = clampMenuPosition(menu.x, menu.y, rect, { width: innerWidth, height: innerHeight })
    ref.current.style.left = `${point.x}px`; ref.current.style.top = `${point.y}px`
  }, [menu])
  useEffect(() => {
    if (!menu) return
    const dismiss = () => setMenu(null)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', key); window.addEventListener('blur', dismiss)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', key); window.removeEventListener('blur', dismiss) }
  }, [menu])
  const paste = (mask: TransformProp[]) => {
    const result = session.pasteTransformKeys(mask)
    if (result.skipped) emitTimelineNotice(t('timeline.keyPasteSkipped', { count: result.skipped }))
    setMenu(null)
  }
  const remove = () => {
    const refs = selectedTimelineRefs(selection, keys, curves)
    useStore.getState().select(makeTimelineBoxSelection([], refs.keys, refs.curves))
    session.deleteSelection()
    setMenu(null)
  }
  return <MenuContext.Provider value={open}>{children}{menu && createPortal(<div ref={ref} role="menu" style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 10000, background: 'var(--t3d-panel-bg, #222)', padding: 6 }} onPointerDown={(e) => e.stopPropagation()}>
    <button type="button" role="menuitem" style={{ display: 'block' }} onClick={() => { const s = useStore.getState(); if (s.doc) copyTransform(s.doc, s.fcurves, s.userKeys, menu.nodeId, menu.frame, s.userKeysEnabled, s.chainCameraMotion); setMenu(null) }}>{t('timeline.keyCopyTransform')}</button>
    {([['timeline.keyPasteTransform', ['position', 'rotation', 'scale']], ['timeline.keyPastePosition', ['position']], ['timeline.keyPasteRotation', ['rotation']], ['timeline.keyPasteScale', ['scale']]] as [string, TransformProp[]][]).map(([label, mask]) => {
      const needsUserKeys = !enabled && !!doc && !canPasteWithoutUserKeys(doc, curves, targets, mask)
      return <button key={label} type="button" role="menuitem" style={{ display: 'block' }} title={needsUserKeys ? t('timeline.keyPasteEnableUserKeys') : undefined} disabled={locked || needsUserKeys || !getTransformClipboard() || !editable.some(({ nodeId }) => mask.length !== 1 || mask[0] !== 'scale' || doc?.content.nodes.find((n) => n.id === nodeId)?.type !== 'camera')} onClick={() => paste(mask)}>{t(label)}</button>
    })}
    <button type="button" role="menuitem" style={{ display: 'block' }} disabled={locked || !editable.length} onClick={remove}>{t('common.delete')}</button>
  </div>, document.body)}</MenuContext.Provider>
}
