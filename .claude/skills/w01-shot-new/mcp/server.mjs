// w01-shot MCP server: newline-delimited JSON-RPC 2.0 over stdio, no dependencies. Tools live in ./tools/*.mjs.
import { readdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tools')
const tools = new Map()
for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs')).sort()) {
  try {
    const m = await import(pathToFileURL(path.join(dir, f)).href)
    // a module can export tool objects (default / named / arrays) or BE one tool (export const name, run, …)
    const list = [m.default, ...Object.values(m), ...(typeof m.name === 'string' && typeof m.run === 'function' ? [{ ...m }] : [])].flatMap((x) => (Array.isArray(x) ? x : [x]))
    for (const t of list) if (t && typeof t === 'object' && typeof t.name === 'string' && typeof t.run === 'function') tools.set(t.name, t)
  } catch (e) { console.error(`w01-shot: failed to load tools/${f}: ${e.message}`) }
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

async function handle(req) {
  const { id, method, params } = req
  const isNote = id === undefined || id === null
  switch (method) {
    case 'initialize':
      return reply(id, { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'w01-shot', version: '0.1.0' } })
    case 'notifications/initialized': return
    case 'ping': return reply(id, {})
    case 'tools/list':
      return reply(id, { tools: [...tools.values()].map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
    case 'tools/call': {
      const t = tools.get(params?.name)
      if (!t) return reply(id, { content: [{ type: 'text', text: `ERROR: unknown tool ${params?.name}` }], isError: true })
      try {
        const text = await t.run(params?.arguments ?? {})
        return reply(id, { content: [{ type: 'text', text: String(text) }] })
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: 'ERROR: ' + (e?.message ?? String(e)) }], isError: true })
      }
    }
    default:
      if (!isNote && !String(method).startsWith('notifications/')) fail(id, -32601, `Method not found: ${method}`)
  }
}

const rl = createInterface({ input: process.stdin })
let pending = 0, closed = false
rl.on('line', (line) => {
  if (!line.trim()) return
  let req
  try { req = JSON.parse(line) } catch { return fail(null, -32700, 'Parse error') }
  pending++
  handle(req).catch((e) => { console.error(e); if (req.id != null) fail(req.id, -32603, String(e?.message ?? e)) }).finally(() => { pending--; if (closed && !pending) process.exit(0) })
})
rl.on('close', () => { closed = true; if (!pending) process.exit(0) })
