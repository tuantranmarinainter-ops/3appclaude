'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DirectorApi } from '@topview/3d-builder'
import { LocalHostAdapter, type LocalDocumentSource } from '../../../src/LocalHostAdapter'
import { getLiveStudio, setLiveStudio, subscribeLiveStudio } from '../../../src/devtools/liveStudio'
import { setStudioLocale, useStudioLocale } from '../../../src/devtools/localePreference'
import { readFilmFrameAspect } from '../../../src/filmFrame'
import { useStudioT } from '../../../src/locale'
import { ensureUnifiedSession, invalidateUnifiedProjectReads, loadUnifiedProject, sendUnifiedCommand, uploadUnifiedAsset } from '../../../src/unifiedApi'
import { FeatureNavigation } from './feature-navigation'
import { WorkspaceNavigationSlot } from './feature-navigation/WorkspaceNavigation'
import { usePanelNavigation } from './feature-navigation/hooks/usePanelNavigation'
import { RetargetWorkspace } from './RetargetWorkspace'
import { AnimationWorkspace } from './AnimationWorkspace'
import { AnimationAssignPanel } from './animation-assign'
import { HostDrawer } from './HostDrawer'
import { CharacterHeightNotice } from './character-height'
import { SceneRenderPanel } from './scene-render'
import { SplitShotsPanel } from './split-shots'
import { FilmExportPanel } from './film-export'
import { SceneReviewPanel } from './scene-review'
import { VfxCueHost } from './vfx-cues'
import { AudioCueHost, AudioSubtitle } from './audio-cues'
import { useAudioPlayback } from './audio-cues/useAudioPlayback'
import { useVfxPreview } from './vfx-cues/hooks/useVfxPreview'
import { planReviewFrames, reviewStatusForSequence } from '../../../src/sceneReview'
import { DiagnosticsPanel } from '../../../src/devtools/tools/DiagnosticsPanel'
import { DebugRecorderPanel } from './debug-recorder'
import { resumeDebugIfEnabled } from '../../../src/debugRecorder'
import { LanguageMenu } from './LanguageMenu'
import { WORKSPACE_PANELS, type Workspace } from '../../../src/workspaceNavigation'

function StudioChunkFallback() {
  const t = useStudioT()
  return (
    <div className="t3d-studio-host">
      <div className="t3d-root">
        <div className="t3d-boot" role="status" aria-live="polite" aria-busy="true">
          <div className="t3d-boot-spinner" aria-hidden="true" />
          <p className="t3d-boot-title">{t('正在加载 3D Builder…')}</p>
        </div>
      </div>
    </div>
  )
}

const CHUNK_RELOAD_KEY = 't3d-studio-chunk-reload'

function isChunkLoadError(err: unknown): boolean {
  const e = err as { name?: string; message?: string }
  const msg = String(e?.message ?? err ?? '')
  return (
    e?.name === 'ChunkLoadError' ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg)
  )
}

const DirectorStudio = dynamic(
  () =>
    import('@topview/3d-builder')
      .then((mod) => {
        try {
          sessionStorage.removeItem(CHUNK_RELOAD_KEY)
        } catch {
          /* ignore */
        }
        return mod.DirectorStudio
      })
      .catch((err: unknown) => {
        // After builder dist rebuild, Next HMR often leaves a stale chunk URL.
        // One hard reload recovers; avoid loops via sessionStorage.
        if (typeof window !== 'undefined' && isChunkLoadError(err)) {
          try {
            if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
              sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
              window.location.reload()
              return function StudioChunkReloadPlaceholder() {
                return null
              }
            }
            sessionStorage.removeItem(CHUNK_RELOAD_KEY)
          } catch {
            /* ignore */
          }
        }
        throw err
      }),
  { ssr: false, loading: StudioChunkFallback },
)

type StudioWindow = Window & {
  __stage?: DirectorApi['stage']
  __store?: DirectorApi['useStore']
  __exportDraft?: () => boolean
}

type HostDrawerId = 'features' | 'assets' | 'animation' | 'export' | 'review' | 'vfx' | 'audio' | 'diagnostics' | 'assign' | 'debug'

function installDebugHooks(api: DirectorApi): void {
  const target = window as StudioWindow
  target.__stage = api.stage
  target.__store = api.useStore
  target.__exportDraft = () => api.useStore.getState().exportDraft()
  setLiveStudio(api)
}

function clearDebugHooks(): void {
  const target = window as StudioWindow
  delete target.__stage
  delete target.__store
  delete target.__exportDraft
  setLiveStudio(null)
}

function notifyProjectCommit(projectId: string): void {
  window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
}

