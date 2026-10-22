'use client'

import { useStudioLocale } from '../../../../src/devtools/localePreference'
import { useVfxCuePanel } from './hooks/useVfxCuePanel'
import type { VfxCuePanelProps } from './types'
import styles from './vfx-cues.module.css'

export function VfxCuePanel(props: VfxCuePanelProps) {
  const vi = useStudioLocale() === 'vi'
  const { project, frameRange } = props
  const { editingId, form, setForm, setField, error, busy, rangeCues, nodes, character, bones, editCue, cancelEdit, submit, remove, updatePosition } = useVfxCuePanel(props, vi)
  return <section className={styles.panel} aria-labelledby="wb-vfx-cues-title">
    <header className={styles.header}>
      <div><h2 id="wb-vfx-cues-title">{vi ? 'Hiệu ứng trong cảnh' : 'Scene effects'}</h2>
        <p>{frameRange ? `${vi ? 'Khoảng đang chọn' : 'Selected range'} ${frameRange.startFrame}–${frameRange.endFrame} · ` : ''}{rangeCues.length} {vi ? 'cue' : 'cues'}</p></div>
    </header>
    <div className={styles.list}>
      {!rangeCues.length && <p role="status">{vi ? 'Chưa có hiệu ứng trong khoảng cảnh này.' : 'No effects in this scene range yet.'}</p>}
      {rangeCues.map((cue) => <article className={styles.item} key={cue.id}>
        <div><strong>{cue.effect}</strong><span>{cue.frameStart}–{cue.frameEnd} · {vi ? 'cỡ' : 'scale'} {cue.scale}</span>
          {cue.attachNodeId && <small>{vi ? 'Gắn với' : 'Attached to'} {nodes.find((node) => node.id === cue.attachNodeId)?.name ?? cue.attachNodeId}{cue.attachBone ? ` · ${cue.attachBone}` : ''}</small>}</div>
        <div className={styles.itemActions}><button type="button" disabled={busy} onClick={() => editCue(cue)}>{vi ? 'Sửa' : 'Edit'}</button><button type="button" disabled={busy} onClick={() => void remove(cue.id)}>{vi ? 'Xóa' : 'Delete'}</button></div>
      </article>)}
    </div>
    <fieldset className={styles.form} disabled={busy}>
      <legend>{editingId ? (vi ? 'Sửa hiệu ứng' : 'Edit effect') : (vi ? 'Thêm hiệu ứng' : 'Add effect')}</legend>
      <label>{vi ? 'Tên hiệu ứng App 4' : 'App 4 effect name'}<input value={form.effect} maxLength={128} onChange={(event) => setField('effect', event.target.value)} placeholder="aura01" /></label>
      <div className={styles.grid}>
        <label>{vi ? 'Frame đầu' : 'Start frame'}<input type="number" step="1" value={form.frameStart} onChange={(event) => setField('frameStart', Number(event.target.value))} /></label>
        <label>{vi ? 'Frame cuối' : 'End frame'}<input type="number" step="1" value={form.frameEnd} onChange={(event) => setField('frameEnd', Number(event.target.value))} /></label>
      </div>
      <div className={styles.grid3}>{(['x', 'y', 'z'] as const).map((axis) => <label key={axis}>{axis}<input type="number" step="0.1" value={form.position[axis]} onChange={(event) => updatePosition(axis, event.target.value)} /></label>)}</div>
      <div className={styles.grid}>
        <label>{vi ? 'Xoay Y (độ)' : 'Yaw (degrees)'}<input type="number" step="1" value={form.yaw} onChange={(event) => setField('yaw', Number(event.target.value))} /></label>
        <label>{vi ? 'Cỡ' : 'Scale'}<input type="number" min="0.001" step="0.1" value={form.scale} onChange={(event) => setField('scale', Number(event.target.value))} /></label>
      </div>
      <label>{vi ? 'Gắn vào node' : 'Attach to node'}<select value={form.attachNodeId ?? ''} onChange={(event) => setForm((current) => ({ ...current, attachNodeId: event.target.value || undefined, attachBone: undefined }))}>
        <option value="">{vi ? 'Không gắn' : 'World space'}</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
      </select></label>
      {form.attachNodeId && character && <label>{vi ? 'Gắn vào xương (tuỳ chọn)' : 'Attach to bone (optional)'}<select value={form.attachBone ?? ''} onChange={(event) => setField('attachBone', event.target.value || undefined)}>
        <option value="">{vi ? 'Gốc nhân vật' : 'Character root'}</option>{bones.map((bone) => <option key={bone.id} value={bone.name}>{bone.name}</option>)}
      </select></label>}
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void submit()}>{busy ? (vi ? 'Đang lưu…' : 'Saving…') : editingId ? (vi ? 'Lưu sửa đổi' : 'Save changes') : (vi ? 'Thêm cue' : 'Add cue')}</button>{editingId && <button type="button" disabled={busy} onClick={cancelEdit}>{vi ? 'Hủy sửa' : 'Cancel edit'}</button>}</div>
    </fieldset>
  </section>
}
