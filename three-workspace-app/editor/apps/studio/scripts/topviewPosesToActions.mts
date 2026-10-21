/**
 * Turns the 121 Topview library poses (builtin-assets/poses, CC BY 4.0) into one-frame Actions on the Mixamo65 skeleton of
 * the builtin Female character, so a pose is an ordinary Motion everywhere (Studio, scene.render, CPU evaluation, Film, App 3)
 * instead of a browser-only pose-bank record. The pose math is the builder's own `applyPoseLibraryBoneRotations`
 * (world-space delta on the rest pose); `hips` is the whole-character offset the Studio applies, added to the Hips position.
 *
 *   node --import tsx ../../apps/studio/scripts/topviewPosesToActions.mts --out <file.glb>     (from packages/builder)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Vector3, type Bone } from 'three'
import { applyPoseLibraryBoneRotations } from '../../../packages/builder/src/engine/rig/applyPose.ts'
import { loadAsset } from '../../../packages/retarget/cli/loadAsset.ts'
import { Writer, writeSkeleton } from '../../../packages/retarget/cli/minecraftBlockCharacters.ts'

const ASSETS = resolve(import.meta.dirname, '../../../../builtin-assets')
const CHARACTER = 'characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb'

export async function posesGlb() {
  const manifest = JSON.parse(readFileSync(join(ASSETS, 'manifest.json'), 'utf8')) as { assets: Array<{ id: string; kind: string; name: string; file: string }> }
  const poses = manifest.assets.filter((asset) => asset.kind === 'pose')
  const root = await loadAsset(readFileSync(join(ASSETS, CHARACTER)), 'glb', { skeletonOnly: true })
  root.updateMatrixWorld(true)
  const bones: Bone[] = []
  root.traverse((object) => { if ((object as Bone).isBone) bones.push(object as Bone) })
  const hips = bones.find((bone) => /Hips$/.test(bone.name))!
  const restQ = new Map(bones.map((bone) => [bone.name, bone.quaternion.clone()])), restHips = hips.position.clone()
  const w = new Writer(), { index } = writeSkeleton(w, root, 'topview_female')
  const ibm = new Float32Array(bones.length * 16)
  bones.forEach((bone, i) => ibm.set(bone.matrixWorld.clone().invert().toArray(), i * 16))
  w.json.skins = [{ joints: bones.map((bone) => index.get(bone)!), inverseBindMatrices: w.accessor(ibm, 'MAT4', 5126) }]
  // Two identical keys one second apart: importers need a positive duration to treat the pose as a Motion.
  const times = w.accessor(new Float32Array([0, 1]), 'SCALAR', 5126, undefined, true)
  const hold = (values: number[]) => new Float32Array([...values, ...values])
  w.json.animations = []
  for (const pose of poses) {
    const record = JSON.parse(readFileSync(join(ASSETS, pose.file), 'utf8')) as { hips?: number[]; bones: Record<string, [number, number, number, number]> }
    for (const bone of bones) bone.quaternion.copy(restQ.get(bone.name)!)
    hips.position.copy(restHips); root.updateMatrixWorld(true)
    applyPoseLibraryBoneRotations(root, restQ, record.bones)
    // The library offset moves the whole character in world space; express it in the Hips parent's frame.
    const offset = new Vector3().fromArray(record.hips ?? [0, 0, 0])
    const parentWorld = hips.parent!.matrixWorld, hipsWorld = restHips.clone().applyMatrix4(parentWorld).add(offset)
    const hipsLocal = hipsWorld.applyMatrix4(parentWorld.clone().invert())
    const samplers: any[] = [], channels: any[] = []
    for (const bone of bones) {
      samplers.push({ input: times, output: w.accessor(hold(bone.quaternion.clone().normalize().toArray()), 'VEC4', 5126), interpolation: 'LINEAR' })
      channels.push({ sampler: samplers.length - 1, target: { node: index.get(bone)!, path: 'rotation' } })
    }
    samplers.push({ input: times, output: w.accessor(hold(hipsLocal.toArray()), 'VEC3', 5126), interpolation: 'LINEAR' })
    channels.push({ sampler: samplers.length - 1, target: { node: index.get(hips)!, path: 'translation' } })
    w.json.animations.push({ name: `pose_${pose.id.replace(/^a3d_pose_/, '')}`, samplers, channels })
  }
  return { bytes: w.glb(), count: poses.length }
}

if (process.argv[1]?.endsWith('topviewPosesToActions.mts')) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } })
  if (!values.out) throw new TypeError('--out <file.glb> is required')
  void posesGlb().then(({ bytes, count }) => { writeFileSync(values.out!, bytes); console.log(`wrote ${values.out} ${bytes.length} B, ${count} pose Actions`) })
}
