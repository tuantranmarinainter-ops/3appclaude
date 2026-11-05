// Install a finished film export job into the game world (Cài vào game). Minecraft must be closed.
//   W01_API=http://127.0.0.1:3133 W01_ALLOW_REAL=1 node install-job.mjs <jobId>
import { BASE } from '../w01api.mjs'
const P = '5673640e-bfd9-4a96-8d22-0e8a648ee130', GAME = 'S:\\Minecraft\\Minecraft Forge-1.20.1', WORLD = 'Thế giới mới (1)'
const jobId = process.argv[2]
let cookie = ''
const raw = async (path, body) => {
  if (!cookie) cookie = ((await fetch(BASE + '/api/unified/session', { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: '{}' })).headers.get('set-cookie') ?? '').split(';')[0]
  const r = await fetch(BASE + path, { method: 'POST', headers: { origin: BASE, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j).slice(0, 500)}`)
  return j
}
const { plan } = await raw('/api/unified/bbs-install/plan-job', { projectId: P, jobId, fileId: '0', gameDir: GAME, worldName: WORLD })
console.log('plan', plan.files.length, 'files', JSON.stringify(plan.files.reduce((m, f) => (m[f.status] = (m[f.status] ?? 0) + 1, m), {})))
const res = await raw('/api/unified/bbs-install/apply', { planId: plan.planId })
console.log(JSON.stringify(res).slice(0, 800))
