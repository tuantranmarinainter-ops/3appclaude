import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { createFrameSnapshot, evaluateFrame } from '@topview/3d-builder/evaluate'
import { inspectProjectFilm, type FilmSamplingArgs } from './unifiedFilmSampling'
import { projectEvaluationScene, sampleProjectCameraSequence } from './unifiedSkeletonEvaluation'

export type FilmSeriesSelection = string[] | 'auto'
export type FilmSeriesPropSelection = string[] | 'all' | 'auto'

export interface FilmSeriesContentArgs extends Omit<FilmSamplingArgs, 'characterIds' | 'propIds'> {
  characterIds: FilmSeriesSelection
  propIds?: FilmSeriesPropSelection
  content?: string
}

export interface FilmSeriesPlanningIssue { code: string; message: string }
export interface FilmSeriesCameraSample { shotId: string; sourceFrame: number; side: 'left' | 'right'; position: number[] }

export interface FilmSeriesSegment {
  order: number
  range: { startFrame: number; endFrame: number }
  ticks: number
  shots: Array<{ id: string; cameraNodeId: string; startFrame: number; endFrame: number }>
  project: UnifiedProject
  exportArgs: FilmSamplingArgs & { content?: string }
  planningIssues: FilmSeriesPlanningIssue[]
}

/** Python stdlib merger for native worker ZIPs; refuses traversal and differing asset collisions. */
export const FILM_SERIES_ARCHIVE_SCRIPT = String.raw`
import json,pathlib,stat,sys,zipfile
spec=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
out=pathlib.Path(sys.argv[2]); out.mkdir(parents=True,exist_ok=False)
films=out/'films'; films.mkdir()
assets={}
effects={}
def unsafe_name(name):
    path=pathlib.PurePosixPath(name)
    devices={'con','prn','aux','nul','conin$','conout$'}
    if chr(92) in name or name.startswith('/') or path.is_absolute() or '..' in path.parts:
        return True
    for part in path.parts:
        stem=part.rstrip(' .').split('.')[0].casefold()
        if ':' in part or part.endswith(('.', ' ')) or stem in devices or stem in {f'{prefix}{number}' for prefix in ('com','lpt') for number in (*range(1,10),'¹','²','³')}:
            return True
    return False
for item in spec['segments']:
    with zipfile.ZipFile(item['zip']) as source:
        names=[n for n in source.namelist() if not n.endswith('/')]
        if len(names)!=len(set(names)): raise ValueError('Duplicate entry names in Film worker package')
        if any(unsafe_name(n) for n in names): raise ValueError('Unsafe cross-platform Film package path')
        dat=[n for n in names if n.startswith('films/') and n.endswith('.dat')]
        if len(dat)!=1: raise ValueError('Each Film worker package must contain exactly one films/*.dat')
        target=films/item['film']
        target.write_bytes(source.read(dat[0]))
        effect_entries=[n for n in names if n=='effects.json']
        if len(effect_entries)>1: raise ValueError('Film worker package contains duplicate effects.json entries')
        try: effect_data=json.loads(source.read(effect_entries[0]).decode('utf-8')) if effect_entries else []
        except (UnicodeDecodeError,json.JSONDecodeError) as error: raise ValueError('Film effects.json is not valid UTF-8 JSON') from error
        if not isinstance(effect_data,list): raise ValueError('Film effects.json must contain a cue array')
        effects['films/'+item['film']]=effect_data
        for name in names:
            if name.startswith('assets/'):
                p=pathlib.PurePosixPath(name)
                mode=(source.getinfo(name).external_attr >> 16) & 0o170000
                if mode == stat.S_IFLNK: raise ValueError('Unsafe asset path in Film package')
                data=source.read(name)
                key=name.casefold(); previous=assets.get(key)
                if previous is not None and previous[1] != data: raise ValueError('Film asset filename collision has different bytes: '+name)
                if previous is None: assets[key]=(name,data)
for name,data in assets.values():
    target=out.joinpath(*pathlib.PurePosixPath(name).parts)
    target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data)
(out/'series.json').write_text(json.dumps(spec['series'],ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(out/'effects.json').write_text(json.dumps(effects,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(out/'README.txt').write_text(pathlib.Path(sys.argv[3]).read_text(encoding='utf-8'),encoding='utf-8')
archive=pathlib.Path(sys.argv[4])
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
    for path in sorted(out.rglob('*')):
        if path.is_file(): z.write(path,path.relative_to(out).as_posix())
`;

