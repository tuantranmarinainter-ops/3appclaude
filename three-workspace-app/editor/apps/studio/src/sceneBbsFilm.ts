import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import type { FilmSamplingArgs } from './unifiedFilmSampling'

/** `scene.export.bbsFilm` arguments; every field is optional and defaults to "the whole scene". */
export interface SceneBbsFilmArgs {
  sequenceId?: string
  frameStart?: number
  frameEnd?: number
  characterIds?: string[]
  viewportAspect?: number
  name?: string
  mode?: 'editable'
}

export interface ResolvedSceneBbsFilm {
  film: FilmSamplingArgs & { filmName: string }
  archiveName: string
  /** Written into the package as `scene-export.json` so the defaults and root-motion split are auditable. */
  sceneExport: {
    schemaVersion: 1
    command: 'scene.export.bbsFilm'
    sceneName: string
    filmName: string
    mode: 'editable'
    sequenceId: string
    range: { startFrame: number; endFrame: number }
    characterIds: string[]
    cameraNodeIds: string[]
    rootMotion: { actorPath: 'replay-transform'; actionRoot: 'pose-track' }
    defaulted: string[]
  }
}

const KEYS = ['sequenceId', 'frameStart', 'frameEnd', 'characterIds', 'viewportAspect', 'name', 'mode']
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function fail(message: string): never { throw new TypeError(message) }

/** ASCII film name from a scene name: strips Vietnamese diacritics, keeps `[A-Za-z0-9._-]`, never ends with a dot. */
export function safeFilmName(value: string): string {
  const ascii = value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
  const cleaned = ascii.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 64).replace(/[.-]+$/, '')
  return cleaned || 'scene'
}

/**
 * Fill the Film sampling arguments from the scene: all Characters, the only camera sequence and the frame range its
 * clips cover. Nothing is trimmed silently; ranges the 20 Hz Film grid cannot hold are rejected by the Film preflight.
 */
export function resolveSceneBbsFilmArgs(project: UnifiedProject, raw: Record<string, unknown>): ResolvedSceneBbsFilm {
  if (Object.keys(raw).some((key) => !KEYS.includes(key))) fail(`scene.export.bbsFilm accepts only ${KEYS.join(', ')}`)
  const args = raw as SceneBbsFilmArgs
  if (args.mode !== undefined && args.mode !== 'editable') fail('scene.export.bbsFilm supports mode "editable" only; the pinned worker has no playback-only package yet')
  const defaulted: string[] = []
  const sequences = (project.scene.content.editorial?.sequences ?? []).filter((item) => item.clips.length)
  let sequenceId = args.sequenceId
  if (sequenceId === undefined) {
    if (sequences.length !== 1) fail(sequences.length ? `Scene has ${sequences.length} camera sequences; pass sequenceId` : 'Scene has no camera sequence with clips')
    sequenceId = sequences[0]!.id; defaulted.push('sequenceId')
  }
  const sequence = sequences.find((item) => item.id === sequenceId)
  if (!sequence) fail(`Camera sequence ${String(sequenceId)} does not exist or has no clips`)
  const startFrame = args.frameStart ?? sequence.clips[0]!.sourceFrameStart
  const endFrame = args.frameEnd ?? sequence.clips.at(-1)!.sourceFrameEnd
  if (args.frameStart === undefined) defaulted.push('frameStart')
  if (args.frameEnd === undefined) defaulted.push('frameEnd')
  let characterIds = args.characterIds
  if (characterIds === undefined) {
    const nodes = new Set(project.scene.content.nodes.map((node) => node.id))
    characterIds = Object.keys(project.characters).filter((id) => nodes.has(project.characters[id]!.nodeId))
    if (!characterIds.length) fail('Scene has no Characters to export')
    defaulted.push('characterIds')
  }
  const viewportAspect = args.viewportAspect ?? 16 / 9
  if (args.viewportAspect === undefined) defaulted.push('viewportAspect')
  const filmName = args.name ?? safeFilmName(project.name)
  if (args.name === undefined) defaulted.push('name')
  if (typeof filmName !== 'string' || !SAFE_NAME.test(filmName) || filmName.endsWith('.')) fail('name must use 1-64 safe ASCII characters')
  const range = { startFrame, endFrame }
  return {
    film: { characterIds, sequenceId, range, viewportAspect, filmName },
    archiveName: `${filmName}.bbs-film.zip`,
    sceneExport: { schemaVersion: 1, command: 'scene.export.bbsFilm', sceneName: project.name, filmName, mode: 'editable', sequenceId, range,
      characterIds, cameraNodeIds: sequence.clips.map((clip) => clip.cameraNodeId), rootMotion: { actorPath: 'replay-transform', actionRoot: 'pose-track' }, defaulted },
  }
}
