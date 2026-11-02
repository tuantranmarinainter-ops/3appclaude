import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Matrix4, Vector3 } from 'three'
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
  extras?: { libraryMotionConversion?: string; libraryMotionConversionFloor?: unknown }
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
interface BobjActionLite { name: string; durationTicks: number; groups: Map<string, { channels: Array<{ path: string; index: number; keys: Array<{ t: number; v: number }> }> }> }
const { parseBobjActions, evaluateBobjAction } = require('../../../packages/retarget/src/index') as {
  parseBobjActions(text: string): Map<string, BobjActionLite>
  evaluateBobjAction(armature: unknown, action: unknown, tick: number): Array<{ name: string; worldMatrix: number[] }>
}
const { parseBobjArmature } = require('../../../packages/retarget/src/reverse') as {
  parseBobjArmature(text: string): { bones: Array<{ name: string; parent: string | null; restWorld: number[]; restLocal: number[] }> }
}
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
/** Bump to rebuild cached conversions; b10 = shin tips shifted onto the target rest floor. */
const FLOOR_FIT_VERSION = 'b10-floor-v1'
/** Same guard as groundAdjust.MAX_GROUND_OFFSET_HIPS_RATIO: a larger shift means wrong units, not wrong ground. */
const MAX_FLOOR_OFFSET_HIPS_RATIO = 0.5
export interface MinecraftFloorFit {
  applied: boolean
  /** Native BOBJ units added to the anchor along world +Y. */
  offsetNative: number
  restFloorNative: number | null
  clipLowestNative: number | null
  skipped?: 'NO_SHIN' | 'NO_ANCHOR' | 'OFFSET_TOO_LARGE'
}
/** Lowest shin tip (native units) over every tick; tip = shin origin extended by the rest knee-to-shin offset, in the shin's frame. */
export function minecraftShinTipFloor(armatureText: string, bobj: string): { restFloor: number; clipLowest: number } | undefined {
  const armature = parseBobjArmature(armatureText)
  const shins = ['low_left_leg', 'low_leg_right'].map((name) => armature.bones.find((bone) => bone.name === name)!)
  if (shins.some((bone) => !bone || !bone.parent)) return undefined
  const mat = (values: number[]) => new Matrix4().fromArray(values)
  const tipLocal = shins.map((shin) => {
    const parent = armature.bones.find((bone) => bone.name === shin.parent)!
    const origin = new Vector3().setFromMatrixPosition(mat(shin.restWorld)), parentOrigin = new Vector3().setFromMatrixPosition(mat(parent.restWorld))
    return origin.clone().multiplyScalar(2).sub(parentOrigin).applyMatrix4(mat(shin.restWorld).invert())
  })
  const restFloor = Math.min(...shins.map((shin, i) => tipLocal[i]!.clone().applyMatrix4(mat(shin.restWorld)).y))
  const action = [...parseBobjActions(bobj).values()][0]
  if (!action) return undefined
  let clipLowest = Infinity
  for (let tick = 0; tick <= action.durationTicks; tick++) {
    const posed = evaluateBobjAction(armature, action, tick)
    for (const [i, shin] of shins.entries()) {
      const bone = posed.find((item) => item.name === shin.name)!
      clipLowest = Math.min(clipLowest, tipLocal[i]!.clone().applyMatrix4(mat(bone.worldMatrix)).y)
    }
  }
  return { restFloor, clipLowest }
}
/**
 * B10: Mixamo hips sit above the Minecraft20 legs. Shift the anchor (root) by ONE constant per clip so the lowest shin tip
 * lands on the target's rest floor. Constant only, so jumps keep their height; skipped when the shift is unreasonably large.
 */
