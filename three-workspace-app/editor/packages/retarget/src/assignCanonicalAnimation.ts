import type { Object3D } from 'three'
import { isMixamo65Topology } from './mixamo65'
import { normalizeAnimation } from './normalizeAnimation'
import { createThreeRigAdapter, type ThreeRigAdapterOptions } from './threeRigAdapter'

function nameKey(name: string) { return name.split(':').pop()!.replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase() }

/** Rebinds canonical motion to the receiver's rest pose; callers still commit and place the new derivative. */
export async function assignCanonicalAnimation(input: {
  source: Object3D; target: Object3D; sourceOptions: ThreeRigAdapterOptions; targetOptions: ThreeRigAdapterOptions;
  actionIndex: number; fps: number
}, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const source = createThreeRigAdapter(input.source, input.sourceOptions)
  let target: ReturnType<typeof createThreeRigAdapter> | undefined
  try {
    target = createThreeRigAdapter(input.target, input.targetOptions)
    for (const adapter of [source, target]) {
      const joints = new Set(adapter.joints)
      if (!isMixamo65Topology(adapter.rig.bones.map((bone) => ({ ...bone, name: bone.name ?? bone.id, deform: joints.has(bone.id) })))) throw new TypeError('Assignment requires canonical Mixamo65 source and receiver; normalize the source first')
    }
    const sourceByName = new Map(source.rig.bones.filter((bone) => source.joints.includes(bone.id)).map((bone) => [nameKey(bone.name ?? bone.id), bone.id]))
    const pairs = target.rig.bones.filter((bone) => target!.joints.includes(bone.id)).map((bone) => {
      const sourceBoneId = sourceByName.get(nameKey(bone.name ?? bone.id))
      if (!sourceBoneId) throw new TypeError(`Canonical correspondence missing for ${bone.name}`)
      return { sourceBoneId, targetBoneId: bone.id, enabled: true }
    })
    const output = await normalizeAnimation({ ...input, pairs, requiredTargetJointIds: target.joints }, signal)
    return { ...output, assignment: { sourceFingerprint: source.rig.fingerprint, receiverFingerprint: target.rig.fingerprint,
      matchedJoints: pairs.length, rootTranslationPolicy: 'preserve-meters' as const } }
  } finally { source.dispose(); target?.dispose() }
}
