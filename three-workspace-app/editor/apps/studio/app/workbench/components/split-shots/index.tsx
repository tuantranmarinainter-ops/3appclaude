'use client'

import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { useSplitShots } from './hooks/useSplitShots'

/** Studio owns project creation and episode packaging; the embedded editor stays single-document. */
export function SplitShotsPanel({ project }: { project: UnifiedProject }) {
  const { shots, selected, setSelected, episodeName, setEpisodeName, busy, error, reports, job, episode, split, exportEpisode } = useSplitShots(project)
  return <details className="wb-host-more">
    <summary>Tách shot thành project</summary>
    <div className="wb-host-more-menu" style={{ maxHeight: '70vh', overflow: 'auto', minWidth: 280 }}>
      <p>Mỗi shot thành dự án nhẹ riêng. Dự án gốc được giữ nguyên; tài nguyên dùng chung.</p>
      <label>Tên tập <input value={episodeName} onChange={(event) => setEpisodeName(event.target.value)} maxLength={100} disabled={busy} /></label>
      <button type="button" onClick={() => setSelected(selected.length === shots.length ? [] : shots.map((shot) => shot.id))} disabled={busy}>{selected.length === shots.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</button>
      {shots.map((shot, index) => <label key={shot.id} style={{ display: 'block' }}><input type="checkbox" checked={selected.includes(shot.id)} disabled={busy} onChange={(event) => setSelected((current) => event.target.checked ? [...current, shot.id] : current.filter((id) => id !== shot.id))} /> Shot {String(index + 1).padStart(2, '0')} · {shot.sourceFrameStart}–{shot.sourceFrameEnd}</label>)}
      <button type="button" disabled={busy || !selected.length || !episodeName.trim()} onClick={() => void split()}>{busy ? 'Đang xử lý…' : `Tách ${selected.length} shot thành project`}</button>
      {reports.length > 0 && <div role="status">{reports.map((report) => <div key={report.projectId}><a href={`?unified=${report.projectId}`}>{report.name}</a><p>{report.nodeCount} nút · {report.clipCount} clip · {Math.ceil(report.manifestBytes / 1024)} KB dữ liệu · khung {report.range.startFrame}–{report.range.endFrame}</p>{report.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>)}</div>}
      {episode && <button type="button" disabled={busy || !!job && ['queued', 'running'].includes(job.state)} onClick={() => void exportEpisode()}>Xuất cả tập {episode.name}</button>}
      {job && <div role="status">{job.state === 'succeeded' ? 'Đã xuất tập' : job.state === 'failed' ? job.error?.message : `Đang xuất tập… ${Math.round(job.progress * 100)}%`}{job.result?.files.map((file) => <a key={file.id} href={`/api/unified/projects/${project.projectId}/jobs/${job.jobId}/files/${file.id}`} download={file.name}>{file.name}</a>)}</div>}
      {error && <p role="alert">{error}</p>}
    </div>
  </details>
}
