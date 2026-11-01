'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { APP3_BRIDGE_CHANNEL as CHANNEL } from '../../../../../src/app3Embed'

/** App 2 owns the shared preference; local App 3 toggles do not push it back. */
export function useSilhouetteSync(frame: RefObject<HTMLIFrameElement>) {
  const enabled = useRef(false)
  useEffect(() => {
    const readCurrent = () => document.getElementById('wb-silhouette-toggle')?.getAttribute('aria-pressed') === 'true'
    enabled.current = readCurrent()
    const send = () => frame.current?.contentWindow?.postMessage({
      channel: CHANNEL, requestId: crypto.randomUUID(), type: 'view.silhouette.set', value: { enabled: enabled.current },
    }, location.origin)
    const receive = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail
      if (!detail || typeof detail !== 'object' || !('enabled' in detail) || typeof detail.enabled !== 'boolean') return
      enabled.current = detail.enabled
      send()
    }
    const ready = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== CHANNEL || event.data.type !== 'bridge-ready') return
      // Covers late mounting, iframe reloads and events emitted before bridge install.
      send()
    }
    window.addEventListener('bbs-view-silhouette', receive)
    window.addEventListener('message', ready)
    return () => {
      window.removeEventListener('bbs-view-silhouette', receive)
      window.removeEventListener('message', ready)
    }
  }, [frame])
}
