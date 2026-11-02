import React from 'react'
import { createRoot } from 'react-dom/client'
import { useVfxPreview } from '../app/workbench/components/vfx-cues/hooks/useVfxPreview'
import { useVfxEffectLibrary } from '../app/workbench/components/vfx-cues/hooks/useVfxEffectLibrary'
import { setLiveStudio } from '../src/devtools/liveStudio'
import { libraryJson, invalidateLibrary } from '../src/libraryClient'

const state = window as any
state.counts = { characters: 0, vfx: 0, timers: 0 }
const timers: Array<() => void> = []
window.setInterval = ((callback: () => void) => { state.counts.timers++; timers.push(callback); return timers.length }) as any
window.fetch = async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('characters=1')) { state.counts.characters++; await new Promise(r=>setTimeout(r,10)); return Response.json({ characters: [{charId:'synthetic',heightBlocks:2}] }) }
  if (url.includes('vfx-previews')) { state.counts.vfx++; return Response.json({sheets:{used:{frames:1},unused:{frames:1}}}) }
  throw Error(url)
}
let last: any
const ready = () => setLiveStudio({ stage: { setVfxCues: (_:unknown, sheets:unknown) => { last = sheets } } } as any)
function Harness({ cue, picker }: { cue: boolean; picker?:boolean }) {
  useVfxPreview({extensions:{vfxCues:{cues:cue?[{id:'one',effect:'used'}]:[]}}} as any)
  return <>{picker && <Picker />}</>
}
function Picker() { useVfxEffectLibrary(); return null }
const root = createRoot(document.getElementById('root')!)
const settle = () => new Promise(r=>setTimeout(r,100))
state.run = async () => {
  root.render(<Harness cue={false}/>); await settle()
  if (state.counts.vfx !== 0) throw Error('No-cue preview requested VFX')
  await Promise.all([libraryJson('/api/library?characters=1'),libraryJson('/api/library?characters=1'),libraryJson('/api/library?characters=1')])
  if (state.counts.characters !== 1) throw Error('Three concurrent reads were not deduplicated')
  // Advance fake interval clock by 60 seconds; none should have been installed.
  for(let i=0;i<60;i++) for(const callback of timers) callback()
  window.dispatchEvent(new Event('focus')); await settle()
  if(state.counts.characters!==1 || state.counts.timers!==0) throw Error('Polling/focus read remains')
  // Character heights use the #176 per-character cache; libraryJson only shares reads until invalidated.
  invalidateLibrary(); await libraryJson('/api/library?characters=1'); await settle()
  if(state.counts.characters!==2) throw Error('Invalidation did not refresh exactly once')
  root.render(<Harness cue/>); await settle()
  if(state.counts.vfx!==0) throw Error('VFX requested before scene onReady')
  ready()
  root.render(<Harness cue picker/>); await settle()
  if(state.counts.vfx!==1) throw Error('Picker/preview did not share list')
  if(Object.keys(last).join(',')!=='used') throw Error('Unused VFX sheets leaked to stage')
  root.unmount()
  return state.counts
}
