import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { preflightProjectFilm, type FilmSamplingArgs } from './unifiedFilmSampling'

export interface FilmSeriesContentArgs extends FilmSamplingArgs {
  content?: string
}

export interface FilmSeriesSegment {
  order: number
  range: { startFrame: number; endFrame: number }
  ticks: number
  shots: Array<{ id: string; cameraNodeId: string; startFrame: number; endFrame: number }>
  project: UnifiedProject
  exportArgs: FilmSeriesContentArgs
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

/**
 * Groups complete editorial shots into Film-worker-sized sequences. The existing film preflight remains the
 * authority for source continuity, tick boundaries, camera count, and bone-sample budgets.
 */
export function planFilmSeries(project: UnifiedProject, args: FilmSeriesContentArgs): FilmSeriesSegment[] {
  const sequence = project.scene.content.editorial?.sequences.find((item) => item.id === args.sequenceId)
  if (!sequence?.clips.length) fail(`Camera sequence ${String(args.sequenceId)} does not exist or has no clips`)

  const segments: FilmSeriesSegment[] = []
  let pending = [] as typeof sequence.clips

  const check = (clips: typeof sequence.clips) => {
    const candidate = structuredClone(project)
    const target = candidate.scene.content.editorial?.sequences.find((item) => item.id === sequence.id)
    if (!target) fail(`Camera sequence ${sequence.id} disappeared from the project snapshot`)
    target.clips = structuredClone(clips)
    const range = { startFrame: clips[0]!.sourceFrameStart, endFrame: clips.at(-1)!.sourceFrameEnd }
    const { durationTicks } = preflightProjectFilm(candidate, { ...args, sequenceId: sequence.id, range })
    return { candidate, range, durationTicks }
  }

  const push = (clips: typeof sequence.clips) => {
    const measured = check(clips)
    const order = segments.length + 1
    segments.push({ order, range: measured.range, ticks: measured.durationTicks,
      shots: clips.map((clip) => ({ id: clip.id, cameraNodeId: clip.cameraNodeId, startFrame: clip.sourceFrameStart, endFrame: clip.sourceFrameEnd })),
      project: measured.candidate,
      exportArgs: { ...args, sequenceId: sequence.id, range: measured.range },
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
        if (message.includes('20 Hz grid') || message.includes('bone sample budget')) {
          fail(`Shot ${clip.id} exceeds a single Film worker segment (${message}); cut the shot shorter`)
        }
        throw error
      }
      push(pending)
      pending = [clip]
      try { check(pending) }
      catch (singleError) {
        const detail = singleError instanceof Error ? singleError.message : String(singleError)
        if (/Film range must end on the 20 Hz grid|Film range exceeds the in-memory bone sample budget/.test(detail)) {
          fail(`Shot ${clip.id} exceeds a single Film worker segment (${detail}); cut the shot shorter`)
        }
        throw singleError
      }
    }
  }
  if (pending.length) push(pending)
  return segments
}
