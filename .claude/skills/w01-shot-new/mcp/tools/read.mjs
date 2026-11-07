import { getShot } from '../util.mjs'
import { client } from '../client.mjs'
import { clipsOf, nodesOf, readClipKeys, charKeyOf, nodeId, limitRows } from '../common.mjs'

const AX = ['x', 'y', 'z']
const trim = (a, n = 12) => (a.length <= n ? a.join(',') : a.slice(0, n).join(',') + ',…')
const rg = (v) => Math.round(v * 1000) / 1000

export default {
  name: 'shot_read',
  description: 'Read a W01 shot from App 2 as compact tables (summary, clips, keys, cues, cast). `shot` is a slug, folder or shot.json path.',
  inputSchema: {
    type: 'object',
    properties: {
      shot: { type: 'string' },
      what: { type: 'string', enum: ['summary', 'clips', 'keys', 'cues', 'cast'] },
      char: { type: 'string', description: 'key from shot.chars or node id' },
      frames: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[from,to]' },
    },
    required: ['shot', 'what'],
  },
  async run({ shot: ref, what, char, frames }) {
    const shot = getShot(ref)
    const p = await client(shot).project()
    const nk = charKeyOf(shot)
    const node = char ? nodeId(shot, char) : null
    const [f0, f1] = frames ?? [-Infinity, Infinity]
    const nodes = nodesOf(p)
    const nodeName = (id) => nodes.find((n) => n.id === id)?.name ?? ''
    const tl = p.scene.content.timeline

    if (what === 'summary') {
      const kinds = {}
      for (const n of nodes) kinds[n.type] = (kinds[n.type] ?? 0) + 1
      const cams = nodes.filter((n) => n.type === 'camera').map((n) => n.id)
      const a = tl.animation
      return [
        `revision ${p.revision}  end frame ${tl.frameEnd}  project ${shot.project}`,
        `nodes: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')}`,
        `clips: motion ${a.motionClips.length} (${a.motionClips.filter((c) => c.frameStart < 1000).length} on timeline), camera ${a.cameraMotionClips?.length ?? 0}, path ${a.pathMotionClips?.length ?? 0}`,
        `cues: vfx ${p.extensions?.vfxCues?.cues?.length ?? 0}, audio ${p.extensions?.audioCues?.cues?.length ?? 0}`,
        `cameras: ${cams.join(', ') || 'none'}${shot.camera ? `  (shot camera ${shot.camera})` : ''}`,
      ].join('\n')
    }

    if (what === 'cast') {
      const rows = ['key  node  characterId  name']
      for (const [k, v] of Object.entries(shot.chars ?? {})) rows.push(`${k}  ${v.node}  ${v.char}  ${nodeName(v.node)}`)
      if (shot.prop) rows.push(`prop  ${shot.prop.node}  -  ${nodeName(shot.prop.node)}`)
      return rows.join('\n')
    }

    if (what === 'clips') {
      const keyOf = Object.fromEntries(Object.entries(readClipKeys(shot)).map(([k, v]) => [v, k]))
      const list = clipsOf(p)
        .filter((c) => c.frameStart < 1000 && c.frameEnd >= f0 && c.frameStart <= f1 && (!node || c.target.nodeId === node))
        .sort((a, b) => (nk[a.target.nodeId] ?? a.target.nodeId).localeCompare(nk[b.target.nodeId] ?? b.target.nodeId) || a.frameStart - b.frameStart)
      const rows = ['key/clipId  char  start-end  speed  loop  blend  root  motion']
      const full = []
      for (const c of list) {
        const row = {
          key: keyOf[c.id] ?? c.id, clipId: c.id, char: nk[c.target.nodeId] ?? c.target.nodeId, start: c.frameStart, end: c.frameEnd,
          speed: c.playback?.speed, loop: !!c.playback?.loop, blend: c.playback?.blendIn?.frames ?? 0, root: p.bindings?.[c.id]?.rootPolicy ?? '', motion: c.motion?.name + (c.motion?.reverse ? ' REV' : ''),
        }
        full.push(row)
        rows.push(`${row.key}  ${row.char}  ${row.start}-${row.end}  x${row.speed}  ${row.loop ? 'loop' : '-'}  ${row.blend || '-'}  ${row.root || '-'}  ${row.motion}`)
      }
      return limitRows(shot, rows, 'read-clips.json', full).join('\n')
    }

    if (what === 'cues') {
      const full = []
      for (const c of p.extensions?.vfxCues?.cues ?? []) full.push({ id: c.id, type: 'vfx', what: c.effect, start: c.frameStart, end: c.frameEnd, attach: c.attachNodeId ? `${nk[c.attachNodeId] ?? c.attachNodeId}:${c.attachBone ?? ''}` : `@${[c.position?.x, c.position?.y, c.position?.z].map((v) => rg(v ?? 0)).join(',')}` })
      for (const c of p.extensions?.audioCues?.cues ?? []) full.push({ id: c.id, type: 'audio', what: `${c.kind}:${p.assets?.[c.assetId]?.displayName ?? p.assets?.[c.assetId]?.name ?? String(c.assetId).slice(0, 15)}`, start: c.frameStart, end: c.frameEnd ?? '', attach: `${c.gainDb}dB${c.speaker ? ' ' + c.speaker : ''}` })
      const sel = full.filter((c) => (c.end === '' ? c.start : c.end) >= f0 && c.start <= f1).sort((a, b) => a.start - b.start)
      const rows = ['id  type  effect/file  start-end  attach', ...sel.map((c) => `${String(c.id).slice(0, 8)}  ${c.type}  ${c.what}  ${c.start}-${c.end}  ${c.attach}`)]
      return limitRows(shot, rows, 'read-cues.json', sel).join('\n')
    }

    if (what === 'keys') {
      const fc = p.extensions?.topview?.fcurves ?? {}
      const out = []
      const groups = new Map()
      for (const c of fc.fcurves ?? []) {
        if (c.t?.[0] !== 'node') continue
        if (node && c.t[1] !== node) continue
        const prop = String(c.p).replace(/^transform\./, '')
        const name = `${prop}.${AX[c.i] ?? c.i}`
        groups.set(`${c.t[1]}|${name}`, (c.k ?? []).filter((k) => k[0] >= f0 && k[0] <= f1).map((k) => [k[0], k[1]]))
      }
      for (const [nid, props] of Object.entries(fc.userKeys ?? {})) {
        if (node && nid !== node) continue
        for (const [prop, ks] of Object.entries(props)) for (const ax of [0, 1, 2]) {
          const arr = ks.filter((k) => k.frame >= f0 && k.frame <= f1).map((k) => [k.frame, k.value?.[ax]])
          if (arr.length) groups.set(`${nid}|${prop}.${AX[ax]} (user)`, arr)
        }
      }
      const rows = ['node channel  n  frames  value-range']
      for (const [key, ks] of groups) {
        if (!ks.length) continue
        const [nid, name] = key.split('|')
        const vals = ks.map((k) => k[1])
        const sorted = [...ks].sort((a, b) => a[0] - b[0])
        out.push({ node: nid, channel: name, keys: sorted })
        rows.push(`${nk[nid] ?? nid} ${name}  ${ks.length} keys  ${trim(sorted.map((k) => k[0]))}  ${rg(Math.min(...vals))}..${rg(Math.max(...vals))}`)
      }
      if (rows.length === 1) return 'no keys' + (node ? ` for ${node}` : '')
      return limitRows(shot, rows, 'read-keys.json', out).join('\n')
    }
    throw new Error(`unknown "what": ${what}`)
  },
}
