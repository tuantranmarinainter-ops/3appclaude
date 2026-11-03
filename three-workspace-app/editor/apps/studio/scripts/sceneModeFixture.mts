/**
 * App 3 scene-mode measurement fixture (docs/APP3-SCENE-MODE-TASK-2026-11-03.md sections 8, 10.5, 10.7).
 *
 * Run from three-workspace-app/editor/packages/builder:
 *
 *   node --import tsx ../../apps/studio/scripts/sceneModeFixture.mts --synthetic --out <dir> [--characters 2|5]
 *   node --import tsx ../../apps/studio/scripts/sceneModeFixture.mts --projects <dir> --project <projectId> --out <dir> \
 *        [--five] [--first <characterId>] [--range a-b]
 *
 * --synthetic  Sets BBS_UNIFIED_PROJECTS_DIR=<out>/projects and W01_LIBRARY=<out>/library (empty temp library), generates a
 *              Mixamo65 GLB with packages/retarget/cli/normalize.ts (two Actions: 28 + 47 frames) and builds N characters
 *              (spacing 1.5 m, different yaw). With 2: A has a chain of two adjacent clips, B has one clip. With 5: clips are
 *              staggered (chains, partial coverage). Always adds a camera (project.create default).
 * --projects   Works on an EXISTING project folder that MUST be a COPY. Refused (exit 2) when --projects or env W01_LIBRARY is
 *              unset/inside a real root (w01-library, tap15v3, tall-projects, tall-lib). --five adds characters until there are
 *              5 by duplicating existing ones (character.add with the same assetId/skeletonId and library metadata if the node
 *              has it), offsets them (scene.layout.apply) and copies one existing clip each (motion.place with its motionId).
 *              This writes into the copy (one revision per command).
 * --decode-draco  (default ON with --synthetic) rewrites every GLB that uses KHR_draco_mesh_compression (builtin characters) into
 *              an uncompressed GLB before asset.import, using the Emscripten decoder shipped in three. Fixture-only.
 * Outputs      <out>/scene-<n>.zip (shot package from shot.export sceneMode:true, n = characters in the shot) and
 *              <out>/scene-<n>.reference.json = { projectId, frameRange, fps:30, exportMs, characters:[{characterId, name,
 *              frames:{ "<frame>": { root: actorWorldMatrix16, bones: { <name>: worldMatrix16 } } }}] } sampled with
 *              sampleProjectSkeletonRange at the first, middle and last frame of the shot frameRange (App 2 sampler = reference).
 *              Prints one JSON summary line. Defaults: --first = first character, --range = whole timeline (0 .. last clip end).
 *              The shot frameRange may be wider than --range (chain widening).
 */
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  synthetic: { type: 'boolean' }, characters: { type: 'string' }, out: { type: 'string' }, projects: { type: 'string' },
  project: { type: 'string' }, five: { type: 'boolean' }, first: { type: 'string' }, range: { type: 'string' },
  'decode-draco': { type: 'boolean' },
} })
/** --decode-draco: default ON for --synthetic (builtin characters are Draco; App 3 has no DRACOLoader). Fixture-only. */
const decodeDraco = values['decode-draco'] ?? Boolean(values.synthetic)

const REAL_ROOTS = ['S:/Claude/w01-library', 'C:/w01-library', 'S:/Claude/w01-samples/tap15v3', 'S:/Claude/w01-samples/tall-projects', 'S:/Claude/w01-samples/tall-lib']
const norm = (p: string) => p.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
/** Windows drive paths are compared as written (path.resolve would turn them into cwd-relative paths on Linux). */
const resolved = (p: string) => (/^[a-z]:[\\/]/i.test(p) ? norm(p) : norm(path.resolve(p)))
const insideReal = (p: string) => [resolved(p), norm(p)].some((candidate) => REAL_ROOTS.some((root) => {
  const r = norm(root)
  return candidate === r || candidate.startsWith(`${r}/`)
}))
const refuse = (message: string): never => { console.error(message); process.exit(2) }
const usage = (message: string): never => { console.error(message); process.exit(1) }

