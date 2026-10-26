import { resolveFilmEffectsPolicy } from './filmEffectsPolicy'
import { assertBbsEffectsDestination } from './bbsGameCapabilities'

/** Existing non-install exports retain explicit runtime acknowledgement. Scoped targets are always rescanned. */
export async function validateFilmEffectsDestination(raw: unknown): Promise<void> {
  const policy = resolveFilmEffectsPolicy(raw)
  if (policy.mode === 'include' && policy.target?.gameDir) {
    try { await assertBbsEffectsDestination(policy.target.gameDir) }
    catch (error) { throw Object.assign(new TypeError(error instanceof Error ? error.message : 'Không kiểm tra được mod đích.'), { code: 'VALIDATION_FAILED', status: 400 }) }
  }
}
