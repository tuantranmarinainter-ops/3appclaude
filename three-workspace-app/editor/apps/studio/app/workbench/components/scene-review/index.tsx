'use client'

import { useMemo, useState } from 'react'
import { useStudioLocale } from '../../../../src/devtools/localePreference'
import type { SceneReviewStatus } from '../../../../src/sceneReview'
import type { SceneReviewClip, SceneReviewFilter } from './types'
import styles from './scene-review.module.css'

export function SceneReviewPanel({
  clips,
  images,
  onSet,
  onPlay,
  onCapture,
}: {
  clips: SceneReviewClip[]
  images: Record<string, string[]>
  onSet: (clipId: string, status: SceneReviewStatus, note: string) => void
  onPlay: (clipId: string) => void
  onCapture?: (clipId: string, frames: number[]) => void
}) {
  const vi = useStudioLocale() === 'vi'
  const [filter, setFilter] = useState<SceneReviewFilter>('pending')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const visible = useMemo(() => filter === 'all' ? clips : clips.filter((clip) => clip.status === filter), [clips, filter])
  const approved = clips.filter((clip) => clip.status === 'ok').length
  const labels: Record<SceneReviewFilter, string> = vi
    ? { pending: 'Chưa duyệt', note: 'Có ghi chú', ok: 'Đạt', all: 'Tất cả' }
    : { pending: 'Pending', note: 'Has notes', ok: 'Approved', all: 'All' }

  return (
    <section className={styles.panel} aria-labelledby="wb-scene-review-title">
      <header className={styles.header}>
        <div><h2 id="wb-scene-review-title">{vi ? 'Duyệt cảnh' : 'Scene review'}</h2><p>{vi ? `${approved}/${clips.length} cảnh đạt` : `${approved}/${clips.length} shots approved`}</p></div>
        <nav aria-label={vi ? 'Lọc cảnh' : 'Filter shots'}>
          {(['pending', 'note', 'ok', 'all'] as const).map((item) => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>{labels[item]}</button>)}
        </nav>
      </header>
      {!visible.length && <p role="status">{vi ? 'Không có cảnh trong bộ lọc này.' : 'No shots match this filter.'}</p>}
      <div className={styles.list}>
        {visible.map((clip) => {
          const frames = images[clip.id] ?? []
          const note = notes[clip.id] ?? clip.note
          return <article className={styles.shot} key={clip.id}>
            <div className={styles.shotHeading}><h3>{clip.name}</h3><span>{clip.frameStart}–{clip.frameEnd}</span><span className={styles[clip.status]}>{labels[clip.status]}</span></div>
            <div className={styles.images}>
              {[0, 1, 2].map((index) => frames[index]
                ? <figure key={index}><img src={frames[index]} alt={`${clip.name} ${vi ? 'khung' : 'frame'} ${index + 1}`} /></figure>
                : <div className={styles.imageEmpty} key={index}>{vi ? 'Chưa chụp' : 'Not captured'}</div>)}
            </div>
            <label className={styles.note}>{vi ? 'Ghi chú' : 'Notes'}
              <textarea maxLength={2000} value={note} onChange={(event) => setNotes((current) => ({ ...current, [clip.id]: event.target.value }))} />
            </label>
            <div className={styles.actions}>
              <button type="button" onClick={() => onSet(clip.id, 'ok', note)}>{vi ? 'Đạt' : 'Approve'}</button>
              <button type="button" onClick={() => onSet(clip.id, 'note', note)}>{vi ? 'Lưu ghi chú' : 'Save note'}</button>
              <button type="button" onClick={() => onPlay(clip.id)}>{vi ? 'Phát cảnh này' : 'Play this shot'}</button>
              <button type="button" disabled={!onCapture} title={!onCapture ? (vi ? 'Chụp ảnh chưa sẵn sàng.' : 'Image capture is not available yet.') : undefined} onClick={() => onCapture?.(clip.id, clip.frames)}>{vi ? 'Chụp lại' : 'Capture again'}</button>
            </div>
          </article>
        })}
      </div>
    </section>
  )
}
