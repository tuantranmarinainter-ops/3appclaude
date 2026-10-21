import { Matrix4, Quaternion, Vector3 } from 'three'
import type { RetargetRig } from './universal'
import type { UniversalBakeFrame } from './universalBake'
import { contactMask, contactRanges } from './footContacts'

export type FootLockMode = 'on' | 'off'
const SIDES = ['Left', 'Right'] as const
const point = (world: number[]) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(world))
const rotation = (world: number[]) => { const q = new Quaternion(); new Matrix4().fromArray(world).decompose(new Vector3(), q, new Vector3()); return q }
const canonical = (name: string) => name.replace(/^mixamorig\d*:?/i, '')
const smooth = (v: number) => v * v * (3 - 2 * v)

/** Two-bone IK. Only leg rotations change: root/hips, local offsets, scales and segment lengths are untouched. */
export function lockFeet(rig: RetargetRig, frames: UniversalBakeFrame[]) {
  const byName = new Map(rig.bones.map(b => [canonical(b.name ?? b.id), b.id]))
  const report = { mode: 'on' as const, contactRanges: { left: [] as Array<[number, number]>, right: [] as Array<[number, number]> }, correctedFrames: 0, unreachableFrames: 0, maxResidualMeters: 0 }
  const footSamples = SIDES.map(side => frames.map(frame => {
    const feet = frame.bones.filter(b => [byName.get(`${side}Foot`), byName.get(`${side}ToeBase`)].includes(b.targetBoneId))
    return { y: Math.min(...feet.map(b => b.world[13]!)), time: frame.timeSeconds }
  }))
  const groundY = Math.min(...footSamples.flatMap(samples => samples.map(s => s.y)))
  if (!Number.isFinite(groundY)) return report
  for (const [sideIndex, side] of SIDES.entries()) {
    const ids = ['UpLeg', 'Leg', 'Foot'].map(role => byName.get(`${side}${role}`))
    if (ids.some(id => !id)) continue
    const [upperId, lowerId, footId] = ids as [string,string,string]
    const ranges = contactRanges(contactMask(footSamples[sideIndex]!, groundY))
    report.contactRanges[side === 'Left' ? 'left' : 'right'] = ranges
    // Snapshot original poses: blend windows must not accumulate the correction from another contact run.
    const originals = frames.map(frame => new Map(frame.bones.map(b => [b.targetBoneId, [...b.world]])))
    const plans = new Map<number, { anchor: Vector3; weight: number; pole: Vector3 }>()
    for (const [start, end] of ranges) {
      if (end <= start) continue
      const initial = originals[start]!, hip = point(initial.get(upperId)!), knee = point(initial.get(lowerId)!), anchor = point(initial.get(footId)!)
      const axis = anchor.clone().sub(hip).normalize()
      const pole = knee.clone().sub(hip).addScaledVector(axis, -knee.clone().sub(hip).dot(axis))
      if (pole.lengthSq() < 1e-10) { pole.set(0,0,1).addScaledVector(axis, -axis.z); if(pole.lengthSq()<1e-10) pole.set(1,0,0).addScaledVector(axis,-axis.x) }
      pole.normalize()
      for(let i=Math.max(0,start-4);i<=Math.min(frames.length-1,end+4);i++) {
        const weight = i < start ? smooth((i-start+4)/4) : i > end ? smooth((end+4-i)/4) : 1
        if(weight > (plans.get(i)?.weight ?? 0)) plans.set(i,{anchor,weight,pole})
      }
    }
    for (const [i, plan] of plans) {
      const frame=frames[i]!, original=originals[i]!, h=point(original.get(upperId)!), k=point(original.get(lowerId)!), f=point(original.get(footId)!)
      const target=f.clone().lerp(plan.anchor,plan.weight), a=h.distanceTo(k), b=k.distanceTo(f), delta=target.clone().sub(h), raw=delta.length()
      if (a<1e-8 || b<1e-8 || raw<1e-8) continue
      const d=Math.max(Math.abs(a-b)+1e-7, Math.min(a+b-1e-7,raw)), axis=delta.normalize()
      if(Math.abs(d-raw)>1e-5) report.unreachableFrames++
      const goal=h.clone().addScaledVector(axis,d), x=(a*a-b*b+d*d)/(2*d), y=Math.sqrt(Math.max(0,a*a-x*x))
      const pole=plan.pole.clone().addScaledVector(axis,-plan.pole.dot(axis))
      if(pole.lengthSq()<1e-10) continue
      pole.normalize()
      const newK=h.clone().addScaledVector(axis,x).addScaledVector(pole,y)
      const desired=new Map<string,Quaternion>([
        [upperId,new Quaternion().setFromUnitVectors(k.clone().sub(h).normalize(),newK.clone().sub(h).normalize()).multiply(rotation(original.get(upperId)!))],
        [lowerId,new Quaternion().setFromUnitVectors(f.clone().sub(k).normalize(),goal.clone().sub(newK).normalize()).multiply(rotation(original.get(lowerId)!))],
        [footId,rotation(original.get(footId)!)],
      ])
      const poses=new Map(frame.bones.map(bone=>[bone.targetBoneId,bone])), done=new Set<string>()
      const rebuild=(id:string):void=>{
        if(done.has(id)) return
        const bone=poses.get(id)!, parentId=rig.bones.find(b=>b.id===id)?.parentId
        if(parentId && poses.has(parentId)) rebuild(parentId)
        const parent=parentId && poses.get(parentId), parentWorld=parent ? new Matrix4().fromArray(parent.world) : new Matrix4()
        if(desired.has(id)) bone.rotation=rotation(parentWorld.toArray()).invert().multiply(desired.get(id)!).normalize().toArray()
        const local=new Matrix4().compose(new Vector3().fromArray(bone.position),new Quaternion().fromArray(bone.rotation),new Vector3().fromArray(bone.scale))
        bone.world=parentWorld.multiply(local).toArray();done.add(id)
      }
      for(const bone of frame.bones) rebuild(bone.targetBoneId)
      report.maxResidualMeters=Math.max(report.maxResidualMeters,point(poses.get(footId)!.world).distanceTo(target))
      report.correctedFrames++
    }
  }
  return report
}
