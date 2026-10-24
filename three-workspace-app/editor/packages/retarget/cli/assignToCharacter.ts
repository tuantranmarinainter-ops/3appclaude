import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addConvertedDraftToCharacter, addDraftToCharacter, listCharacterActions } from '../../library/characterActions.ts'
import { getAction, rebuildLibraryIndex } from '../../library/library.ts'
import { resolveCharacter } from '../../library/characters.ts'
import { readJsonFile, resolveLibraryPath, safeChild } from '../../library/store.ts'
import type { MotionPackMetadata } from '../../library/types.ts'
import { bobjModelNodeName, bobjModelToGlb, parseBobjModel } from '../src/bobjModel.ts'
import { parseBobjActions } from '../src/index.ts'
import { decodeGlb, encodeGlb } from './glb.ts'
import { exportMinecraft20 } from './toMinecraft20.ts'
import { exportVerityOriginalArtifacts } from './verityOriginal.ts'

const MINECRAFT20_ARMATURE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj')

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

/** Assign selected shared-library Actions to a character using that character's native rig. */
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
      if (source.ownerCharId) throw new TypeError('Only shared-library Actions can be assigned')
      const existing = listCharacterActions({ root: options.libraryRoot, charId: character.character.charId })
        .find((item) => item.parentUuid?.toLowerCase() === source.uuid.toLowerCase())
      if (existing && !options.createNew) {
        results.push({ actionUuid, status: 'already-exists', assignedUuid: existing.uuid, name: source.name })
      } else if ((character.character.rig === 'mixamo65' && !hasOriginalRig) || character.character.rig === 'mixamo65+verity') {
        const draft = addDraftToCharacter({ root: options.libraryRoot, charId: character.character.charId, actionUuid: source.uuid })
        results.push({ actionUuid, status: 'ok', assignedUuid: draft.uuid, name: source.name })
      } else {
        const selectedGlb = oneAnimation(readFileSync(source.glbPath), source.glbAnimationIndex, source.name)
        const sourcePack = readJsonFile<MotionPackMetadata>(safeChild(resolveLibraryPath({ root: options.libraryRoot }), 'packs', source.packId, 'meta.json'))
        const conversionRig = isLegacyMinecraft20 ? 'minecraft20'
          : character.character.rig === 'verity' || (character.character.rig === 'mixamo65' && hasOriginalRig) ? 'verity'
            : character.character.rig
        const conversionModelPath = isLegacyMinecraft20 ? minecraftArmaturePath
          : character.character.rig === 'mixamo65' && hasOriginalRig ? originalModelPath
            : character.modelPath
        const sourceText = readFileSync(conversionModelPath, 'utf8')
        let outputGlb: Uint8Array, sidecar: string, sidecarName: string, originalGlb: Uint8Array | undefined
        if (conversionRig === 'minecraft20') {
          const exported = await exportMinecraft20(selectedGlb, sourceText)
          if (exported.report.status !== 'PASS') throw new Error(`Minecraft20 conversion failed: ${exported.report.status}`)
          const parsedModel = parseBobjModel(sourceText), actions = parseBobjActions(exported.bobj)
          const action = [...actions.values()][0]
          if (!action) throw new Error('Minecraft20 conversion returned no Action')
          parsedModel.actions = new Map([[action.name, action]])
          outputGlb = addBobjSkeletonSkin(bobjModelToGlb(parsedModel).bytes, parsedModel.armature.bones.map((bone) => bone.name))
          sidecar = exported.bobj; sidecarName = 'anim.bobj'
        } else if (conversionRig === 'verity') {
          const exported = await exportVerityOriginalArtifacts({ sourceText, sourcePath: conversionModelPath, normalizedGlb: selectedGlb })
          outputGlb = selectedGlb
          originalGlb = exported.glb
          sidecar = exported.bobj; sidecarName = 'anim.original.bbs.bobj'
        } else throw new TypeError(`Automatic assignment is not supported for rig ${character.character.rig}`)

        const directory = mkdtempSync(join(tmpdir(), 'w01-assign-'))
        try {
          // The converted GLB becomes the character's draft directly, linked to the shared Action; the shared store gets no copy.
          const glbFile = join(directory, 'assigned.glb')
          writeFileSync(glbFile, outputGlb)
          const draft = addConvertedDraftToCharacter({ root: options.libraryRoot, charId: character.character.charId, parentUuid: source.uuid, glbFile,
            rig: conversionRig === 'verity' ? sourcePack.rig : conversionRig, durationSeconds: source.durationSeconds })
          const draftPack = safeChild(root, 'packs', draft.packId)
          writeFileSync(join(draftPack, sidecarName), sidecar)
          if (originalGlb) writeFileSync(join(draftPack, 'anim.original.glb'), originalGlb)
          rebuildLibraryIndex({ root })
          results.push({ actionUuid, status: 'ok', assignedUuid: draft.uuid, name: source.name })
        } finally { rmSync(directory, { recursive: true, force: true }) }
      }
    } catch (error) {
      results.push({ actionUuid, status: 'error', reason: error instanceof Error ? error.message : String(error) })
    }
    options.onProgress?.(index + 1, options.actionUuids.length)
  }
  return results
}
