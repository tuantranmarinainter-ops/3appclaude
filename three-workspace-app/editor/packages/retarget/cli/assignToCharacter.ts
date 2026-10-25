import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addConvertedDraftToCharacter, addDraftToCharacter, copyActionToCharacter, listCharacterActions } from '../../library/characterActions.ts'
import { getAction, rebuildLibraryIndex } from '../../library/library.ts'
import { resolveCharacter } from '../../library/characters.ts'
import { readJsonFile, resolveLibraryPath, safeChild } from '../../library/store.ts'
import type { IndexedAction, MotionPackMetadata } from '../../library/types.ts'
import { bobjModelNodeName, bobjModelToGlb, parseBobjModel } from '../src/bobjModel.ts'
import { parseBobjActions } from '../src/index.ts'
import { decodeGlb, encodeGlb } from './glb.ts'
import { loadAsset } from './loadAsset.ts'
import { loadBobj } from './loadBobj.ts'
import { runNormalize } from './normalizeCore.ts'
import { exportMinecraft20 } from './toMinecraft20.ts'
import { exportVerityOriginalArtifacts } from './verityOriginal.ts'

const MINECRAFT20_ARMATURE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj')
const BUILTIN_TARGET_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../builtin-assets/characters')

export interface AssignToCharacterOptions {
  actionUuids: string[]
  charId: string
  libraryRoot?: string
  createNew?: boolean
  signal?: AbortSignal
  onProgress?: (completed: number, total: number) => void
}

export interface AssignActionResult {
  actionUuid: string
  status: 'ok' | 'already-exists' | 'error'
  assignedUuid?: string
  name?: string
  reason?: string
  /** Short quality note attached to cross-skeleton conversions (N1b). */
  warning?: string
}

function oneAnimation(bytes: Uint8Array, animationIndex: number, name: string): Uint8Array {
  const { json, bin } = decodeGlb(bytes)
  const animations = json.animations as unknown[] | undefined
  if (!animations?.[animationIndex]) throw new Error(`Animation ${animationIndex} is missing from the source GLB`)
  json.animations = [{ ...(animations[animationIndex] as Record<string, unknown>), name }]
  return encodeGlb(json, bin)
}

/** Library validation needs all twenty BOBJ joints, including global item joints outside the playable anchor tree. */
function addBobjSkeletonSkin(bytes: Uint8Array, boneNames: string[]): Uint8Array {
  const decoded = decodeGlb(bytes), nodes = (decoded.json.nodes ?? []) as Array<{ name?: string }>
  const joints = boneNames.map((name) => nodes.findIndex((node) => node.name === bobjModelNodeName(name)))
  if (joints.some((index) => index < 0)) throw new Error('Minecraft20 library GLB is missing a BOBJ joint node')
  decoded.json.skins = [...((decoded.json.skins as unknown[] | undefined) ?? []), { joints }]
  return encodeGlb(decoded.json, decoded.bin)
}

/** Same rig-compatibility predicate the library uses for copies and drafts. */
function rigsCompatible(characterRig: string, actionRig: string): boolean {
  return characterRig === actionRig ||
    (characterRig === 'verity' && (actionRig === 'mixamo65' || actionRig === 'mixamo65+verity')) ||
    ((characterRig === 'mixamo65' || characterRig === 'mixamo65+verity') && actionRig === 'verity')
}

function conversionWarning(sourceRig: string, targetRig: string): string {
  return `Đã chuyển xương ${sourceRig} → ${targetRig}: nên kiểm tra nhanh khớp vai/hông và độ bám đất của Nháp mới trước khi duyệt.`
}

type ResolvedLibraryCharacter = ReturnType<typeof resolveCharacter>

/**
 * N1b: build the source Action's GLB on its OWNER's rig. Native BOBJ owners keep the real
 * animation in the pack sidecar (the pack GLB only carries the model), so compose it from
 * the owner's base model + sidecar exactly like the studio's libraryNativeAction does.
 */
function ownedSourceGlb(root: string, source: ReturnType<typeof getAction>): Uint8Array {
  const packGlb = readFileSync(source.glbPath)
  if (!source.ownerCharId) return oneAnimation(packGlb, source.glbAnimationIndex, source.name)
  let owner: ResolvedLibraryCharacter | null = null
  try { owner = resolveCharacter({ root, charId: source.ownerCharId }) } catch { owner = null }
  if (owner?.baseModel?.format !== 'bobj' || !['verity', 'minecraft20'].includes(owner.baseModel.rig)) {
    return oneAnimation(packGlb, source.glbAnimationIndex, source.name)
  }
  const packDir = dirname(source.glbPath)
  if (owner.baseModel.rig === 'minecraft20') {
    const sidecar = join(packDir, 'anim.bobj')
    if (!existsSync(sidecar)) return oneAnimation(packGlb, source.glbAnimationIndex, source.name)
    const model = parseBobjModel(readFileSync(owner.modelPath, 'utf8'))
    model.actions = parseBobjActions(readFileSync(sidecar, 'utf8'))
    if (model.actions.size !== 1) throw new Error('Minecraft Action sidecar must contain one Action')
    return bobjModelToGlb(model, { faceForward: true }).bytes
  }
  const sidecar = join(packDir, 'anim.original.bbs.bobj')
  if (!existsSync(sidecar)) return oneAnimation(packGlb, source.glbAnimationIndex, source.name)
  const base = parseBobjModel(readFileSync(owner.modelPath, 'utf8'))
  const model = parseBobjModel(readFileSync(sidecar, 'utf8'))
  const added = [...model.actions].filter(([name]) => !base.actions.has(name))
  if (added.length !== 1) throw new Error('Native Action sidecar must contain exactly one added Action')
  model.actions = new Map(added)
  return bobjModelToGlb(model, { faceForward: true }).bytes
}

