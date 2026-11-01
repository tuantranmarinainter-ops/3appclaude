import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { getAction } from '../../../packages/library/library'
import { resolveCharacter } from '../../../packages/library/characters'
import { resolveLibraryPath } from '../../../packages/library/store'

// Server-only CLI bridge; keep its .ts-suffix graph out of Studio's TS compilation.
const { decodeGlb, encodeGlb } = require('../../../packages/retarget/cli/glb') as {
  decodeGlb(bytes: Uint8Array): { json: GlbJson; bin: Uint8Array }
  encodeGlb(json: GlbJson, bin: Uint8Array): Uint8Array
}
interface GlbJson {
  extras?: { libraryMotionConversion?: string }
  nodes?: Array<{ name?: string; children?: number[] }>
  skins?: Array<{ joints: number[] }>
  animations?: Array<{ name?: string; channels: unknown[] }>
}
interface Model { actions: Map<string, { name: string }>; armature: { bones: Array<{ name: string }> } }
const { parseBobjModel, bobjModelToGlb, bobjModelNodeName } = require('../../../packages/retarget/src/bobjModel') as {
  parseBobjModel(text: string): Model
  bobjModelToGlb(model: Model, options?: { faceForward: boolean }): { bytes: Uint8Array }
  bobjModelNodeName(name: string): string
}
const { parseBobjActions } = require('../../../packages/retarget/src/index') as { parseBobjActions(text: string): Model['actions'] }
const { MIXAMO65_BONE_PARENTS } = require('../../../packages/retarget/src/mixamo65') as { MIXAMO65_BONE_PARENTS: Array<[string, string | null]> }
const { exportMinecraft20 } = require('../../../packages/retarget/cli/toMinecraft20') as {
  exportMinecraft20(glb: Uint8Array, text: string, settings: { rootTravelMode: 'inPlace' | 'follow' }): Promise<{ bobj: string; report: { status: string } }>
}

