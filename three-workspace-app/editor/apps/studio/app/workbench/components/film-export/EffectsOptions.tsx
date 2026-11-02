import type { FilmEffectsPolicy } from '../../../../src/filmEffectsPolicy'
import type { BbsGameCapabilities } from '../../../../src/bbsGameCapabilities'

export function EffectsOptions({ value, onChange, disabled, vi, capabilities }: { value: FilmEffectsPolicy; onChange: (value: FilmEffectsPolicy) => void; disabled: boolean; vi: boolean; capabilities: BbsGameCapabilities | null }) {
  return <div className="wb-film-checklist">
    <label className="wb-check">
      <input type="checkbox" disabled={disabled || !capabilities?.effectsCompatible} checked={value.mode === 'include'} onChange={(event) => onChange(event.target.checked && capabilities?.effectsCompatible ? { mode: 'include', target: { runtime: 'bbs-fs-2.7', aaaRendererAvailable: true, compatibleAddonConfirmed: true, gameDir: capabilities.gameDir } } : { mode: 'omit' })} />
      <span>{vi ? 'Kèm hiệu ứng (lửa, hào quang…)' : 'Include effects'}
        <small>{!capabilities
          ? (vi ? 'Chọn thư mục game ở bước 1 để app kiểm bộ mod hiệu ứng AAA.' : 'Pick the game folder in step 1 to check the AAA effects mod.')
          : capabilities.effectsCompatible
            ? (vi ? 'Game có mod AAA nên hiệu ứng phát được (chưa kiểm trong game).' : 'AAA mod found; effects can play (not checked in game).')
            : (vi ? 'Game chưa có mod AAA nên không kèm được hiệu ứng.' : 'No AAA mod; effects cannot be included.')}</small>
      </span>
    </label>
    {capabilities?.issues.map((issue) => <small key={issue}>{issue}</small>)}
  </div>
}
