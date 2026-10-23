import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getAction, listLibraryCharacters, resolveLibraryPath, searchLibrary, setActionPreview, type ActionMetadata } from '../../../packages/library/index'
import * as directorRenderer from '@topview/3d-director-cli/render.mjs'

export type LibraryPreviewJob = { uuid: string; state: 'queued' | 'running' | 'complete' | 'failed'; message?: string; renderer?: string }
const builtinCharacter = 'a3d_char_de37873a79244fbe8a0660ea08d1b4ab'
const jobs = new Map<string, LibraryPreviewJob>()
let active = false
let appOrigin = ''

function runFfmpeg(input: string, output: string, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-t', String(seconds), '-vf', 'fps=15,scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2', '-an', '-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '4', '-f', 'webm', output], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''; child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 1000) })
    child.once('error', error => reject(new Error(`ffmpeg is unavailable: ${error.message}`)))
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`ffmpeg preview encode failed (${code}): ${stderr.trim()}`)))
  })
}

async function createPreview(uuid: string): Promise<void> {
  const job = jobs.get(uuid)!; job.state = 'running'
  let rawPath = ''
  try {
    if (!appOrigin) throw new Error('Library preview queue has no Studio origin')
    const action = getAction({ actionUuid: uuid })
    const characters = listLibraryCharacters()
    const character = action.ownerCharId ? characters.find(item => item.charId === action.ownerCharId) : undefined
    const useCharacter = Boolean(character)
    const charId = useCharacter ? character!.charId : builtinCharacter
    const mannequin = action.rig === 'minecraft20' && !useCharacter
    const seconds = Math.min(2.5, Math.max(0.1, action.durationSeconds))
    type RenderPage = { setViewportSize(size: { width: number; height: number }): Promise<void>; goto(url: string, options: { waitUntil: 'networkidle'; timeout: number }): Promise<unknown>; waitForFunction<T>(callback: () => T, argument?: unknown, options?: { timeout: number }): Promise<unknown>; evaluate<T>(callback: () => T): Promise<T> }
    type RendererInfo = { kind: 'gpu' | 'cpu'; name: string; raw: string }
    type WithPage = <T>(work: (page: RenderPage, origin: string, warnings: string[], network: { blocked: string[] }, localAssetUrls: Record<string, string>, renderer: RendererInfo) => Promise<T>, options?: { allowedOrigins?: string[] }) => Promise<T>
    const withPage = (directorRenderer as unknown as { withPage: WithPage }).withPage
    const result = await withPage(async (page, _origin, _warnings, _network, _localAssets, renderer) => {
      job.renderer = renderer.kind === 'gpu' ? `GPU: ${renderer.name}` : `CPU: ${renderer.name}`
      if (renderer.kind !== 'gpu') throw new Error(`GPU rendering unavailable (${renderer.name}); showing the PNG cover instead. Set W01_RENDER_GPU=1 to request hardware rendering.`)
      await page.setViewportSize({ width: 320, height: 320 })
      await page.goto(`${appOrigin}/library/preview-render?${new URLSearchParams({ actionUuid: uuid, charId, animationIndex: String(action.glbAnimationIndex), ...(mannequin ? { mannequin: '1' } : {}) })}`, { waitUntil: 'networkidle', timeout: 45_000 })
      await page.waitForFunction(() => Boolean((window as Window & { __libraryPreviewResult?: unknown }).__libraryPreviewResult), undefined, { timeout: 60_000 })
      return page.evaluate(() => (window as Window & { __libraryPreviewResult?: { data: string; mime: string; error?: string } }).__libraryPreviewResult!)
    }, { allowedOrigins: [appOrigin] })
    if (result.error || !result.data) throw new Error(result.error || 'Browser produced an empty WebM preview')
    const raw = Buffer.from(result.data, 'base64')
    if (raw.length < 128 || !raw.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) throw new Error('Browser output is not a valid WebM file')
    const root = resolveLibraryPath(), packDirectory = path.join(root, 'packs', action.packId), previewDirectory = path.join(packDirectory, 'previews')
    await mkdir(previewDirectory, { recursive: true })
    const filename = `${uuid}.webm`, destination = path.join(previewDirectory, filename), temporary = `${destination}.${randomUUID()}.tmp`
    rawPath = `${temporary}.input.webm`
    await writeFile(rawPath, raw)
    await runFfmpeg(rawPath, temporary, seconds)
    const video = await readFile(temporary)
    if (video.length < 128 || !video.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) throw new Error('ffmpeg output is not a valid WebM file')
    await rm(destination, { force: true })
    await rename(temporary, destination)
    const preview: NonNullable<ActionMetadata['preview']> = { file: `previews/${filename}`, sha256: createHash('sha256').update(video).digest('hex'), width: 320, height: 320, fps: 15, seconds }
    setActionPreview({ actionUuid: uuid, preview })
    job.state = 'complete'; job.message = `${video.length} bytes · ${job.renderer}`
  } catch (error) {
    job.state = 'failed'; job.message = error instanceof Error ? error.message : String(error)
  } finally {
    if (rawPath) await rm(rawPath, { force: true }).catch(() => undefined)
  }
}

async function drain(): Promise<void> {
  if (active) return
  active = true
  try {
    for (const job of jobs.values()) if (job.state === 'queued') await createPreview(job.uuid)
  } finally { active = false }
}

export function queueLibraryPreviews(options: { origin: string; actionUuids?: string[]; regenerate?: boolean } ): LibraryPreviewJob[] {
  appOrigin = new URL(options.origin).origin
  const all = []
  for (let offset = 0, total = 1; offset < total; offset += 100) {
    const page = searchLibrary({ limit: 100, offset }); total = page.total; all.push(...page.items)
  }
  const requested = options.actionUuids ? new Set(options.actionUuids) : null
  const selected = all.filter(action => (!requested || requested.has(action.uuid)) && (options.regenerate || !action.preview))
  for (const action of selected) {
    const existing = jobs.get(action.uuid)
    if (existing?.state === 'queued' || existing?.state === 'running') continue
    const job: LibraryPreviewJob = { uuid: action.uuid, state: 'queued' }
    jobs.set(action.uuid, job)
  }
  void drain()
  return [...jobs.values()]
}

export function libraryPreviewJobs(): LibraryPreviewJob[] { return [...jobs.values()] }