if (!values.out) usage('Thiếu --out <thư mục>')
const out = path.resolve(values.out!)
if (insideReal(values.out!)) refuse(`Từ chối: --out nằm trong thư mục thật (${values.out}). Chỉ dùng bản sao.`)
mkdirSync(out, { recursive: true })

let projectsDir: string
if (values.synthetic) {
  projectsDir = path.join(out, 'projects')
  process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
  process.env.W01_LIBRARY = path.join(out, 'library')
  mkdirSync(process.env.W01_LIBRARY, { recursive: true })
} else if (values.projects) {
  if (insideReal(values.projects)) refuse(`Từ chối: --projects trỏ vào thư mục dự án thật (${values.projects}). Hãy dùng BẢN SAO.`)
  const library = process.env.W01_LIBRARY
  if (!library) refuse('Từ chối: chưa đặt biến môi trường W01_LIBRARY. Hãy trỏ tới thư viện tạm/bản sao.')
  else if (insideReal(library)) refuse(`Từ chối: W01_LIBRARY trỏ vào thư viện thật (${library}). Hãy dùng bản sao.`)
  projectsDir = /^[a-z]:[\\/]/i.test(values.projects) ? values.projects : path.resolve(values.projects)
  process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
  if (!values.project) usage('Thiếu --project <projectId>')
} else usage('Dùng --synthetic hoặc --projects <thư mục> --project <id>')

const here = path.dirname(fileURLToPath(import.meta.url))
const editor = path.resolve(here, '../../..')
const { makeEmptyDraft } = await import('@topview/3d-builder')
const { executeUnifiedCommand, readUnifiedProject } = await import('../src/unifiedProjectStore.ts')
const { stageAssetUpload } = await import('../src/unifiedAssetFiles.ts')
const { sampleProjectSkeletonRange } = await import('../src/unifiedSkeletonEvaluation.ts')
const { getUnifiedJob, readUnifiedJobFile } = await import('../src/unifiedJobs.ts')

type Project = Awaited<ReturnType<typeof readUnifiedProject>>
const upload = (data: Uint8Array, name: string) => stageAssetUpload(name, new ReadableStream({ start(c) { c.enqueue(data); c.close() } }))

// ------------------------------------------------------------------------------------------------ Draco -> plain GLB
const GLB_MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
let dracoModule: Promise<any> | undefined
function loadDracoModule() {
  dracoModule ??= (async () => {
    const { createRequire } = await import('node:module')
    const pnpm = path.join(editor, 'node_modules/.pnpm')
    const dir = readdirSync(pnpm).find((d) => d.startsWith('three@'))
    if (!dir) throw new Error('Không tìm thấy three trong node_modules/.pnpm')
    const file = path.join(pnpm, dir, 'node_modules/three/examples/jsm/libs/draco/draco_decoder.js')
    const factory = createRequire(import.meta.url)(file) // pure-JS (asm.js) Emscripten build, UMD
    return await factory({})
  })()
  return dracoModule
}

