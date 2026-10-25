import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolveCharacter } from '../../../packages/library/index'
import { bobjModelToGlb, parseBobjModel } from '../../../packages/retarget/src/bobjModel'

/** Library BOBJ models face +Z at rest like Minecraft20; native clips already carry the Root turn. */
export const LIBRARY_GLB_OPTIONS = { faceForward: true } as const

/**
 * C25 display name for a storyboard node linked to a library character: "Tên vai · Shot NN".
 * The shot number comes from the trailing number of the storyboard node name
 * ("go 01_1" / "go 01" -> Shot 01); nodes without a trailing number keep the plain role name.
 */
export function libraryShotDisplayName(characterName: string, nodeName: string): string {
  // Storyboard node names carry Topview's uniqueness suffixes ("go 01" -> "go 01_1");
  // the shot number is the first trailing number group, before any _N suffixes.
  const match = /(\d+)(?:_\d+)*\s*$/.exec(nodeName.trim())
  if (!match) return characterName
  return `${characterName} · Shot ${match[1]!.padStart(2, '0')}`
}

export function unpackLibraryGlb(bytes: Buffer) {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('Invalid library GLB')
  const size = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.subarray(20, 20 + size).toString('utf8'))
  const offset = 20 + size
  return { json, binary: bytes.subarray(offset + 8, offset + 8 + bytes.readUInt32LE(offset)) }
}
export function packLibraryGlb(json: any, binary: Buffer): Buffer {
  const text = Buffer.from(JSON.stringify(json)), j = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32), b = Buffer.alloc(Math.ceil(binary.length / 4) * 4)
  text.copy(j); binary.copy(b)
  const out = Buffer.alloc(28 + j.length + b.length)
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8)
  out.writeUInt32LE(j.length, 12); out.writeUInt32LE(0x4e4f534a, 16); j.copy(out, 20)
  out.writeUInt32LE(b.length, 20 + j.length); out.writeUInt32LE(0x004e4942, 24 + j.length); b.copy(out, 28 + j.length)
  return out
}

/** Add one animation to a textured character model while preserving its skeleton and meshes. */
export function composeLibraryActionGlb(characterBytes: Buffer, actionBytes: Buffer, animationIndex = 0): Buffer {
  const character = unpackLibraryGlb(characterBytes), action = unpackLibraryGlb(actionBytes)
  const source = action.json.animations?.[animationIndex]
  if (!source || !Array.isArray(source.channels) || !Array.isArray(source.samplers)) throw new Error('Library Action animation is missing')
  const normalize = (value: unknown) => String(value ?? '').split(':').pop()!.replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
  const targets = new Map<string, number>()
  const jointNodes = new Set<number>((character.json.skins ?? []).flatMap((skin: any) => Array.isArray(skin.joints) ? skin.joints : []))
  for (const [index, node] of (character.json.nodes ?? []).entries()) if (typeof node.name === 'string') {
    if (jointNodes.size && !jointNodes.has(index)) continue
    const key = normalize(node.name)
    if (targets.has(key)) throw new Error(`Library character has ambiguous normalized bone name: ${node.name}`)
    targets.set(key, index)
  }
  const animation = structuredClone(source)
  const nodes = action.json.nodes ?? []
  for (const channel of animation.channels) {
    const sourceNode = nodes[channel.target?.node]
    const target = targets.get(normalize(sourceNode?.name))
    if (target === undefined) throw new Error(`Library Action bone is not present in character model: ${sourceNode?.name ?? 'unknown'}`)
    channel.target.node = target
  }
  const accessors = character.json.accessors ?? [], bufferViews = character.json.bufferViews ?? []
  const accessorOffset = accessors.length, viewOffset = bufferViews.length, base = Math.ceil(character.binary.length / 4) * 4
  const actionViews = action.json.bufferViews ?? [], actionAccessors = action.json.accessors ?? []
  character.json.bufferViews = [...bufferViews, ...actionViews.map((view: any) => ({ ...structuredClone(view), byteOffset: (view.byteOffset ?? 0) + base }))]
  character.json.accessors = [...accessors, ...actionAccessors.map((accessor: any) => {
    const copy = structuredClone(accessor)
    if (copy.bufferView !== undefined) copy.bufferView += viewOffset
    if (copy.sparse?.indices?.bufferView !== undefined) copy.sparse.indices.bufferView += viewOffset
    if (copy.sparse?.values?.bufferView !== undefined) copy.sparse.values.bufferView += viewOffset
    return copy
  })]
  for (const sampler of animation.samplers) { sampler.input += accessorOffset; sampler.output += accessorOffset }
  character.json.animations = [animation]
  const binary = Buffer.concat([character.binary, Buffer.alloc(base - character.binary.length), action.binary])
  character.json.buffers[0].byteLength = binary.length
  return packLibraryGlb(character.json, binary)
}

