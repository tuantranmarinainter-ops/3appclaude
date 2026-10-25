import type { FilmEffectsPolicy } from '../../../../src/filmEffectsPolicy'

export function EffectsOptions({ value, onChange, disabled, vi }: { value: FilmEffectsPolicy; onChange: (value: FilmEffectsPolicy) => void; disabled: boolean; vi: boolean }) {
  return <fieldset disabled={disabled}>
    <legend>{vi ? 'Hiệu ứng BBS' : 'BBS effects'}</legend>
    <label><input type="checkbox" checked={value.mode === 'omit'} onChange={(event) => onChange(event.target.checked ? { mode: 'omit' } : { mode: 'include' })} />{vi ? 'Không kèm hiệu ứng (mặc định an toàn khi thiếu addon)' : 'Omit effects (safe default without addon)'}</label>
    {value.mode === 'include' && <label><input type="checkbox" checked={!!value.target} onChange={(event) => onChange(event.target.checked ? { mode: 'include', target: { runtime: 'bbs-fs-2.7', aaaRendererAvailable: true, compatibleAddonConfirmed: true } } : { mode: 'include' })} />{vi ? 'Tôi xác nhận đích BBS FS 2.7 có renderer AAA và addon tương thích. Hiệu ứng (vd aura01) chưa được xác minh trong game.' : 'I confirm the BBS FS 2.7 target has an AAA renderer and compatible addon. Effects (e.g. aura01) remain unverified in game.'}</label>}
  </fieldset>
}
