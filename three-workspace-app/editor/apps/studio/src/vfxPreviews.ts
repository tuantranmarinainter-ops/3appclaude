import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

// Sprite sheets baked from Effekseer by App 4 (`vfx/tools/bake_sprite_sheet.py`) for the App 2 viewport preview.
// They live outside the repository (binary, per machine): W01_VFX_PREVIEWS or ./vfx-previews.

const EFFECT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function vfxPreviewRoot(): string {
  return path.resolve(process.env.W01_VFX_PREVIEWS?.trim() || path.join(process.cwd(), 'vfx-previews'))
}

/** Effect name → sheet.json metadata, for every effect folder with both files. */
export async function listVfxPreviews(): Promise<Record<string, unknown>> {
  const root = vfxPreviewRoot()
  let names: string[]
  try { names = await readdir(root) } catch { return {} }
  const result: Record<string, unknown> = {}
  for (const name of names) {
    if (!EFFECT.test(name)) continue
    try { result[name] = JSON.parse(await readFile(path.join(root, name, 'sheet.json'), 'utf8')) } catch { /* not a baked effect */ }
  }
  return result
}

export async function readVfxSheetImage(effect: string): Promise<Uint8Array | null> {
  if (!EFFECT.test(effect)) return null
  try { return await readFile(path.join(vfxPreviewRoot(), effect, 'sheet.png')) } catch { return null }
}
