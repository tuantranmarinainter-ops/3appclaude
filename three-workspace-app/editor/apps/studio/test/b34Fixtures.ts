import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Matrix4 } from 'three'
import { MIXAMO65_BONE_PARENTS, universalFramesToGlb, createUniversalRetargeter, bakeUniversalRetargetFrames } from '@bbs/retarget'
import { createCharacter, registerBaseModel, rebuildLibraryIndex } from '../../../packages/library/index'
import { decodeGlb, encodeGlb } from '../../../packages/retarget/cli/glb'

export const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
export function libraryFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? libraryFiles(path.join(root, entry.name)).map((name) => `${entry.name}/${name}`) : [entry.name]).sort()
}
export function syntheticMixamoGlb(): Buffer {
  const worlds = new Map<string, Matrix4>()
  const rig = { fingerprint: 'b34-synthetic-65', bones: MIXAMO65_BONE_PARENTS.map(([name, parent]) => {
    const world = (parent ? worlds.get(parent)!.clone() : new Matrix4()).multiply(new Matrix4().makeTranslation(0, parent ? 0.04 : 1, 0))
    worlds.set(name, world)
    return { id: name, name: `mixamorig:${name}`, parentId: parent, restWorld: world.toArray() }
  }) }
  const solver = createUniversalRetargeter(rig, rig, rig.bones.map((bone) => ({ sourceBoneId: bone.id, targetBoneId: bone.id, enabled: true })))
  const frames = bakeUniversalRetargetFrames(solver, (time) => rig.bones.map((bone) => ({ id: bone.id,
    world: new Matrix4().makeTranslation(time * 0.1, 0, 0).multiply(new Matrix4().fromArray(bone.restWorld)).toArray() })), { startFrame: 0, endFrame: 6, fps: 30 })
  const decoded = decodeGlb(universalFramesToGlb(rig, rig.bones.map((bone) => bone.id), frames, 'Synthetic wave'))
  decoded.json.skins = [{ joints: rig.bones.map((bone) => decoded.json.nodes!.findIndex((node: { name?: string }) => node.name === bone.name)) }]
  return Buffer.from(encodeGlb(decoded.json, decoded.bin))
}
export function fixture(root: string, temp: string) {
  const armature = readFileSync(path.resolve('apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8')
  const bobj = `${armature}\no Body\no_arm minecraft20\nv 0 0 0\nvw body 1\nv 0 2 0\nvw head 1\nv 1 0 0\nvw body 1\nf 1 2 3\nan idle\nao body\nag location 0\nkf 0 0 LINEAR\nkf 20 0 LINEAR\n`
  const model = path.join(temp, 'mc20.bobj'); writeFileSync(model, bobj)
  const base = registerBaseModel({ name: 'B34 synthetic Minecraft', rig: 'minecraft20', modelFile: model })
  const den = createCharacter({ charId: 'b34-den', name: 'Đen', baseModelId: base.modelId })
  const hero = createCharacter({ charId: 'b34-hero', name: 'Hero', baseModelId: base.modelId })
  const source = syntheticMixamoGlb(), actionUuid = randomUUID(), packId = '3400000000000001', pack = path.join(root, 'packs', packId)
  mkdirSync(pack, { recursive: true })
  writeFileSync(path.join(pack, 'anim.glb'), source)
  const action = { uuid: actionUuid, name: 'Synthetic wave', durationSeconds: 0.2, fps: 30, category: 'idle', tags: [], loop: false, inPlace: true, glbAnimationIndex: 0, status: 'draft', version: 1 }
  writeFileSync(path.join(pack, 'meta.json'), JSON.stringify({ kind: 'motion-pack', libraryVersion: '1.1.0', packId, rig: 'mixamo65', glbSha256: sha(source), createdAt: '2026-10-26T00:00:00Z', license: { id: 'test', commitable: false }, actions: [action] }))
  writeFileSync(path.join(pack, 'anim.manifest.json'), JSON.stringify({ version: '1.0.0', rig: 'mixamo65', glbSha256: sha(source), actions: [action] }))
  rebuildLibraryIndex()
  return { den, hero, actionUuid, pack, bobj }
}