export function StudioOverlay({
  documentId,
  source = 'draft',
  onClose,
}: {
  documentId: string
  source?: LocalDocumentSource
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [projectState, setProjectState] = useState<Awaited<ReturnType<typeof loadUnifiedProject>> | null>(null)
  const [activeWorkspace, setActiveWorkspace] = useState<'scene' | 'retarget' | 'animation'>('scene')
  const [drawer, setDrawer] = useState<HostDrawerId | null>(null)
  const [assignRequest, setAssignRequest] = useState<{ nodeId: string | null; nonce: number }>({ nodeId: null, nonce: 0 })
  const [historyBusy, setHistoryBusy] = useState(false)
  const hostRefreshRef = useRef<Promise<void> | null>(null)
  const [shellError, setShellError] = useState<string | null>(null)
  const [assetMessage, setAssetMessage] = useState('')
  const [assetBusy, setAssetBusy] = useState(false)
  const [animationEditorDirty, setAnimationEditorDirty] = useState(false)
  // Silhouette is a view mode only (never saved): App 2's Stage applies it; App 3 listens for the window event.
  const [silhouette, setSilhouette] = useState(false)
  useEffect(() => {
    const apply = () => getLiveStudio()?.stage.setSilhouette(silhouette)
    apply()
    window.dispatchEvent(new CustomEvent('bbs-view-silhouette', { detail: { enabled: silhouette } }))
    return subscribeLiveStudio(apply)
  }, [silhouette])
  // BBS look is a view mode only (never saved): Minecraft lighting, sky and grass as BBS FS 2.7 shows the Film.
  const [bbsLook, setBbsLook] = useState(false)
  useEffect(() => {
    const apply = () => getLiveStudio()?.stage.setBbsLook(bbsLook)
    apply()
    return subscribeLiveStudio(apply)
  }, [bbsLook])
  const filmFrameAspect = source === 'unified' && projectState ? readFilmFrameAspect(projectState.project.extensions) : null
  useEffect(() => {
    const apply = () => getLiveStudio()?.stage.setFilmFrameAspect(filmFrameAspect)
    apply()
    const unsubscribe = subscribeLiveStudio(apply)
    return () => {
      unsubscribe()
      getLiveStudio()?.stage.setFilmFrameAspect(null)
    }
  }, [filmFrameAspect])
  useVfxPreview(source === 'unified' ? projectState?.project ?? null : null)
  const subtitle = useAudioPlayback(source === 'unified' ? projectState?.project ?? null : null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const assetInputRef = useRef<HTMLInputElement>(null)
  const relinkInputRef = useRef<HTMLInputElement>(null)
  const relinkTargetRef = useRef<string | null>(null)
  const activeWorkspaceRef = useRef(activeWorkspace)
  const openAnimationOnSwitch = useRef(false)
  const saveErrorRef = useRef<string | null>(null)
  const locale = useStudioLocale()
  const vi = locale === 'vi'
  const t = useStudioT()
  const { api, setApi, selectedNodeId, setSelectedNodeId, openPanel } = usePanelNavigation(activeWorkspace, setActiveWorkspace, setShellError)
  const adapter = useMemo(() => new LocalHostAdapter(source), [source])
  const onReady = useCallback((api: DirectorApi) => {
    installDebugHooks(api)
    setApi(api)
  }, [setApi])
  const runHistory = useCallback(async (command: 'history.undo' | 'history.redo') => {
    if (historyBusy) return
    setHistoryBusy(true)
    setShellError(null)
    try {
      const latest = projectState ?? await loadUnifiedProject(documentId)
      if (command === 'history.undo' ? !latest.history.canUndo : !latest.history.canRedo) return
      await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: documentId, expectedRevision: latest.project.revision, command, args: {} })
      notifyProjectCommit(documentId)
      await hostRefreshRef.current
    } catch (error) {
      // The server rejects stale expectedRevision. Refresh before the next attempt.
      notifyProjectCommit(documentId)
      await hostRefreshRef.current
      setShellError(error instanceof Error ? error.message : String(error))
    }
    finally { setHistoryBusy(false) }
  }, [documentId, historyBusy, projectState])
  const cleanupResources = useCallback(async () => {
    if (assetBusy || !window.confirm(vi ? 'Dọn motion và tài nguyên không còn dùng? Bạn có thể hoàn tác thao tác này.' : 'Remove unused motions and assets? You can undo this operation.')) return
    setAssetBusy(true)
    setShellError(null)
    try {
      const latest = await loadUnifiedProject(documentId)
      await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: documentId, expectedRevision: latest.project.revision, command: 'project.cleanup', args: { confirmed: true } })
      notifyProjectCommit(documentId)
      await hostRefreshRef.current
      setAssetMessage(vi ? 'Đã dọn tài nguyên không còn dùng.' : 'Unused resources removed.')
    } catch (error) { setShellError(error instanceof Error ? error.message : String(error)) }
    finally { setAssetBusy(false) }
  }, [assetBusy, documentId, vi])
  const importAssets = useCallback(async (files: File[]) => {
    if (!files.length || assetBusy) return
    const totalBytes = files.reduce((total, file) => total + file.size, 0)
    if (files.length > 32 || totalBytes > 512 * 1024 * 1024) {
      setShellError(vi ? 'Mỗi lần nhập tối đa 32 tệp và tổng dung lượng 512 MiB.' : 'Import up to 32 files and 512 MiB per batch.')
      return
    }
    setAssetBusy(true)
    setShellError(null)
    setAssetMessage(vi ? 'Đang tải tài nguyên lên dự án…' : 'Uploading assets to the project…')
    try {
      const uploaded = []
      for (const file of files) uploaded.push(await uploadUnifiedAsset(file))
      const latest = await loadUnifiedProject(documentId)
      const result = await sendUnifiedCommand({
        requestId: crypto.randomUUID(), projectId: documentId, expectedRevision: latest.project.revision,
        command: 'asset.import', args: { files: uploaded.map((item) => item.uploadId), format: 'auto' },
      })
      const refreshed = await loadUnifiedProject(documentId)
      setProjectState(refreshed)
      notifyProjectCommit(documentId)
      setAssetMessage(vi ? `Đã nhập ${Array.isArray(result.result.assetIds) ? result.result.assetIds.length : 0} tài nguyên.` : `Imported ${Array.isArray(result.result.assetIds) ? result.result.assetIds.length : 0} assets.`)
    } catch (error) {
      setAssetMessage('')
      setShellError(error instanceof Error ? error.message : String(error))
    } finally { setAssetBusy(false) }
  }, [assetBusy, documentId, vi])
  const addCharacter = useCallback(async (assetId: string, skeletonId: string, name: string) => {
    if (assetBusy) return
    setAssetBusy(true)
    setShellError(null)
    try {
      const latest = await loadUnifiedProject(documentId)
      await sendUnifiedCommand({
        requestId: crypto.randomUUID(), projectId: documentId, expectedRevision: latest.project.revision,
        command: 'character.add', args: { assetId, skeletonId, name },
      })
      setProjectState(await loadUnifiedProject(documentId))
      notifyProjectCommit(documentId)
      setAssetMessage(vi ? `Đã thêm nhân vật “${name}” vào cảnh.` : `Added character “${name}” to the scene.`)
    } catch (error) { setShellError(error instanceof Error ? error.message : String(error)) }
    finally { setAssetBusy(false) }
  }, [assetBusy, documentId, vi])
  const addProp = useCallback(async (assetId: string, name: string) => {
    if (assetBusy) return
    setAssetBusy(true)
    setShellError(null)
    try {
      const latest = await loadUnifiedProject(documentId)
      await sendUnifiedCommand({
        requestId: crypto.randomUUID(), projectId: documentId, expectedRevision: latest.project.revision,
        command: 'prop.add', args: { assetId, name },
      })
      setProjectState(await loadUnifiedProject(documentId))
      notifyProjectCommit(documentId)
      setAssetMessage(vi ? `Đã thêm đạo cụ “${name}” vào cảnh.` : `Added prop “${name}” to the scene.`)
    } catch (error) { setShellError(error instanceof Error ? error.message : String(error)) }
    finally { setAssetBusy(false) }
  }, [assetBusy, documentId, vi])
  const relinkAsset = useCallback(async (assetId: string, file: File) => {
    if (assetBusy) return
    setAssetBusy(true)
    setShellError(null)
    setAssetMessage(vi ? `Đang kiểm tra tệp ${file.name}…` : `Checking file ${file.name}…`)
    try {
      const upload = await uploadUnifiedAsset(file)
      const latest = await loadUnifiedProject(documentId)
      const result = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: documentId, expectedRevision: latest.project.revision, command: 'asset.relink', args: { assetId, file: upload.uploadId } })
      setProjectState(await loadUnifiedProject(documentId))
      notifyProjectCommit(documentId)
      setAssetMessage(result.result.restored ? (vi ? `Đã khôi phục tài nguyên ${file.name}.` : `Restored asset ${file.name}.`) : (vi ? `Tài nguyên ${file.name} đã có sẵn.` : `Asset ${file.name} is already available.`))
    } catch (error) {
      setAssetMessage('')
      setShellError(error instanceof Error ? error.message : String(error))
    } finally { setAssetBusy(false) }
  }, [assetBusy, documentId, vi])

  useEffect(() => {
    let live = true
    setShellError(null)
    if (source !== 'unified') { setMounted(true); return () => { live = false; clearDebugHooks() } }
    setProjectState(null)
    setDrawer(null)
    setSaveStatus('saved')
    saveErrorRef.current = null
    void (async () => {
      try {
        await ensureUnifiedSession()
        const state = await loadUnifiedProject(documentId)
        if (live) {
          const key = `bbs-workspace:${documentId}`
          let remembered: string | null = null
          let firstOpen = false
          try {
            remembered = window.localStorage.getItem(key)
            firstOpen = window.localStorage.getItem(`bbs-new-project:${documentId}`) === '1'
            window.localStorage.removeItem(`bbs-new-project:${documentId}`)
          } catch { /* Workspace selection is an optional local preference. */ }
          setActiveWorkspace(remembered === 'retarget' || remembered === 'scene' || remembered === 'animation' ? remembered : firstOpen ? 'retarget' : 'scene')
          setProjectState(state); setMounted(true)
        }
      } catch (error) {
        if (live) { setShellError(error instanceof Error ? error.message : String(error)); setMounted(true) }
      }
    })()
    return () => { live = false; clearDebugHooks() }
  }, [documentId, source])

  useEffect(() => {
    if (source !== 'unified') return
    document.body.classList.add('wb-unified-open')
    return () => {
      document.body.classList.remove('wb-unified-open')
      delete document.body.dataset.bbsWorkspace
      window.dispatchEvent(new CustomEvent('bbs-workspace-change', { detail: { workspace: 'scene' } }))
    }
  }, [source])

  useEffect(() => {
    if (source !== 'unified') return
    if (!mounted || !projectState) return
    try { window.localStorage.setItem(`bbs-workspace:${documentId}`, activeWorkspace) } catch { /* Private mode keeps the selection for this session. */ }
    document.body.dataset.bbsWorkspace = activeWorkspace
    window.dispatchEvent(new CustomEvent('bbs-workspace-change', { detail: { workspace: activeWorkspace } }))
  }, [activeWorkspace, documentId, mounted, projectState, source])

  useEffect(() => {
    if (api && activeWorkspace !== 'scene') { api.stage.pause(); api.stage.stopAmbient() }
    else if (api && !api.useStore.getState().timelineVisible) api.stage.startAmbient()
  }, [activeWorkspace, api])

  useEffect(() => {
    if (activeWorkspaceRef.current !== activeWorkspace) {
      activeWorkspaceRef.current = activeWorkspace
      if (openAnimationOnSwitch.current) {
        openAnimationOnSwitch.current = false
        if (activeWorkspace === 'animation') setDrawer('animation')
      }
    }
  }, [activeWorkspace])

  useEffect(() => {
    if (source !== 'unified') return
    const onSaving = (event: Event) => {
      if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === documentId) setSaveStatus('saving')
    }
    const onSaved = (event: Event) => {
      if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === documentId) {
        setSaveStatus('saved')
        const previousError = saveErrorRef.current
        saveErrorRef.current = null
        if (previousError) setShellError((current) => current === previousError ? null : current)
      }
    }
    const onFailed = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; message?: string }>).detail
      if (detail?.projectId === documentId) { setSaveStatus('error'); if (detail.message) { saveErrorRef.current = detail.message; setShellError(detail.message) } }
    }
    window.addEventListener('bbs-unified-project-saving', onSaving)
    window.addEventListener('bbs-unified-project-saved', onSaved)
    window.addEventListener('bbs-unified-project-save-failed', onFailed)
    return () => {
      window.removeEventListener('bbs-unified-project-saving', onSaving)
      window.removeEventListener('bbs-unified-project-saved', onSaved)
      window.removeEventListener('bbs-unified-project-save-failed', onFailed)
    }
  }, [documentId, source])

  useEffect(() => {
    if (shellError && openAnimationOnSwitch.current) openAnimationOnSwitch.current = false
  }, [shellError])

  useEffect(() => {
    if (source !== 'unified') return
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail
      if (detail?.projectId !== documentId) return
      invalidateUnifiedProjectReads(documentId)
      // Apply host revisions in order: async node loads must finish before the next refresh.
      const reload = (hostRefreshRef.current ?? Promise.resolve()).then(() => loadUnifiedProject(documentId)).then(async (state) => {
        setProjectState(state)
        const studio = getLiveStudio()
        if (studio?.documentId === documentId) await adapter.withProjectSnapshot(state.project, () => studio.session.reloadFromHost())
      }).catch((error: unknown) => setShellError(error instanceof Error ? error.message : String(error)))
      hostRefreshRef.current = reload
      void reload.finally(() => { if (hostRefreshRef.current === reload) hostRefreshRef.current = null })
    }
    window.addEventListener('bbs-unified-project-commit', refresh)
    return () => window.removeEventListener('bbs-unified-project-commit', refresh)
  }, [adapter, documentId, source])

  useEffect(() => {
    if (source === 'unified' && activeWorkspace === 'scene' && getLiveStudio()) setApi(getLiveStudio())
  }, [activeWorkspace, source, setApi])

  useEffect(() => {
    if (source !== 'unified') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeWorkspaceRef.current !== 'scene') return
      const target = event.target
      if (event.isComposing || target instanceof HTMLElement && target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setDrawer('features')
        requestAnimationFrame(() => document.getElementById('wb-feature-search')?.focus())
        return
      }
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setSilhouette((value) => !value)
        return
      }
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setBbsLook((value) => !value)
        return
      }
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const command = key === 'z' ? (event.shiftKey ? 'history.redo' : 'history.undo') : key === 'y' ? 'history.redo' : null
      if (!command) return
      event.preventDefault()
      event.stopImmediatePropagation()
      void runHistory(command)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [runHistory, source])

  const project = projectState?.project ?? null
  const reviewSequence = project?.scene.content.editorial?.sequences.find((sequence) => sequence.id === project.scene.content.editorial?.activeSequenceId)
  const reviewFramePlans = project && reviewSequence ? new Map(planReviewFrames(project, reviewSequence.id).map((item) => [item.clipId, item.frames])) : new Map<string, number[]>()
  const reviewClips = reviewSequence?.clips.map((clip, index) => ({
    id: clip.id,
    name: `${vi ? 'Cảnh' : 'Shot'} ${String(index + 1).padStart(2, '0')}`,
    frameStart: clip.sourceFrameStart,
    frameEnd: clip.sourceFrameEnd,
    frames: reviewFramePlans.get(clip.id) ?? [],
    ...reviewStatusForSequence(project!, reviewSequence!.id, clip.id),
  })) ?? []
  const setReview = useCallback(async (clipId: string, status: 'pending' | 'ok' | 'note', note: string) => {
    if (!project) return
    try {
      await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: documentId, expectedRevision: project.revision,
        command: 'scene.review.set', args: { sequenceId: reviewSequence?.id, clipId, status, note } })
      setProjectState(await loadUnifiedProject(documentId))
      notifyProjectCommit(documentId)
    } catch (error) { setShellError(error instanceof Error ? error.message : String(error)) }
  }, [documentId, project, reviewSequence?.id])
  // C4: review stills rendered by Studio with the BBS look, kept per clip for this session.
  const [reviewImages, setReviewImages] = useState<Record<string, string[]>>({})
  const [reviewCapturing, setReviewCapturing] = useState<string | null>(null)
  const captureReview = useCallback(async (clipId: string, frames: number[]) => {
    if (!reviewSequence) return
    setReviewCapturing(clipId)
    try {
      const response = await fetch(`/api/unified/projects/${documentId}/review-capture`, { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sequenceId: reviewSequence.id, clipId, frames }) })
      const body = await response.json() as { images?: string[]; error?: { message?: string } }
      if (!response.ok || !body.images) throw new Error(body.error?.message ?? `Capture failed (${response.status})`)
      setReviewImages((current) => ({ ...current, [clipId]: body.images! }))
    } catch (error) { setShellError(error instanceof Error ? error.message : String(error)) }
    finally { setReviewCapturing(null) }
  }, [documentId, reviewSequence])
  const reviewClipsRef = useRef(reviewClips)
  reviewClipsRef.current = reviewClips
  const captureAllReview = useCallback(async () => {
    for (const clip of reviewClipsRef.current) if (!reviewImages[clip.id]?.length && clip.frames.length) await captureReview(clip.id, clip.frames)
  }, [captureReview, reviewImages])
  const playReviewClip = useCallback((clipId: string) => {
    const clip = reviewSequence?.clips.find((item) => item.id === clipId)
    const studio = getLiveStudio()
    const stage = studio?.stage
    if (!clip || !stage) return
    // N4: phát một shot trong Duyệt cảnh cũng đặt In/Out theo shot để timeline lặp đúng khoảng.
    studio?.useStore.getState().setInOutRange(clip.sourceFrameStart, clip.sourceFrameEnd)
    stage.seek(clip.sourceFrameStart)
    stage.play()
  }, [reviewSequence])
  const assetCount = Object.keys(project?.assets ?? {}).length
  const characterCount = Object.keys(project?.characters ?? {}).length
  const clipCount = project?.scene.content.timeline.animation.motionClips.length ?? 0
  const workflowHint = assetCount === 0
    ? (vi ? 'Bắt đầu bằng cách chọn một FBX để chuẩn hóa.' : 'Start by choosing an FBX to standardize.')
    : characterCount === 0
      ? (vi ? 'Thêm mô hình đã nhập thành nhân vật để dựng cảnh.' : 'Add an imported model as a character to build the scene.')
      : clipCount === 0
        ? (vi ? 'Chọn nhân vật rồi đặt animation lên timeline.' : 'Choose a character, then place an animation on the timeline.')
        : (vi ? 'Có thể tiếp tục chỉnh scene, animation hoặc xuất dự án.' : 'Continue editing the scene, animation, or export the project.')
  const openFeature = (panelId: string) => {
    openAnimationOnSwitch.current = false
    if (panelId === 'feature-tree') { setDrawer('features'); requestAnimationFrame(() => document.getElementById('wb-feature-search')?.focus()); return }
    const targetDrawer: Partial<Record<string, HostDrawerId>> = {
      'workspace-switcher': 'features', 'asset-profile': 'assets', 'motion-binding': 'animation',
      'animation-motion': 'animation', 'scene-checks': 'export', 'film-export': 'export',
    }
    setDrawer(targetDrawer[panelId] ?? null)
    void openPanel(panelId)
  }
  const switchWorkspace = (workspace: Workspace) => {
    openAnimationOnSwitch.current = false
    setDrawer(null)
    void openPanel(WORKSPACE_PANELS[workspace])
  }
  useEffect(() => {
    if (source !== 'unified') return
    const onWorkspaceRequest = (event: Event) => {
      const workspace = (event as CustomEvent<{ workspace?: string }>).detail?.workspace
      if (workspace === 'retarget' || workspace === 'scene' || workspace === 'animation') {
        openAnimationOnSwitch.current = false
        setDrawer(null)
        void openPanel(WORKSPACE_PANELS[workspace])
      }
    }
    window.addEventListener('bbs-workspace-request', onWorkspaceRequest)
    return () => window.removeEventListener('bbs-workspace-request', onWorkspaceRequest)
  }, [openPanel, source])
  // N1: the builder rail's "Gán animation" button reaches the overlay through the host adapter event.
  useEffect(() => {
    if (source !== 'unified') return
    const onAssignRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ characterNodeId?: string | null }>).detail
      setAssignRequest((current) => ({ nodeId: detail?.characterNodeId ?? null, nonce: current.nonce + 1 }))
      setDrawer('assign')
    }
    window.addEventListener('bbs-assign-animation', onAssignRequest)
    return () => window.removeEventListener('bbs-assign-animation', onAssignRequest)
  }, [source])
  // Nút "Debug" ở cột trái mở bảng ghi thao tác; bản ghi đang bật thì tiếp tục sau khi tải lại trang.
  useEffect(() => {
    if (source !== 'unified') return
    resumeDebugIfEnabled()
    const onDebugRequest = () => setDrawer('debug')
    window.addEventListener('bbs-open-debug', onDebugRequest)
    return () => window.removeEventListener('bbs-open-debug', onDebugRequest)
  }, [source])
  // C27: after an assignment, reveal the new clip (scroll + zoom + flash) in the builder timeline.
  // Sources: the assign panel and adapter dispatch 'bbs-reveal-clip'; returning from the Library
  // page hands the clip over through sessionStorage because the workbench remounts.
  useEffect(() => {
    if (source !== 'unified') return
    type RevealDetail = { projectId?: string; clipId: string; nodeId: string; frameStart: number; frameEnd: number }
    const applyReveal = (detail: RevealDetail): boolean => {
      if (detail.projectId && detail.projectId !== documentId) return false
      const studio = getLiveStudio()
      if (!studio || studio.documentId !== documentId) return false
      studio.useStore.getState().revealTimelineClip({ clipId: detail.clipId, nodeId: detail.nodeId, frameStart: detail.frameStart, frameEnd: detail.frameEnd })
      studio.stage.seek(detail.frameStart)
      return true
    }
    const onReveal = (event: Event) => {
      const detail = (event as CustomEvent<RevealDetail>).detail
      if (detail && !applyReveal(detail)) {
        try { sessionStorage.setItem('bbs-reveal-clip', JSON.stringify(detail)) } catch { /* storage unavailable */ }
      }
    }
    window.addEventListener('bbs-reveal-clip', onReveal)
    const consumeStored = () => {
      try {
        const raw = sessionStorage.getItem('bbs-reveal-clip')
        if (!raw) return
        const detail = JSON.parse(raw) as RevealDetail
        if (applyReveal(detail)) sessionStorage.removeItem('bbs-reveal-clip')
      } catch { /* ignore malformed handoff */ }
    }
    consumeStored()
    const unsubscribe = subscribeLiveStudio(consumeStored)
    return () => { window.removeEventListener('bbs-reveal-clip', onReveal); unsubscribe() }
  }, [source, documentId])
  const openAnimationControls = () => {
    // E9: "Thêm animation" chỉ mở bảng điều khiển ngay tại workspace hiện tại
    // (vd tab Dựng cảnh), không ép chuyển sang tab Animation.
    openAnimationOnSwitch.current = false
    setDrawer('animation')
  }
  const openFeatureSearch = () => {
    openAnimationOnSwitch.current = false
    setDrawer('features')
    requestAnimationFrame(() => document.getElementById('wb-feature-search')?.focus())
  }

  if (!mounted) return null

  if (source === 'unified') {
    return createPortal(
      <div className="wb-unified-shell" role="dialog" aria-modal="true" aria-label={vi ? 'Dự án hợp nhất' : 'Unified project'}>
        <header className="wb-unified-topbar">
          <div className="wb-unified-brand"><strong id="wb-project-title">{project?.name ?? (vi ? 'Dự án' : 'Project')}</strong><span className={`wb-save-state is-${saveStatus}`} role="status" title={saveStatus === 'error' ? shellError ?? undefined : undefined}>{!projectState ? (vi ? 'Đang mở…' : 'Opening…') : assetBusy ? (vi ? 'Đang xử lý…' : 'Working…') : saveStatus === 'saving' ? (vi ? 'Đang lưu' : 'Saving') : saveStatus === 'error' ? (vi ? 'Lưu thất bại' : 'Save failed') : (vi ? 'Đã lưu' : 'Saved')}</span></div>
          <div className="wb-unified-actions">
            <h2 id="wb-history-title" className="wb-sr-only">Undo / Redo</h2>
            <input ref={assetInputRef} className="wb-sr-only" type="file" multiple accept=".glb,.gltf,.png,.jpg,.jpeg,.wav,.mp3,.ogg" aria-label={vi ? 'Chọn model GLB/GLTF hoặc texture để nhập' : 'Choose GLB/GLTF models or textures to import'} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void importAssets(files) }} />
            <input ref={relinkInputRef} className="wb-sr-only" type="file" aria-label={vi ? 'Chọn file cần liên kết lại' : 'Choose a file to relink'} onChange={(event) => { const file = event.target.files?.[0]; const assetId = relinkTargetRef.current; event.target.value = ''; relinkTargetRef.current = null; if (file && assetId) void relinkAsset(assetId, file) }} />
            <button type="button" className="wb-host-secondary" onClick={openFeatureSearch} title={vi ? 'Tìm chức năng (Ctrl+K)' : 'Find a feature (Ctrl+K)'}>{vi ? 'Tìm' : 'Find'} <kbd>Ctrl K</kbd></button>
            <button type="button" className="wb-host-secondary" onClick={() => setDrawer('assets')}>{vi ? 'Tài nguyên' : 'Assets'}</button>
            <button type="button" id="wb-silhouette-toggle" className={`wb-host-secondary${silhouette ? ' is-active' : ''}`} aria-pressed={silhouette} onClick={() => setSilhouette((value) => !value)} title={vi ? 'Xem silhouette: nhân vật tô đặc trên nền sáng (Shift+S)' : 'Silhouette view: solid characters on a light background (Shift+S)'}>{vi ? 'Silhouette' : 'Silhouette'} <kbd>Shift S</kbd></button>
            <button type="button" id="wb-bbs-look-toggle" className={`wb-host-secondary${bbsLook ? ' is-active' : ''}`} aria-pressed={bbsLook} onClick={() => setBbsLook((value) => !value)} title={vi ? 'Xem như BBS FS: ánh sáng, trời và sàn cỏ Minecraft (Shift+B)' : 'BBS look: Minecraft lighting, sky and grass as in BBS FS (Shift+B)'}>{vi ? 'Xem như BBS' : 'BBS look'} <kbd>Shift B</kbd></button>
            {project && activeWorkspace === 'scene' && <SplitShotsPanel project={project} />}
            <button type="button" id="wb-scene-review-open" className="wb-host-secondary" onClick={() => setDrawer('review')}>{vi ? 'Duyệt cảnh' : 'Review shots'}</button>
            <button type="button" id="wb-vfx-cues-open" className="wb-host-secondary" onClick={() => setDrawer('vfx')}>{vi ? 'Hiệu ứng' : 'Effects'}</button>
            <button type="button" id="wb-audio-cues-open" className="wb-host-secondary" onClick={() => setDrawer('audio')}>{vi ? 'Âm thanh' : 'Audio'}</button>
            {activeWorkspace === 'animation' && <button type="button" className="wb-host-secondary" onClick={() => setDrawer('animation')}>{vi ? 'Thêm animation' : 'Add animation'}</button>}
            <button type="button" className="wb-host-icon" aria-label={vi ? 'Hoàn tác' : 'Undo'} title="Undo (Ctrl+Z)" disabled={historyBusy || !projectState?.history.canUndo} onClick={() => void runHistory('history.undo')}>↶</button>
            <button type="button" className="wb-host-icon" aria-label={vi ? 'Làm lại' : 'Redo'} title="Redo (Ctrl+Shift+Z)" disabled={historyBusy || !projectState?.history.canRedo} onClick={() => void runHistory('history.redo')}>↷</button>
            <button type="button" className="wb-host-primary" onClick={() => setDrawer('export')}>{vi ? 'Xuất' : 'Export'} ▾</button>
            <details className="wb-host-more"><summary aria-label={vi ? 'Tùy chọn khác' : 'More options'}>⋯</summary><div className="wb-host-more-menu"><LanguageMenu /><button type="button" disabled={assetBusy} onClick={() => void cleanupResources()}>{vi ? 'Dọn tài nguyên thừa' : 'Clean unused resources'}</button><button type="button" onClick={() => setDrawer('diagnostics')}>{vi ? 'Chẩn đoán' : 'Diagnostics'}</button><button type="button" onClick={() => window.dispatchEvent(new Event('bbs-unified-open-devtools'))}>{vi ? 'Công cụ phát triển' : 'Developer tools'}</button><details><summary>{vi ? 'Chi tiết dự án' : 'Project details'}</summary><small>{vi ? 'Revision' : 'Revision'} {project?.revision ?? '—'} · {assetCount} {vi ? 'tài nguyên' : 'assets'}</small></details></div></details>
            <button type="button" className="wb-unified-close" onClick={() => { if (animationEditorDirty && !window.confirm(vi ? 'Animation chưa lưu. Bạn có muốn đóng dự án và bỏ bản sửa này?' : 'Animation changes are unsaved. Close the project and discard them?')) return; onClose() }}>{vi ? 'Đóng' : 'Close'}</button>
          </div>
        </header>
        <WorkspaceNavigationSlot />
        <div className="wb-workflow-bar"><span>{workflowHint}</span>{assetCount === 0 && <button type="button" className="cross-app-button" onClick={() => switchWorkspace('retarget')}>{vi ? 'Mở Chuẩn hóa' : 'Open Standardize'}</button>}{assetCount > 0 && characterCount === 0 && <button type="button" onClick={() => setDrawer('assets')}>{vi ? 'Mở Tài nguyên' : 'Open Assets'}</button>}{(characterCount > 0 || activeWorkspace === 'animation') && clipCount === 0 && <button type="button" onClick={openAnimationControls}>{vi ? 'Thêm animation' : 'Add animation'}</button>}</div>
        <main className="wb-unified-main">
          {shellError && <div className="wb-unified-error" role="alert">{shellError}</div>}
          {!projectState && <div className="wb-unified-placeholder" role="status">{shellError ? (vi ? 'Không thể mở dự án.' : 'Could not open the project.') : (vi ? 'Đang mở dự án…' : 'Opening project…')}</div>}
          {projectState && <div className="wb-unified-scene" style={{ display: activeWorkspace === 'scene' ? undefined : 'none' }}><div className="studio-root"><DirectorStudio adapter={adapter} documentId={documentId} locale={locale} onLocaleChange={setStudioLocale} onReady={onReady} readOnly={adapter.readOnly} autoSaveIntervalMs={activeWorkspace === 'scene' ? undefined : 0} /></div><AudioSubtitle cue={subtitle} />{project && <CharacterHeightNotice project={project} selectedNodeId={selectedNodeId} />}</div>}
          {projectState && <RetargetWorkspace key={`retarget-${documentId}`} projectId={documentId} active={activeWorkspace === 'retarget'} />}
          {projectState && <AnimationWorkspace key={`animation-${documentId}`} projectId={documentId} active={activeWorkspace === 'animation'} controlsOpen={drawer === 'animation'} onClose={() => setDrawer(null)} onEditorDirty={setAnimationEditorDirty} />}
        </main>
        {project && <>
          <HostDrawer open={drawer === 'features'} title={vi ? 'Tìm chức năng' : 'Find a feature'} closeLabel={vi ? 'Đóng bảng' : 'Close panel'} className="wb-drawer-wide" onClose={() => setDrawer(null)}>
            <FeatureNavigation key={documentId} projectId={documentId} project={project} locale={locale} workspace={activeWorkspace} api={api} selectedNodeId={selectedNodeId} onSelectionChange={setSelectedNodeId} onOpen={openFeature} />
          </HostDrawer>
          <HostDrawer open={drawer === 'assets'} title={vi ? 'Tài nguyên dự án' : 'Project assets'} closeLabel={vi ? 'Đóng bảng' : 'Close panel'} className="wb-drawer-wide" onClose={() => setDrawer(null)}>
            <div className="wb-assets-drawer">
              <h2 id="wb-assets-title" className="wb-sr-only">{vi ? 'Danh sách tài nguyên' : 'Asset list'}</h2>
              <p>{vi ? 'Nhập model và texture, sau đó thêm model vào scene.' : 'Import models and textures, then add models to the scene.'}</p>
              <button type="button" className="wb-host-primary" disabled={assetBusy} onClick={() => assetInputRef.current?.click()}>{assetBusy ? (vi ? 'Đang nhập…' : 'Importing…') : (vi ? 'Chọn tệp' : 'Choose files')}</button>
              {assetMessage && <p role="status" className="wb-unified-asset-status">{assetMessage}</p>}
              {!assetCount && <div className="wb-empty-card"><strong>{vi ? 'Chưa có tài nguyên' : 'No assets yet'}</strong><span>{vi ? 'Chọn tệp GLB/GLTF hoặc texture. FBX animation được nhập trong Chuẩn hóa.' : 'Choose GLB/GLTF models or textures. Import FBX animation in Standardize.'}</span></div>}
              <div className="wb-assets-list">{Object.values(project.assets).map((asset) => {
                const profiles = Object.values(project.skeletons).filter((profile) => profile.provenance.original.sha256 === asset.source.sha256)
                const kind = asset.kind === 'model' ? (vi ? 'Mô hình' : 'Model') : asset.kind === 'motion' ? (vi ? 'Animation' : 'Animation') : (vi ? 'Texture' : 'Texture')
                return <article className="wb-unified-asset" key={asset.id}>
                  <div><strong title={asset.displayName}>{asset.displayName}</strong><small>{kind}{profiles[0] ? ` · ${profiles[0].family}` : ''}</small></div>
                  {asset.kind === 'model' && <div className="wb-asset-actions"><button type="button" disabled={assetBusy} onClick={() => void addProp(asset.id, asset.displayName)}>{vi ? 'Thêm đạo cụ' : 'Add prop'}</button>{profiles.map((profile) => <button type="button" key={profile.id} disabled={assetBusy} onClick={() => void addCharacter(asset.id, profile.id, asset.displayName)}>{vi ? 'Thêm nhân vật' : 'Add character'}</button>)}</div>}
                  {asset.kind === 'model' && !profiles.length && <small>{vi ? 'Không tìm thấy rig; có thể thêm làm đạo cụ.' : 'No rig profile found; this can be added as a prop.'}</small>}
                  <details className="wb-asset-details"><summary>{vi ? 'Chi tiết' : 'Details'}</summary><small>{asset.source.byteLength.toLocaleString()} bytes · SHA-256 {asset.source.sha256}</small><button type="button" disabled={assetBusy} onClick={() => { relinkTargetRef.current = asset.id; relinkInputRef.current?.click() }}>{vi ? 'Liên kết lại tệp' : 'Relink file'}</button></details>
                </article>
              })}</div>
            </div>
          </HostDrawer>
          <HostDrawer open={drawer === 'export'} title={vi ? 'Xuất dự án' : 'Export project'} closeLabel={vi ? 'Đóng bảng' : 'Close panel'} className="wb-drawer-export" onClose={() => setDrawer(null)}>
            <div className="wb-export-groups"><details open><summary>{vi ? 'Ảnh PNG' : 'PNG images'}</summary><SceneRenderPanel project={project} /></details><details><summary>{vi ? 'Gói BBS FS' : 'BBS FS package'}</summary><FilmExportPanel project={project} active={drawer === 'export'} /></details></div>
          </HostDrawer>
          <HostDrawer open={drawer === 'review'} title={vi ? 'Duyệt cảnh' : 'Scene review'} closeLabel={vi ? 'Đóng bảng' : 'Close panel'} className="wb-drawer-wide" onClose={() => setDrawer(null)}>
            {reviewSequence ? <><p className="wb-review-capture"><button type="button" disabled={reviewCapturing !== null} onClick={() => void captureAllReview()}>{reviewCapturing ? (vi ? 'Đang chụp…' : 'Capturing…') : (vi ? 'Chụp tất cả cảnh chưa có ảnh (Xem như BBS)' : 'Capture all shots without stills (BBS look)')}</button></p><SceneReviewPanel clips={reviewClips} images={reviewImages} onSet={(clipId, status, note) => void setReview(clipId, status, note)} onPlay={playReviewClip} onCapture={(clipId, frames) => void captureReview(clipId, frames)} /></> : <p>{vi ? 'Dự án chưa có danh sách cảnh biên tập.' : 'This project has no editorial shot list.'}</p>}
          </HostDrawer>
          <HostDrawer open={drawer === 'vfx'} title={vi ? 'Hiệu ứng' : 'Effects'} closeLabel={vi ? 'Đóng bảng' : 'Close panel'} className="wb-drawer-wide" onClose={() => setDrawer(null)}>
            {drawer === 'vfx' && <VfxCueHost key={documentId} projectId={documentId} project={project} active />}
          </HostDrawer>
          <HostDrawer open={drawer === 'audio'} title={vi ? 'Thoại và âm thanh' : 'Voice and sound'} closeLabel={vi ? 'Đóng bảng' : 'Close panel'} className="wb-drawer-wide" onClose={() => setDrawer(null)}>
            <AudioCueHost key={documentId} projectId={documentId} project={project} active={drawer === 'audio'} />
          </HostDrawer>
          <HostDrawer open={drawer === 'diagnostics'} title={vi ? 'Chẩn đoán' : 'Diagnostics'} closeLabel={vi ? 'Đóng bảng' : 'Close panel'} className="wb-drawer-wide" onClose={() => setDrawer(null)}><DiagnosticsPanel /></HostDrawer>
          <HostDrawer open={drawer === 'debug'} title="Debug · ghi thao tác" closeLabel={vi ? 'Đóng bảng' : 'Close panel'} className="wb-drawer-wide" onClose={() => setDrawer(null)}><DebugRecorderPanel /></HostDrawer>
          <HostDrawer open={drawer === 'assign'} title={vi ? 'Gán animation' : 'Assign animation'} closeLabel={vi ? 'Đóng bảng' : 'Close panel'} className="wb-drawer-wide" onClose={() => setDrawer(null)}>
            <AnimationAssignPanel key={`${documentId}-${assignRequest.nonce}`} projectId={documentId} project={project} initialNodeId={assignRequest.nodeId} />
          </HostDrawer>
        </>}
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div className="wb-studio-overlay" role="dialog" aria-modal="true" aria-label={t('3D 导演台')}>
      <div className="studio-root">
        <DirectorStudio
          adapter={adapter}
          documentId={documentId}
          locale={locale}
          onLocaleChange={setStudioLocale}
          onReady={onReady}
          onClose={onClose}
          readOnly={adapter.readOnly}
        />
      </div>
    </div>,
    document.body,
  )
}
