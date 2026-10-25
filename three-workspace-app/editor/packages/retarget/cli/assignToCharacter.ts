import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addConvertedDraftToCharacter, addDraftToCharacter, copyActionToCharacter, listCharacterActions } from '../../library/characterActions.ts'
import { getAction, rebuildLibraryIndex } from '../../library/library.ts'
import { resolveCharacter } from '../../library/characters.ts'
import { resolveLibraryPath, safeChild } from '../../library/store.ts'
import type { IndexedAction } from '../../library/types.ts'
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
type SkeletonKind = 'verity' | 'minecraft20' | 'mixamo65'

/**
 * N1b: the REAL skeleton an Action lives on. A pack/character label of mixamo65 does not prove a Mixamo65 body: Verity characters keep
 * their original 85-bone skeleton (original/model.bbs.bobj) while labelled mixamo65 for App 1. Decide from the owner's base model.
 */
function sourceSkeletonKind(root: string, source: ReturnType<typeof getAction>): SkeletonKind {
  if (source.ownerCharId) {
    try {
      const owner = resolveCharacter({ root, charId: source.ownerCharId })
      if (owner.baseModel?.format === 'bobj' && owner.baseModel.rig === 'verity') return 'verity'
      if (owner.baseModel?.format === 'bobj' && owner.baseModel.rig === 'minecraft20') return 'minecraft20'
      if (owner.character.rig === 'verity') return 'verity'
      if (existsSync(safeChild(root, 'characters', owner.character.charId, 'original', 'model.bbs.bobj'))) return 'verity'
      if (owner.character.rig === 'minecraft20') return 'minecraft20'
    } catch { /* fall back to the pack label */ }
  }
  return source.rig === 'verity' ? 'verity' : source.rig === 'minecraft20' ? 'minecraft20' : 'mixamo65'
}

/** Original Verity BOBJ of a Verity-skeleton owner: its registered base model, or the legacy original/model.bbs.bobj copy. */
function verityModelPathOf(root: string, owner: ResolvedLibraryCharacter | null): string | null {
  if (!owner) return null
  if (owner.baseModel?.format === 'bobj' && owner.baseModel.rig === 'verity') return owner.modelPath
  const legacy = safeChild(root, 'characters', owner.character.charId, 'original', 'model.bbs.bobj')
  return existsSync(legacy) ? legacy : null
}

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
  const verityModelPath = sourceSkeletonKind(root, source) === 'verity' ? verityModelPathOf(root, owner) : null
  if (!verityModelPath && (owner?.baseModel?.format !== 'bobj' || owner.baseModel.rig !== 'minecraft20')) {
    return oneAnimation(packGlb, source.glbAnimationIndex, source.name)
  }
  const packDir = dirname(source.glbPath)
  if (!verityModelPath && owner) {
    const sidecar = join(packDir, 'anim.bobj')
    if (!existsSync(sidecar)) return oneAnimation(packGlb, source.glbAnimationIndex, source.name)
    const model = parseBobjModel(readFileSync(owner.modelPath, 'utf8'))
    model.actions = parseBobjActions(readFileSync(sidecar, 'utf8'))
    if (model.actions.size !== 1) throw new Error('Minecraft Action sidecar must contain one Action')
    return bobjModelToGlb(model, { faceForward: true }).bytes
  }
  const sidecar = join(packDir, 'anim.original.bbs.bobj')
  if (!existsSync(sidecar)) return oneAnimation(packGlb, source.glbAnimationIndex, source.name)
  const base = parseBobjModel(readFileSync(verityModelPath!, 'utf8'))
  const model = parseBobjModel(readFileSync(sidecar, 'utf8'))
  const added = [...model.actions].filter(([name]) => !base.actions.has(name))
  if (added.length !== 1) throw new Error('Native Action sidecar must contain exactly one added Action')
  model.actions = new Map(added)
  return bobjModelToGlb(model, { faceForward: true }).bytes
}

/**
 * A Verity source makes App 1 append scene-node extras (X_Head_Jaw, manifest rig mixamo65+verity). Cross-skeleton assignment
 * targets plain Mixamo65 / Minecraft20 / Verity-via-Mixamo65, none of which carry them, so drop the extra nodes and their channels.
 */
function stripSceneExtraBones(bytes: Uint8Array): Uint8Array {
  const { json, bin } = decodeGlb(bytes)
  const nodes = (json.nodes ?? []) as Array<{ name?: string; children?: number[] }>
  const extra = new Set(nodes.flatMap((node, index) => /^X_/.test(node.name ?? '') ? [index] : []))
  if (!extra.size) return bytes
  for (const node of nodes) if (node.children) { node.children = node.children.filter((child) => !extra.has(child)); if (!node.children.length) delete node.children }
  for (const scene of (json.scenes ?? []) as Array<{ nodes?: number[] }>) if (scene.nodes) scene.nodes = scene.nodes.filter((index) => !extra.has(index))
  for (const skin of (json.skins ?? []) as Array<{ joints: number[] }>) skin.joints = skin.joints.filter((index) => !extra.has(index))
  for (const animation of (json.animations ?? []) as Array<{ channels: Array<{ target: { node?: number } }> }>) {
    animation.channels = animation.channels.filter((channel) => channel.target.node === undefined || !extra.has(channel.target.node))
  }
  return encodeGlb(json, bin)
}

