import { useCallback, useEffect, useRef, useState } from 'react'
import type { DirectorApi } from '@topview/3d-builder'
import { FEATURE_PANELS, type Workspace } from '../../../../../src/workspaceNavigation'

export function usePanelNavigation(workspace: Workspace, setWorkspace: (workspace: Workspace) => void, onError: (message: string | null) => void) {
  const [api, setApi] = useState<DirectorApi | null>(null)
  const [request, setRequest] = useState<{ panelId: string } | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const switching = useRef(false)
  const resume = useRef<{ frame: number; nodeId: string | null } | null>(null)
  const restoredApi = useRef<DirectorApi | null>(null)

  const openPanel = useCallback(async (panelId: string) => {
    const target = FEATURE_PANELS[panelId]
    if (!target || target.unavailable || switching.current) return
    switching.current = true
    onError(null)
    try {
      if (target.workspace && target.workspace !== workspace) {
        if (api) {
          const state = api.useStore.getState()
          if (state.pendingKeyframe) throw new Error('Hãy xác nhận hoặc hủy keyframe đang chỉnh trước khi chuyển workspace.')
          if (state.playing) state.togglePlay()
          if (state.ready) {
            await api.session.flushPendingUserWrites()
            const current = api.useStore.getState()
            if (current.ready) {
              if (current.dirty) {
                const error = await api.session.save({ captureCover: false })
                if (error) throw new Error(error)
              }
              resume.current = { frame: current.frame, nodeId: current.selection?.kind === 'node' ? current.selection.nodeId : null }
            }
          } else {
            resume.current = null
          }
        }
        setApi(null)
        setWorkspace(target.workspace)
      }
      setRequest({ panelId })
    } catch (error) { onError(error instanceof Error ? error.message : String(error)) }
    finally { switching.current = false }
  }, [api, onError, setWorkspace, workspace])

  useEffect(() => {
    const target = request ? FEATURE_PANELS[request.panelId] : null
    if (target?.workspace && target.workspace !== workspace) return
    if (!target && !api) return
    let frame = 0
    let cancelled = false
    const deadline = performance.now() + 30_000
    const visit = () => {
      if (cancelled) return
      const state = api?.useStore.getState()
      if (state?.ready && restoredApi.current !== api) {
        restoredApi.current = api
        if (resume.current) {
          state.setFrame(resume.current.frame)
          if (resume.current.nodeId && state.doc?.content.nodes.some((node) => node.id === resume.current?.nodeId)) state.select({ kind: 'node', nodeId: resume.current.nodeId })
        }
      }
      if (target && (!target.editorPanel || state?.ready)) {
        if (target.editorPanel === 'objects') state?.setLibraryTab('object')
        if (target.editorPanel === 'camera') state?.setLibraryTab('camera')
        if (target.editorPanel === 'inspector') state?.openInspector()
        if (target.editorPanel === 'timeline') state?.openTimeline()
        const element = target.selector ? document.querySelector<HTMLElement>(`.wb-unified-shell ${target.selector}`) : null
        if (element) {
          const details = element.closest('details')
          if (details) details.open = true
        }
        if (element && element.getClientRects().length) {
          if (!element.matches('input,button,summary')) {
            element.tabIndex = -1
            if (!element.matches('h1,h2,h3,h4,h5,h6')) { element.setAttribute('role', 'heading'); element.setAttribute('aria-level', '2') }
          }
          element.focus()
          element.scrollIntoView({ block: 'nearest' })
          setRequest(null)
          return
        }
      } else if (!target && state?.ready) return
      if (performance.now() >= deadline) {
        if (request) { onError(`Không mở được panel ${request.panelId}. Hãy thử lại sau khi workspace tải xong.`); setRequest(null) }
        return
      }
      frame = requestAnimationFrame(visit)
    }
    frame = requestAnimationFrame(visit)
    return () => { cancelled = true; cancelAnimationFrame(frame) }
  }, [api, onError, request, workspace])

  return { api, setApi, selectedNodeId, setSelectedNodeId, openPanel }
}
