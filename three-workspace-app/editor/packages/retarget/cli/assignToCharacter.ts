import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addDraftToCharacter, listCharacterActions } from '../../library/characterActions.ts'
import { getAction, importPack, rebuildLibraryIndex } from '../../library/library.ts'
import { resolveCharacter } from '../../library/characters.ts'
import { readJsonFile, resolveLibraryPath, safeChild, writeJsonAtomic } from '../../library/store.ts'
import type { MotionPackMetadata } from '../../library/types.ts'
import { bobjModelToGlb, parseBobjModel } from '../src/bobjModel.ts'
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

function buildInputPack(directory: string, bytes: Uint8Array, rig: string, name: string, sourceName: string, durationSeconds: number, fps: number) {
  const stem = 'assigned'
  const glbPath = join(directory, `${stem}.glb`), manifestPath = join(directory, `${stem}.manifest.json`)
  const uuid = randomUUID()
  writeFileSync(glbPath, bytes)
  writeFileSync(manifestPath, JSON.stringify({ version: '1.0.0', rig, source: { file: sourceName, sha256: null }, actions: [{ uuid, name, sourceName, durationSeconds, fps, glbAnimationIndex: 0 }] }))
  writeFileSync(join(directory, `${stem}.report.json`), JSON.stringify({ status: 'PASS' }))
  return { uuid }
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
        let outputGlb: Uint8Array, sidecar: string, sidecarName: string
        if (conversionRig === 'minecraft20') {
          const exported = await exportMinecraft20(selectedGlb, sourceText)
          if (exported.report.status !== 'PASS') throw new Error(`Minecraft20 conversion failed: ${exported.report.status}`)
          const parsed = parseBobjModel(`${sourceText}\n${exported.bobj}`)
          const action = [...parsed.actions.values()][0]
          if (!action) throw new Error('Minecraft20 conversion returned no Action')
          parsed.actions = new Map([[action.name, action]])
          outputGlb = bobjModelToGlb(parsed).bytes
          sidecar = exported.bobj; sidecarName = 'anim.bobj'
        } else if (conversionRig === 'verity') {
          const exported = await exportVerityOriginalArtifacts({ sourceText, sourcePath: conversionModelPath, normalizedGlb: selectedGlb })
          const original = parseBobjModel(sourceText), converted = parseBobjModel(exported.bobj)
          const added = [...converted.actions].filter(([name]) => !original.actions.has(name))
          if (added.length !== 1) throw new Error(`Verity conversion returned ${added.length} new Actions`)
          converted.actions = new Map(added)
          outputGlb = bobjModelToGlb(converted).bytes
          sidecar = exported.bobj; sidecarName = 'anim.original.bbs.bobj'
        } else throw new TypeError(`Automatic assignment is not supported for rig ${character.character.rig}`)

        const directory = mkdtempSync(join(tmpdir(), 'w01-assign-'))
        try {
          buildInputPack(directory, outputGlb, conversionRig, source.name, source.sourceName ?? source.name, source.durationSeconds, source.fps)
          const pack = importPack({ root: options.libraryRoot, sourceDirectory: directory, createdBy: 'app1', license: sourcePack.license, category: source.category, tags: source.tags, loop: source.loop })
          const rawAction = pack.metadata.actions[0]
          if (!rawAction) throw new Error('Converted Action pack is empty')
          const draft = addDraftToCharacter({ root: options.libraryRoot, charId: character.character.charId, actionUuid: rawAction.uuid })
          const root = resolveLibraryPath({ root: options.libraryRoot }), draftPack = safeChild(root, 'packs', draft.packId)
          const metadataPath = safeChild(draftPack, 'meta.json'), metadata = readJsonFile<MotionPackMetadata>(metadataPath)
          const draftMetadata = metadata.actions.find((item) => item.uuid === draft.uuid)
          if (!draftMetadata) throw new Error('Assigned draft metadata is missing')
          draftMetadata.parentUuid = source.uuid
          draftMetadata.sourceName = source.sourceName ?? source.name
          draftMetadata.name = source.name
          if (source.nameVi) { draftMetadata.nameVi = source.nameVi; draftMetadata.nameViSource = source.nameViSource }
          draftMetadata.tags = [...source.tags]; draftMetadata.category = source.category; draftMetadata.loop = source.loop; draftMetadata.inPlace = source.inPlace
          writeJsonAtomic(metadataPath, metadata)
          writeFileSync(join(draftPack, sidecarName), sidecar)
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