export function fitMinecraftFloor(armatureText: string, bobj: string): { bobj: string; fit: MinecraftFloorFit } {
  const none = (fit: Partial<MinecraftFloorFit>): { bobj: string; fit: MinecraftFloorFit } => ({ bobj, fit: { applied: false, offsetNative: 0, restFloorNative: null, clipLowestNative: null, ...fit } })
  const floor = minecraftShinTipFloor(armatureText, bobj)
  if (!floor) return none({ skipped: 'NO_SHIN' })
  const offset = floor.restFloor - floor.clipLowest
  const base = { restFloorNative: floor.restFloor, clipLowestNative: floor.clipLowest }
  const armature = parseBobjArmature(armatureText)
  const anchor = armature.bones.find((bone) => !bone.parent)
  const body = armature.bones.find((bone) => bone.name === 'body')
  if (!anchor) return none({ ...base, skipped: 'NO_ANCHOR' })
  if (Math.abs(offset) < 1e-6) return none(base)
  const hips = body ? new Vector3().setFromMatrixPosition(new Matrix4().fromArray(body.restWorld)).y : 0
  if (hips && Math.abs(offset) > MAX_FLOOR_OFFSET_HIPS_RATIO * hips) return none({ ...base, offsetNative: offset, skipped: 'OFFSET_TOO_LARGE' })
  // A world +Y shift is a location delta expressed in the anchor's rest frame (anchor has no parent).
  const restLinear = new Matrix4().fromArray(anchor.restLocal); restLinear.setPosition(0, 0, 0)
  const shift = new Vector3(0, offset, 0).applyMatrix4(restLinear.invert()).toArray()
  const action = [...parseBobjActions(bobj).values()][0]!
  const ticks = Math.max(0, Math.round(action.durationTicks))
  const channels = new Map((action.groups.get(anchor.name)?.channels ?? []).map((channel) => [`${channel.path} ${channel.index}`, channel]))
  const fmt = (value: number) => (Math.abs(value) < 5e-7 ? 0 : value).toFixed(6)
  const lines: string[] = [`ao ${anchor.name}`]
  for (const path of ['location', 'rotation', 'scale'] as const) {
    for (let axis = 0; axis < 3; axis++) {
      const channel = channels.get(`${path} ${axis}`), add = path === 'location' ? shift[axis]! : 0
      if (!channel && Math.abs(add) < 1e-9) continue
      const keys = channel?.keys ?? Array.from({ length: ticks + 1 }, (_, t) => ({ t, v: path === 'scale' ? 1 : 0 }))
      lines.push(`ag ${path} ${axis}`)
      for (const key of keys) lines.push(`kf ${key.t} ${fmt(key.v + add)} LINEAR ${key.t} ${fmt(key.v + add)} ${key.t} ${fmt(key.v + add)}`)
    }
  }
  const rows = bobj.split('\n'), start = rows.findIndex((row) => row === `ao ${anchor.name}`)
  let end = rows.length
  if (start >= 0) { const next = rows.findIndex((row, i) => i > start && /^(ao|an) /.test(row)); if (next >= 0) end = next }
  const at = start >= 0 ? start : Math.max(0, rows.findIndex((row) => row.startsWith('ao ')))
  const rebuilt = start >= 0 ? [...rows.slice(0, at), ...lines, ...rows.slice(end)] : [...rows.slice(0, at < 0 ? rows.length : at), ...lines, ...rows.slice(at < 0 ? rows.length : at)]
  return { bobj: rebuilt.join('\n'), fit: { applied: true, offsetNative: offset, ...base } }
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
  return `b34-v1:${FLOOR_FIT_VERSION}:${sha([...files.map((file) => `${file}\n${sha(readFileSync(join(cliRoot, file)))}`), sha(readFileSync(join(editorRoot(), 'apps/studio/src/libraryMotionConversion.ts'))), sha(readFileSync(resolve(cliRoot, '../../pnpm-lock.yaml')))].join('\n'))}`
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
    const floored = fitMinecraftFloor(data.targetText, exported.bobj)
    exported.bobj = floored.bobj
    const model = parseBobjModel(data.targetText)
    model.actions = parseBobjActions(exported.bobj) as unknown as Model['actions']
    if (model.armature.bones.length !== 20 || model.actions.size !== 1) throw new Error('Kết quả chuyển phải có 20 xương và một động tác')
    const output = decodeGlb(bobjModelToGlb(model, { faceForward: true }).bytes), nodes = output.json.nodes ?? []
    const joints = model.armature.bones.map((bone) => nodes.findIndex((node) => node.name === bobjModelNodeName(bone.name)))
    if (joints.some((index) => index < 0)) throw new Error('Kết quả chuyển thiếu xương Minecraft20')
    output.json.extras = { ...output.json.extras, libraryMotionConversion: cacheKey }
    output.json.skins = [...(output.json.skins ?? []), { joints }]
    output.json.extras = { ...output.json.extras, libraryMotionConversionFloor: floored.fit }
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