/** Returns the same bytes when the GLB has no Draco primitive; otherwise a plain GLB with decoded accessors. */
async function decodeDracoGlb(input: Uint8Array): Promise<{ bytes: Uint8Array; primitives: number; accessors: Array<{ accessor: number; count: number }> }> {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('Không phải GLB')
  const jsonLen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'))
  const binHeader = 20 + jsonLen
  const bin = binHeader < buf.length && buf.readUInt32LE(binHeader + 4) === CHUNK_BIN ? buf.subarray(binHeader + 8, binHeader + 8 + buf.readUInt32LE(binHeader)) : Buffer.alloc(0)
  const EXT = 'KHR_draco_mesh_compression'
  const prims: any[] = (json.meshes ?? []).flatMap((m: any) => m.primitives).filter((p: any) => p.extensions?.[EXT])
  if (!prims.length) return { bytes: input, primitives: 0, accessors: [] }
  const D = await loadDracoModule()
  const dtypeOf: Record<number, [number, any]> = { 5120: [D.DT_INT8, Int8Array], 5121: [D.DT_UINT8, Uint8Array], 5122: [D.DT_INT16, Int16Array], 5123: [D.DT_UINT16, Uint16Array], 5125: [D.DT_UINT32, Uint32Array], 5126: [D.DT_FLOAT32, Float32Array] }
  const dracoViews = new Set<number>(prims.map((p) => p.extensions[EXT].bufferView))
  // New binary chunk: every surviving bufferView copied (4-aligned) then one new view per decoded accessor.
  const chunks: Buffer[] = []
  let cursor = 0
  const append = (data: Uint8Array) => { const offset = cursor; chunks.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength)); cursor += data.byteLength; const pad = (4 - (cursor % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); cursor += pad } return offset }
  const oldViews: any[] = json.bufferViews ?? []
  const views: any[] = []
  const remap = new Map<number, number>()
  oldViews.forEach((view, index) => {
    if (dracoViews.has(index)) return
    const start = view.byteOffset ?? 0
    remap.set(index, views.length)
    views.push({ ...view, buffer: 0, byteOffset: append(bin.subarray(start, start + view.byteLength)) })
  })
  for (const accessor of json.accessors ?? []) if (accessor.bufferView !== undefined) accessor.bufferView = remap.get(accessor.bufferView) ?? accessor.bufferView
  for (const image of json.images ?? []) if (image.bufferView !== undefined) image.bufferView = remap.get(image.bufferView)
  const decoded: Array<{ accessor: number; count: number }> = []
  const addAccessorData = (accessorIndex: number, data: Uint8Array, target?: number) => {
    const accessor = json.accessors[accessorIndex]
    views.push({ buffer: 0, byteOffset: append(data), byteLength: data.byteLength, ...(target ? { target } : {}) })
    accessor.bufferView = views.length - 1
    delete accessor.byteOffset
    decoded.push({ accessor: accessorIndex, count: accessor.count })
  }
  for (const prim of prims) {
    const ext = prim.extensions[EXT]
    const view = oldViews[ext.bufferView]
    const start = view.byteOffset ?? 0
    const raw = bin.subarray(start, start + view.byteLength)
    const decoder = new D.Decoder(), dbuf = new D.DecoderBuffer(), mesh = new D.Mesh()
    try {
      dbuf.Init(new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength), raw.byteLength)
      if (decoder.GetEncodedGeometryType(dbuf) !== D.TRIANGULAR_MESH) throw new Error('Draco: không phải TRIANGULAR_MESH')
      const status = decoder.DecodeBufferToMesh(dbuf, mesh)
      if (!status.ok() || !mesh.ptr) throw new Error(`Draco decode lỗi: ${status.error_msg()}`)
      const points = mesh.num_points()
      for (const [semantic, accessorIndex] of Object.entries<number>(prim.attributes)) {
        const accessor = json.accessors[accessorIndex]
        const [dtype, Ctor] = dtypeOf[accessor.componentType] ?? (() => { throw new Error(`componentType ${accessor.componentType}`) })()
        const attr = decoder.GetAttributeByUniqueId(mesh, ext.attributes[semantic])
        const n = COMPONENTS[accessor.type]!
        if (attr.num_components() !== n) throw new Error(`${semantic}: ${attr.num_components()} thành phần, accessor ${n}`)
        if (points !== accessor.count) throw new Error(`${semantic}: Draco ${points} điểm, accessor ${accessor.count}`)
        const bytes = points * n * BYTES[accessor.componentType]!
        const ptr = D._malloc(bytes)
        try {
          if (!decoder.GetAttributeDataArrayForAllPoints(mesh, attr, dtype, bytes, ptr)) throw new Error(`${semantic}: GetAttributeDataArrayForAllPoints thất bại`)
          const data = new Ctor(D.HEAPU8.buffer.slice(ptr, ptr + bytes))
          if (semantic === 'POSITION') {
            const min = Array(n).fill(Infinity), max = Array(n).fill(-Infinity)
            for (let i = 0; i < data.length; i++) { const c = i % n; if (data[i] < min[c]) min[c] = data[i]; if (data[i] > max[c]) max[c] = data[i] }
            accessor.min = min; accessor.max = max
          }
          addAccessorData(accessorIndex, new Uint8Array(data.buffer), 34962)
        } finally { D._free(ptr) }
      }
      if (prim.indices !== undefined) {
        const accessor = json.accessors[prim.indices]
        const faces = mesh.num_faces()
        if (faces * 3 !== accessor.count) throw new Error(`indices: Draco ${faces * 3}, accessor ${accessor.count}`)
        const bytes = faces * 3 * 4
        const ptr = D._malloc(bytes)
        try {
          if (!decoder.GetTrianglesUInt32Array(mesh, bytes, ptr)) throw new Error('GetTrianglesUInt32Array thất bại')
          const all = new Uint32Array(D.HEAPU8.buffer.slice(ptr, ptr + bytes))
          const data = accessor.componentType === 5123 ? Uint16Array.from(all) : accessor.componentType === 5125 ? all : (() => { throw new Error(`indices componentType ${accessor.componentType}`) })()
          addAccessorData(prim.indices, new Uint8Array(data.buffer, data.byteOffset, data.byteLength), 34963)
        } finally { D._free(ptr) }
      }
    } finally { D.destroy(mesh); D.destroy(dbuf); D.destroy(decoder) }
    delete prim.extensions[EXT]
    if (!Object.keys(prim.extensions).length) delete prim.extensions
  }
  json.bufferViews = views
  json.buffers = [{ byteLength: cursor }]
  for (const key of ['extensionsRequired', 'extensionsUsed']) {
    if (!json[key]) continue
    json[key] = json[key].filter((e: string) => e !== EXT)
    if (!json[key].length) delete json[key]
  }
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)])
  const binBytes = Buffer.concat(chunks)
  const total = 12 + 8 + jsonPadded.length + 8 + binBytes.length
  const header = Buffer.alloc(12); header.writeUInt32LE(GLB_MAGIC, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8)
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonPadded.length, 0); jh.writeUInt32LE(CHUNK_JSON, 4)
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBytes.length, 0); bh.writeUInt32LE(CHUNK_BIN, 4)
  return { bytes: new Uint8Array(Buffer.concat([header, jh, jsonPadded, bh, binBytes])), primitives: prims.length, accessors: decoded }
}
const maybeDecode = async (bytes: Uint8Array, label: string) => {
  if (!decodeDraco) return bytes
  const result = await decodeDracoGlb(bytes)
  console.error(`[decode-draco] ${label}: ${result.primitives} primitive Draco -> ${result.accessors.length} accessor, ${bytes.byteLength} -> ${result.bytes.byteLength} byte`)
  if (process.env.FIXTURE_DUMP_DECODED && result.primitives) writeFileSync(path.join(out, `${label}.decoded.glb`), result.bytes)
  return result.bytes
}

