'use client'

import { useEffect, useMemo, useState } from 'react'
import { defaultReverseRetargetSettings, parseBobjActions, type BobjAction, type ReverseRetargetSettings } from '@bbs/retarget'
import { useStudioLocale } from '../../../src/devtools/localePreference'
import { MinecraftActionPreview } from './MinecraftActionPreview'
import { RetargetPreview, type ActiveRetargetMapping, type RetargetReferencePose } from './RetargetPreview'
import { RetargetSessionPanel } from './RetargetSessionPanel'
import { SkeletonMappingEditor } from './SkeletonMappingEditor'
import { NormalizationPanel } from './normalization'

interface ActionRow {
  name: string
  category: string
  max_time: number
  seconds: number
  keyframes: number
  bones: string[]
}

interface ActionCatalog {
  action_count: number
  actions: ActionRow[]
}

interface ActionNames {
  actions: Record<string, { en?: string; vi?: string }>
}

function isCatalog(value: unknown): value is ActionCatalog {
  if (!value || typeof value !== 'object') return false
  const candidate = value as ActionCatalog
  return candidate.action_count === 85 && Array.isArray(candidate.actions) && candidate.actions.length === 85 &&
    candidate.actions.every((action) => typeof action.name === 'string' && typeof action.category === 'string' &&
      Number.isFinite(action.max_time) && Number.isFinite(action.seconds) && Number.isFinite(action.keyframes) && Array.isArray(action.bones) &&
      action.bones.every((bone) => typeof bone === 'string')) &&
    new Set(candidate.actions.map((action) => action.name)).size === 85
}

function isActionNames(value: unknown): value is ActionNames {
  if (!value || typeof value !== 'object' || !('actions' in value)) return false
  const actions = (value as ActionNames).actions
  return !!actions && typeof actions === 'object' && !Array.isArray(actions) && Object.keys(actions).length === 85 &&
    Object.values(actions).every((label) => !!label && typeof label.en === 'string' && typeof label.vi === 'string')
}

function summarize(action: BobjAction): { bones: number; channels: number; keyframes: number } {
  const groups = [...action.groups.values()]
  const channels = groups.flatMap((group) => group.channels)
  return {
    bones: groups.length,
    channels: channels.length,
    keyframes: channels.reduce((count, channel) => count + channel.keys.length, 0),
  }
}