/**
 * N1b: convert a source Action GLB to Mixamo65 through App 1's normalize pipeline
 * (Minecraft20 .bobj → Mixamo65, and Verity via its Mixamo65 mapping).
 */
async function convertToMixamo65(root: string, source: ReturnType<typeof getAction>, sourceGlb: Uint8Array): Promise<{ glb: Uint8Array; durationSeconds: number }> {
  let sourceScene
  const owner = source.ownerCharId ? (() => { try { return resolveCharacter({ root, charId: source.ownerCharId }) } catch { return null } })() : null
  const sidecar = join(dirname(source.glbPath), 'anim.bobj')
  if (source.rig === 'minecraft20' && owner?.baseModel?.format === 'bobj' && owner.baseModel.rig === 'minecraft20' && existsSync(sidecar)) {
    sourceScene = loadBobj(readFileSync(sidecar, 'utf8'), readFileSync(owner.modelPath, 'utf8'))
  } else {
    sourceScene = await loadAsset(sourceGlb, 'glb', { skeletonOnly: true })
  }
  const targetFile = readdirSync(BUILTIN_TARGET_DIR).filter((name) => /^a3d_char_.*\.glb$/i.test(name)).sort()[0]
  if (!targetFile) throw new Error('No builtin Mixamo65 target character is available for conversion')
  const targetBytes = readFileSync(join(BUILTIN_TARGET_DIR, targetFile))
  const targetScene = await loadAsset(targetBytes, 'glb', { skeletonOnly: true })
  const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  const result = await runNormalize({
    source: sourceScene, sourceLabel: source.name, sourceSha256: sha256(sourceGlb),
    target: targetScene, targetLabel: targetFile, targetSha256: sha256(targetBytes),
    actions: [0], rootPolicy: 'preserve',
  })
  if (!('glb' in result)) {
    const blocker = (result.report as { blocker?: { message?: string } } | undefined)?.blocker
    throw new Error(`Normalize to Mixamo65 failed: ${blocker?.message ?? result.status}`)
  }
  return { glb: result.glb, durationSeconds: result.manifest.actions[0]?.durationSeconds ?? source.durationSeconds }
}

