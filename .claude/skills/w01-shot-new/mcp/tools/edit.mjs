import { getShot } from '../util.mjs'
import { client } from '../client.mjs'
import { clipsOf, nodeId, clipId, nodesOf, int, num } from '../common.mjs'

const SCENE_OPS = new Set(['moveClip', 'setClip', 'removeClip', 'setKeys'])
const CUE_OPS = new Set(['addCue', 'removeCue'])
const CHANNEL = /^(position|rotation|scale)\.([xyz])$/
const INTERP = new Set(['linear', 'bezier'])

const opSchema = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['moveClip', 'setClip', 'removeClip', 'setKeys', 'addCue', 'removeCue'] },
    clip: { type: 'string', description: 'clips.json key or clip id' },
    start: { type: 'number' }, end: { type: 'number' }, speed: { type: 'number' }, loop: { type: 'boolean' }, blend: { type: 'number', description: 'blendIn frames, 0 = none' },
    node: { type: 'string', description: 'char key or node id' },
    channel: { type: 'string', description: 'position|rotation|scale + .x|.y|.z (rotation in degrees)' },
    keys: { type: 'array', items: { type: 'array' }, description: '[[frame,value,interp?],...]' },
    replace: { type: 'boolean', description: 'replace all keys of the channel (default: merge by frame); not with layer user' },
    layer: { type: 'string', enum: ['curve', 'user'], description: 'setKeys: curve (default, F-curve layer) or user (user keys: they win over the curve, e.g. continued shots)' },
    kind: { type: 'string', enum: ['vfx', 'audio'] },
    id: { type: 'string', description: 'cue id (removeCue)' },
    effect: { type: 'string' }, pos: { type: 'array', items: { type: 'number' } }, yaw: { type: 'number' }, scale: { type: 'number' },
    attach: { type: 'string', description: 'char key or node id' }, bone: { type: 'string' },
    assetId: { type: 'string' }, asset: { type: 'string', description: 'audio: imported file name instead of assetId (e.g. thud or thud.wav)' }, sound: { type: 'string', enum: ['voice', 'sfx', 'music'] }, gainDb: { type: 'number' }, offsetSeconds: { type: 'number' }, speaker: { type: 'string' }, text: { type: 'string' },
  },
  required: ['op'],
}