function runner(projectId: string, startRevision: number) {
  let revision = startRevision
  return async (command: string, args: Record<string, unknown>) => {
    const result = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command, args })
    revision = result.revision
    return result
  }
}
const clipsOf = (project: Project, characterId: string) => project.scene.content.timeline.animation.motionClips
  .filter((clip) => clip.target.nodeId === project.characters[characterId]!.nodeId)

// ---------------------------------------------------------------------------------------------- synthetic project
interface Spec { name: string; clips: Array<{ action: 0 | 1; start: number }> }
const SPECS: Record<number, Spec[]> = {
  2: [
    { name: 'A', clips: [{ action: 0, start: 0 }, { action: 1, start: 29 }] }, // chain 0-28 + 29-76
    { name: 'B', clips: [{ action: 1, start: 40 }] }, // 40-87: covers only part of the timeline
  ],
  5: [
    { name: 'C0', clips: [{ action: 0, start: 0 }, { action: 1, start: 29 }] },
    { name: 'C1', clips: [{ action: 1, start: 10 }] },
    { name: 'C2', clips: [{ action: 0, start: 20 }] },
    { name: 'C3', clips: [{ action: 1, start: 30 }] },
    { name: 'C4', clips: [{ action: 0, start: 40 }, { action: 1, start: 69 }] },
  ],
}