export interface LibraryMotionConversionRecipe {
  version: 1
  sourceActionUuid: string
  sourceSha256: string
  sourceAnimationIndex: number
  sourceActionName: string
  sourceRig: 'mixamo65'
  targetCharId: string
  targetRig: 'minecraft20'
  targetBaseModelSha256: string
  converterVersion: string
  parameters: { rootTravelMode: 'inPlace' | 'follow'; ground: 'off' }
}
export class LibraryMotionConversionRequiredError extends Error {
  readonly code = 'CONVERSION_REQUIRED'
}
export interface LibraryMotionConversionOptions { libraryRoot?: string; cacheRoot?: string }
export interface MaterializedLibraryMotionConversion {
  recipe: LibraryMotionConversionRecipe
  cacheKey: string
  glbPath: string
  bobjPath: string
  glb: Uint8Array
  bobj: string
  durationSeconds: number
  actionName: string
}
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
const canonical = (value: string) => value.replace(/^mixamorig[:_]?/i, '').toLowerCase()
function editorRoot(): string {
  let current = resolve(process.cwd())
  for (let depth = 0; depth < 8; depth++, current = dirname(current)) {
    for (const candidate of [current, join(current, 'three-workspace-app/editor')]) {
      if (existsSync(join(candidate, 'packages/retarget/cli/toMinecraft20.ts'))) return candidate
    }
  }
  throw new Error('Không tìm thấy bộ chuyển động tác cục bộ')
}
const cliRoot = resolve(editorRoot(), 'packages/retarget')
// Content version includes the solver, writer, preset and GLB conversion code, independent of a checkout's HEAD.
function converterVersion(): string {
  const walk = (directory: string): string[] => readdirSync(join(cliRoot, directory), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : entry.name.endsWith('.ts') ? [`${directory}/${entry.name}`] : [])
  const files = ['cli', 'src'].flatMap(walk).sort()
  return `b34-v1:${sha([...files.map((file) => `${file}\n${sha(readFileSync(join(cliRoot, file)))}`), sha(readFileSync(join(editorRoot(), 'apps/studio/src/libraryMotionConversion.ts'))), sha(readFileSync(resolve(cliRoot, '../../pnpm-lock.yaml')))].join('\n'))}`
}
function noSymlinks(path: string): void {
  let current = resolve(path)
  while (true) {
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('Conversion paths must not contain symbolic links') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}
function checkedRead(path: string, root: string): Buffer {
  noSymlinks(path)
  const rel = relative(realpathSync(root), realpathSync(path))
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Conversion input escapes library root')
  return readFileSync(path)
}
function inputs(actionUuid: string, charId: string, options: LibraryMotionConversionOptions, recipe?: LibraryMotionConversionRecipe) {
  // The configured root may itself be a junction (C:\w01-library -> S:\...); only links inside the library are rejected.
  const root = realpathSync(resolveLibraryPath({ root: options.libraryRoot }))
  noSymlinks(root)
  const source = getAction({ root, actionUuid })
  const target = resolveCharacter({ root, charId })
  if (source.rig !== 'mixamo65' || target.character.rig !== 'minecraft20') throw new Error('Chỉ tự chuyển Mixamo65 sang Minecraft20')
  if (target.baseModel?.format !== 'bobj' || target.baseModel.rig !== 'minecraft20') throw new Error('Nhân vật cần model BOBJ Minecraft20 để chuyển động tác')
  const raw = checkedRead(source.glbPath, root), targetBytes = checkedRead(target.modelPath, root)
  if (recipe && (recipe.sourceSha256 !== sha(raw) || recipe.sourceAnimationIndex !== source.glbAnimationIndex || recipe.sourceActionName !== source.name)) throw new LibraryMotionConversionRequiredError('Động tác gốc đã đổi — chuyển lại?')
  if (recipe && recipe.targetBaseModelSha256 !== sha(targetBytes)) throw new LibraryMotionConversionRequiredError('Model nhân vật đã đổi — chuyển lại?')
  const decoded = decodeGlb(raw)
  const nodes = decoded.json.nodes ?? []
  const joints = new Set((decoded.json.skins ?? []).flatMap((skin) => skin.joints))
  const actual = [...joints].map((index) => canonical(nodes[index]?.name ?? ''))
  const expected = MIXAMO65_BONE_PARENTS.map(([name]) => canonical(name))
  if (actual.length !== 65 || new Set(actual).size !== 65 || expected.some((name) => !actual.includes(name))) {
    throw new Error('Động tác không có khung xương Mixamo65 thực; cần chuẩn hoá trước khi chuyển')
  }
  for (const [name, parent] of MIXAMO65_BONE_PARENTS) {
    if (!parent) continue
    const parentIndex = [...joints].find((index) => canonical(nodes[index]?.name ?? '') === canonical(parent))!
    const childIndex = [...joints].find((index) => canonical(nodes[index]?.name ?? '') === canonical(name))!
    if (!nodes[parentIndex]?.children?.includes(childIndex)) throw new Error('Khung xương Mixamo65 có cấu trúc không hợp lệ')
  }
  const animation = decoded.json.animations?.[source.glbAnimationIndex]
  if (!animation) throw new Error('Động tác gốc thiếu animation')
  decoded.json.animations = [{ ...animation, name: source.name }]
  return { root, source, sourceSha256: sha(raw), targetSha256: sha(targetBytes), targetText: targetBytes.toString('utf8'), inputGlb: encodeGlb(decoded.json, decoded.bin) }
}
export async function createLibraryMotionConversion(input: LibraryMotionConversionOptions & {
  actionUuid: string; targetCharId: string; parameters?: Partial<LibraryMotionConversionRecipe['parameters']>
}): Promise<LibraryMotionConversionRecipe> {
  const data = inputs(input.actionUuid, input.targetCharId, input)
  const parameters = { rootTravelMode: 'inPlace' as const, ground: 'off' as const, ...input.parameters }
  if (!['inPlace', 'follow'].includes(parameters.rootTravelMode) || parameters.ground !== 'off') throw new Error('Unsupported conversion parameters')
  return { version: 1, sourceActionUuid: data.source.uuid, sourceSha256: data.sourceSha256, sourceAnimationIndex: data.source.glbAnimationIndex, sourceActionName: data.source.name, sourceRig: 'mixamo65', targetCharId: input.targetCharId,
    targetRig: 'minecraft20', targetBaseModelSha256: data.targetSha256, converterVersion: converterVersion(), parameters }
}
export async function materializeLibraryMotionConversion(recipe: LibraryMotionConversionRecipe, options: LibraryMotionConversionOptions = {}): Promise<MaterializedLibraryMotionConversion> {
  if (recipe.version !== 1 || recipe.sourceRig !== 'mixamo65' || recipe.targetRig !== 'minecraft20'
    || !['inPlace', 'follow'].includes(recipe.parameters?.rootTravelMode) || recipe.parameters.ground !== 'off') throw new Error('Công thức chuyển động tác không hợp lệ — cần chuyển lại')
  const data = inputs(recipe.sourceActionUuid, recipe.targetCharId, options, recipe)
  if (recipe.sourceSha256 !== data.sourceSha256 || recipe.sourceAnimationIndex !== data.source.glbAnimationIndex || recipe.sourceActionName !== data.source.name) throw new LibraryMotionConversionRequiredError('Động tác gốc đã đổi — chuyển lại?')
  if (recipe.targetBaseModelSha256 !== data.targetSha256) throw new LibraryMotionConversionRequiredError('Model nhân vật đã đổi — chuyển lại?')
  if (recipe.converterVersion !== converterVersion()) throw new LibraryMotionConversionRequiredError('Bộ chuyển đã đổi — chuyển lại?')
  // Reconstruct canonical field order; untrusted extra JSON keys cannot alter the cache key.
  const canonicalRecipe = { version: 1, sourceActionUuid: recipe.sourceActionUuid, sourceSha256: recipe.sourceSha256, sourceAnimationIndex: recipe.sourceAnimationIndex, sourceActionName: recipe.sourceActionName, sourceRig: recipe.sourceRig,
    targetCharId: recipe.targetCharId, targetRig: recipe.targetRig, targetBaseModelSha256: recipe.targetBaseModelSha256,
    converterVersion: recipe.converterVersion, parameters: { rootTravelMode: recipe.parameters.rootTravelMode, ground: recipe.parameters.ground } }
  const cacheKey = sha(JSON.stringify(canonicalRecipe)), cacheRoot = resolve(options.cacheRoot ?? join(tmpdir(), 'w01-motion-conversion-cache'))
  const rel = relative(data.root, cacheRoot)
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) throw new Error('Conversion cache must be outside the library')
  noSymlinks(cacheRoot)
  const directory = join(cacheRoot, cacheKey)
  noSymlinks(directory)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const glbPath = join(directory, 'motion.glb'), bobjPath = join(directory, 'motion.bobj'), manifestPath = join(directory, 'integrity.json')
  for (const path of [glbPath, bobjPath, manifestPath]) noSymlinks(path)
  let glb: Uint8Array | undefined, bobj: string | undefined
  try {
    const integrity = JSON.parse(readFileSync(manifestPath, 'utf8')) as { glb: string; bobj: string }
    const cachedGlb = readFileSync(glbPath), cachedBobj = readFileSync(bobjPath, 'utf8')
    if (sha(cachedGlb) === integrity.glb && sha(cachedBobj) === integrity.bobj) { glb = cachedGlb; bobj = cachedBobj }
  } catch { /* Disposable/incomplete cache is regenerated from validated inputs. */ }
  const actionName = `b34_${cacheKey.slice(0, 24)}`
  if (!glb || bobj === undefined) {
    const conversionInput = decodeGlb(data.inputGlb)
    conversionInput.json.animations![0]!.name = actionName
    const exported = await exportMinecraft20(encodeGlb(conversionInput.json, conversionInput.bin), data.targetText, { rootTravelMode: recipe.parameters.rootTravelMode })
    if (exported.report.status !== 'PASS') throw new Error('Chuyển Minecraft20 thất bại')
    const model = parseBobjModel(data.targetText)
    model.actions = parseBobjActions(exported.bobj)
    if (model.armature.bones.length !== 20 || model.actions.size !== 1) throw new Error('Kết quả chuyển phải có 20 xương và một động tác')
    const output = decodeGlb(bobjModelToGlb(model, { faceForward: true }).bytes), nodes = output.json.nodes ?? []
    const joints = model.armature.bones.map((bone) => nodes.findIndex((node) => node.name === bobjModelNodeName(bone.name)))
    if (joints.some((index) => index < 0)) throw new Error('Kết quả chuyển thiếu xương Minecraft20')
    output.json.extras = { ...output.json.extras, libraryMotionConversion: cacheKey }
    output.json.skins = [...(output.json.skins ?? []), { joints }]
    glb = encodeGlb(output.json, output.bin); bobj = `${data.targetText}\n${exported.bobj}`
    // Recheck immediately before writes; never follow pre-existing output symlinks.
    for (const path of [glbPath, bobjPath, manifestPath]) noSymlinks(path)
    const atomicWrite = (path: string, value: Uint8Array | string) => {
      const temporary = join(directory, `${randomUUID()}.tmp`)
      try { writeFileSync(temporary, value, { flag: 'wx', mode: 0o600 }); noSymlinks(directory); renameSync(temporary, path) }
      finally { rmSync(temporary, { force: true }) }
    }
    atomicWrite(glbPath, glb); atomicWrite(bobjPath, bobj)
    atomicWrite(manifestPath, JSON.stringify({ glb: sha(glb), bobj: sha(bobj) }))
  }
  return { recipe, cacheKey, glbPath, bobjPath, glb, bobj, durationSeconds: data.source.durationSeconds, actionName }
}
