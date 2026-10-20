#!/usr/bin/env node
/**
 * Headless App 1 normalize: source FBX/GLB/glTF → Mixamo65 animation-only GLB + manifest JSON + report JSON (+ preview PNG).
 * Usage (from editor/packages/builder so tsx resolves):
 *   node --import tsx <abs>/packages/retarget/cli/normalize.ts --src <file> --target <mixamo65.glb> --out <dir> [--preview]
 *        [--action all|<i>[,<i>...]] [--preview-action <i>] [--unit-meters <n>] [--up y|z] [--root preserve|in-place] [--root-scale <n>] [--mapping <preset.json>]
 *        [--armature <minecraft20-armature.bobj>] [--facing <deg>] [--calibrate limbs|none]   (limbs: swing source limbs onto the target rest directions — A/T calibration)
 *        [--bobj [--bobj-root inPlace|follow] [--bobj-armature <minecraft20-armature.bobj>]]   (also write Minecraft20 actions for BBS FS)
 * Exit codes: 0 PASS, 1 FAIL/error, 2 BLOCKED (input cannot be normalized as given).
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { formatFromPath, loadAsset } from './loadAsset.ts'
import { runNormalize } from './normalizeCore.ts'
import { renderContactSheet } from './previewPng.ts'
import { exportMinecraft20 } from './toMinecraft20.ts'

const { values } = parseArgs({ options: {
  src: { type: 'string' }, target: { type: 'string' }, out: { type: 'string' }, preview: { type: 'boolean', default: false },
  action: { type: 'string', default: 'all' }, 'preview-action': { type: 'string' }, 'unit-meters': { type: 'string' }, up: { type: 'string', default: 'y' },
  root: { type: 'string', default: 'preserve' }, calibrate: { type: 'string', default: 'limbs' }, facing: { type: 'string' }, 'root-scale': { type: 'string', default: '1' }, mapping: { type: 'string' }, armature: { type: 'string' },
  bobj: { type: 'boolean', default: false }, 'bobj-root': { type: 'string', default: 'inPlace' }, 'bobj-armature': { type: 'string' },
} })

function fail(message: string): never { console.error(`normalize: ${message}`); process.exit(1) }
if (!values.src || !values.target || !values.out) fail('--src, --target and --out are required')
if (!['y', 'z'].includes(values.up!)) fail('--up must be y or z')
if (!['preserve', 'in-place'].includes(values.root!)) fail('--root must be preserve or in-place')
if (!['limbs', 'none'].includes(values.calibrate!)) fail('--calibrate must be limbs or none')
if (!['inPlace', 'follow'].includes(values['bobj-root']!)) fail('--bobj-root must be inPlace or follow')
// The V9.12 Minecraft20 rig shipped with Studio is the default BBS FS target.
const minecraftArmature = values['bobj-armature'] ? resolve(values['bobj-armature']) :
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj')
const actions = values.action === 'all' ? undefined : values.action!.split(',').map(Number)
if (actions?.some((index) => !Number.isInteger(index) || index < 0)) fail('--action must be all or comma-separated Action indices')

const srcPath = resolve(values.src), targetPath = resolve(values.target), outDir = resolve(values.out)
const stem = basename(srcPath, extname(srcPath))
const write = (suffix: string, data: string | Uint8Array) => { const path = join(outDir, `${stem}${suffix}`); writeFileSync(path, data); return path }
mkdirSync(outDir, { recursive: true })

try {
  const format = formatFromPath(srcPath)
  const srcBytes = readFileSync(srcPath), targetBytes = readFileSync(targetPath)
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  const result = await runNormalize({
    source: await loadAsset(srcBytes, format, { skeletonOnly: true, resourceDir: dirname(srcPath), ...(values.armature ? { bobjArmature: readFileSync(resolve(values.armature)) } : {}) }), sourceLabel: basename(srcPath), sourceSha256: sha(srcBytes),
    target: await loadAsset(targetBytes, formatFromPath(targetPath), { skeletonOnly: true, resourceDir: dirname(targetPath) }), targetLabel: basename(targetPath), targetSha256: sha(targetBytes),
    actions, previewAction: values['preview-action'] === undefined ? undefined : Number(values['preview-action']), unitMeters: values['unit-meters'] ? Number(values['unit-meters']) : format === 'fbx' ? 0.01 : 1,
    upAxis: values.up as 'y' | 'z', rootPolicy: values.root as 'preserve' | 'in-place', rootScale: Number(values['root-scale']),
    mappingPreset: values.mapping ? JSON.parse(readFileSync(resolve(values.mapping), 'utf8')) : undefined, preview: values.preview,
    calibrate: values.calibrate as 'limbs' | 'none', facingDegrees: values.facing === undefined ? undefined : Number(values.facing),
  })
  const report = result.report as Record<string, any>, written: string[] = []
  let status: string = result.status
  if ('glb' in result) {
    written.push(write('.glb', result.glb), write('.manifest.json', JSON.stringify(result.manifest, null, 2)))
    if (result.preview) written.push(write('.preview.png', result.preview))
    if (values.bobj) {
      // BBS FS actions come from the GLB just written, so they carry exactly what App 2 receives.
      const armatureText = readFileSync(minecraftArmature, 'utf8')
      const previewAnimation = result.manifest.actions.find((action) => action.sourceActionIndex === report.roundtrip.primaryAction)?.glbAnimationIndex ?? 0
      const minecraft = await exportMinecraft20(result.glb, armatureText, { rootTravelMode: values['bobj-root'] as 'inPlace' | 'follow' }, previewAnimation)
      report.minecraft20 = { ...minecraft.report, armature: basename(minecraftArmature) }
      written.push(write('.minecraft20.bobj', minecraft.bobj))
      if (values.preview) written.push(write('.minecraft20.preview.png', renderContactSheet(minecraft.previewFrames, minecraft.previewParents)))
      if (minecraft.report.status !== 'PASS' && status === 'PASS') status = 'FAIL'
    }
  }
  written.unshift(write('.report.json', JSON.stringify(report, null, 2)))
  console.log(`status ${status}`)
  if (report.blocker) console.log(`blocker ${report.blocker.code}: ${report.blocker.message}`)
  if (report.gates) console.log(`gates ${JSON.stringify(report.gates)} contract ${JSON.stringify(report.contract)}`)
  if (report.mapping) console.log(`mapping ${report.mapping.family} ${report.mapping.mapped}/65`)
  if (report.mapping?.needsUserConfirmation) console.log(`mapping GEOMETRY confidence ${report.mapping.confidence.toFixed(2)} - inferred from structure, confirm before use`)
  if (report.calibration) console.log(`calibration ${report.calibration.mode} facing ${report.calibration.facingYawDegrees.toFixed(0)}°${report.calibration.facingAmbiguous ? ` (AMBIGUOUS: measured ${report.calibration.measuredFacingYawDegrees.toFixed(0)}°, set --facing)` : ''} max ${report.calibration.maxDegrees.toFixed(1)}° over ${report.calibration.corrections.length} joints`)
  if (report.proportions?.suggestedRootScale) console.log(`hips source=${report.proportions.sourceHipsHeightMeters.toFixed(2)}m target=${report.proportions.targetHipsHeightMeters.toFixed(2)}m suggested --root-scale ${report.proportions.suggestedRootScale.toFixed(3)}`)
  if (report.roundtrip) console.log(`actions exported=${report.exportedActions} skipped=${report.skippedActions.length} (${[...new Set(report.skippedActions.map((item: { code: string }) => item.code))].join(', ') || '-'})`)
  if (report.roundtrip) console.log(`roundtrip joints=${report.roundtrip.jointCount} animations=${report.roundtrip.animationCount} preview="${report.roundtrip.name}" duration=${report.roundtrip.durationSeconds.toFixed(3)}s hipsTravel=${report.roundtrip.hipsTravelMeters.toFixed(3)}m elapsed=${report.elapsedMs}ms`)
  if (report.minecraft20) console.log(`minecraft20 ${report.minecraft20.status} actions=${report.minecraft20.actions.length} roundtripError=${report.minecraft20.roundtripMaxErrorBlocks.toExponential(1)} blocks`)
  for (const path of written) console.log(`wrote ${path}`)
  process.exit(status === 'PASS' ? 0 : status === 'BLOCKED' ? 2 : 1)
} catch (error) {
  write('.report.json', JSON.stringify({ status: 'FAIL', error: error instanceof Error ? error.message : String(error) }, null, 2))
  fail(error instanceof Error ? error.message : String(error))
}