/** Base bytes never include character overrides: one content-addressed project model. */
export async function libraryBaseGlb(charId: string, faceForward = true): Promise<Buffer> {
  const resolved = resolveCharacter(charId)
  if (!resolved.baseModel) throw new Error('Library character has no base model')
  const source = await readFile(resolved.modelPath)
  if (createHash('sha256').update(source).digest('hex') !== resolved.baseModel.sha256) throw new Error('Library model checksum mismatch')
  if (resolved.baseModel.format === 'glb') return source
  return Buffer.from(bobjModelToGlb(parseBobjModel(source.toString('utf8')), { faceForward }).bytes)
}

/** The URL fingerprint covers actual model and texture bytes, not mutable profile fields. */
export async function libraryCharacterModel(charId: string, faceForward = true) {
  const resolved = resolveCharacter(charId), base = await libraryBaseGlb(charId, faceForward)
  const textures = await Promise.all(Object.entries(resolved.textures).sort(([a], [b]) => a.localeCompare(b)).map(async ([object, file]) => ({ object, bytes: await readFile(file) })))
  const hash = createHash('sha256').update(base)
  for (const item of textures) hash.update(JSON.stringify(item.object)).update(createHash('sha256').update(item.bytes).digest())
  const fingerprint = hash.digest('hex')
  const { json, binary } = unpackLibraryGlb(base)
  let bin = binary
  json.images ??= []; json.textures ??= []; json.materials ??= []; json.bufferViews ??= []
  for (const { object, bytes } of textures) {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Skin is not PNG: ${object}`)
    const offset = Math.ceil(bin.length / 4) * 4
    bin = Buffer.concat([bin, Buffer.alloc(offset - bin.length), bytes])
    const view = json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }) - 1
    const image = json.images.push({ bufferView: view, mimeType: 'image/png' }) - 1
    const texture = json.textures.push({ source: image }) - 1
    const nodes = json.nodes.filter((node: any) => node.mesh !== undefined && (node.name === object || node.extras?.bobjObject === object || json.meshes[node.mesh]?.name === object))
    for (const node of nodes) {
      const mesh = structuredClone(json.meshes[node.mesh])
      for (const primitive of mesh.primitives) {
        const material = structuredClone(json.materials[primitive.material] ?? {})
        material.pbrMetallicRoughness = { ...material.pbrMetallicRoughness, baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: texture } }
        primitive.material = json.materials.push(material) - 1
      }
      node.mesh = json.meshes.push(mesh) - 1
    }
  }
  json.buffers[0].byteLength = bin.length
  return { bytes: packLibraryGlb(json, bin), fingerprint }
}

/**
 * Mọi nhân vật thư viện dưới dạng GLB cho viewer: nhân vật có base model đi qua
 * `libraryCharacterModel` (kèm texture/skin); nhân vật cũ chưa có base model thì đọc
 * model ngay trong thư mục của nó — GLB trả nguyên, `.bobj` chuyển khi đọc.
 */
export async function libraryCharacterGlb(charId: string): Promise<Buffer> {
  const resolved = resolveCharacter(charId)
  if (resolved.baseModel) return (await libraryCharacterModel(charId)).bytes
  const source = await readFile(resolved.modelPath)
  if (resolved.character.model.toLowerCase().endsWith('.bobj')) return Buffer.from(bobjModelToGlb(parseBobjModel(source.toString('utf8')), LIBRARY_GLB_OPTIONS).bytes)
  return source
}

/** A character-owned sidecar must extend the exact authoritative native model. */
export async function libraryNativeAction(charId: string, sidecar: string) {
  const resolved = resolveCharacter(charId)
  if (resolved.baseModel?.format !== 'bobj') throw new Error('Native Action requires a BOBJ character')
  const original = await readFile(resolved.modelPath)
  if (createHash('sha256').update(original).digest('hex') !== resolved.baseModel.sha256) throw new Error('Library model checksum mismatch')
  const extended = await readFile(sidecar)
  if (resolved.baseModel.rig === 'minecraft20') {
    if (/^(arm_bone|arm_name|o|v|vw|f)\s/m.test(extended.toString('utf8'))) throw new Error('Minecraft Action sidecar must contain only animation data')
    const model = parseBobjModel(original.toString('utf8') + '\n' + extended.toString('utf8'))
    const { parseBobjActions } = await import('../../../packages/retarget/src/index')
    model.actions = parseBobjActions(extended.toString('utf8'))
    if (model.actions.size !== 1) throw new Error('Minecraft Action sidecar must contain one Action')
    return Buffer.from(bobjModelToGlb(model, LIBRARY_GLB_OPTIONS).bytes)
  }
  if (!extended.subarray(0, original.length).equals(original)) throw new Error('Native Action does not preserve the selected base model')
  const base = parseBobjModel(original.toString('utf8')), model = parseBobjModel(extended.toString('utf8'))
  const added = [...model.actions].filter(([name]) => !base.actions.has(name))
  if (added.length !== 1) throw new Error('Native Action sidecar must contain exactly one added Action')
  model.actions = new Map(added)
  return Buffer.from(bobjModelToGlb(model, LIBRARY_GLB_OPTIONS).bytes)
}
