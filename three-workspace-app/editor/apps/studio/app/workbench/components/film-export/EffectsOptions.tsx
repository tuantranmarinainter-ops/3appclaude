import type { FilmEffectsPolicy } from '../../../../src/filmEffectsPolicy'
import type { BbsGameCapabilities } from '../../../../src/bbsGameCapabilities'

export function EffectsOptions({ value, onChange, disabled, vi, capabilities }: { value: FilmEffectsPolicy; onChange: (value: FilmEffectsPolicy) => void; disabled: boolean; vi: boolean; capabilities: BbsGameCapabilities | null }) {
  return <fieldset disabled={disabled}>
    <legend>{vi ? 'Hiệu ứng BBS' : 'BBS effects'}</legend>
    <label><input type="checkbox" disabled={!capabilities?.effectsCompatible} checked={value.mode === 'include'} onChange={(event) => onChange(event.target.checked && capabilities?.effectsCompatible ? { mode: 'include', target: { runtime: 'bbs-fs-2.7', aaaRendererAvailable: true, compatibleAddonConfirmed: true, gameDir: capabilities.gameDir } } : { mode: 'omit' })} />{vi ? 'Kèm hiệu ứng' : 'Include effects'}</label>
    {!capabilities && <p>Chọn thư mục game và bấm Đọc world để kiểm tra AAA trước khi kèm hiệu ứng.</p>}
    {capabilities?.issues.map((issue) => <p key={issue}>{issue}</p>)}
    {capabilities?.effectsCompatible && <p>Đã phát hiện bộ mod AAA. Phát hiệu ứng trong game: chưa kiểm (NOT_RUN).</p>}
  </fieldset>
}