function fail(message: string): never { throw new TypeError(message) }

function selectedCharacterIds(project: UnifiedProject, clips: readonly { cameraNodeId: string; sourceFrameStart: number; sourceFrameEnd: number }[], selection: FilmSeriesSelection) {
  if (Array.isArray(selection)) return [...selection]
  const start = clips[0]!.sourceFrameStart, end = clips.at(-1)!.sourceFrameEnd
  const nodeToCharacter = new Map(Object.values(project.characters).map((item) => [item.nodeId, item.id]))
  const selected = new Set<string>()
  for (const motion of project.scene.content.timeline.animation.motionClips) {
    if (motion.frameEnd < start || motion.frameStart > end) continue
    const id = nodeToCharacter.get(motion.target.nodeId)
    if (id) selected.add(id)
  }
  const rawFcurves = project.extensions.topview?.fcurves as { fcurves?: Array<{ t?: unknown; p?: unknown; k?: unknown[] }> } | undefined
  for (const curve of rawFcurves?.fcurves ?? []) {
    if (curve.p !== 'transform.position' && curve.p !== 'transform.rotation') continue
    const targetId = Array.isArray(curve.t) ? String(curve.t[1]) : String(curve.t ?? '')
    const id = nodeToCharacter.get(targetId)
    if (!id || !Array.isArray(curve.k)) continue
    if (curve.k.some((key) => Array.isArray(key) && Number.isFinite(Number(key[0])) && Number(key[0]) >= start && Number(key[0]) <= end)) selected.add(id)
  }
  const userKeys = projectEvaluationScene(project).userKeys as Record<string, Record<string, Array<{ frame: number }>>>
  for (const [nodeId, tracks] of Object.entries(userKeys)) {
    const id = nodeToCharacter.get(nodeId)
    if (!id) continue
    for (const property of ['position', 'rotation'] as const) {
      if (tracks[property]?.some((key) => key.frame >= start && key.frame <= end)) selected.add(id)
    }
  }
  const cameraIds = new Set(clips.map((clip) => clip.cameraNodeId))
  for (const camera of project.scene.content.nodes.filter((node) => cameraIds.has(node.id))) {
    const targets = [camera.camera?.subject?.nodeId, camera.camera?.lookAtTarget?.nodeId]
    for (const target of targets) {
      const id = target ? nodeToCharacter.get(target) : undefined
      if (id) selected.add(id)
    }
  }
  return [...selected]
}

function selectedPropIds(project: UnifiedProject, clips: readonly { id: string; cameraNodeId: string; sourceFrameStart: number; sourceFrameEnd: number }[], selection: FilmSeriesPropSelection | undefined, sequenceCameraFrames: readonly FilmSeriesCameraSample[]) {
  const props = project.scene.content.nodes.filter((node) => node.type === 'prop' && typeof node.metadata?.assetId === 'string')
  if (Array.isArray(selection)) return [...selection]
  if (selection === 'all') return props.map((node) => node.id)
  const start = clips[0]!.sourceFrameStart, end = clips.at(-1)!.sourceFrameEnd
  const shotIds = new Set(clips.map((clip) => clip.id))
  const cameraPositions = sequenceCameraFrames.filter((sample) => shotIds.has(sample.shotId) && sample.sourceFrame >= start && sample.sourceFrame <= end + 1)
  if (!cameraPositions.length) return []
  const scene = projectEvaluationScene(project)
  const snapshot = createFrameSnapshot()
  const selected = new Set<string>()
  for (const camera of cameraPositions) {
    evaluateFrame({ ...scene, exportSampleBoundary: camera.side }, camera.sourceFrame, snapshot)
    for (const prop of props) {
      const transform = snapshot.transforms.get(prop.id)
      if (!transform) continue
      const dx = transform.position.x - camera.position[0]!, dy = transform.position.y - camera.position[1]!, dz = transform.position.z - camera.position[2]!
      if (dx * dx + dy * dy + dz * dz <= 60 * 60) selected.add(prop.id)
    }
  }
  return [...selected]
}

