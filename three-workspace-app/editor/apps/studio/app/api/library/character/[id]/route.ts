import { readFile, realpath, access } from 'node:fs/promises'
import path from 'node:path'
import { listLibraryCharacters, resolveLibraryPath } from '../../../../../../../packages/library/index'

export const runtime = 'nodejs'

const BUILTIN = new Set([
  'a3d_char_de37873a79244fbe8a0660ea08d1b4ab',
  'a3d_char_7d220ac359844c80a8faaf0e25478477',
  'a3d_char_461b4f4b76ae4b198f439fa4f6f743b6',
  'a3d_char_30ec53c93eae4173946b38639691ebe0',
])

async function builtinCharacterPath(id: string): Promise<string> {
  let directory = process.cwd()
  for (;;) {
    const candidate = path.resolve(directory, 'builtin-assets/characters', `${id}.glb`)
    try {
      await access(candidate)
      return candidate
    } catch { /* keep walking toward the workspace root */ }
    const parent = path.dirname(directory)
    if (parent === directory) throw new Error('Built-in character is unavailable')
    directory = parent
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params
    let file: string
    if (BUILTIN.has(id)) file = await builtinCharacterPath(id)
    else {
      const character = listLibraryCharacters().find((item) => item.charId === id)
      if (!character || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) || character.model !== 'model.glb') return new Response('Character not found', { status: 404 })
      const root = await realpath(path.resolve(resolveLibraryPath(), 'characters'))
      const characterRoot = await realpath(path.resolve(root, id))
      file = await realpath(path.resolve(characterRoot, character.model))
      if (!characterRoot.startsWith(`${root}${path.sep}`) || !file.startsWith(`${characterRoot}${path.sep}`)) return new Response('Character not found', { status: 404 })
    }
    return new Response(await readFile(file), { headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch { return new Response('Character not found', { status: 404 }) }
}
