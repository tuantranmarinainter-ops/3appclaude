'use client'

import { useEffect, useRef, useState } from 'react'
import { previewPlaybackAction, shouldLoadPreview } from '../../src/libraryPreviewUtils'
const active = new Set<HTMLVideoElement>()
const MAX_ACTIVE = 40

export function AutoPreviewVideo({ uuid, onClick }: { uuid: string; onClick: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [near, setNear] = useState(false), [visible, setVisible] = useState(false)
  useEffect(() => {
    const video = ref.current; if (!video) return
    const lazyObserver = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '320px' })
    const visibleObserver = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '0px' })
    lazyObserver.observe(video); visibleObserver.observe(video); return () => { lazyObserver.disconnect(); visibleObserver.disconnect(); video.pause(); video.removeAttribute('src'); video.load(); active.delete(video) }
  }, [])
  useEffect(() => {
    const video = ref.current; if (!video) return
    if (!shouldLoadPreview(near, true)) { video.pause(); video.removeAttribute('src'); video.load(); active.delete(video); return }
    if (!video.src) { video.src = `/api/library/video/${encodeURIComponent(uuid)}`; video.load() }
    if (previewPlaybackAction(visible) === 'play') {
      active.add(video)
      while (active.size > MAX_ACTIVE) { const oldest = active.values().next().value as HTMLVideoElement | undefined; if (!oldest) break; oldest.pause(); oldest.removeAttribute('src'); oldest.load(); active.delete(oldest) }
      void video.play().catch(() => undefined)
    } else { video.pause(); active.delete(video) }
    return () => { video.pause(); active.delete(video) }
  }, [near, uuid, visible])
  return <button type="button" aria-label="Mở xem động tác" onClick={onClick} style={{ display: 'block', width: '100%', height: 120, padding: 0, border: 0, background: '#171a20', cursor: 'pointer' }}>
    <video ref={ref} muted loop playsInline preload="none" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
  </button>
}