async function buildSynthetic(count: number) {
  const specs = SPECS[count]
  if (!specs) usage('--characters chỉ nhận 2 hoặc 5')
  const targetGlb = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
  const fixtureDir = path.join(editor, 'apps/studio/public/retarget/v9.12')
  const norm_out = path.join(out, 'normalized')
  const run = spawnSync(process.execPath, ['--import', 'tsx', '../retarget/cli/normalize.ts', '--src', path.join(fixtureDir, 'minecraft-actions.bobj'), '--armature', path.join(fixtureDir, 'minecraft20-armature.bobj'), '--target', targetGlb, '--out', norm_out, '--action', '0,27'],
    { cwd: path.join(editor, 'packages/builder'), encoding: 'utf8', timeout: 180000 })
  if (run.status !== 0) throw new Error(`normalize.ts failed: ${run.stdout}${run.stderr}`)
  const files = readdirSync(norm_out)
  const glb = await maybeDecode(readFileSync(path.join(norm_out, files.find((f) => f.endsWith('.glb'))!)), 'actions')
  const manifest = JSON.parse(readFileSync(path.join(norm_out, files.find((f) => f.endsWith('.manifest.json'))!), 'utf8'))
  const name = `SceneFixture${count}`
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name, scene: makeEmptyDraft(name, 30, 180, { fov: 50, position: { x: 0, y: 2, z: 8 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }) } })
  const projectId = created.projectId as string
  const send = runner(projectId, 0)
  await send('asset.import', { files: [(await upload(glb, 'actions.glb')).id], format: 'glb', manifest })
  const model = await send('asset.import', { files: [(await upload(await maybeDecode(readFileSync(targetGlb), 'target'), 'target.glb')).id], format: 'glb' })
  const ids: string[] = []
  for (const spec of specs) {
    const added = await send('character.add', { assetId: (model.result.assetIds as string[])[0], skeletonId: (model.result.skeletonIds as string[])[0], name: spec.name })
    const id = String(added.result.characterId)
    ids.push(id)
    for (const clip of spec.clips) await send('motion.place', { characterId: id, motionId: manifest.actions[clip.action].uuid, frameStart: clip.start })
  }
  // Spaced 1.5 m along X (centered), small Z zigzag, a different yaw each (lookAt points rotate around the circle).
  const placements = ids.map((characterId, i) => {
    const x = (i - (ids.length - 1) / 2) * 1.5, z = (i % 2) * 0.6, angle = (i / ids.length) * Math.PI * 2
    return { characterId, position: { x, z }, lookAt: { point: { x: x + Math.cos(angle), z: z + Math.sin(angle) } } }
  })
  await send('scene.layout.apply', { frame: 0, placements })
  return projectId
}

// ------------------------------------------------------------------------------------------ duplicate up to five
async function ensureFive(projectId: string) {
  let project = await readUnifiedProject(projectId)
  const send = runner(projectId, project.revision)
  const existing = Object.keys(project.characters)
  if (!existing.length) throw new Error('Dự án không có nhân vật để nhân bản')
  const duplicated: Array<{ source: string; characterId: string; name: string }> = []
  const evaluated = await send('scene.evaluate', { frame: project.scene.content.timeline.frameStart })
  const positions = existing.map((id) => (evaluated.result.transforms as any)[project.characters[id]!.nodeId]?.position ?? { x: 0, y: 0, z: 0 })
  let nextX = Math.max(...positions.map((p: any) => p.x)) + 1.5
  const baseZ = positions[0]!.z as number
  const placements: Array<Record<string, unknown>> = []
  for (let n = 0; existing.length + duplicated.length < 5; n++) {
    const sourceId = existing[n % existing.length]!
    const source = project.characters[sourceId]!
    const node = project.scene.content.nodes.find((candidate) => candidate.id === source.nodeId)!
    const meta = (node.metadata ?? {}) as Record<string, unknown>
    // Library characters carry their library identity in node metadata; plain ones are duplicated by asset + skeleton.
    const library = typeof meta.libraryCharacterId === 'string'
      ? Object.fromEntries(Object.entries(meta).filter(([key]) => key.startsWith('library'))) : undefined
    const name = `${source.name} copy ${duplicated.length + 1}`
    const added = await send('character.add', { assetId: source.assetId, skeletonId: source.skeletonId, name, ...(library ? { library } : {}) })
    const characterId = String(added.result.characterId)
    const clips = clipsOf(project, sourceId)
    const clip = clips[0]
    const binding = clip ? project.bindings[clip.id] : undefined
    if (clip && binding) await send('motion.place', { characterId, motionId: binding.motionId, frameStart: clip.frameStart + 2 * (duplicated.length + 1) })
    placements.push({ characterId, position: { x: nextX, z: baseZ + (duplicated.length % 2) * 0.6 }, lookAt: { point: { x: nextX - 1, z: baseZ + 1 } } })
    nextX += 1.5
    duplicated.push({ source: sourceId, characterId, name })
  }
  if (placements.length) await send('scene.layout.apply', { frame: project.scene.content.timeline.frameStart, placements })
  project = await readUnifiedProject(projectId)
  return duplicated
}