export function RetargetWorkspace({ projectId, active = true }: { projectId: string; active?: boolean }) {
  const locale = useStudioLocale()
  const vi = locale === 'vi'
  const [catalog, setCatalog] = useState<ActionCatalog | null>(null)
  const [names, setNames] = useState<ActionNames | null>(null)
  const [selectedName, setSelectedName] = useState('')
  const [query, setQuery] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState<Map<string, BobjAction> | null>(null)
  const [calibrationSettings, setCalibrationSettings] = useState<ReverseRetargetSettings>(() => ({ ...defaultReverseRetargetSettings }))
  const [activeMapping, setActiveMapping] = useState<ActiveRetargetMapping | null>(null)
  const [sourceReferencePose, setSourceReferencePose] = useState<RetargetReferencePose | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      fetch('/retarget/v9.12/action_manifest.json', { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error(`Catalogue HTTP ${response.status}`)
        return response.json() as Promise<unknown>
      }),
      fetch('/retarget/v9.12/action_names_i18n.json', { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error(`Names HTTP ${response.status}`)
        return response.json() as Promise<unknown>
      }),
    ]).then(([rawCatalog, rawNames]) => {
      if (!isCatalog(rawCatalog) || !isActionNames(rawNames) || rawCatalog.actions.some((action) => !Object.hasOwn(rawNames.actions, action.name))) {
        throw new Error('Retarget V9.12 catalogue is invalid')
      }
      setCatalog(rawCatalog)
      setNames(rawNames)
      setSelectedName(rawCatalog.actions[0].name)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setCatalogError(error instanceof Error ? error.message : String(error))
    })
    return () => controller.abort()
  }, [])

  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase()
    if (!catalog) return []
    return catalog.actions.filter((action) => {
      const label = names?.actions[action.name]?.[vi ? 'vi' : 'en'] ?? action.name
      return !value || `${action.name} ${label} ${action.category}`.toLocaleLowerCase().includes(value)
    })
  }, [catalog, names, query, vi])

  const selected = catalog?.actions.find((action) => action.name === selectedName) ?? null
  const parsed = selectedName ? loaded?.get(selectedName) ?? null : null
  const stats = parsed ? summarize(parsed) : null

  async function loadBobj() {
    if (loading) return
    setLoading(true)
    setLoadError('')
    try {
      const response = await fetch('/retarget/v9.12/minecraft-actions.bobj')
      if (!response.ok) throw new Error(`BOBJ HTTP ${response.status}`)
      const actions = parseBobjActions(await response.text())
      if (!catalog || actions.size !== catalog.action_count || catalog.actions.some((action) => !actions.has(action.name))) {
        throw new Error('BOBJ data does not match the 85-action catalogue')
      }
      setLoaded(actions)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="wb-retarget" aria-labelledby="wb-retarget-title" hidden={!active}>
      <header className="wb-retarget-header">
        <div>
          <h1 id="wb-retarget-title">{vi ? 'Chuẩn hóa rig và animation' : 'Standardize rig and animation'}</h1>
          <p>{vi ? 'Chọn FBX, xem trước và lưu nguồn vào dự án. Rig đích: Minecraft20.' : 'Choose an FBX, preview it, and save the source to the project. Target rig: Minecraft20.'}</p>
        </div>
        <span className="wb-retarget-source">{vi ? 'Mixamo65 → Minecraft20' : 'Mixamo65 → Minecraft20'}</span>
      </header>
      <div className="wb-retarget-workarea">
          <section className="wb-retarget-library" aria-label={vi ? 'Thư viện animation BOBJ' : 'BOBJ animation library'}>
            <h2>{vi ? 'Thư viện BOBJ · 85' : 'BOBJ library · 85'}</h2>
            {catalogError ? <p className="wb-retarget-error" role="alert">{catalogError}</p> : !catalog ? <p role="status">{vi ? 'Đang đọc thư viện animation…' : 'Loading animation library…'}</p> : <>
            <label className="wb-retarget-search">
              <span>{vi ? 'Tìm animation' : 'Search actions'}</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={vi ? 'Tên hoặc nhóm' : 'Name or category'} />
            </label>
            <p className="wb-retarget-count">{filtered.length} / {catalog.action_count}</p>
            <div className="wb-retarget-list">
              {filtered.map((action) => {
                const label = names?.actions[action.name]?.[vi ? 'vi' : 'en'] ?? action.name
                return <button key={action.name} type="button" className={selectedName === action.name ? 'is-active' : ''} aria-pressed={selectedName === action.name} onClick={() => setSelectedName(action.name)}>
                  <span>{label}</span><small>{action.seconds.toFixed(2)} s</small>
                </button>
              })}
              {filtered.length === 0 && <p role="status">{vi ? 'Không có kết quả.' : 'No matching actions.'}</p>}
            </div>
            </>}
          </section>
          <div className="wb-retarget-preview-column">
            <RetargetPreview projectId={projectId} calibrationSettings={calibrationSettings} active={active} activeMapping={activeMapping} sourceReferencePose={sourceReferencePose} onCalibrationChange={setCalibrationSettings} />
          </div>
          <aside className="wb-retarget-settings" aria-label={vi ? 'Thiết lập nâng cao' : 'Advanced settings'}>
            <NormalizationPanel projectId={projectId} />
            <SkeletonMappingEditor projectId={projectId} calibrationSettings={calibrationSettings} onCalibrationLoad={setCalibrationSettings} onActiveMappingChange={setActiveMapping} />
            <details className="wb-retarget-settings-group"><summary>{vi ? 'Session retarget V9.12' : 'V9.12 retarget session'}</summary><RetargetSessionPanel projectId={projectId} onReferencePoseChange={setSourceReferencePose} /></details>
            <details className="wb-retarget-settings-group wb-retarget-action-details"><summary>{vi ? 'Chi tiết animation đã chọn' : 'Selected animation details'}</summary><section className="wb-retarget-detail" aria-label={vi ? 'Chi tiết animation' : 'Action details'}>
            {selected ? <>
              <div>
                <p className="wb-retarget-kicker">{selected.category}</p>
                <h2>{names?.actions[selected.name]?.[vi ? 'vi' : 'en'] ?? selected.name}</h2>
                <code>{selected.name}</code>
              </div>
              <dl>
                <div><dt>{vi ? 'Thời lượng' : 'Duration'}</dt><dd>{selected.seconds.toFixed(2)} s · {selected.max_time.toFixed(2)} ticks</dd></div>
                <div><dt>{vi ? 'Xương hoạt động' : 'Animated bones'}</dt><dd>{selected.bones.join(', ') || '—'}</dd></div>
                <div><dt>{vi ? 'Keyframe theo nguồn' : 'Source keyframes'}</dt><dd>{selected.keyframes.toLocaleString()}</dd></div>
              </dl>
              <button type="button" className="wb-retarget-load" onClick={() => void loadBobj()} disabled={loading || !!loaded}>
                {loaded ? (vi ? 'Đã nạp dữ liệu BOBJ' : 'BOBJ data loaded') : loading ? (vi ? 'Đang nạp…' : 'Loading…') : (vi ? 'Nạp và xem trước BOBJ' : 'Load and preview BOBJ')}
              </button>
              {loadError && <p className="wb-retarget-error" role="alert">{loadError}</p>}
              {stats && <div className="wb-retarget-inspection" role="status">
                <strong>{vi ? 'Dữ liệu clip đã phân tích' : 'Parsed clip data'}</strong>
                <span>{stats.bones} {vi ? 'xương' : 'bones'} · {stats.channels} {vi ? 'kênh' : 'channels'} · {stats.keyframes.toLocaleString()} keys · {parsed?.durationTicks.toFixed(2)} ticks</span>
                <small>{vi ? 'Preview Mixamo65→Minecraft20 dùng mapping tương thích; session V9.12 lưu riêng project JSON. Bake/export chưa nối.' : 'Compatible Mixamo65→Minecraft20 previews use saved mappings; V9.12 sessions preserve project JSON separately. Bake/export are not connected.'}</small>
              </div>}
              {parsed && <MinecraftActionPreview key={selectedName} action={parsed} />}
            </> : <p>{vi ? 'Chọn một animation.' : 'Select an action.'}</p>}
            </section></details>
          </aside>
      </div>
    </section>
  )
}
