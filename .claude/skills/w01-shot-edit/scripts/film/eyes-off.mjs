import { command, project } from '../w01api.mjs'
const P = '5673640e-bfd9-4a96-8d22-0e8a648ee130'
const mode = process.argv[2]
if (mode === 'off') {
  const { project: p } = await project(P)
  for (const c of p.extensions.vfxCues.cues.filter((c) => c.attachNodeId)) { const r = await command(P, 'vfx.cue.remove', { id: c.id }); console.log('removed', c.effect, c.id, 'rev', r.revision) }
} else {
  for (let i = 0; i < 2; i++) { const r = await command(P, 'history.undo', {}); console.log('undo rev', r.revision) }
  const { project: p } = await project(P)
  console.log('attached cues now', p.extensions.vfxCues.cues.filter((c) => c.attachNodeId).length)
}
