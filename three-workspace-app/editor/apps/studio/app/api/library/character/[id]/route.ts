import { readFile, realpath, access } from 'node:fs/promises'
import path from 'node:path'
import { listLibraryCharacters, resolveLibraryPath } from '../../../../../../../packages/library/index'
import { libraryCharacterGlb } from '../../../../../src/libraryModels'

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

const notFound = () => new Response('Character not found', { status: 404 })
const glbResponse = (bytes: Buffer) => new Response(bytes, { headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params
    if (BUILTIN.has(id)) return glbResponse(await readFile(await builtinCharacterPath(id)))
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) return notFound()
    const character = listLibraryCharacters().find((item) => item.charId === id)
    if (!character) return notFound()
    const root = await realpath(path.resolve(resolveLibraryPath(), 'characters'))
    const characterRoot = await realpath(path.resolve(root, id))
    if (!characterRoot.startsWith(`${root}${path.sep}`)) return notFound()
    if (character.model === 'model.glb') {
      // Đường đi cũ giữ nguyên từng byte: bản GLB nằm ngay trong thư mục nhân vật.
      try {
        const file = await realpath(path.resolve(characterRoot, character.model))
        if (file.startsWith(`${characterRoot}${path.sep}`)) return glbResponse(await readFile(file))
      } catch { /* chưa có bản sao cạnh meta.json: dùng model gốc của thư viện bên dưới */ }
    }
    // Nhân vật `.bobj` (model.bbs.bobj / model.bobj — Minecraft20, Verity…) hoặc nhân vật
    // có base model nhưng thiếu bản sao GLB: resolveCharacter tìm model gốc
    // (models/<baseModelId> hoặc thư mục nhân vật) rồi chuyển sang GLB khi đọc,
    // cùng đường App 2 dùng để nạp nhân vật.
    return glbResponse(await libraryCharacterGlb(id))
  } catch { return notFound() }
}
