import { translateStudio } from './locale'
import { navigationHintPreference } from './navigationHintPreference'
import {
  normalizeAssetKey,
  type AssetFacets,
  type AssetPage,
  type AssetQuery,
  type CharacterLibEntry,
  type DirectorDocument,
  type HostAdapter,
  type MediaRef,
  type MotionLibEntry,
  type PoseBonesPayload,
  type PoseLibEntry,
  type PropLibEntry,
  type ExportMeta,
  type TopviewCanvasSummary,
} from '@topview/3d-builder'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { loadUnifiedProject, sendUnifiedCommand } from './unifiedApi'

const LOCAL_ASSET_ROUTE = '/api/local-assets'

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

const getInflight = new Map<string, Promise<unknown>>()
const poseJsonByUrl = new Map<string, Promise<unknown>>()

async function canvasJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  const body = await res.json().catch(() => null)
  if (res.status === 401) throw new Error('TOPVIEW_CANVAS_AUTH')
  if (!res.ok) {
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${res.status}`
    throw new Error(message)
  }
  return body
}

function fetchJsonOnce(url: string): Promise<unknown> {
  const pending = getInflight.get(url)
  if (pending) return pending
  const request = fetchJson(url).finally(() => {
    getInflight.delete(url)
  })
  getInflight.set(url, request)
  return request
}

function fetchPoseJson(url: string): Promise<unknown> {
  const hit = poseJsonByUrl.get(url)
  if (hit) return hit
  const request = fetchJson(url).catch((error) => {
    poseJsonByUrl.delete(url)
    throw error
  })
  poseJsonByUrl.set(url, request)
  return request
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function keyUrl(key: string): string {
  return `${LOCAL_ASSET_ROUTE}/file/${normalizeAssetKey(key).split('/').map(encodeURIComponent).join('/')}`
}

export type LocalDocumentSource = 'draft' | 'project' | 'unified'

/**
 * 纯本地宿主：草稿走 /api/drafts，CLI 项目走 /api/projects。两边都可以保存。
 * 素材搜索与文件都来自本机素材清单（/api/local-assets）。没有登录，也不访问外网。
 */
export class LocalHostAdapter implements HostAdapter<DirectorDocument> {
  getNavigationHintDismissed = navigationHintPreference.read
  dismissNavigationHint = navigationHintPreference.dismiss

  readonly readOnly: boolean
  private readonly base: string
  private readonly revisions = new Map<string, number>()
  private readonly projects = new Map<string, UnifiedProject>()
  saveDocumentState?: (documentId: string, doc: DirectorDocument, fcurves: unknown) => Promise<void>

  constructor(source: LocalDocumentSource = 'draft') {
    this.readOnly = false
    this.base = source === 'unified' ? '/api/unified/projects' : source === 'project' ? '/api/projects' : '/api/drafts'
    if (source === 'unified') {
      this.saveDocumentState = async (documentId, doc, fcurves) => {
        window.dispatchEvent(new CustomEvent('bbs-unified-project-saving', { detail: { projectId: documentId } }))
        try {
          const expectedRevision = this.revisions.get(documentId)
          if (expectedRevision === undefined) throw new Error('Project revision is unavailable; reload before saving')
          const result = await sendUnifiedCommand({
            requestId: crypto.randomUUID(), projectId: documentId, expectedRevision,
            command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: doc, fcurves }] },
          })
          this.revisions.set(documentId, result.revision)
          window.dispatchEvent(new CustomEvent('bbs-unified-project-saved', { detail: { projectId: documentId, revision: result.revision } }))
          window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId: documentId } }))
        } catch (error) {
          window.dispatchEvent(new CustomEvent('bbs-unified-project-save-failed', { detail: { projectId: documentId, message: error instanceof Error ? error.message : String(error) } }))
          throw error
        }
      }
    }
  }

  async loadDocument(documentId: string): Promise<DirectorDocument> {
    if (this.base === '/api/unified/projects') {
      const { project } = await loadUnifiedProject(documentId)
      if (project.type !== 'three-workspace-project' || project.scene.type !== 'biz/scene3d-director-document') throw new Error('Unified project document is invalid')
      this.projects.set(documentId, project)
      this.revisions.set(documentId, project.revision)
      return project.scene
    }
    const doc = (await fetchJson(`${this.base}/${documentId}`)) as DirectorDocument
    if (doc.type !== 'biz/scene3d-director-document') throw new Error(translateStudio('未知草稿类型: {{type}}', { type: String(doc.type) }))
    return doc
  }

  async browseLibraryAction(documentId: string, characterNodeId: string): Promise<void> {
    if (this.base !== '/api/unified/projects') throw new Error('Shared-library Actions can only be placed in an App 2 project')
    const project = (await loadUnifiedProject(documentId)).project
    const character = Object.values(project.characters).find((item) => item.nodeId === characterNodeId)
    if (!character) throw new Error('Select a Character in the current App 2 project first')
    const node = project.scene.content.nodes.find((item) => item.id === character.nodeId)
    const libraryCharacterId = typeof node?.metadata?.libraryCharacterId === 'string' ? node.metadata.libraryCharacterId : ''
    const popup = window.open(`/library?app2=1${libraryCharacterId ? `&charId=${encodeURIComponent(libraryCharacterId)}` : ''}`, 'bbs-action-library', 'popup,width=1100,height=760')
    if (!popup) throw new Error('Allow popups to choose an Action from the library')
    await new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== popup) return
        const data = event.data as { type?: unknown; actionUuid?: unknown; charId?: unknown }
        if (data.type === 'bbs-library-add-character' && typeof data.charId === 'string') {
          window.removeEventListener('message', onMessage)
          popup.close()
          void this.addLibraryCharacter(documentId, data.charId).then(resolve, reject)
          return
        }
        if (typeof data?.actionUuid !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.actionUuid)) return
        if (data.type !== 'bbs-library-place-action' && data.type !== 'bbs-library-open-app3') return
        window.removeEventListener('message', onMessage)
        popup.close()
        const operation = data.type === 'bbs-library-place-action'
          ? this.placeLibraryAction(documentId, data.actionUuid, characterNodeId)
          : this.openLibraryAction(documentId, data.actionUuid)
        void operation.then(resolve, reject)
      }
      window.addEventListener('message', onMessage)
    })
  }

  async addLibraryCharacter(documentId: string, charId: string): Promise<void> {
    if (this.base !== '/api/unified/projects') throw new Error('Library Characters require an App 2 project')
    const project = (await loadUnifiedProject(documentId)).project
    const response = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'add-to-scene', projectId: project.projectId, expectedRevision: project.revision, charId }) })
    const body = await response.json() as { revision?: number; error?: string; code?: string; existingNodeNames?: string[] }
    if (response.status === 409 && body.code === 'LIBRARY_CHARACTER_ALREADY_IN_SCENE') {
      // C25: the role already has nodes in this project; ask instead of silently duplicating.
      const names = (body.existingNodeNames ?? []).join(', ')
      const reuse = window.confirm(`Vai này đã có node trong cảnh (${names}).\nOK = Dùng node có sẵn (không thêm mới)\nHuỷ = Thêm lần xuất hiện mới`)
      if (reuse) {
        window.dispatchEvent(new CustomEvent('bbs-unified-project-saved', { detail: { projectId: project.projectId, revision: project.revision } }))
        window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId: project.projectId } }))
        return
      }
      const latest = (await loadUnifiedProject(documentId)).project
      const retry = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'add-to-scene', projectId: latest.projectId, expectedRevision: latest.revision, charId, existingNodePolicy: 'create' }) })
      const retryBody = await retry.json() as { revision?: number; error?: string }
      if (!retry.ok || !Number.isInteger(retryBody.revision)) throw new Error(retryBody.error ?? 'Could not add the library Character')
      this.revisions.set(latest.projectId, retryBody.revision!)
      window.dispatchEvent(new CustomEvent('bbs-unified-project-saved', { detail: { projectId: latest.projectId, revision: retryBody.revision } }))
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId: latest.projectId } }))
      return
    }
    if (!response.ok || !Number.isInteger(body.revision)) throw new Error(body.error ?? 'Could not add the library Character')
    this.revisions.set(project.projectId, body.revision!)
    window.dispatchEvent(new CustomEvent('bbs-unified-project-saved', { detail: { projectId: project.projectId, revision: body.revision } }))
    window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId: project.projectId } }))
  }

  /** N1: the builder rail's "Gán animation" button opens the host assign drawer in the overlay. */
  async assignAnimation(documentId: string, characterNodeId: string | null): Promise<void> {
    window.dispatchEvent(new CustomEvent('bbs-assign-animation', { detail: { documentId, characterNodeId } }))
  }

  async placeLibraryAction(documentId: string, actionUuid: string, characterNodeId: string): Promise<void> {
    if (this.base !== '/api/unified/projects') throw new Error('Shared-library Actions can only be placed in an App 2 project')
    const project = (await loadUnifiedProject(documentId)).project
    const character = Object.values(project.characters).find((item) => item.nodeId === characterNodeId)
    if (!character) throw new Error('Select a Character in the current App 2 project first')
    const result = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: project.projectId, expectedRevision: project.revision,
      command: 'library.place', args: { actionUuid, characterId: character.id } })
    this.projects.set(project.projectId, { ...project, revision: result.revision })
    this.revisions.set(project.projectId, result.revision)
    window.dispatchEvent(new CustomEvent('bbs-unified-project-saved', { detail: { projectId: project.projectId, revision: result.revision } }))
    window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId: project.projectId } }))
  }

  async openLibraryAction(documentId: string, actionUuid: string): Promise<void> {
    if (this.base !== '/api/unified/projects') throw new Error('App 3 library Actions require an App 2 project')
    const project = (await loadUnifiedProject(documentId)).project
    const listed = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: project.projectId, expectedRevision: project.revision, command: 'app3.session.list', args: {} })
    const sessions = Array.isArray(listed.result.sessions) ? listed.result.sessions as Array<Record<string, unknown>> : []
    const session = sessions.find(item => item.characterId && item.active === true && item.ready === true && Object.hasOwn(project.characters, String(item.characterId)))
    if (!session) throw new Error('Open Animation Studio on a compatible App 2 Character first')
    const identity = { sessionId: session.sessionId, epoch: session.epoch, characterId: session.characterId, serverInstance: session.serverInstance }
    const context = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: project.projectId, expectedRevision: project.revision, command: 'app3.context.get', args: identity })
    const expectedAnimationRevision = String((context.result.context as Record<string, unknown> | undefined)?.revision ?? '')
    if (!expectedAnimationRevision) throw new Error('Animation Studio has no current revision')
    await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: project.projectId, expectedRevision: project.revision, command: 'app3.command.submit', args: { ...identity, tool: 'libraryActionOpen', parameters: { actionUuid }, expectedAnimationRevision } })
  }

  saveDocument?: (documentId: string, doc: DirectorDocument) => Promise<void> = async (documentId, doc) => {
    const res = await fetch(`${this.base}/${documentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) })
    if (!res.ok) throw new Error(translateStudio('保存失败: HTTP {{status}}', { status: res.status }))
  }

  saveFCurves?: (documentId: string, data: unknown) => Promise<void> = async (documentId, data) => {
    const res = await fetch(`${this.base}/${documentId}/fcurves`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (!res.ok) throw new Error(translateStudio('关键帧保存失败: HTTP {{status}}', { status: res.status }))
  }

  async loadFCurves(documentId: string): Promise<unknown | null> {
    if (this.base === '/api/unified/projects') {
      const project = this.projects.get(documentId) ?? (await loadUnifiedProject(documentId)).project
      this.projects.set(documentId, project)
      return project.extensions.topview?.fcurves ?? null
    }
    try { return await fetchJson(`${this.base}/${documentId}/fcurves`) } catch { return null }
  }

  resolveAssetUrl(key: string): string {
    const trimmed = key.trim()
    if (trimmed.startsWith(`${LOCAL_ASSET_ROUTE}/`) || trimmed.startsWith('/api/unified/projects/') || trimmed.startsWith('/api/library?modelCharacter=')) return trimmed
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    const normalized = normalizeAssetKey(trimmed)
    if (!normalized) throw new Error(translateStudio('素材 key 为空'))
    return keyUrl(normalized)
  }

  resolveMediaUrl(ref: MediaRef): string {
    // character 的 sourcePath 是 'user' / 'base' 这类枚举，不是路径。
    const raw = (ref.sourceUrl || (ref.kind === 'character' ? '' : ref.sourcePath) || '').trim()
    if (!raw) throw new Error(`unable to resolve media ref kind=${ref.kind}`)
    return this.resolveAssetUrl(raw)
  }

  async searchAssets(query: AssetQuery): Promise<AssetPage<CharacterLibEntry | PropLibEntry | MotionLibEntry | PoseLibEntry>> {
    const empty = { items: [], total: 0, pageNo: query.pageNo, pageSize: query.pageSize }
    // 本地素材清单没有动作（motion）类型；返回空列表，面板显示「未安装动作」。
    if (query.kind === 'motion') return empty
    const params = new URLSearchParams({ kind: query.kind, pageNo: String(query.pageNo), pageSize: String(query.pageSize) })
    if (query.keyword) params.set('keyword', query.keyword)
    if (query.category) params.set('category', query.category)
    query.tags?.forEach((tag) => params.append('tags', tag))
    try {
      return (await fetchJsonOnce(`${LOCAL_ASSET_ROUTE}/search?${params}`)) as AssetPage<CharacterLibEntry | PropLibEntry | PoseLibEntry>
    } catch (error) {
      console.warn('[studio] local asset search failed', error)
      return empty
    }
  }

  async loadPoseById(poseId: string): Promise<PoseBonesPayload | null> {
    // 内置预设（如 stand）不在素材清单里，查不到就交回 builder 用自带数据。
    const page = await this.searchAssets({ kind: 'pose', pageNo: 1, pageSize: 500 })
    const shortId = poseId.startsWith('a3d_pose_') ? poseId.slice('a3d_pose_'.length) : poseId
    const entry = (page.items as PoseLibEntry[]).find((item) => item.id === shortId)
    return entry?.modelUrl ? this.loadPoseAsset(entry.modelUrl) : null
  }

  async loadPoseAsset(modelUrl: string): Promise<PoseBonesPayload | null> {
    let payload: unknown
    try {
      payload = await fetchPoseJson(this.resolveAssetUrl(modelUrl))
    } catch {
      return null
    }
    if (!isRecord(payload) || !Array.isArray(payload.hips) || !isRecord(payload.bones)) return null
    const hips = payload.hips
    if (hips.length !== 3 || hips.some((value) => typeof value !== 'number')) return null
    return {
      poseId: readString(payload.pose_id) ?? undefined,
      hips: [hips[0], hips[1], hips[2]],
      bones: payload.bones as PoseBonesPayload['bones'],
    }
  }

  topviewCanvasLoginUrl = (): string => '/api/topview-canvas/login?return=/api/topview-canvas/done'

  async topviewCanvasAuthorized(): Promise<boolean> {
    const body = await canvasJson('/api/topview-canvas/status')
    return isRecord(body) && body.authorized === true
  }

  async listTopviewCanvases(): Promise<TopviewCanvasSummary[]> {
    const body = await canvasJson('/api/topview-canvas/canvases')
    const rows = isRecord(body) && Array.isArray(body.canvases) ? body.canvases : []
    return rows.flatMap((row) => {
      if (!isRecord(row) || typeof row.id !== 'string') return []
      return [{ id: row.id, name: typeof row.name === 'string' ? row.name : row.id }]
    })
  }

  async createTopviewCanvas(name: string): Promise<TopviewCanvasSummary> {
    const body = await canvasJson('/api/topview-canvas/canvases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const canvas = isRecord(body) ? body.canvas : null
    if (!isRecord(canvas) || typeof canvas.id !== 'string') throw new Error(translateStudio('新建 Canvas 失败'))
    return { id: canvas.id, name: typeof canvas.name === 'string' ? canvas.name : name }
  }

  async uploadToTopviewCanvas(
    canvasId: string,
    blob: Blob,
    meta: ExportMeta,
    signal?: AbortSignal,
  ): Promise<{ canvasUrl?: string }> {
    const form = new FormData()
    form.set('canvasId', canvasId)
    form.set('file', new File([blob], meta.filename, { type: meta.mimeType }))
    const body = await canvasJson('/api/topview-canvas/upload', { method: 'POST', body: form, signal })
    return { canvasUrl: isRecord(body) && typeof body.canvasUrl === 'string' ? body.canvasUrl : undefined }
  }

  async listAssetFacets(kind: AssetQuery['kind']): Promise<AssetFacets> {
    if (kind === 'motion') return { categories: [], tags: [] }
    try {
      return (await fetchJsonOnce(`${LOCAL_ASSET_ROUTE}/facets?kind=${encodeURIComponent(kind)}`)) as AssetFacets
    } catch (error) {
      console.warn('[studio] local asset facets failed', error)
      return { categories: [], tags: [] }
    }
  }
}
