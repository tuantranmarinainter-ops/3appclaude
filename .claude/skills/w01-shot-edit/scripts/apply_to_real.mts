/**
 * Copy an approved shot from the sandbox project to the real project, in-process (no server needed), through App 2
 * commands so the real project keeps undo history. Handles: new prop model assets, new motion clips (library or project
 * motions, parked then re-timed), root-motion policy, the whole scene + F-curves (incl. userKeys), VFX cues. Verifies.
 *
 * Run from three-workspace-app/editor (builder must be built):
 *   pnpm --filter @topview/3d-builder exec tsx S:/Claude/w01/.claude/skills/w01-shot-edit/scripts/apply_to_real.mts \
 *     --from S:/Claude/w01-samples/<name>-projects --to S:/Claude/w01-samples/tap15v3/projects \
 *     --project <id> --expect-rev <real revision when the sandbox was copied> [--library S:/Claude/w01-library] [--dry-run]
 *
 * Refuses when the real project moved past --expect-rev (the user edited it meanwhile) or the sandbox added Characters.
 * Backs up the real project.json to S:/Claude/w01/work/backup-real/<id>-rev<n>.json first.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'

const { values: a } = parseArgs({ options: {
  from: { type: 'string' }, to: { type: 'string' }, project: { type: 'string' }, 'expect-rev': { type: 'string' },
  library: { type: 'string', default: 'S:/Claude/w01-library' }, 'dry-run': { type: 'boolean', default: false },
} })
if (!a.from || !a.to || !a.project || a['expect-rev'] === undefined) throw new TypeError('need --from --to --project --expect-rev')
const P = a.project, EXPECT = Number(a['expect-rev']), DRY = a['dry-run']
process.env.BBS_UNIFIED_PROJECTS_DIR = a.to.replaceAll('\\', '/')
process.env.W01_LIBRARY = a.library!.replaceAll('\\', '/')
// App 2 code of the checkout we run from (pnpm exec runs in packages/builder): walk up to editor/.
let editor = process.cwd()
while (!existsSync(path.join(editor, 'apps/studio/src/unifiedProjectStore.ts'))) {
  const up = path.dirname(editor)
  if (up === editor) throw new Error('run from three-workspace-app/editor (or a package below it)')
  editor = up
}
const studio = pathToFileURL(path.join(editor, 'apps/studio/src') + '/')
const { executeUnifiedCommand, readUnifiedProject } = await import(new URL('unifiedProjectStore.ts', studio).href)
const { stageAssetUpload } = await import(new URL('unifiedAssetFiles.ts', studio).href)

type Clip = { id: string; source?: string; frameStart: number; frameEnd: number; target: { nodeId: string }; playback: { speed: number; loop: boolean }; motion: Record<string, any> }
const sbDir = path.join(a.from, P)
const sb = JSON.parse(readFileSync(path.join(sbDir, 'project.json'), 'utf8'))
let real = await readUnifiedProject(P)
if (real.revision !== EXPECT) throw new Error(`Real project is at rev ${real.revision}, expected ${EXPECT}: the user changed it since the copy. Stop and ask.`)
const realChars = new Set(Object.keys(real.characters))
const newChars = Object.keys(sb.characters).filter((id) => !realChars.has(id))
if (newChars.length) throw new Error(`Sandbox added Characters (${newChars.join(', ')}); add them in the real project first (character.add), then rerun.`)

const backupDir = 'S:/Claude/w01/work/backup-real'
mkdirSync(backupDir, { recursive: true })
copyFileSync(path.join(a.to, P, "project.json"), path.join(backupDir, `${path.basename(path.dirname(a.to))}-${P}-rev${real.revision}.json`))

const plan: string[] = []
const run = async (command: string, args: Record<string, unknown>) => {
  plan.push(`${command} ${JSON.stringify(args).slice(0, 160)}`)
  if (DRY) return null
  const cur = await readUnifiedProject(P)
  return executeUnifiedCommand({ requestId: randomUUID(), projectId: P, expectedRevision: cur.revision, command, args })
}

// 1. model assets used by sandbox props but missing in the real project
for (const node of sb.scene.content.nodes) {
  const id = node.type === 'prop' ? node.metadata?.assetId : undefined
  if (typeof id !== 'string' || real.assets[id]) continue
  const file = path.join(sbDir, sb.assets[id].source.path)
  const bytes = readFileSync(file)
  plan.push(`upload ${file}`)
  if (DRY) continue
  const up = await stageAssetUpload(path.basename(file), new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } }))
  const res = await run('asset.import', { files: [up.id], format: 'auto' })
  if (!res!.result.assetIds.includes(id)) throw new Error(`asset ${id} imported as ${res!.result.assetIds}`)
}

// 2. clips that exist only in the sandbox: place them parked (no overlap), fix root policy, map IDs
const realClipIds = new Set(real.scene.content.timeline.animation.motionClips.map((c: Clip) => c.id))
const charByNode = new Map(Object.values(sb.characters).map((c: any) => [c.nodeId, c.id]))
let park = Math.max(...[...real.scene.content.timeline.animation.motionClips, ...sb.scene.content.timeline.animation.motionClips].map((c: Clip) => c.frameEnd)) + 100
const idMap = new Map<string, string>()
for (const c of sb.scene.content.timeline.animation.motionClips as Clip[]) {
  if (realClipIds.has(c.id)) continue
  const characterId = charByNode.get(c.target.nodeId)
  if (!characterId) throw new Error(`clip ${c.id} targets a non-character node`)
  const motionId = c.motion.assetId
  // A motion already in the real project is placed directly; otherwise it is a library Action (motion id = Action UUID).
  const res = real.motions[motionId]
    ? await run('motion.place', { motionId, characterId, frameStart: park, sourceStartSeconds: c.motion.time ?? 0, sourceLengthSeconds: c.motion.sourceLengthSeconds, speed: c.playback.speed, loop: c.playback.loop })
    : await run('library.place', { actionUuid: motionId, characterId, frameStart: park })
  const newId = DRY ? `(new ${c.id})` : (res!.result.libraryPlacement?.clipId ?? res!.result.clipId)
  idMap.set(c.id, newId)
  park += Math.max(200, c.frameEnd - c.frameStart + 50)
  const want = sb.bindings[c.id]
  if (!DRY && want) {
    const cur = await readUnifiedProject(P)
    const have = cur.bindings[newId]
    if (have && (have.rootPolicy !== want.rootPolicy || have.alignment !== want.alignment)) {
      await run('motion.binding.set', { binding: { ...have, rootPolicy: want.rootPolicy, alignment: want.alignment } })
    }
  }
}

// 3. VFX first when the shot gets shorter (cue ranges are validated against the timeline), else after the scene
const sbEnd = sb.scene.content.timeline.frameEnd
const syncCues = async () => {
  const cur = DRY ? real : await readUnifiedProject(P)
  const have = cur.extensions.vfxCues?.cues ?? [], want = sb.extensions.vfxCues?.cues ?? []
  // Cues added earlier got fresh IDs, so a cue also counts as present when everything but its ID matches.
  const body = (c: any) => { const { id: _id, ...rest } = c; return JSON.stringify(rest) }
  const same = (r: any, c: any) => r.id === c.id || body(r) === body(c)
  for (const r of have) if (!want.some((c: any) => same(r, c))) await run('vfx.cue.remove', { id: r.id })
  for (const c of want) {
    const { id, effect, ...patch } = c
    const match = have.find((r: any) => same(r, c))
    if (match) { if (body(match) !== body(c)) await run('vfx.cue.update', { id: match.id, patch }) }
    else await run('vfx.cue.add', { cue: { effect, ...patch } })
  }
}
const applyScene = async () => {
  const cur = DRY ? real : await readUnifiedProject(P)
  const scene = structuredClone(sb.scene)
  scene.content.timeline.animation.motionClips = scene.content.timeline.animation.motionClips.map((c: Clip) => {
    const newId = idMap.get(c.id)
    if (!newId || DRY) return c
    const r = cur.scene.content.timeline.animation.motionClips.find((x: Clip) => x.id === newId)
    return { ...c, id: newId, motion: { ...c.motion, assetId: r.motion.assetId, url: r.motion.url, rootMotion: r.motion.rootMotion, inPlace: r.motion.inPlace } }
  })
  await run('scene.apply', { operations: [{ type: 'document.replace', document: scene, fcurves: sb.extensions.topview?.fcurves ?? null }] })
}
if (sbEnd < real.scene.content.timeline.frameEnd) { await syncCues(); await applyScene() } else { await applyScene(); await syncCues() }

// 4. verify
const sig = (p: any, map = new Map<string, string>()) => ({
  clips: p.scene.content.timeline.animation.motionClips.map((c: Clip) => `${map.get(c.id) ?? c.id}|${c.target.nodeId}|${c.frameStart}-${c.frameEnd}|${c.motion.name}|${c.motion.rootMotion?.policy}`).sort(),
  nodes: p.scene.content.nodes.map((n: any) => `${n.id}|${n.metadata?.assetId ?? ''}|${JSON.stringify(n.transform)}`).sort(),
  timeline: [p.scene.content.timeline.frameStart, p.scene.content.timeline.frameEnd, JSON.stringify(p.scene.content.editorial)],
  fcurves: JSON.stringify(p.extensions.topview?.fcurves ?? null),
  cues: (p.extensions.vfxCues?.cues ?? []).map(({ id: _id, ...c }: any) => JSON.stringify(c)).sort(),
})
console.log(plan.length ? plan.map((s) => '  ' + s).join('\n') : '  (nothing to do)')
if (DRY) { console.log('DRY RUN: nothing written'); process.exit(0) }
real = await readUnifiedProject(P)
const got = sig(real), want = sig(sb, idMap)
let ok = true
for (const k of Object.keys(got) as (keyof typeof got)[]) { const same = JSON.stringify(got[k]) === JSON.stringify(want[k]); ok &&= same; console.log(k.padEnd(9), same ? 'MATCH' : 'DIFF') }
console.log(`real rev ${EXPECT} -> ${real.revision}; backup in ${backupDir}`)
if (!ok) process.exit(1)
