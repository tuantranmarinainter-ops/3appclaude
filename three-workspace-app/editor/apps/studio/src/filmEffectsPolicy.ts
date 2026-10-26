/** Target runtime acknowledgement; this does not certify an effect's in-game playback. */
export interface FilmEffectsPolicy {
  mode: 'omit' | 'include'
  target?: { runtime: 'bbs-fs-2.7'; aaaRendererAvailable: true; compatibleAddonConfirmed: true; gameDir?: string }
}
export function resolveFilmEffectsPolicy(raw: unknown): FilmEffectsPolicy {
  if (raw === undefined) return { mode: 'omit' }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('effectsPolicy must be an object')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some((key) => !['mode', 'target'].includes(key)) || !['omit', 'include'].includes(String(value.mode))) throw new TypeError('effectsPolicy requires mode omit or include')
  if (value.mode === 'omit') {
    if (value.target !== undefined) throw new TypeError('Omitted effects do not require a target addon')
    return { mode: 'omit' }
  }
  const target = value.target as Record<string, unknown> | undefined
  if (!target || Array.isArray(target) || Object.keys(target).some((key) => !['runtime', 'aaaRendererAvailable', 'compatibleAddonConfirmed', 'gameDir'].includes(key)) || (target.gameDir !== undefined && (typeof target.gameDir !== 'string' || !target.gameDir.trim())) || target.runtime !== 'bbs-fs-2.7' || target.aaaRendererAvailable !== true || target.compatibleAddonConfirmed !== true) {
    throw new TypeError('Including unverified effects requires explicit confirmation of a compatible BBS FS 2.7 runtime and installed AAA form renderer/addon')
  }
  return { mode: 'include', target: { runtime: 'bbs-fs-2.7', aaaRendererAvailable: true, compatibleAddonConfirmed: true, ...(typeof target.gameDir === 'string' ? { gameDir: target.gameDir } : {}) } }
}
export function filmRequiredMods(effectCount: number) {
  return { schemaVersion: 1, requiredMods: ['BBS FS 2.7', ...(effectCount > 0 ? ['AAA Particles with compatible BBS AAA form renderer/addon'] : [])],
    includedEffectCount: effectCount, effectPlayback: effectCount > 0 ? 'UNVERIFIED' : 'OMITTED', gamePlayback: 'NOT_RUN' }
}

/** Lazy callback deliberately avoids parsing/evaluating omitted project effects. */
export async function filmEffectsForExport<T>(raw: unknown, build: () => Promise<T[]>): Promise<T[]> {
  return resolveFilmEffectsPolicy(raw).mode === 'include' ? build() : []
}
