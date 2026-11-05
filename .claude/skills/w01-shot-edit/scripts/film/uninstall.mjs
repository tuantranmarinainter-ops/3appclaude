import { BASE } from '../w01api.mjs'
const cookie = ((await fetch(BASE + '/api/unified/session', { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: '{}' })).headers.get('set-cookie') ?? '').split(';')[0]
const r = await fetch(BASE + '/api/unified/bbs-install/uninstall', { method: 'POST', headers: { origin: BASE, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ gameDir: 'S:/Minecraft/Minecraft Forge-1.20.1', installId: process.argv[2] }) })
console.log(r.status, (await r.text()).slice(0, 400))
