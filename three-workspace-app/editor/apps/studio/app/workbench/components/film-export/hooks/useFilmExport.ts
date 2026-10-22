import { useEffect, useMemo, useRef, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { loadUnifiedJob, sendUnifiedCommand, type UnifiedJobView } from '../../../../../src/unifiedApi'
import { chooseDirectory, saveJob } from '../../scene-render/utils'
import { useStudioLocale } from '../../../../../src/devtools/localePreference'
import { readFilmFrameAspect } from '../../../../../src/filmFrame'
import type { FilmPreflightIssue, FilmPreflightResult } from '../../../../../src/filmPreflight'

function isSeriesJob(job: UnifiedJobView): boolean { return typeof job.result?.provenance.segmentCount === 'number' }

export function useFilmExport(project: UnifiedProject) {
  const vi = useStudioLocale() === 'vi'
  const characters = Object.values(project.characters)
  const props = project.scene.content.nodes.filter((node) => node.type === 'prop' && typeof node.metadata?.assetId === 'string')
  const sequences = project.scene.content.editorial?.sequences ?? []
  const [content, setContent] = useState<'characters' | 'backdrops' | 'both'>('characters')
  const [characterIds, setCharacterIds] = useState<string[]>(characters[0] ? [characters[0].id] : [])
  const [propIds, setPropIds] = useState<string[]>(props.map((node) => node.id))
  const [sequenceId, setSequenceId] = useState(project.scene.content.editorial?.activeSequenceId ?? sequences[0]?.id ?? '')
  const [exportMode, setExportMode] = useState<'film' | 'series'>('film')
  const [startFrame, setStartFrame] = useState(project.scene.content.timeline.frameStart)
  const [endFrame, setEndFrame] = useState(project.scene.content.timeline.frameEnd)
  const [viewportAspectOverride, setViewportAspectOverride] = useState<number | undefined>(undefined)
  const viewportAspect = viewportAspectOverride ?? readFilmFrameAspect(project.extensions)
  const [filmName, setFilmName] = useState(project.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 64) || 'project-film')
  const [busy, setBusy] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [completedJob, setCompletedJob] = useState<UnifiedJobView | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [preflight, setPreflight] = useState<FilmPreflightResult | null>(null)
  const [preflightRevision, setPreflightRevision] = useState<number | null>(null)
  const [preflightKey, setPreflightKey] = useState<string | null>(null)
  const [checkingPreflight, setCheckingPreflight] = useState(false)
  const preflightGeneration = useRef(0)

  const selectionArgs = useMemo(() => {
    const range = { startFrame, endFrame }
    if (exportMode === 'series') return { characterIds, sequenceId, range, viewportAspect }
    if (content === 'characters') return { characterIds, sequenceId, range, viewportAspect }
    return { content, characterIds: content === 'backdrops' ? [] : characterIds, propIds, sequenceId, range, viewportAspect }
  }, [exportMode, content, characterIds, propIds, sequenceId, startFrame, endFrame, viewportAspect])
  const currentKey = JSON.stringify({ projectId: project.projectId, revision: project.revision, ...selectionArgs })
  const latestKey = useRef(currentKey)
  latestKey.current = currentKey
  const passedKey = useRef<string | null>(null)
  useEffect(() => {
    const revision = project.revision
    const generation = ++preflightGeneration.current
    let cancelled = false
    const args = selectionArgs
    const requestKey = currentKey
    setPreflight(null); setPreflightRevision(null); setPreflightKey(null); passedKey.current = null; setCheckingPreflight(true)
    const timer = setTimeout(() => {
      void sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: project.projectId, expectedRevision: revision,
        command: 'film.preflight', args }).then((response) => {
        if (cancelled || generation !== preflightGeneration.current || response.revision !== revision || response.result.sourceRevision !== revision) return
        setPreflight(response.result.preflight as FilmPreflightResult)
        setPreflightRevision(revision)
        setPreflightKey(requestKey)
        passedKey.current = requestKey
      }).catch((cause) => {
        if (cancelled || generation !== preflightGeneration.current) return
        const message = cause instanceof Error ? cause.message : String(cause)
        const failure: FilmPreflightIssue = { code: 'PREFLIGHT_FAILED', message: { vi: message, en: message } }
        setPreflight({ errors: [failure], warnings: [] })
        setPreflightRevision(revision)
        setPreflightKey(requestKey)
      }).finally(() => {
        if (!cancelled && generation === preflightGeneration.current) setCheckingPreflight(false)
      })
    }, 250)
    return () => { clearTimeout(timer); cancelled = true }
  }, [project.projectId, project.revision, selectionArgs, currentKey])

  // The whole-range preflight enforces single-Film limits (ticks, cameras, bones) that a series splits around; the series job
  // validates every segment itself. TODO(B10/B11 follow-up): run the preflight per planned segment instead.
  const canExport = exportMode === 'series' ? !busy && characterIds.length > 0 : !busy && !checkingPreflight && preflightRevision === project.revision &&
    preflightKey === currentKey && passedKey.current === currentKey && !!preflight && preflight.errors.length === 0

  const saveAgain = async (job: UnifiedJobView) => {
    setBusy(true); setError('')
    try {
      const directory = await chooseDirectory()
      await saveJob(project.projectId, job, directory, isSeriesJob(job) ? 'film-series' : 'film')
      setStatus(vi ? `Đã lưu gói ${isSeriesJob(job) ? 'cả tập' : 'Film'} · revision ${job.sourceRevision}` : `Saved ${isSeriesJob(job) ? 'episode' : 'Film'} package · revision ${job.sourceRevision}`)
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const exportFilm = async () => {
    if (busy) return
    if (!canExport) { setError(vi ? 'Kiểm tra trước khi xuất chưa đạt cho lựa chọn hiện tại.' : 'Preflight has not passed for the current selection.'); return }
    const exportKey = currentKey
    const sourceRevision = project.revision
    if (exportMode === 'series' || content !== 'backdrops') {
      if (!characterIds.length || new Set(characterIds).size !== characterIds.length || characterIds.some((id) => !project.characters[id])) { setError(vi ? 'Chọn ít nhất một nhân vật hợp lệ.' : 'Choose at least one valid character.'); return }
    }
    if (exportMode === 'film' && content !== 'characters' && (!propIds.length || new Set(propIds).size !== propIds.length || propIds.some((id) => !props.some((node) => node.id === id)))) {
      setError(vi ? 'Chọn ít nhất một hậu cảnh hợp lệ.' : 'Choose at least one valid backdrop.'); return
    }
    if (exportMode === 'film' && content !== 'characters') {
      setError(vi ? 'Máy chủ chưa nhận chế độ nội dung cho Film export.' : 'The server Film export contract does not yet accept content modes.'); return
    }
    if (!sequences.some((sequence) => sequence.id === sequenceId)) { setError(vi ? 'Chọn chuỗi camera có trong dự án.' : 'Choose a camera sequence in the project.'); return }
    if (exportMode === 'film' && (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || startFrame < project.scene.content.timeline.frameStart || endFrame > project.scene.content.timeline.frameEnd || endFrame < startFrame)) { setError(vi ? 'Khoảng frame phải nằm trong timeline dự án.' : 'The frame range must fit within the project timeline.'); return }
    const maxNameLength = exportMode === 'series' ? 56 : 64
    if (!Number.isFinite(viewportAspect) || viewportAspect <= 0 || filmName.length > maxNameLength || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filmName) || filmName.endsWith('.')) { setError(vi ? `Aspect phải dương; tên gói cần 1–${maxNameLength} ký tự ASCII an toàn và không kết thúc bằng dấu chấm.` : `Aspect must be positive; the package name needs 1–${maxNameLength} safe ASCII characters and cannot end with a period.`); return }
    setBusy(true); setError(''); setCompletedJob(null); setStatus(vi ? 'Chọn thư mục lưu ZIP…' : 'Choose a folder for the ZIP…')
    try {
      const directory = await chooseDirectory()
      if (latestKey.current !== exportKey || (exportMode !== 'series' && passedKey.current !== exportKey) || project.revision !== sourceRevision) {
        throw new Error(vi ? 'Lựa chọn đã thay đổi trong lúc chọn thư mục; hãy đợi kiểm tra lại.' : 'The selection changed while choosing a folder; wait for preflight to finish again.')
      }
      const started = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: project.projectId, expectedRevision: project.revision,
        command: exportMode === 'series' ? 'scene.export.bbsFilmSeries' : 'film.export',
        args: exportMode === 'series' ? { characterIds, sequenceId, viewportAspect, name: filmName, content: 'characters' } : { characterIds, sequenceId, range: { startFrame, endFrame }, viewportAspect, filmName } })
      const jobId = String(started.result.jobId)
      setActiveJobId(jobId); setStatus(exportMode === 'series' ? (vi ? 'Đang chia đoạn và xuất cả tập…' : 'Segmenting and exporting episode…') : (vi ? 'Đang lấy mẫu và xuất Film…' : 'Sampling and exporting Film…'))
      let job = await loadUnifiedJob(project.projectId, jobId)
      for (let attempt = 0; attempt < 900 && (job.state === 'queued' || job.state === 'running'); attempt++) {
        setStatus(vi ? `Đang xuất Film · ${Math.round(job.progress * 100)}% · revision ${job.sourceRevision}` : `Exporting Film · ${Math.round(job.progress * 100)}% · revision ${job.sourceRevision}`)
        await new Promise((resolve) => setTimeout(resolve, 1000))
        job = await loadUnifiedJob(project.projectId, jobId)
      }
      if (job.state === 'queued' || job.state === 'running') {
        await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: project.projectId, command: 'job.cancel', args: { jobId } })
        throw new Error(vi ? 'Film export quá thời gian chờ; đã yêu cầu hủy tác vụ.' : 'Film export timed out; cancellation was requested.')
      }
      if (job.state !== 'succeeded') throw new Error(job.error?.message ?? `Film export kết thúc với trạng thái ${job.state}.`)
      setCompletedJob(job); setStatus(vi ? 'Xuất xong · đang lưu ZIP đã xác minh…' : 'Export complete · saving the verified ZIP…')
      const prefix = isSeriesJob(job) ? 'film-series' : 'film'
      await saveJob(project.projectId, job, directory, prefix)
      setStatus(vi ? `Đã lưu gói ${prefix === 'film-series' ? 'cả tập' : 'Film'} · revision ${job.sourceRevision}` : `Saved ${prefix === 'film-series' ? 'episode' : 'Film'} package · revision ${job.sourceRevision}`)
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('')
    } finally { setBusy(false); setActiveJobId(null) }
  }

  const cancel = async () => {
    if (!activeJobId) return
    try {
      await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: project.projectId, command: 'job.cancel', args: { jobId: activeJobId } })
      setStatus(vi ? 'Đã yêu cầu hủy Film export.' : 'Film export cancellation requested.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  return { characters, props, content, setContent, propIds, setPropIds, sequences, characterIds, setCharacterIds, sequenceId, setSequenceId, startFrame, setStartFrame, endFrame, setEndFrame, exportMode, setExportMode,
    viewportAspect, setViewportAspect: setViewportAspectOverride, filmName, setFilmName, busy, activeJobId, completedJob, status, error, exportFilm, cancel, saveAgain,
    preflight, checkingPreflight, canExport }
}
