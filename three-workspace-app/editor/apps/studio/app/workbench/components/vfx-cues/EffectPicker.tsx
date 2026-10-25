'use client'

import { useVfxEffectLibrary } from './hooks/useVfxEffectLibrary'
import { vfxSpriteThumb } from './utils'
import styles from './vfx-cues.module.css'

/** Pick an App 4 effect from the baked preview library instead of typing its name. */
export function EffectPicker({ value, onPick, vi }: { value: string; onPick: (name: string) => void; vi: boolean }) {
  const { options, loading } = useVfxEffectLibrary()
  if (loading) return <p className={styles.effectHint} role="status">{vi ? 'Đang tải kho hiệu ứng App 4…' : 'Loading the App 4 effect library…'}</p>
  if (!options.length) return <p className={styles.effectHint} role="status">{vi
    ? 'Kho hiệu ứng App 4 trên máy này đang trống (chưa có bản xem trước) — vẫn gõ tên hiệu ứng thủ công được.'
    : 'The App 4 effect library on this machine is empty (no baked previews yet) — typing an effect name still works.'}</p>
  return <div className={styles.effectGrid} role="group" aria-label={vi ? 'Chọn hiệu ứng từ kho App 4' : 'Pick an effect from the App 4 library'}>
    {options.map((option) => <button key={option.name} type="button" className={styles.effectOption} aria-pressed={option.name === value}
      title={`${option.name} · ${option.meta.frames} ${vi ? 'khung' : 'frames'} · ${option.meta.fps} fps`} onClick={() => onPick(option.name)}>
      <span className={styles.effectThumb} style={{ backgroundImage: `url("${option.imageUrl}")`, ...vfxSpriteThumb(option.meta) }} aria-hidden="true" />
      <span className={styles.effectName}>{option.name}</span>
    </button>)}
  </div>
}
