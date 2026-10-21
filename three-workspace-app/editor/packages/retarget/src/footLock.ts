import { Matrix4, Quaternion, Vector3 } from 'three'
import type { RetargetRig } from './universal'
import type { UniversalBakeFrame } from './universalBake'
import { contactMask, contactRanges, measureFootContact, type FootContactSample } from './footContacts'
import { planContactAnchors, reachableContactGoal } from './footLockAnchors'

export type FootLockMode = 'on' | 'off'
const SIDES = ['Left', 'Right'] as const
const point = (world: number[]) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(world))
const rotation = (world: number[]) => { const q = new Quaternion(); new Matrix4().fromArray(world).decompose(new Vector3(), q, new Vector3()); return q }
const canonical = (name: string) => name.replace(/^mixamorig\d*:?/i, '')
const twist = (q: Quaternion) => Math.hypot(q.y,q.w)>1e-8 ? new Quaternion(0,q.y,0,q.w).normalize() : new Quaternion()
const lockYaw = (current: Quaternion, anchor: Quaternion, weight: number) => { const yaw=twist(current);return yaw.clone().slerp(twist(anchor),weight).multiply(yaw.invert()).multiply(current).normalize() }
const smooth = (v: number) => v * v * (3 - 2 * v)

/** Two-bone IK. Only leg rotations change: root/hips, local offsets, scales and segment lengths are untouched. */
export function lockFeet(rig: RetargetRig, frames: UniversalBakeFrame[]) {
  const byName = new Map(rig.bones.map(b => [canonical(b.name ?? b.id), b.id]))
  const report = { mode: 'on' as const, contactRanges: { left: [] as Array<[number, number]>, right: [] as Array<[number, number]> }, correctedFrames: 0, unreachableFrames: 0, maxResidualMeters: 0, maxAnkleHeightDeltaMeters: 0, reAnchoredSegments: 0, slideAfterMeters: { left: 0, right: 0 } }
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
    const reaches=originals.map(pose=>{const hip=point(pose.get(upperId)!),knee=point(pose.get(lowerId)!),foot=point(pose.get(footId)!);return {hip,foot,upper:hip.distanceTo(knee),lower:knee.distanceTo(foot)}})
    const toeId=byName.get(`${side}ToeBase`)
    const plans = new Map<number, { anchor: Vector3; weight: number; pole: Vector3; heightBudget: number; footRotation: Quaternion; toeRotation: Quaternion | null }>()
    for (const [start, end] of ranges) {
      if (end <= start) continue
      const initial = originals[start]!, hip = point(initial.get(upperId)!), knee = point(initial.get(lowerId)!), anchor = point(initial.get(footId)!)
      const axis = anchor.clone().sub(hip).normalize()
      const pole = knee.clone().sub(hip).addScaledVector(axis, -knee.clone().sub(hip).dot(axis))
      if (pole.lengthSq() < 1e-10) { pole.set(0,0,1).addScaledVector(axis, -axis.z); if(pole.lengthSq()<1e-10) pole.set(1,0,0).addScaledVector(axis,-axis.x) }
      pole.normalize()
      const segments=planContactAnchors(reaches,start,end)
      report.reAnchoredSegments+=segments.filter(segment=>Math.hypot(segment.anchor.x-anchor.x,segment.anchor.z-anchor.z)>1e-5).length
      for(let i=Math.max(0,start-4);i<=Math.min(frames.length-1,end+4);i++) {
        const weight = i < start ? smooth((i-start+4)/4) : i > end ? smooth((end+4-i)/4) : 1
        const segment=segments.find(s=>i<=s.end)??segments[segments.length-1]!
        const planned=segment.anchor.clone(),index=segments.indexOf(segment),previous=segments[index-1]
        if(previous && i<segment.start+4)planned.lerpVectors(previous.anchor,segment.anchor,smooth(Math.max(0,(i-segment.start+1)/4)))
        if(weight > (plans.get(i)?.weight ?? 0)) plans.set(i,{anchor:planned,weight,pole,heightBudget:segment.heightBudget*weight,footRotation:rotation(initial.get(footId)!),toeRotation:toeId&&initial.has(toeId)?rotation(initial.get(toeId)!):null})
      }
    }
    for (const [i, plan] of plans) {
      const frame=frames[i]!, original=originals[i]!, h=point(original.get(upperId)!), k=point(original.get(lowerId)!), f=point(original.get(footId)!)
      const target=f.clone().lerp(plan.anchor,plan.weight)
      // Prefer authored ankle height; only the explicit <=9 mm reach budget may change it.
      target.y=f.y
      const a=h.distanceTo(k), b=k.distanceTo(f)
      if (a<1e-8 || b<1e-8) continue
      const {goal,clamped,heightDelta}=reachableContactGoal(reaches[i]!,target,plan.heightBudget)
      if(clamped)report.unreachableFrames++
      report.maxAnkleHeightDeltaMeters=Math.max(report.maxAnkleHeightDeltaMeters,heightDelta)
      const delta=goal.clone().sub(h), d=delta.length()
      if(d<1e-8) continue
      const axis=delta.divideScalar(d), x=(a*a-b*b+d*d)/(2*d), y=Math.sqrt(Math.max(0,a*a-x*x))
      const pole=plan.pole.clone().addScaledVector(axis,-plan.pole.dot(axis))
      if(pole.lengthSq()<1e-10) continue
      pole.normalize()
      const newK=h.clone().addScaledVector(axis,x).addScaledVector(pole,y)
      const desired=new Map<string,Quaternion>([
        [upperId,new Quaternion().setFromUnitVectors(k.clone().sub(h).normalize(),newK.clone().sub(h).normalize()).multiply(rotation(original.get(upperId)!))],
        [lowerId,new Quaternion().setFromUnitVectors(f.clone().sub(k).normalize(),goal.clone().sub(newK).normalize()).multiply(rotation(original.get(lowerId)!))],
        [footId,lockYaw(rotation(original.get(footId)!),plan.footRotation,plan.weight)],
      ])
      if(toeId && plan.toeRotation && original.has(toeId))desired.set(toeId,lockYaw(rotation(original.get(toeId)!),plan.toeRotation,plan.weight))
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
  const samples=SIDES.map(side=>frames.map(frame=>{
    const xz:Record<string,readonly [number,number]>={};let y=Infinity,joint=''
    for(const name of [`${side}ToeBase`,`${side}Foot`]){const bone=frame.bones.find(b=>b.targetBoneId===byName.get(name));if(!bone)continue
      const p=point(bone.world);xz[name]=[p.x,p.z];if(p.y<y){y=p.y;joint=name}}
    return {y,joint,time:frame.timeSeconds,xz} satisfies FootContactSample
  }).filter(s=>Number.isFinite(s.y)))
  const floor=Math.min(...samples.flatMap(side=>side.map(s=>s.y)))
  report.slideAfterMeters.left=measureFootContact(samples[0]!,floor).slideMeters
  report.slideAfterMeters.right=measureFootContact(samples[1]!,floor).slideMeters
  return report
}
