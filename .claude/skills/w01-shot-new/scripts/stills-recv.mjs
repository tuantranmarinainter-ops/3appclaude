// Receives PNG data URLs posted by the browser snippet in stills.md and writes <dir>/fNNNN.png.
//   node stills-recv.mjs <dir> [port=3147]     (run in the background, stop it when done)
import http from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
const dir = process.argv[2], port = Number(process.argv[3] ?? 3147)
if (!dir) throw new Error('usage: stills-recv.mjs <dir> [port]')
mkdirSync(dir, { recursive: true })
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Private-Network', 'true')
  if (req.method !== 'POST') { res.end('ok'); return }
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const f = new URL(req.url, 'http://x').searchParams.get('f')
    writeFileSync(`${dir}/f${String(f).padStart(4, '0')}.png`, Buffer.from(Buffer.concat(chunks).toString().split(',')[1], 'base64')); res.end('saved')
  })
}).listen(port, '127.0.0.1', () => console.log(`stills receiver on ${port} -> ${dir}`))