/** Groups whole editorial shots after resolving auto selections for each candidate segment. */
export function planFilmSeries(project: UnifiedProject, args: FilmSeriesContentArgs, cameraSamples: readonly FilmSeriesCameraSample[] = [], cameraErrors: ReadonlyMap<string, string> = new Map(), options: { retainInvalidSingles?: boolean } = {}): FilmSeriesSegment[] {
  const content = args.content ?? (Array.isArray(args.propIds) && args.propIds.length ? 'both' : 'characters')
  args = { ...args, content }
  const sequence = project.scene.content.editorial?.sequences.find((item) => item.id === args.sequenceId)
  if (!sequence?.clips.length) fail(`Camera sequence ${String(args.sequenceId)} does not exist or has no clips`)

  const segments: FilmSeriesSegment[] = []
  let pending = [] as typeof sequence.clips

  const check = (clips: typeof sequence.clips, keepInvalidSingle = false) => {
    const candidate = structuredClone(project)
    const target = candidate.scene.content.editorial?.sequences.find((item) => item.id === sequence.id)
    if (!target) fail(`Camera sequence ${sequence.id} disappeared from the project snapshot`)
    target.clips = structuredClone(clips)
    const range = { startFrame: clips[0]!.sourceFrameStart, endFrame: clips.at(-1)!.sourceFrameEnd }
    const selectionClips = clips.map((clip) => ({ cameraNodeId: clip.cameraNodeId, sourceFrameStart: clip.sourceFrameStart, sourceFrameEnd: clip.sourceFrameEnd }))
    const characterIds = args.content === 'backdrops' ? [] : selectedCharacterIds(project, selectionClips, args.characterIds)
    const propIds = args.content === 'characters' ? [] : selectedPropIds(project, clips, args.propIds, cameraSamples)
    const exportArgs = { ...args, characterIds, propIds, sequenceId: sequence.id, range }
    const inspection = inspectProjectFilm(candidate, exportArgs)
    const workerLimit = inspection.issues.find((item) => ['CAMERA_LIMIT', 'TICK_LIMIT', 'BONE_BUDGET'].includes(item.code))
    if (workerLimit && !keepInvalidSingle) fail(workerLimit.message)
    const ticks = (range.endFrame - range.startFrame + 1) / project.scene.content.timeline.fps * 20
    const planningIssues: FilmSeriesPlanningIssue[] = []
    for (const validation of inspection.issues.filter((item) => !['CAMERA_LIMIT', 'TICK_LIMIT', 'BONE_BUDGET'].includes(item.code))) {
      planningIssues.push({ code: validation.code, message: validation.message })
    }
    for (const clip of clips) {
      const cameraError = cameraErrors.get(clip.id)
      if (cameraError && (args.propIds ?? 'auto') === 'auto') planningIssues.push({ code: 'CAMERA_EVALUATION_UNAVAILABLE', message: `Shot ${clip.id}: ${cameraError}` })
      if ((args.propIds ?? 'auto') === 'auto' && content !== 'characters' && !cameraError && !cameraSamples.some((sample) => sample.shotId === clip.id)) {
        planningIssues.push({ code: 'CAMERA_SAMPLES_REQUIRED', message: `Shot ${clip.id}: camera samples are required for automatic backdrop selection` })
      }
    }
    return { candidate, range, durationTicks: inspection.durationTicks ?? (Number.isFinite(ticks) ? ticks : 0), exportArgs,
      planningIssues: [...(workerLimit ? [{ code: workerLimit.code, message: workerLimit.message }] : []), ...planningIssues] }
  }

  const push = (clips: typeof sequence.clips) => {
    const measured = check(clips, clips.length === 1 && options.retainInvalidSingles === true)
    const order = segments.length + 1
    segments.push({ order, range: measured.range, ticks: measured.durationTicks,
      shots: clips.map((clip) => ({ id: clip.id, cameraNodeId: clip.cameraNodeId, startFrame: clip.sourceFrameStart, endFrame: clip.sourceFrameEnd })),
      project: measured.candidate,
      exportArgs: measured.exportArgs,
      planningIssues: measured.planningIssues,
    })
  }

  for (const clip of sequence.clips) {
    if (pending.length && pending.at(-1)!.sourceFrameEnd + 1 !== clip.sourceFrameStart) {
      push(pending)
      pending = []
    }
    const candidate = [...pending, clip]
    try {
      check(candidate)
      pending = candidate
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/Film currently supports 1-3 camera shots|Film range must end on the 20 Hz grid and contain 1-255 ticks|Film range exceeds the in-memory bone sample budget/.test(message)) throw error
      if (!pending.length) {
        if (!options.retainInvalidSingles) fail(`Shot ${clip.id} exceeds a single Film worker segment (${message}); cut the shot shorter`)
        push([clip])
        pending = []
        continue
      }
      push(pending)
      pending = [clip]
      try { check(pending) }
      catch (singleError) {
        const detail = singleError instanceof Error ? singleError.message : String(singleError)
        if (/Film range must end on the 20 Hz grid|Film range exceeds the in-memory bone sample budget/.test(detail)) {
          if (!options.retainInvalidSingles) fail(`Shot ${clip.id} exceeds a single Film worker segment (${detail}); cut the shot shorter`)
          push([clip])
          pending = []
          continue
        }
        throw singleError
      }
    }
  }
  if (pending.length) push(pending)
  return segments
}

