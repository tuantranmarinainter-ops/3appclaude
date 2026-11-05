// Export Tập 15 Shot 03 as a BBS FS film ZIP from the user's App 2 (3016) and install it into the game world
// (same steps as Xuất ▾ → Gói BBS FS → Cài vào game). Run only while Minecraft is closed.
//   W01_API=http://127.0.0.1:3016 W01_ALLOW_REAL=1 node export-install.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { command, project, BASE } from '../w01api.mjs'

const P = '5673640e-bfd9-4a96-8d22-0e8a648ee130'
const GAME = 'S:\\Minecraft\\Minecraft Forge-1.20.1', WORLD = 'Thế giới mới (1)'
const FILM = 'Tap15-shot03-gay'
let cookie = ''
const raw = async (path, init = {}) => {
  if (!cookie) {
    const r = await fetch(BASE + '/api/unified/session', { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: '{}' })
    cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]
  }
  const r = await fetch(BASE + path, { ...init, headers: { origin: BASE, cookie, ...(init.headers ?? {}) } })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  if (!r.ok) throw new Error(`${path} ${r.status} ${typeof j === 'string' ? j.slice(0, 300) : JSON.stringify(j).slice(0, 600)}`)
  return j
}

const { project: p } = await project(P)
const end = p.scene.content.timeline.frameEnd
const args = {
  content: 'both', propIds: ['user_prop_6awe79i6'],   // rod: keyed motion + animated texture (filmPropAnimation.ts)
  effectsPolicy: { mode: 'include', target: { runtime: 'bbs-fs-2.7', aaaRendererAvailable: true, compatibleAddonConfirmed: true, gameDir: GAME } },
  worldAnchor: { mode: 'local-origin', pivot: [-0.6, 0, 1.2], destination: [107.08, -60, 207.13], yawDegrees: -64.47, dimension: 'minecraft:overworld' },
  characterIds: Object.keys(p.characters), sequenceId: 'sequence_1', range: { startFrame: 0, endFrame: 224 }, viewportAspect: 16 / 9, filmName: FILM,
}
const pre = await command(P, 'film.preflight', { ...Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'filmName')), mode: 'film' })
const pf = pre.result.preflight
console.log('preflight errors', JSON.stringify(pf.errors), 'warnings', (pf.warnings ?? []).map((w) => w.code ?? w.message).join(', '))
if (pf.errors.length) process.exit(1)
const started = await command(P, 'film.export', args)
const jobId = String(started.result.jobId)
let job
for (let i = 0; i < 900; i++) {
  job = await raw(`/api/unified/projects/${P}/jobs/${jobId}`)
  job = job.job ?? job
  if (job.state !== 'queued' && job.state !== 'running') break
  if (i % 10 === 0) console.log(`export ${Math.round((job.progress ?? 0) * 100)}%`)
  await new Promise((r) => setTimeout(r, 1000))
}
if (job.state !== 'succeeded') throw new Error('export failed: ' + JSON.stringify(job.error ?? job).slice(0, 600))
const zipFile = job.result.files.find((f) => f.name.toLowerCase().endsWith('.zip'))
console.log('zip', zipFile.name, zipFile.byteLength ?? '')
// keep a copy of the ZIP for the user
const bytes = Buffer.from(await (await fetch(`${BASE}/api/unified/projects/${P}/jobs/${jobId}/files/${zipFile.id}`, { headers: { origin: BASE, cookie } })).arrayBuffer())
mkdirSync('S:/Claude/w01-samples/tap15v3/film-zips', { recursive: true })
writeFileSync(`S:/Claude/w01-samples/tap15v3/film-zips/${zipFile.name}`, bytes)
console.log('saved', `S:/Claude/w01-samples/tap15v3/film-zips/${zipFile.name}`, bytes.length)
const plan = (await raw('/api/unified/bbs-install/plan-job', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: P, jobId, fileId: zipFile.id, gameDir: GAME, worldName: WORLD }) })).plan
const counts = plan.files.reduce((m, f) => (m[f.status] = (m[f.status] ?? 0) + 1, m), {})
console.log('plan', JSON.stringify(counts), plan.files.filter((f) => /films/.test(f.target ?? f.path ?? '')).map((f) => f.target ?? f.path).join(' | '))
if (process.env.APPLY !== '1') { console.log('preview only (set APPLY=1 to install)'); process.exit(0) }
const applied = await raw('/api/unified/bbs-install/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planId: plan.planId }) })
console.log('installed', JSON.stringify(applied).slice(0, 600))
