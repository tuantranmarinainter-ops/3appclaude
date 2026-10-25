/** External Emoticons meshes remain outside Git. Explicit copied-library migration only. */
import { copyFileSync, existsSync, lstatSync, statSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { listLibraryCharacters, registerBaseModel, setCharacterBaseModel, setCharacterSkin } from '../../library/index.ts'
import { parseBobjModel } from '../src/bobjModel.ts'

const reference = parseBobjModel(readFileSync(new URL('../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj', import.meta.url), 'utf8')).armature
const contained = (parent: string, child: string) => { const rel = relative(parent, child); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)) }
/** Reject links throughout a destination tree before any library mutation. */
function noLinks(path: string): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) throw Error('Copied library must contain no symlinks/junctions')
  if (!stat.isDirectory() && !stat.isFile()) throw Error('Copied library must contain only regular files')
  if (lstatSync(path).isDirectory()) for (const name of readdirSync(path)) noLinks(join(path, name))
}
export function validateEmoticonsModel(file: string) {
  const model = parseBobjModel(readFileSync(file, 'utf8'))
  if (model.armature.bones.length !== 20 || !model.positions.length || !model.objects.length || !model.objects.some(o => o.faces.length)) throw Error('Requires a mesh and exactly 20 Minecraft20 bones')
  for (const bone of reference.bones) {
    const actual = model.armature.bones.find(b => b.name === bone.name)
    if (!actual || actual.parent !== bone.parent || actual.restWorld.some((v, i) => Math.abs(v - bone.restWorld[i]) > 0.001)) throw Error(`Incompatible Minecraft20 rest skeleton: ${bone.name}`)
  }
  const ys = model.positions.map(p => p[1]), floor = Math.min(...ys), height = Math.max(...ys) - floor
  if (Math.abs(floor) > 0.15 || height < 1.5 || height > 2.5) throw Error('Unexpected native metre scale/floor; inspect external model before migration')
  return model
}
function skin64(file: string): void {
  const png = readFileSync(file)
  if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || png.toString('ascii',12,16) !== 'IHDR' || png.readUInt32BE(16) !== 64 || png.readUInt32BE(20) !== 64) throw Error('Each character requires a 64x64 PNG skin')
}
export function migrateMinecraft20Emoticons(options: { copiedLibrary: string; sourceLibrary: string; baseDir?: string; variant?: string; dryRun?: boolean }) {
  const root = realpathSync(resolve(options.copiedLibrary)), source = realpathSync(resolve(options.sourceLibrary))
  if (contained(source, root) || contained(root, source)) throw Error('Copied library must be separate from original source library')
  if (process.env.W01_LIBRARY && contained(realpathSync(process.env.W01_LIBRARY), root)) throw Error('Refusing configured live W01_LIBRARY')
  noLinks(root)
  const baseDir = options.baseDir ?? process.env.W01_MC20_BASE_DIR
  if (!baseDir) throw Error('Set W01_MC20_BASE_DIR or --base-dir to external extracted models')
  const variant = options.variant ?? 'default'
  if (!/^[a-zA-Z0-9_-]+$/.test(variant)) throw Error('Unsafe model variant')
  const file = join(realpathSync(baseDir), `${variant}.bobj`), model = validateEmoticonsModel(file)
  const characters = listLibraryCharacters({ root }).filter(c => c.rig === 'minecraft20')
  // Preflight every skin before registering anything.
  for (const c of characters) skin64(join(root, 'characters', c.charId, 'skin.png'))
  return characters.map(c => {
    if (options.dryRun) return { charId: c.charId, status: 'would-migrate' }
    const stage = mkdtempSync(join(tmpdir(), 'mc20-emoticons-'))
    try {
      for (const object of model.objects) {
        const dest = join(stage, 'textures', ...object.name.split('/'), 'default.png')
        mkdirSync(dirname(dest), { recursive: true }); copyFileSync(join(root, 'characters', c.charId, 'skin.png'), dest)
      }
      // Dereference external input into staging; metadata contains only basename, never original user paths.
      copyFileSync(file, join(stage, 'model.bobj'))
      const base = registerBaseModel({ root, name: c.name, rig: 'minecraft20', ownerCharId: c.charId, modelFile: join(stage, 'model.bobj'), texturesDir: join(stage, 'textures'), license: { id: 'Emoticons-external-license-unverified', commitable: false } })
      setCharacterBaseModel({ root, charId: c.charId, baseModelId: base.modelId }); setCharacterSkin({ root, charId: c.charId })
      return { charId: c.charId, status: 'migrated', modelId: base.modelId }
    } finally { rmSync(stage, { recursive: true, force: true }) }
  })
}
/** Make a new physical copy; never preserve source symlinks/junctions. */
export function copyLibraryForMinecraft20(sourceLibrary: string, destination: string): void {
  const source = realpathSync(sourceLibrary), target = resolve(destination)
  if (existsSync(target) || contained(source, target)) throw Error('Copy destination must be new and outside original library')
  // Resolve nearest existing parent to prevent destination parent links redirecting into original.
  let parent = dirname(target)
  while (!existsSync(parent)) parent = dirname(parent)
  if (contained(source, realpathSync(parent))) throw Error('Copy destination resolves into original library')
  const copy = (from: string, to: string, ancestors = new Set<string>()) => {
    const actual = realpathSync(from)
    if (ancestors.has(actual)) throw Error('Cyclic source symlink')
    if (statSync(actual).isDirectory()) {
      mkdirSync(to); const next = new Set(ancestors).add(actual)
      for (const name of readdirSync(actual)) copy(join(actual, name), join(to, name), next)
    } else if (statSync(actual).isFile()) copyFileSync(actual, to)
    else throw Error('Only regular source files can be copied')
  }
  copy(source, target)
  noLinks(target)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'source-library': { type: 'string' }, 'copied-library': { type: 'string' }, 'base-dir': { type: 'string' }, variant: { type: 'string' }, copy: { type: 'boolean' }, 'dry-run': { type: 'boolean' } } })
  if (!values['source-library'] || !values['copied-library']) throw Error('Explicit --source-library and --copied-library required')
  if (values.copy) copyLibraryForMinecraft20(values['source-library'], values['copied-library'])
  console.log(JSON.stringify(migrateMinecraft20Emoticons({ sourceLibrary: values['source-library'], copiedLibrary: values['copied-library'], baseDir: values['base-dir'], variant: values.variant, dryRun: values['dry-run'] }), null, 2))
}
