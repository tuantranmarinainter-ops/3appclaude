import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { getUnifiedJob, readUnifiedJobFile } from './unifiedJobs'
import { zipPackage } from './shotPackage'

export interface SceneConversionArgs { glbJobId: string }
type LocalCommand = (command: string, args: string[], cwd: string, signal: AbortSignal) => Promise<string>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Use an immutable verified H1 artifact, never a client-supplied filesystem path. */
export async function validateSceneConversionArgs(project: UnifiedProject, args: SceneConversionArgs) {
  if (!args || Object.keys(args).some(key => key !== 'glbJobId') || typeof args.glbJobId !== 'string' || !UUID.test(args.glbJobId)) throw new TypeError('Scene conversion requires only an existing glbJobId')
  const job = await getUnifiedJob(args.glbJobId, project.projectId)
  if (String(job.type) !== 'scene.export.glb' || job.state !== 'succeeded') throw new TypeError('Scene conversion requires a successful scene.export.glb job')
  if (job.sourceRevision !== project.revision) throw new TypeError('Scene GLB source revision is stale; export the current scene first')
  const file = job.result?.files.find(file => file.mimeType === 'model/gltf-binary')
  if (!file) throw new TypeError('Scene GLB job has no GLB artifact')
  if (!Number.isInteger(project.scene.content.timeline.fps) || project.scene.content.timeline.fps < 1 || project.scene.content.timeline.fps > 240) throw new TypeError('Scene conversion FPS must be an integer in [1, 240]')
  return { job, file }
}

export async function stageSceneConversion(project: UnifiedProject, args: SceneConversionArgs, work: string, signal: AbortSignal, command: LocalCommand, agentRoot: () => Promise<string>) {
  signal.throwIfAborted()
  const { file } = await validateSceneConversionArgs(project, args)
  const source = await readUnifiedJobFile(args.glbJobId, project.projectId, file.id)
  if (!source) throw new TypeError('Scene GLB artifact failed its stored hash or size check')
  await mkdir(work)
  const input = path.join(work, 'scene.glb'), output = path.join(work, 'converted')
  await writeFile(input, source.bytes, { flag: 'wx' })
  const agent = await agentRoot(), python = process.env.BBS_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3')
  const fps = project.scene.content.timeline.fps
  const text = await command(python, ['-m', 'agent.scene_model_converter', '--input', input, '--output', output, '--fps', String(fps)], agent, signal)
  signal.throwIfAborted()
  const report = JSON.parse(text) as Record<string, unknown>
  const files: Record<string, Uint8Array> = {}
  for (const name of ['scene.blend', 'scene.fbx', 'report.json']) files[name] = await readFile(path.join(output, name))
  const bytes = Buffer.from(zipPackage(files))
  return { bytes, provenance: { glbJobId: args.glbJobId, sourceRevision: project.revision, committedToProject: false, report } }
}
