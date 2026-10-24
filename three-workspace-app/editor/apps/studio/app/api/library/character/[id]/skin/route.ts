import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { listLibraryCharacters, resolveLibraryPath } from '../../../../../../../../packages/library/index'

export const runtime = 'nodejs'

/** 64×64 Minecraft player skin of a Minecraft20 library character (`characters/<id>/skin.png`), for library previews. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) || !listLibraryCharacters().some((item) => item.charId === id)) return new Response('Skin not found', { status: 404 })
    const root = await realpath(path.resolve(resolveLibraryPath(), 'characters'))
    const file = await realpath(path.resolve(root, id, 'skin.png'))
    if (!file.startsWith(`${root}${path.sep}`)) return new Response('Skin not found', { status: 404 })
    return new Response(await readFile(file), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch { return new Response('Skin not found', { status: 404 }) }
}