/**
 * N1b: convert a source Action GLB to Mixamo65 through App 1's normalize pipeline
 * (Minecraft20 .bobj → Mixamo65, and Verity via its Mixamo65 mapping).
 */
async function convertToMixamo65(root: string, source: ReturnType<typeof getAction>, sourceGlb: Uint8Array, skeleton: SkeletonKind): Promise<{ glb: Uint8Array; durationSeconds: number }> {
  let sourceScene
  const owner = source.ownerCharId ? (() => { try { return resolveCharacter({ root, charId: source.ownerCharId }) } catch { return null } })() : null
  const sidecar = join(dirname(source.glbPath), 'anim.bobj')
  if (skeleton === 'minecraft20' && owner?.baseModel?.format === 'bobj' && owner.baseModel.rig === 'minecraft20' && existsSync(sidecar)) {
    sourceScene = loadBobj(readFileSync(sidecar, 'utf8'), readFileSync(owner.modelPath, 'utf8'))
  } else if (skeleton === 'verity' && verityModelPathOf(root, owner) && existsSync(join(dirname(source.glbPath), 'anim.original.bbs.bobj'))) {
    // Same path as the App 1 CLI for a Verity BOBJ model: the full model keeps the extra bones (jaw, wings) as scene nodes,
    // which the GLB re-export drops from the retained rig. Keep only the one Action this pack added to the base model.
    const base = parseBobjModel(readFileSync(verityModelPathOf(root, owner)!, 'utf8'))
    const sidecarText = readFileSync(join(dirname(source.glbPath), 'anim.original.bbs.bobj'), 'utf8')
    sourceScene = await loadAsset(new TextEncoder().encode(sidecarText), 'bobj', { skeletonOnly: true })
    const added = parseBobjModel(sidecarText).actions
    const addedNames = new Set([...added.keys()].filter((name) => !base.actions.has(name)))
    if (addedNames.size !== 1) throw new Error('Native Action sidecar must contain exactly one added Action')
    sourceScene.animations = sourceScene.animations.filter((clip) => addedNames.has(clip.name))
    if (sourceScene.animations.length !== 1) throw new Error('Verity Action sidecar did not load as one animation clip')
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
  return { glb: stripSceneExtraBones(result.glb), durationSeconds: result.manifest.actions[0]?.durationSeconds ?? source.durationSeconds }
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
  const targetKind: SkeletonKind = isLegacyMinecraft20 || character.character.rig === 'minecraft20' ? 'minecraft20'
    : character.character.rig === 'verity' || (character.character.rig === 'mixamo65' && hasOriginalRig) ? 'verity' : 'mixamo65'
  const results: AssignActionResult[] = []
  for (const [index, actionUuid] of options.actionUuids.entries()) {
    if (options.signal?.aborted) break
    try {
      const source = getAction({ root: options.libraryRoot, actionUuid })
      const owned = !!source.ownerCharId
      const sourceKind = sourceSkeletonKind(root, source)
      const existing = listCharacterActions({ root: options.libraryRoot, charId: character.character.charId })
        .find((item) => item.parentUuid?.toLowerCase() === source.uuid.toLowerCase())
      if (existing && !options.createNew) {
        results.push({ actionUuid, status: 'already-exists', assignedUuid: existing.uuid, name: source.name })
      } else if (owned && sourceKind === targetKind && rigsCompatible(character.character.rig, source.rig)) {
        // Same-rig character-owned source: a straight copy into the target's set (no conversion).
        const draft = copyActionToCharacter({ root: options.libraryRoot, actionUuid: source.uuid, toCharId: character.character.charId })
        results.push({ actionUuid, status: 'ok', assignedUuid: draft.uuid, name: source.name })
      } else if (!owned && ((character.character.rig === 'mixamo65' && !hasOriginalRig) || character.character.rig === 'mixamo65+verity')) {
        const draft = addDraftToCharacter({ root: options.libraryRoot, charId: character.character.charId, actionUuid: source.uuid })
        results.push({ actionUuid, status: 'ok', assignedUuid: draft.uuid, name: source.name })
      } else {
        const sourceGlb = owned ? ownedSourceGlb(root, source) : oneAnimation(readFileSync(source.glbPath), source.glbAnimationIndex, source.name)
        const conversionRig = isLegacyMinecraft20 ? 'minecraft20'
          : character.character.rig === 'verity' || (character.character.rig === 'mixamo65' && hasOriginalRig) ? 'verity'
            : character.character.rig
        const directory = mkdtempSync(join(tmpdir(), 'w01-assign-'))
        try {
          let draft: IndexedAction
          if (conversionRig === 'mixamo65' || conversionRig === 'mixamo65+verity') {
            // Cross-skeleton into Mixamo65 (Minecraft20 .bobj or Verity source) via App 1 normalize.
            const converted = await convertToMixamo65(root, source, sourceGlb, sourceKind)
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
            // Routing uses the owner's real skeleton, never the pack label (a Verity pack is labelled mixamo65).
            if (owned && sourceKind !== 'mixamo65' && sourceKind !== targetKind) inputGlb = (await convertToMixamo65(root, source, sourceGlb, sourceKind)).glb
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
              rig: conversionRig === 'verity' ? (character.character.rig === 'verity' ? 'mixamo65' : character.character.rig) : conversionRig, durationSeconds: source.durationSeconds, allowOwnedParent: owned })
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
