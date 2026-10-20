import { PropertyBinding, type AnimationClip, type Object3D, type SkinnedMesh } from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { isMixamo65Topology } from './mixamo65'

/** Browser/local-worker exporter; caller supplies the rebound model and normalized target clips. */
export async function exportCanonicalModel(model: Object3D, animations: readonly AnimationClip[]): Promise<Uint8Array> {
  let skins = 0
  const jointNames = new Set<string>()
  model.traverse((node) => {
    const mesh = node as SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    skins++
    if (!isMixamo65Topology(mesh.skeleton.bones.map((bone) => ({ id: bone.uuid, name: bone.name,
      parentId: mesh.skeleton.bones.includes(bone.parent as typeof bone) ? bone.parent!.uuid : null })))) throw new TypeError('Model export requires canonical65 skin joints')
    for (const bone of mesh.skeleton.bones) jointNames.add(bone.name)
  })
  if (!skins || !animations.length) throw new TypeError('Model+Rig+Animation export requires a skinned model and normalized clips')
  for (const clip of animations) {
    if (!(clip.duration > 0) || !clip.validate() || !clip.tracks.length) throw new TypeError('Export animation must contain valid tracks and positive duration')
    for (const track of clip.tracks) {
      const binding = PropertyBinding.parseTrackName(track.name)
      if (!jointNames.has(binding.nodeName) || binding.objectName || binding.propertyIndex !== undefined || !['position', 'quaternion', 'scale'].includes(binding.propertyName)) throw new TypeError(`Export track does not target a canonical joint TRS: ${track.name}`)
      let matches = 0
      model.traverse((node) => { if (node.name === binding.nodeName) matches++ })
      if (matches !== 1) throw new TypeError(`Export track target is ambiguous: ${track.name}`)
    }
  }
  model.updateMatrixWorld(true)
  const output = await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: false, animations: animations.map((clip) => clip.clone()), trs: true })
  if (!(output instanceof ArrayBuffer)) throw new TypeError('Exporter did not produce a binary GLB')
  return new Uint8Array(output)
}