function validate(shot, p, ops) {
  const clips = clipsOf(p)
  const nodes = nodesOf(p)
  const cues = [...(p.extensions?.vfxCues?.cues ?? []).map((c) => ['vfx', c]), ...(p.extensions?.audioCues?.cues ?? []).map((c) => ['audio', c])]
  const errs = []
  ops.forEach((o, i) => {
    const e = (m) => errs.push(`op ${i} (${o?.op}): ${m}`)
    if (!o || typeof o !== 'object') return e('not an object')
    if (!SCENE_OPS.has(o.op) && !CUE_OPS.has(o.op)) return e('unknown op')
    if (['moveClip', 'setClip', 'removeClip'].includes(o.op)) {
      if (!o.clip) return e('missing clip')
      if (!clips.some((c) => c.id === clipId(shot, o.clip))) return e(`clip not found: ${o.clip}`)
    }
    if (o.op === 'moveClip' && !int(o.start)) e('start must be an integer frame')
    if (o.op === 'setClip') {
      for (const k of ['start', 'end', 'blend']) if (o[k] != null && !int(o[k])) e(`${k} must be an integer`)
      if (o.speed != null && !(num(o.speed) && o.speed !== 0)) e('speed must be a non-zero number')
      if (o.loop != null && typeof o.loop !== 'boolean') e('loop must be boolean')
      if (!['start', 'end', 'speed', 'loop', 'blend'].some((k) => o[k] != null)) e('nothing to set')
    }
    if (o.op === 'setKeys') {
      const nid = nodeId(shot, o.node ?? '')
      if (!nodes.some((n) => n.id === nid)) e(`node not found: ${o.node}`)
      if (!CHANNEL.test(o.channel ?? '')) e('channel must be position|rotation|scale + .x|.y|.z')
      if (!Array.isArray(o.keys) || !o.keys.length) e('keys must be a non-empty array of [frame,value]')
      else for (const k of o.keys) if (!Array.isArray(k) || !int(k[0]) || !num(k[1]) || (k[2] != null && !INTERP.has(k[2]))) { e(`bad key ${JSON.stringify(k)}`); break }
      if (o.layer != null && !['curve', 'user'].includes(o.layer)) e('layer must be curve|user')
      if (o.layer === 'user' && o.replace) e('replace is not allowed with layer user (user keys hold x,y,z together)')
    }
    if (o.op === 'addCue') {
      if (!int(o.start)) e('start must be an integer frame')
      if (o.end != null && !int(o.end)) e('end must be an integer frame')
      if (o.kind === 'vfx') {
        if (!o.effect) e('missing effect')
        if (!int(o.end)) e('vfx cue needs end')
        if (o.pos && !(o.pos.length === 3 && o.pos.every(num))) e('pos must be [x,y,z]')
        if (o.bone && !o.attach) e('bone needs attach')
      } else if (o.kind === 'audio') {
        if (!o.assetId && o.asset != null) {
          // shot_read shows "sfx:<name>", never the asset id: resolve the imported file's name; on duplicates (audio.mjs
          // re-imports) prefer the asset a cue already uses
          const base = (n) => String(n ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').toLowerCase()
          const want = base(o.asset)
          const hits = want ? Object.entries(p.assets ?? {}).filter(([, a]) => [a?.displayName, a?.name].some((n) => n != null && base(n) === want)).map(([id]) => id) : []
          const used = new Set((p.extensions?.audioCues?.cues ?? []).map((c) => c.assetId))
          const pick = hits.length === 1 ? hits : hits.filter((id) => used.has(id))
          if (pick.length === 1) o.assetId = pick[0]
          else return e(hits.length ? `asset name not unique: ${o.asset} (${hits.length} assets)` : `audio asset not found: ${o.asset}`)
        }
        if (!o.assetId) e('missing assetId (or asset: imported file name, as shot_read cues shows it)')
        if (o.sound != null && !['voice', 'sfx', 'music'].includes(o.sound)) e('sound must be voice|sfx|music')
      } else e('kind must be vfx|audio')
    }
    if (o.op === 'removeCue') {
      // shot_read shows 8-char id prefixes: accept a unique prefix and expand it
      const hits = cues.filter(([, c]) => typeof o.id === 'string' && o.id && c.id.startsWith(o.id))
      if (hits.length === 1) o.id = hits[0][1].id
      else e(hits.length ? `cue id prefix not unique: ${o.id}` : `cue not found: ${o.id}`)
    }
  })
  if (errs.length) throw new Error(errs.slice(0, 6).join('\n'))
}

const KEY_ID = () => 'k' + Math.random().toString(36).slice(2, 8)

/** Applies scene/fcurve ops to clones; returns the log lines. */
function applyScene(shot, p, ops, scene, fc) {
  const log = []
  const tl = scene.content.timeline.animation
  for (const o of ops) {
    if (['moveClip', 'setClip', 'removeClip'].includes(o.op)) {
      const id = clipId(shot, o.clip)
      const c = tl.motionClips.find((x) => x.id === id)
      const before = `${c.frameStart}-${c.frameEnd} x${c.playback?.speed}`
      if (o.op === 'removeClip') { tl.motionClips = tl.motionClips.filter((x) => x.id !== id); log.push(`removeClip ${o.clip}: was ${before}`); continue }
      if (o.op === 'moveClip') { const len = c.frameEnd - c.frameStart; c.frameStart = o.start; c.frameEnd = o.start + len }
      else {
        if (o.start != null) c.frameStart = o.start
        if (o.end != null) c.frameEnd = o.end
        c.playback ??= {}
        if (o.speed != null) c.playback.speed = o.speed
        if (o.loop != null) c.playback.loop = o.loop
        if (o.blend != null) { if (o.blend > 0) c.playback.blendIn = { frames: o.blend, curve: 'smooth', footLock: false }; else delete c.playback.blendIn }
      }
      log.push(`${o.op} ${o.clip}: ${before} -> ${c.frameStart}-${c.frameEnd} x${c.playback?.speed}${c.playback?.blendIn ? ' blend ' + c.playback.blendIn.frames : ''}`)
    } else if (o.op === 'setKeys' && o.layer === 'user') {
      // user keys win over the curve; each key holds [x,y,z]: set one axis, keep the others (sampled at that frame)
      const nid = nodeId(shot, o.node)
      const [, prop, ax] = CHANNEL.exec(o.channel)
      const i = 'xyz'.indexOf(ax)
      fc.userKeys ??= {}; fc.userKeys[nid] ??= {}
      const cur = [...(fc.userKeys[nid][prop] ?? [])].sort((a, b) => a.frame - b.frame)
      const before = cur.length
      const node = nodesOf(p).find((n) => n.id === nid)
      const base = prop === 'scale' ? [1, 1, 1] : [0, 0, 0]
      const at = (f) => {
        if (!cur.length) { const t = node?.transform?.[prop]; return t ? [t.x ?? base[0], t.y ?? base[1], t.z ?? base[2]] : [...base] }
        if (f <= cur[0].frame) return [...cur[0].value]
        const j = cur.findIndex((k) => k.frame >= f); if (j < 0) return [...cur.at(-1).value]
        const a = cur[j - 1], b = cur[j], t = (f - a.frame) / (b.frame - a.frame)
        return a.value.map((v, n) => v + (b.value[n] - v) * t)
      }
      const add = o.keys.map(([f, v, ip]) => { const old = cur.find((k) => k.frame === f); const value = old ? [...old.value] : at(f); value[i] = v; return { id: old?.id ?? KEY_ID(), frame: f, value, interpolation: ip === 'bezier' ? 'ease-in-out' : 'linear' } })
      const byFrame = new Map(cur.map((k) => [k.frame, k])); for (const k of add) byFrame.set(k.frame, k)
      fc.userKeys[nid][prop] = [...byFrame.values()].sort((a, b) => a.frame - b.frame)
      log.push(`setKeys ${o.node} ${o.channel} (user): ${before} -> ${fc.userKeys[nid][prop].length} keys (set ${o.keys.length})`)
    } else if (o.op === 'setKeys') {
      const nid = nodeId(shot, o.node)
      const [, prop, ax] = CHANNEL.exec(o.channel)
      const i = 'xyz'.indexOf(ax), pp = 'transform.' + prop
      fc.fcurves ??= []
      let cur = fc.fcurves.find((x) => x.t?.[1] === nid && x.p === pp && x.i === i)
      if (!cur) { cur = { id: `fc_${nid}_${prop}_${i}`, t: ['node', nid], p: pp, i, k: [] }; fc.fcurves.push(cur) }
      const before = cur.k.length
      const byFrame = new Map(o.replace ? [] : cur.k.map((k) => [k[0], k]))
      for (const [f, v, ip] of o.keys) byFrame.set(f, [f, v, ip ?? 'linear', KEY_ID()])
      cur.k = [...byFrame.values()].sort((a, b) => a[0] - b[0])
      log.push(`setKeys ${o.node} ${o.channel}: ${before} -> ${cur.k.length} keys (set ${o.keys.length}${o.replace ? ', replace' : ''})`)
    }
  }
  return log
}

function cueCommand(shot, o) {
  if (o.op === 'removeCue') return null
  if (o.kind === 'vfx') {
    const [x, y, z] = o.pos ?? [0, 0, 0]
    const cue = { effect: o.effect, frameStart: o.start, frameEnd: o.end, position: { x, y, z }, yaw: o.yaw ?? 0, scale: o.scale ?? 1 }
    if (o.attach) { cue.attachNodeId = nodeId(shot, o.attach); if (o.bone) cue.attachBone = o.bone }
    return ['vfx.cue.add', { cue }]
  }
  const cue = { kind: o.sound ?? 'sfx', assetId: o.assetId, frameStart: o.start, gainDb: o.gainDb ?? 0 }
  for (const [k, from] of [['frameEnd', 'end'], ['offsetSeconds', 'offsetSeconds'], ['speaker', 'speaker'], ['text', 'text']]) if (o[from] != null) cue[k] = o[from]
  return ['audio.cue.add', { cue }]
}

export const edit = {
  name: 'shot_edit',
  description: 'Edit a shot in App 2: clips, F-curve keys, VFX/audio cues. All clip/key ops become ONE scene.apply (one undo step); validates everything first.',
  inputSchema: {
    type: 'object',
    properties: { shot: { type: 'string' }, ops: { type: 'array', items: opSchema, minItems: 1 }, dryRun: { type: 'boolean' } },
    required: ['shot', 'ops'],
  },
  async run({ shot: ref, ops, dryRun }) {
    if (!Array.isArray(ops) || !ops.length) throw new Error('ops must be a non-empty array')
    const shot = getShot(ref)
    const c = client(shot)
    const p = await c.project()
    validate(shot, p, ops)
    const sceneOps = ops.filter((o) => SCENE_OPS.has(o.op)), cueOps = ops.filter((o) => CUE_OPS.has(o.op))
    const scene = structuredClone(p.scene)
    const fc = structuredClone(p.extensions?.topview?.fcurves ?? { version: 1, encoding: 'compact-v1', fcurves: [] })
    const log = applyScene(shot, p, sceneOps, scene, fc)
    const cueLog = cueOps.map((o) => (o.op === 'removeCue' ? `removeCue ${o.id}` : `addCue ${o.kind} ${o.effect ?? o.assetId} ${o.start}${o.end != null ? '-' + o.end : ''}`))
    if (dryRun) return [`DRY RUN rev ${p.revision} (nothing written)`, ...log.map((l) => 'would ' + l), ...cueLog.map((l) => 'would ' + l)].join('\n')
    let rev = p.revision
    if (sceneOps.length) {
      rev = (await c.command('scene.apply', { operations: [{ type: 'document.replace', document: scene, fcurves: fc }] })).revision ?? rev
    }
    for (const o of cueOps) {
      if (o.op === 'removeCue') rev = (await c.command(`${(p.extensions?.vfxCues?.cues ?? []).some((x) => x.id === o.id) ? 'vfx' : 'audio'}.cue.remove`, { id: o.id })).revision ?? rev
      else { const [cmd, args] = cueCommand(shot, o); rev = (await c.command(cmd, args)).revision ?? rev }
    }
    return [`rev ${p.revision} -> ${rev}`, ...log, ...cueLog].join('\n')
  },
}

export const undo = {
  name: 'shot_undo',
  description: 'Undo the last N edits of the shot project in App 2 (history.undo).',
  inputSchema: { type: 'object', properties: { shot: { type: 'string' }, steps: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['shot'] },
  async run({ shot: ref, steps = 1 }) {
    const c = client(getShot(ref))
    const before = (await c.project()).revision
    let rev = before
    for (let i = 0; i < steps; i++) rev = (await c.undo()).revision ?? rev
    return `undo x${steps}: rev ${before} -> ${rev}`
  },
}