/** Samples each shot independently so an unsupported camera target is reported only on affected segments. */
export async function planFilmSeriesWithCameraSamples(project: UnifiedProject, args: FilmSeriesContentArgs, options: { retainInvalidSingles?: boolean } = {}): Promise<FilmSeriesSegment[]> {
  const content = args.content ?? (Array.isArray(args.propIds) && args.propIds.length ? 'both' : 'characters')
  args = { ...args, content }
  if (content === 'characters' || (args.propIds ?? 'auto') !== 'auto') return planFilmSeries(project, args, [], new Map(), options)
  const sequence = project.scene.content.editorial?.sequences.find((item) => item.id === args.sequenceId)
  if (!sequence?.clips.length) return planFilmSeries(project, args, [], new Map(), options)
  const cameraSamples: FilmSeriesCameraSample[] = []
  const cameraErrors = new Map<string, string>()
  for (const clip of sequence.clips) {
    const ticks = (clip.sourceFrameEnd - clip.sourceFrameStart + 1) / project.scene.content.timeline.fps * 20
    if (!Number.isFinite(ticks) || ticks > 255) {
      cameraErrors.set(clip.id, 'camera sampling was skipped because the single shot exceeds the 255-tick segment limit')
      continue
    }
    const shotProject = structuredClone(project)
    const target = shotProject.scene.content.editorial?.sequences.find((item) => item.id === sequence.id)
    if (!target) continue
    target.clips = [structuredClone(clip)]
    try {
      for await (const sample of sampleProjectCameraSequence(shotProject, sequence.id, 20, args.viewportAspect)) {
        cameraSamples.push({ shotId: clip.id, sourceFrame: sample.sourceFrame, side: sample.side, position: sample.position })
      }
    } catch (error) {
      cameraErrors.set(clip.id, error instanceof Error ? error.message : String(error))
    }
  }
  return planFilmSeries(project, args, cameraSamples, cameraErrors, options)
}