// ---------------------------------------------------------------------------------------------------- export + sample
async function measure(projectId: string) {
  const project = await readUnifiedProject(projectId)
  const ids = Object.keys(project.characters)
  const first = values.first ?? ids[0]!
  if (!project.characters[first]) throw new Error(`Không có nhân vật ${first}`)
  const cameraNodeId = project.scene.content.nodes.find((node) => node.type === 'camera')?.id
  if (!cameraNodeId) throw new Error('Dự án không có camera')
  const ends = ids.flatMap((id) => clipsOf(project, id).map((clip) => clip.frameEnd))
  const starts = ids.flatMap((id) => clipsOf(project, id).map((clip) => clip.frameStart))
  let range: [number, number] = [Math.min(0, ...starts), Math.max(...ends)]
  if (values.range) {
    const m = /^(\d+)-(\d+)$/.exec(values.range)
    if (!m || Number(m[1]) > Number(m[2])) usage('--range phải có dạng a-b')
    range = [Number(m![1]), Number(m![2])]
  }
  const { unzipPackage } = await import('../src/shotPackage.ts')
  const send = runner(projectId, project.revision)
  const started = Date.now()
  const response = await send('shot.export', { cameraNodeId, frameStart: range[0], frameEnd: range[1], editableCharacterIds: [first], sceneMode: true })
  const exportMs = Date.now() - started
  const job = await getUnifiedJob(String(response.result.jobId), projectId)
  const artifact = await readUnifiedJobFile(job.jobId, projectId, '0')
  if (!artifact) throw new Error('Không đọc được gói shot')
  const shot = JSON.parse(Buffer.from(unzipPackage(artifact.bytes)['shot.json']!).toString())
  const frameRange = shot.frameRange as [number, number]
  const count = shot.characters.length as number
  const zipPath = path.join(out, `scene-${count}.zip`)
  writeFileSync(zipPath, artifact.bytes)

  const span = frameRange[1] - frameRange[0] + 1
  const wanted = [...new Set([0, Math.floor(span / 2), span - 1])]
  const characters: Array<{ characterId: string; name: string; frames: Record<string, unknown> }> = []
  for (const entry of shot.characters as Array<{ characterId: string }>) {
    const frames: Record<string, unknown> = {}
    let k = 0
    for await (const sample of sampleProjectSkeletonRange(project, { startFrame: frameRange[0], endFrame: frameRange[1], sampleFps: 30 }, [entry.characterId])) {
      if (sample.side !== 'right') continue
      if (wanted.includes(k)) {
        const skeleton = sample.skeletonSamples[0]!
        frames[String(frameRange[0] + k)] = { root: skeleton.actorWorldMatrix, bones: Object.fromEntries(skeleton.bones.map((bone) => [bone.name, bone.worldMatrix])) }
      }
      k++
    }
    characters.push({ characterId: entry.characterId, name: project.characters[entry.characterId]!.name, frames })
  }
  const referencePath = path.join(out, `scene-${count}.reference.json`)
  writeFileSync(referencePath, JSON.stringify({ projectId, frameRange, fps: 30, exportMs, characters }))
  return { projectId, characters: count, first, requestedRange: range, frameRange, widened: response.result.widened ?? null, exportMs, zip: zipPath, reference: referencePath }
}

try {
  let projectId: string
  let duplicated: unknown
  if (values.synthetic) projectId = await buildSynthetic(Number(values.characters ?? 2))
  else {
    projectId = values.project!
    if (values.five) duplicated = await ensureFive(projectId)
  }
  const summary = await measure(projectId)
  console.log(JSON.stringify({ ...summary, projectsDir, ...(duplicated ? { duplicated } : {}) }))
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
}
