import { Vector3 } from 'three'
export interface ContactReach { hip: Vector3; foot: Vector3; upper: number; lower: number }
export interface AnchorSegment { start: number; end: number; anchor: Vector3; heightBudget: number }
export const ANKLE_HEIGHT_BUDGET_METERS = 0.009

/** Look ahead over a contact and intersect horizontal reach discs instead of chasing the initial anchor. */
export function planContactAnchors(poses: readonly ContactReach[], start: number, end: number): AnchorSegment[] {
 const fit=(first:number,last:number,preferred:Vector3,budget:number):Vector3|null=>{
  const discs=poses.slice(first,last+1).map(p=>({x:p.hip.x,z:p.hip.z,radius:Math.sqrt(Math.max(0,(p.upper+p.lower-1e-9)**2-Math.max(0,Math.abs(p.hip.y-p.foot.y)-budget)**2))}))
  const anchor=preferred.clone()
  for(let pass=0;pass<256;pass++){
   for(const d of discs){const dx=anchor.x-d.x,dz=anchor.z-d.z,length=Math.hypot(dx,dz);if(length>d.radius&&length>1e-12){anchor.x=d.x+dx*d.radius/length;anchor.z=d.z+dz*d.radius/length}}
   if(discs.every(d=>Math.hypot(anchor.x-d.x,anchor.z-d.z)<=d.radius+1e-7))return anchor
  }
  return null
 }
 const segments:AnchorSegment[]=[]
 let first=start,preferred=poses[start]!.foot.clone()
 while(first<=end){
  let anchor=first===start?fit(first,end,preferred,0):null,heightBudget=0,last=end
  if(!anchor){heightBudget=ANKLE_HEIGHT_BUDGET_METERS;if(first===start)anchor=fit(first,end,preferred,heightBudget)}
  if(!anchor){
   // If no common anchor exists, use the longest feasible prefix and re-anchor once.
   let lo=first,hi=Math.min(end,first+1),span=1
   while(hi<end&&fit(first,hi,preferred,heightBudget)){lo=hi;span*=2;hi=Math.min(end,first+span)}
   while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(fit(first,mid,preferred,heightBudget))lo=mid;else hi=mid-1}
   last=lo;anchor=fit(first,last,preferred,heightBudget)??poses[first]!.foot.clone()
  }
  segments.push({start:first,end:last,anchor,heightBudget});preferred=anchor;first=last+1
 }
 return segments
}

/** Spend at most 9 mm toward the hip before relaxing horizontal lock; never stretch a segment. */
export function reachableContactGoal(pose:ContactReach,target:Vector3,heightBudget:number){
 const {hip,foot,upper:a,lower:b}=pose,goal=target.clone(),length=a+b
 const horizontal=new Vector3(target.x-hip.x,0,target.z-hip.z),radius=horizontal.length()
 const required=Math.sqrt(Math.max(0,length*length-radius*radius)),lift=Math.min(heightBudget,Math.max(0,Math.abs(foot.y-hip.y)-required))
 goal.y=foot.y+Math.sign(hip.y-foot.y)*lift
 const dy=goal.y-hip.y,maximum=Math.sqrt(Math.max(0,length*length-dy*dy)),minimum=Math.sqrt(Math.max(0,(a-b)**2-dy*dy)),reachable=Math.max(minimum,Math.min(maximum,radius))
 if(radius>1e-9)horizontal.multiplyScalar(reachable/radius);else if(reachable>1e-9)horizontal.set(reachable,0,0)
 goal.x=hip.x+horizontal.x;goal.z=hip.z+horizontal.z
 return {goal,clamped:Math.abs(reachable-radius)>1e-5,heightDelta:lift}
}
