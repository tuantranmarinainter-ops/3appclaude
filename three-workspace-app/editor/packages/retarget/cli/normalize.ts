#!/usr/bin/env node
/**
 * Headless App 1 normalize: source FBX/GLB/glTF → Mixamo65 animation-only GLB + manifest JSON + report JSON (+ preview PNG).
 * Usage (from editor/packages/builder so tsx resolves):
 *   node --import tsx <abs>/packages/retarget/cli/normalize.ts --src <file> --target <mixamo65.glb> --out <dir> [--preview]
 *        [--action all|<i>[,<i>...]] [--preview-action <i>] [--unit-meters <n>] [--up y|z] [--root preserve|in-place] [--root-scale <n>] [--ground off|lift|level|frame] [--mapping <preset.json>]
 *        [--armature <minecraft20-armature.bobj>] [--facing <deg>] [--swap-sides auto|on|off] [--calibrate limbs|none]   (limbs: swing source limbs onto the target rest directions — A/T calibration)
 *        [--bobj [--bobj-root inPlace|follow] [--bobj-armature <minecraft20-armature.bobj>]]   (also write Minecraft20 actions for BBS FS)
 *        [--arm-space <-0.5..1>] [--leg-space <-0.5..1>] [--shoulder-width <.7..1.4>] [--upper-arm <.7..1.4>] [--forearm <.7..1.4>] [--leg-length <.8..1.25>] [--intensity <0..2>] [--stride <0..2>] [--vertical <0..2>] [--proportion-side both|left|right] [--stride-side both|left|right] [--mirror] [--trim-start <0..0.9>] [--trim-end <0..0.9>] [--speed <.25..4>] [--joint-offset <joint>=<xDeg>,<yDeg>,<zDeg>]...   (Mixamo-style adjustments; default = no change)
 *        [--mode animation|model]   (model: also embed the source meshes + textures skinned to the Mixamo65 skeleton; Mixamo-family sources only)
 * Exit codes: 0 PASS, 1 FAIL/error, 2 BLOCKED (input cannot be normalized as given).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { resolveAdjustments, type AdjustmentSettings } from '../src/adjustments.ts'
import { formatFromPath, loadAsset } from './loadAsset.ts'
import { applyModelMode, ModelBlockedError, readModelSourceFiles, type PipelineResult } from './modelExport.ts'
import { runNormalize } from './normalizeCore.ts'
import { renderContactSheet } from './previewPng.ts'
import { exportMinecraft20 } from './toMinecraft20.ts'
import { exportVerityOriginalArtifacts } from './verityOriginal.ts'

const { values } = parseArgs({ options: {
  src: { type: 'string' }, target: { type: 'string' }, out: { type: 'string' }, preview: { type: 'boolean', default: false },
  'foot-lock': { type: 'string', default: 'off' }, range: { type: 'string' }, action: { type: 'string', default: 'all' }, 'preview-action': { type: 'string' }, 'unit-meters': { type: 'string' }, up: { type: 'string', default: 'y' },
  root: { type: 'string', default: 'preserve' }, calibrate: { type: 'string', default: 'limbs' }, 'swap-sides': { type: 'string', default: 'auto' }, facing: { type: 'string' }, 'root-scale': { type: 'string' }, ground: { type: 'string', default: 'lift' }, mapping: { type: 'string' }, armature: { type: 'string' },
  'arm-space': { type: 'string' }, 'leg-space': { type: 'string' }, 'shoulder-width': { type: 'string' }, 'upper-arm': { type: 'string' }, forearm: { type: 'string' }, 'leg-length': { type: 'string' }, intensity: { type: 'string' }, stride: { type: 'string' }, vertical: { type: 'string' }, 'proportion-side': { type: 'string' }, 'stride-side': { type: 'string' }, mirror: { type: 'boolean', default: false }, 'trim-start': { type: 'string' }, 'trim-end': { type: 'string' }, speed: { type: 'string' }, 'joint-offset': { type: 'string', multiple: true },
  mode: { type: 'string', default: 'animation' }, bobj: { type: 'boolean', default: false }, 'bobj-root': { type: 'string', default: 'inPlace' }, 'bobj-armature': { type: 'string' },
} })

function fail(message: string): never { console.error(`normalize: ${message}`); process.exit(1) }
if (!values.src || !values.target || !values.out) fail('--src, --target and --out are required')
if (!['y', 'z'].includes(values.up!)) fail('--up must be y or z')
if (!['preserve', 'in-place'].includes(values.root!)) fail('--root must be preserve or in-place')
if (!['on', 'off'].includes(values['foot-lock']!)) fail('--foot-lock must be on or off')
if (!['off', 'lift', 'level', 'frame'].includes(values.ground!)) fail('--ground must be off, lift, level or frame')
if (!['limbs', 'none'].includes(values.calibrate!)) fail('--calibrate must be limbs or none')
if (!['auto', 'on', 'off'].includes(values['swap-sides']!)) fail('--swap-sides must be auto, on or off')
if (!['animation', 'model'].includes(values.mode!)) fail('--mode must be animation or model')
if (!['inPlace', 'follow'].includes(values['bobj-root']!)) fail('--bobj-root must be inPlace or follow')
// The V9.12 Minecraft20 rig shipped with Studio is the default BBS FS target.
const minecraftArmature = values['bobj-armature'] ? resolve(values['bobj-armature']) :
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj')
const range = values.range?.split(':').map(Number)
if (range && (range.length !== 2 || range.some((n) => !Number.isFinite(n)) || range[0]! < 0 || range[1]! <= range[0]!)) fail('--range must be start:end with 0 <= start < end')
const actions = values.action === 'all' ? undefined : values.action!.split(',').map(Number)
if (actions?.some((index) => !Number.isInteger(index) || index < 0)) fail('--action must be all or comma-separated Action indices')

let adjustments: Partial<AdjustmentSettings>
try {
  const flag = (name: string) => values[name as 'intensity'] === undefined ? undefined : Number(values[name as 'intensity'])
  adjustments = resolveAdjustments({ armSpace: flag('arm-space'), legSpace: flag('leg-space'), shoulderWidth: flag('shoulder-width'), upperArm: flag('upper-arm'), forearm: flag('forearm'), legLength: flag('leg-length'), intensity: flag('intensity'), stride: flag('stride'), vertical: flag('vertical'),
    ...(values['proportion-side'] ? { proportionSide: values['proportion-side'] as 'both' } : {}), ...(values['stride-side'] ? { strideSide: values['stride-side'] as 'both' } : {}), mirror: values.mirror, trimStart: flag('trim-start'), trimEnd: flag('trim-end'), speed: flag('speed'),
    jointOffsets: Object.fromEntries((values['joint-offset'] ?? []).map((item) => { const [joint, angles = ''] = item.split('='); return [joint!, angles.split(',').map(Number)] as const })) as Record<string, [number, number, number]> })
} catch (error) { fail(`${error instanceof Error ? error.message : error} (flags are --arm-space, --leg-space, --shoulder-width, --upper-arm, --forearm, --leg-length, --intensity, --stride, --vertical)`) }
const srcPath = resolve(values.src), targetPath = resolve(values.target), outDir = resolve(values.out)
const stem = basename(srcPath, extname(srcPath))
const write = (suffix: string, data: string | Uint8Array) => { const path = join(outDir, `${stem}${suffix}`); writeFileSync(path, data); return path }
mkdirSync(outDir, { recursive: true })

try {
  const format = formatFromPath(srcPath)
  const srcBytes = readFileSync(srcPath), targetBytes = readFileSync(targetPath)
  const sourceText = format === 'bobj' ? srcBytes.toString('utf8') : null
  const isBobjModel = !!sourceText && /^[\t \uFEFF]*arm_bone\s+/m.test(sourceText) && /^[\t ]*o\s+/m.test(sourceText) && /^[\t ]*v\s+/m.test(sourceText)
  // The physical-unit preset name can also label canonical rigs; inverse projection needs native Verity bones.
  const isVerityModel = isBobjModel && /^[\t \uFEFF]*arm_name[\t ]+verity\.mdl[\t \r]*$/m.test(sourceText!)
    && ['COG', 'Upper_Leg_L', 'Upper_Leg_R'].every(name => new RegExp(`^[\\t ]*arm_bone[\\t ]+${name}[\\t ]`, 'm').test(sourceText!))
  const sourceManifestPath = srcPath.replace(/\.[^.]+$/, '.manifest.json')
  const sourceExtraManifest = format === 'glb' && existsSync(sourceManifestPath)
    ? JSON.parse(readFileSync(sourceManifestPath, 'utf8')) as { version?: unknown; rig?: unknown; extraBones?: unknown } : undefined
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  const requestedUnitMeters = values['unit-meters'] ? Number(values['unit-meters']) : format === 'fbx' ? 0.01 : undefined
  if (requestedUnitMeters !== undefined && (!(requestedUnitMeters > 0) || !Number.isFinite(requestedUnitMeters))) fail('--unit-meters must be finite and positive')
  // Full BOBJ models carry their physical unit on a scale/floor wrapper. The solver sees that metre-space wrapper once.
  const unitMeters = isBobjModel ? 1 : requestedUnitMeters ?? 1
  // Model mode: Draco/meshopt sources are refused before any work is done.
  let modelFiles: ReturnType<typeof readModelSourceFiles> | undefined
  let early: PipelineResult | undefined
  if (values.mode === 'model') {
    try { modelFiles = readModelSourceFiles(srcBytes, format, dirname(srcPath)) } catch (error) {
      if (!(error instanceof ModelBlockedError)) throw error
      early = { status: 'BLOCKED', report: { status: 'BLOCKED', blocker: { code: error.code, message: error.message } } }
    }
  }
  let result: PipelineResult = early ?? await runNormalize({
    source: await loadAsset(srcBytes, format, { skeletonOnly: true, resourceDir: dirname(srcPath),
      ...(isBobjModel && requestedUnitMeters !== undefined ? { unitMeters: requestedUnitMeters } : {}),
      ...(values.armature ? { bobjArmature: readFileSync(resolve(values.armature)) } : {}) }), sourceLabel: basename(srcPath), sourceSha256: sha(srcBytes),
    ...(sourceExtraManifest ? { sourceExtraManifest, sourceExtraGlb: srcBytes } : {}),
    target: await loadAsset(targetBytes, formatFromPath(targetPath), { skeletonOnly: true, resourceDir: dirname(targetPath) }), targetLabel: basename(targetPath), targetSha256: sha(targetBytes),
    footLock: values['foot-lock'] as 'on' | 'off', range: range as [number, number] | undefined, actions, previewAction: values['preview-action'] === undefined ? undefined : Number(values['preview-action']), unitMeters,
    upAxis: values.up as 'y' | 'z', rootPolicy: values.root as 'preserve' | 'in-place', rootScale: values['root-scale'] === undefined ? undefined : Number(values['root-scale']), ground: values.ground as 'off' | 'lift' | 'level' | 'frame', adjustments,
    mappingPreset: values.mapping ? JSON.parse(readFileSync(resolve(values.mapping), 'utf8')) : undefined, preview: values.preview,
    calibrate: values.calibrate as 'limbs' | 'none', swapSides: values['swap-sides'] as 'auto' | 'on' | 'off', facingDegrees: values.facing === undefined ? undefined : Number(values.facing),
  })
  if (values.mode === 'model') {
    result = await applyModelMode(result, { loadSource: () => loadAsset(srcBytes, format, { keepMeshes: true, resourceDir: dirname(srcPath) }), files: modelFiles ?? null, unitMeters, upAxis: values.up as 'y' | 'z' })
  }
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
    if (isVerityModel) {
      const original = await exportVerityOriginalArtifacts({ sourceText: sourceText!, sourcePath: srcPath, normalizedGlb: result.glb,
        ...(requestedUnitMeters !== undefined ? { unitMeters: requestedUnitMeters } : {}) })
      const originalPrefixSha256 = sha(Buffer.from(original.bobj).subarray(0, srcBytes.length))
      if (originalPrefixSha256 !== sha(srcBytes)) throw new Error('Original-rig BOBJ prefix differs from the source bytes')
      report.originalRig = { ...original.report, sourceSha256: sha(srcBytes), originalPrefixSha256,
        bobj: `${stem}.original.bbs.bobj`, glb: `${stem}.original.glb` }
      written.push(write('.original.bbs.bobj', original.bobj), write('.original.glb', original.glb))
      if ((original.report.roundtripMaxPositionErrorUnits > 1e-4 || original.report.maxHipAngleDegrees > 2 || original.report.maxHeadAngleDegrees > 2) && status === 'PASS') status = 'FAIL'
    }
  }
  // The written report states the final status (a failed .bobj export fails the run), same as the Workbench.
  report.status = status
  written.unshift(write('.report.json', JSON.stringify(report, null, 2)))
  console.log(`status ${status}`)
  if (report.blocker) console.log(`blocker ${report.blocker.code}: ${report.blocker.message}`)
  if (report.gates) console.log(`gates ${JSON.stringify(report.gates)} contract ${JSON.stringify(report.contract)}`)
  if (report.mapping) console.log(`mapping ${report.mapping.family} ${report.mapping.mapped}/65`)
  if (report.mapping?.needsUserConfirmation) console.log(`mapping GEOMETRY confidence ${report.mapping.confidence.toFixed(2)} - inferred from structure, confirm before use`)
  if (report.sides) console.log(`sides ${report.sides.mode} evidence=${report.sides.evidence} ${report.sides.evidenceMeters.toFixed(2)}m agreement=${report.sides.agreement === null ? '-' : report.sides.agreement.toFixed(2)}${report.sides.mirrored ? ' MIRRORED' : ''}${report.sides.swapped ? ' (swapped)' : ''}${report.sides.restTurnDegrees ? ` restTurn=${report.sides.restTurnDegrees}°` : ''}`)
  if (report.calibration) console.log(`calibration ${report.calibration.mode} facing ${report.calibration.facingYawDegrees.toFixed(0)}°${report.calibration.facingAmbiguous ? ` (AMBIGUOUS: measured ${report.calibration.measuredFacingYawDegrees.toFixed(0)}°, set --facing)` : ''} max ${report.calibration.maxDegrees.toFixed(1)}° over ${report.calibration.corrections.length} joints`)
  if (report.proportions?.suggestedRootScale) console.log(`hips source=${report.proportions.sourceHipsHeightMeters.toFixed(2)}m target=${report.proportions.targetHipsHeightMeters.toFixed(2)}m suggested --root-scale ${report.proportions.suggestedRootScale.toFixed(3)}`)
  if (report.roundtrip) console.log(`actions exported=${report.exportedActions} skipped=${report.skippedActions.length} (${[...new Set(report.skippedActions.map((item: { code: string }) => item.code))].join(', ') || '-'})`)
  if (report.roundtrip) console.log(`roundtrip joints=${report.roundtrip.jointCount} animations=${report.roundtrip.animationCount} preview="${report.roundtrip.name}" duration=${report.roundtrip.durationSeconds.toFixed(3)}s hipsTravel=${report.roundtrip.hipsTravelMeters.toFixed(3)}m elapsed=${report.elapsedMs}ms`)
  if (report.quality) console.log(`quality warnings ${report.quality.warnings.length ? report.quality.warnings.map((w: { code: string; actions: number }) => `${w.code}x${w.actions}`).join(' ') : '-'}`)
  if (report.model) console.log(`model ${report.model.status} meshes=${report.model.meshes} vertices=${report.model.vertices} influences ${report.model.maxInfluencesBefore}->${report.model.maxInfluencesAfter} images=${report.model.images.count} restError=${(report.model.restMaxErrorMeters * 1000).toFixed(4)}mm jointFit max=${report.model.jointFit.maxMeters.toFixed(3)}m checks=${JSON.stringify(report.model.checks)}${report.model.warnings.length ? ` warnings=${report.model.warnings.map((w: { code: string }) => w.code).join(',')}` : ''}`)
  if (report.minecraft20) console.log(`minecraft20 ${report.minecraft20.status} actions=${report.minecraft20.actions.length} roundtripError=${report.minecraft20.roundtripMaxErrorBlocks.toExponential(1)} blocks`)
  if (report.originalRig) console.log(`originalRig bones=${report.originalRig.bones} oldActions=${report.originalRig.originalActions} added=${report.originalRig.addedActions} roundtripError=${report.originalRig.roundtripMaxPositionErrorUnits.toExponential(1)} units`)
  for (const path of written) console.log(`wrote ${path}`)
  process.exit(status === 'PASS' ? 0 : status === 'BLOCKED' ? 2 : 1)
} catch (error) {
  write('.report.json', JSON.stringify({ status: 'FAIL', error: error instanceof Error ? error.message : String(error) }, null, 2))
  fail(error instanceof Error ? error.message : String(error))
}