/** Assign shared-library or character-owned Actions to a character using that character's native rig. */
export async function assignToCharacter(options: AssignToCharacterOptions): Promise<AssignActionResult[]> {
  if (!Array.isArray(options.actionUuids) || !options.actionUuids.length) throw new TypeError('At least one actionUuid is required')
  const character = resolveCharacter({ root: options.libraryRoot, charId: options.charId })
  const root = resolveLibraryPath({ root: options.libraryRoot })
  const characterDirectory = safeChild(root, 'characters', character.character.charId)
  const originalModelPath = safeChild(characterDirectory, 'original', 'model.bbs.bobj')
  const hasOriginalRig = existsSync(originalModelPath)
  const isLegacyMinecraft20 = !character.baseModel && character.character.rig === 'minecraft20'
    && existsSync(safeChild(characterDirectory, 'skin.png'))
  const minecraftArmaturePath = isLegacyMinecraft20 && !character.modelPath.toLowerCase().endsWith('.bobj')
    ? MINECRAFT20_ARMATURE_PATH
    : character.modelPath
  const results: AssignActionResult[] = []
  for (const [index, actionUuid] of options.actionUuids.entries()) {
    if (options.signal?.aborted) break
    try {
      const source = getAction({ root: options.libraryRoot, actionUuid })
      const owned = !!source.ownerCharId
      const existing = listCharacterActions({ root: options.libraryRoot, charId: character.character.charId })
        .find((item) => item.parentUuid?.toLowerCase() === source.uuid.toLowerCase())
      if (existing && !options.createNew) {
        results.push({ actionUuid, status: 'already-exists', assignedUuid: existing.uuid, name: source.name })
      } else if (owned && rigsCompatible(character.character.rig, source.rig)) {
        // Same-rig character-owned source: a straight copy into the target's set (no conversion).
        const draft = copyActionToCharacter({ root: options.libraryRoot, actionUuid: source.uuid, toCharId: character.character.charId })
        results.push({ actionUuid, status: 'ok', assignedUuid: draft.uuid, name: source.name })
      } else if (!owned && ((character.character.rig === 'mixamo65' && !hasOriginalRig) || character.character.rig === 'mixamo65+verity')) {
        const draft = addDraftToCharacter({ root: options.libraryRoot, charId: character.character.charId, actionUuid: source.uuid })
        results.push({ actionUuid, status: 'ok', assignedUuid: draft.uuid, name: source.name })
      } else {
        const sourceGlb = owned ? ownedSourceGlb(root, source) : oneAnimation(readFileSync(source.glbPath), source.glbAnimationIndex, source.name)
        const sourcePack = readJsonFile<MotionPackMetadata>(safeChild(root, 'packs', source.packId, 'meta.json'))
        const conversionRig = isLegacyMinecraft20 ? 'minecraft20'
          : character.character.rig === 'verity' || (character.character.rig === 'mixamo65' && hasOriginalRig) ? 'verity'
            : character.character.rig
        const directory = mkdtempSync(join(tmpdir(), 'w01-assign-'))
        try {
          let draft: IndexedAction
          if (conversionRig === 'mixamo65' || conversionRig === 'mixamo65+verity') {
            // Cross-skeleton into Mixamo65 (Minecraft20 .bobj or Verity source) via App 1 normalize.
            const converted = await convertToMixamo65(root, source, sourceGlb)
            const glbFile = join(directory, 'assigned.glb')
            writeFileSync(glbFile, converted.glb)
            draft = addConvertedDraftToCharacter({ root: options.libraryRoot, charId: character.character.charId, parentUuid: source.uuid, glbFile,
              rig: conversionRig, durationSeconds: converted.durationSeconds, allowOwnedParent: owned })
          } else {
            const conversionModelPath = isLegacyMinecraft20 ? minecraftArmaturePath
              : character.character.rig === 'mixamo65' && hasOriginalRig ? originalModelPath
                : character.modelPath
            const sourceText = readFileSync(conversionModelPath, 'utf8')
            // Verity sources reach Minecraft20 (and Mixamo65 sources reach Verity directly) through
            // the Mixamo65 mapping first when the source is not already a Mixamo65-family GLB.
            let inputGlb = sourceGlb
            if (owned && conversionRig === 'minecraft20' && source.rig === 'verity') inputGlb = (await convertToMixamo65(root, source, sourceGlb)).glb
            if (owned && conversionRig === 'verity' && source.rig === 'minecraft20') inputGlb = (await convertToMixamo65(root, source, sourceGlb)).glb
            let outputGlb: Uint8Array, sidecar: string, sidecarName: string, originalGlb: Uint8Array | undefined
            if (conversionRig === 'minecraft20') {
              const exported = await exportMinecraft20(inputGlb, sourceText)
              if (exported.report.status !== 'PASS') throw new Error(`Minecraft20 conversion failed: ${exported.report.status}`)
              const parsedModel = parseBobjModel(sourceText), actions = parseBobjActions(exported.bobj)
              const action = [...actions.values()][0]
              if (!action) throw new Error('Minecraft20 conversion returned no Action')
              parsedModel.actions = new Map([[action.name, action]])
              outputGlb = addBobjSkeletonSkin(bobjModelToGlb(parsedModel).bytes, parsedModel.armature.bones.map((bone) => bone.name))
              sidecar = exported.bobj; sidecarName = 'anim.bobj'
            } else if (conversionRig === 'verity') {
              const exported = await exportVerityOriginalArtifacts({ sourceText, sourcePath: conversionModelPath, normalizedGlb: inputGlb })
              outputGlb = inputGlb
              originalGlb = exported.glb
              sidecar = exported.bobj; sidecarName = 'anim.original.bbs.bobj'
            } else throw new TypeError(`Automatic assignment is not supported for rig ${character.character.rig}`)

            // The converted GLB becomes the character's draft directly, linked to the source Action; the shared store gets no copy.
            const glbFile = join(directory, 'assigned.glb')
            writeFileSync(glbFile, outputGlb)
            draft = addConvertedDraftToCharacter({ root: options.libraryRoot, charId: character.character.charId, parentUuid: source.uuid, glbFile,
              rig: conversionRig === 'verity' ? sourcePack.rig : conversionRig, durationSeconds: source.durationSeconds, allowOwnedParent: owned })
            const draftPack = safeChild(root, 'packs', draft.packId)
            writeFileSync(join(draftPack, sidecarName), sidecar)
            if (originalGlb) writeFileSync(join(draftPack, 'anim.original.glb'), originalGlb)
          }
          rebuildLibraryIndex({ root })
          results.push({ actionUuid, status: 'ok', assignedUuid: draft.uuid, name: source.name, warning: conversionWarning(source.rig, character.character.rig) })
        } finally { rmSync(directory, { recursive: true, force: true }) }
      }
    } catch (error) {
      results.push({ actionUuid, status: 'error', reason: error instanceof Error ? error.message : String(error) })
    }
    options.onProgress?.(index + 1, options.actionUuids.length)
  }
  return results
}
