import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { unifiedProjectsRoot } from '../../../../src/unifiedProjectStore'
import { validateLocalRequest } from '../../../../src/unifiedSession'

export const runtime = 'nodejs'

const MAX_ENTRIES = 500
const MAX_BYTES = 1024 * 1024

/** Appends the App 2 "Debug" recorder batch to `<projects dir>/.debug-logs/<session>.jsonl` (local only). */
export async function POST(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  try {
    const text = await request.text()
    if (text.length > MAX_BYTES) return Response.json({ error: 'Debug batch too large' }, { status: 413 })
    const body = JSON.parse(text) as { sessionId?: unknown; entries?: unknown }
    if (typeof body.sessionId !== 'string' || !/^[0-9A-Za-z-]{8,64}$/.test(body.sessionId)) return Response.json({ error: 'sessionId is invalid' }, { status: 400 })
    if (!Array.isArray(body.entries) || body.entries.length > MAX_ENTRIES || body.entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
      return Response.json({ error: `entries must be 0-${MAX_ENTRIES} objects` }, { status: 400 })
    }
    const directory = path.join(unifiedProjectsRoot(), '.debug-logs')
    const file = path.join(directory, `${body.sessionId}.jsonl`)
    await mkdir(directory, { recursive: true })
    if (body.entries.length) await appendFile(file, body.entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8')
    return Response.json({ path: file, written: body.entries.length })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'IO_FAILED' }, { status: 400 })
  }
}
