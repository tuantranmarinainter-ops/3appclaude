'use client'

import { useCallback, useEffect, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import type { AudioCue, AudioCueKind } from '../../../../src/audioCues'
import { loadUnifiedProject, sendUnifiedCommand } from '../../../../src/unifiedApi'
import { getLiveStudio } from '../../../../src/devtools/liveStudio'
import { useStudioLocale } from '../../../../src/devtools/localePreference'

const AUDIO_MEDIA = ['audio/wav', 'audio/mpeg', 'audio/ogg']

/** B16 audio lane editor: voice / SFX / music cues on imported audio assets, placed at the current frame. */
export function AudioCueHost({ projectId, project: initial, active }: { projectId: string; project: UnifiedProject; active: boolean }) {
  const vi = useStudioLocale() === 'vi'
  const [project, setProject] = useState(initial)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ assetId: '', kind: 'voice' as AudioCueKind, gainDb: 0, speaker: '', text: '' })
  const refresh = useCallback(async () => setProject((await loadUnifiedProject(projectId)).project), [projectId])
  useEffect(() => {
    if (!active) return
    void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    const onCommit = (event: Event) => { if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) void refresh() }
    window.addEventListener('bbs-unified-project-commit', onCommit)
    return () => window.removeEventListener('bbs-unified-project-commit', onCommit)
  }, [active, projectId, refresh])
  const assets = Object.values(project.assets).filter((asset) => AUDIO_MEDIA.includes(asset.source.mediaType))
  const raw = (project.extensions as { audioCues?: { cues?: unknown } }).audioCues?.cues
  const cues = (Array.isArray(raw) ? raw as AudioCue[] : []).slice().sort((a, b) => a.frameStart - b.frameStart)
  const name = (assetId: string) => project.assets[assetId as keyof UnifiedProject['assets']]?.displayName ?? assetId
  const mutate = async (command: 'audio.cue.add' | 'audio.cue.remove', args: Record<string, unknown>) => {
    try {
      await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: project.revision, command, args })
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const add = () => {
    const frameStart = Math.round(getLiveStudio()?.stage.currentFrame ?? project.scene.content.timeline.frameStart)
    void mutate('audio.cue.add', { cue: { kind: form.kind, assetId: form.assetId || assets[0]?.id, frameStart, gainDb: form.gainDb,
      ...(form.speaker.trim() ? { speaker: form.speaker.trim() } : {}), ...(form.text.trim() ? { text: form.text.trim() } : {}) } })
  }
  return (
    <section className="wb-audio-cues" aria-label={vi ? 'Thoại và âm thanh' : 'Voice and sound'}>
      {!assets.length && <p>{vi ? 'Chưa có file âm thanh. Nhập WAV/MP3/OGG qua nút Tài nguyên.' : 'No audio yet. Import WAV/MP3/OGG with Assets.'}</p>}
      {!!assets.length && <div className="wb-audio-form">
        <select value={form.assetId} onChange={(event) => setForm({ ...form, assetId: event.target.value })} aria-label={vi ? 'File âm thanh' : 'Audio file'}>
          {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}
        </select>
        <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as AudioCueKind })} aria-label={vi ? 'Loại' : 'Kind'}>
          <option value="voice">{vi ? 'Thoại' : 'Voice'}</option><option value="sfx">SFX</option><option value="music">{vi ? 'Nhạc' : 'Music'}</option>
        </select>
        <label>dB <input type="number" min={-60} max={24} step={1} value={form.gainDb} onChange={(event) => setForm({ ...form, gainDb: Number(event.target.value) })} /></label>
        <input placeholder={vi ? 'Người nói' : 'Speaker'} value={form.speaker} onChange={(event) => setForm({ ...form, speaker: event.target.value })} />
        <input placeholder={vi ? 'Phụ đề' : 'Subtitle'} value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} />
        <button type="button" onClick={add}>{vi ? 'Thêm tại frame hiện tại' : 'Add at current frame'}</button>
      </div>}
      {error && <p role="alert">{error}</p>}
      <ul>
        {cues.map((cue) => <li key={cue.id}>
          <span>{cue.frameStart} · {cue.kind} · {name(cue.assetId)} · {cue.gainDb} dB{cue.speaker ? ` · ${cue.speaker}` : ''}{cue.text ? ` · "${cue.text}"` : ''}</span>
          <button type="button" onClick={() => void mutate('audio.cue.remove', { id: cue.id })}>{vi ? 'Xoá' : 'Remove'}</button>
        </li>)}
      </ul>
      <a href={`/api/unified/projects/${projectId}/audio-mixdown`} download="mix.wav">{vi ? 'Tải bản trộn tiếng (WAV)' : 'Download mixdown (WAV)'}</a>
    </section>
  )
}

/** Voice subtitle under the viewport while the playhead is inside a voice cue. */
export function AudioSubtitle({ cue }: { cue: AudioCue | null }) {
  if (!cue?.text) return null
  return <div className="wb-audio-subtitle" role="status"><strong>{cue.speaker ? `${cue.speaker}: ` : ''}</strong>{cue.text}</div>
}
