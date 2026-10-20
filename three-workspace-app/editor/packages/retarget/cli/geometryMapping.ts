import { Vector3 } from 'three'
import type { RetargetRig } from '../src/universal.ts'

/** Mixamo65 role → source bone id, plus how much to trust it. Always a suggestion: the user must confirm. */
export interface GeometryMapping { assignments: Map<string, string>; confidence: number; notes: string[] }

interface Node { id: string; name: string; parent: Node | null; children: Node[]; p: Vector3; extent: number; minY: number; maxY: number }

const UP = new Vector3(0, 1, 0)
const horizontal = (v: Vector3) => new Vector3(v.x, 0, v.z)
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

function buildNodes(rig: RetargetRig): Node[] {
  const nodes = rig.bones.map((bone): Node => ({ id: bone.id, name: bone.name ?? bone.id, parent: null, children: [], p: new Vector3().fromArray(bone.restWorld, 12),
    extent: 0, minY: 0, maxY: 0 }))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  rig.bones.forEach((bone, index) => {
    const parent = bone.parentId ? byId.get(bone.parentId) : undefined
    if (parent) { nodes[index]!.parent = parent; parent.children.push(nodes[index]!) }
  })
  const visit = (node: Node): void => {
    node.minY = node.maxY = node.p.y; node.extent = 0
    for (const child of node.children) {
      visit(child)
      node.minY = Math.min(node.minY, child.minY); node.maxY = Math.max(node.maxY, child.maxY)
      node.extent = Math.max(node.extent, node.p.distanceTo(child.p), child.extent + node.p.distanceTo(child.p))
    }
  }
  for (const node of nodes) if (!node.parent) visit(node)
  return nodes
}

/**
 * Follows one limb/neck chain downwards in the tree: single child → continue; a branch with ≥3 children (fingers, jaw/ears,
 * toes+heel) or without a clearly dominant child (others ≤ 40% of its reach) ends the chain at that branching joint.
 */
function walk(start: Node): Node[] {
  const chain = [start]
  for (let node = start; node.children.length;) {
    let next: Node | undefined
    if (node.children.length === 1) next = node.children[0]
    else if (node.children.length === 2) {
      const reach = (item: Node) => item.extent + item.p.distanceTo(node.p)
      const [top, other] = [...node.children].sort((a, b) => reach(b) - reach(a))
      if (reach(top!) > 0 && reach(other!) <= 0.4 * reach(top!)) next = top
    }
    if (!next) break
    chain.push(next); node = next
  }
  return chain
}

function ancestors(node: Node): Node[] { const result: Node[] = []; for (let item: Node | null = node; item; item = item.parent) result.push(item); return result }
function commonAncestor(a: Node, b: Node): Node | null { const set = new Set(ancestors(a)); return ancestors(b).find((item) => set.has(item)) ?? null }
const linkLength = (chain: readonly Node[], index: number) => chain[index]!.p.distanceTo(chain[index - 1]!.p)
/** Interior chain joint nearest the midpoint of the first and `end` joints (twist helpers and elbow/knee offsets resolve to the middle). */
function middleJoint(chain: readonly Node[], end: number): Node | null {
  const mid = chain[0]!.p.clone().add(chain[end]!.p).multiplyScalar(0.5)
  return chain.slice(1, end).sort((a, b) => a.p.distanceTo(mid) - b.p.distanceTo(mid))[0] ?? null
}
const relativeDifference = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b, 1e-9)
const chainLength = (chain: readonly Node[]) => chain.slice(1).reduce((sum, node, index) => sum + node.p.distanceTo(chain[index]!.p), 0)

/**
 * Suggests the 15 required Mixamo65 roles (+ Spine1/2, Neck, ToeBase when evident) for a humanoid with unrecognised names,
 * from tree structure and rest positions (Y-up). Returns null when the rig is not clearly a single biped (never guesses —
 * a quadruped or insect has more than one ground-reaching mirrored pair).
 *
 * 1. Legs: the only mirrored sibling pair of ≥3-joint chains that descend ≥20% of the rig height and end near the ground.
 *    More than one such pair (fox: hind + front legs) or none → null. The pair's parent P carries the pelvis.
 * 2. Shoulder fork N: a joint above P with two mirrored ≥3-joint chains reaching ≥12% of the height sideways (arms) and an
 *    upward child (neck/head). Cape strands and ears fail the lateral reach. Hips = common ancestor of P and N (handles a
 *    pelvis joint under the root as well as legs directly under the hips); Spine/Spine1/Spine2 come from the Hips→N path.
 * 3. Head: the neck chain above N ends at the first branching joint (jaw/ears/crest) or leaf.
 * 4. Facing: lateral axis = leg pair; the front/back sign comes from toe direction and knee bend (knees point forward),
 *    Left = up × forward — the same convention as `measureFacingYaw` (Mixamo faces +Z with Left at +X).
 * Confidence (0..1) = facing evidence × (0.5 + 0.5 × left/right symmetry) × plausibility of body proportions.
 */
export function suggestGeometryMapping(rig: RetargetRig): GeometryMapping | null {
  const nodes = buildNodes(rig)
  if (nodes.length < 15) return null
  const gMin = Math.min(...nodes.map((node) => node.p.y)), height = Math.max(...nodes.map((node) => node.p.y)) - gMin
  if (!(height > 1e-6)) return null

  // 1. legs
  const legLike = (node: Node) => {
    const chain = walk(node)
    return chain.length >= 3 && node.p.y - node.minY >= 0.2 * height && node.minY - gMin <= 0.15 * height ? chain : null
  }
  const legPairs: Array<{ a: Node[]; b: Node[]; parent: Node }> = []
  for (const parent of nodes) for (let i = 0; i < parent.children.length; i++) for (let j = i + 1; j < parent.children.length; j++) {
    const a = legLike(parent.children[i]!), b = legLike(parent.children[j]!)
    if (!a || !b || Math.abs(a.length - b.length) > 1) continue
    if (Math.abs(a[0]!.p.y - b[0]!.p.y) > 0.05 * height || horizontal(a[0]!.p.clone().sub(b[0]!.p)).length() < 0.03 * height) continue
    legPairs.push({ a, b, parent })
  }
  if (legPairs.length !== 1) return null
  const { a: legA, b: legB, parent: pelvisParent } = legPairs[0]!
  const lateral = horizontal(legA[0]!.p.clone().sub(legB[0]!.p)).normalize()

  // 2. shoulder fork
  type Arms = { fork: Node; a: Node[]; b: Node[]; up: Node; reach: number }
  let arms: Arms | null = null
  const pelvisAncestors = new Set(ancestors(pelvisParent))
  for (const fork of nodes) {
    if (pelvisAncestors.has(fork) || fork.p.y < pelvisParent.p.y + 0.03 * height || !commonAncestor(pelvisParent, fork)) continue
    for (let i = 0; i < fork.children.length; i++) for (let j = i + 1; j < fork.children.length; j++) {
      const a = walk(fork.children[i]!), b = walk(fork.children[j]!)
      if (a.length < 3 || b.length < 3) continue
      const da = a[a.length - 1]!.p.clone().sub(fork.p).dot(lateral), db = b[b.length - 1]!.p.clone().sub(fork.p).dot(lateral)
      if (da * db >= 0 || Math.min(Math.abs(da), Math.abs(db)) < 0.12 * height || relativeDifference(Math.abs(da), Math.abs(db)) > 0.5) continue
      if (Math.min(a[a.length - 1]!.p.y, b[b.length - 1]!.p.y) - gMin < 0.2 * height) continue
      const up = fork.children.filter((child, index) => index !== i && index !== j).sort((x, y) => y.maxY - x.maxY)[0]
      if (!up || up.maxY < fork.p.y + 0.03 * height) continue
      const reach = Math.min(Math.abs(da), Math.abs(db))
      if (!arms || reach > arms.reach) arms = { fork, a, b, up, reach }
    }
  }
  if (!arms) return null
  const hips = commonAncestor(pelvisParent, arms.fork)
  if (!hips || hips === arms.fork) return null

  // 3. spine path and head
  const path = ancestors(arms.fork).reverse().filter((node) => node !== hips && ancestors(node).includes(hips))
  if (!path.length) return null
  const neckChain = walk(arms.up)
  let headIndex = neckChain.length - 1
  if (neckChain.length >= 3 && linkLength(neckChain, headIndex) < 0.03 * height) headIndex-- // trailing end effector (HeadTop_End)
  const head = neckChain[headIndex]!, neck = headIndex > 0 ? neckChain[0]! : null

  // 4. legs and facing
  const describeLeg = (chain: Node[]) => {
    const last = chain.length - 1, hasToe = chain.length >= 4 && (linkLength(chain, last) < 0.5 * linkLength(chain, last - 1) ||
      horizontal(chain[last]!.p.clone().sub(chain[last - 1]!.p)).length() > 0.5 * linkLength(chain, last))
    const footIndex = hasToe ? last - 1 : last, knee = middleJoint(chain, footIndex)
    return knee && footIndex >= 2 ? { up: chain[0]!, knee, foot: chain[footIndex]!, toe: hasToe ? chain[last]! : null } : null
  }
  const legs = [describeLeg(legA), describeLeg(legB)]
  if (!legs[0] || !legs[1]) return null
  const forwardIfALeft = lateral.clone().cross(UP).normalize()
  let toeCue = 0, kneeCue = 0
  for (const leg of legs) {
    if (leg!.toe) toeCue += horizontal(leg!.toe.p.clone().sub(leg!.foot.p)).dot(forwardIfALeft) / height
    const line = leg!.up.p.clone().add(leg!.foot.p).multiplyScalar(0.5)
    kneeCue += horizontal(leg!.knee.p.clone().sub(line)).dot(forwardIfALeft) / height
  }
  const toeSignal = Math.abs(toeCue) > 0.01, kneeSignal = Math.abs(kneeCue) > 0.004
  const total = (toeSignal ? toeCue : 0) + (kneeSignal ? kneeCue : 0)
  const agree = toeSignal && kneeSignal ? Math.sign(toeCue) === Math.sign(kneeCue) : null
  const facingConfidence = agree === true ? 1 : agree === false ? 0.35 : toeSignal || kneeSignal ? 0.7 : 0.2
  const notes: string[] = []
  if (agree === false) notes.push('Toe direction and knee bend disagree about which way the character faces: Left/Right may be swapped.')
  else if (!toeSignal && !kneeSignal) notes.push('No toe/knee cue for the facing direction: Left/Right is a guess.')
  const aIsLeft = total >= 0, leftLeg = aIsLeft ? legs[0]! : legs[1]!, rightLeg = aIsLeft ? legs[1]! : legs[0]!
  const leftAxis = aIsLeft ? lateral : lateral.clone().negate()
  const armsA = arms.a, armsB = arms.b
  const aArmIsLeft = armsA[armsA.length - 1]!.p.clone().sub(arms.fork.p).dot(leftAxis) > 0
  const leftArm = aArmIsLeft ? armsA : armsB, rightArm = aArmIsLeft ? armsB : armsA

  // 5. assemble
  const assignments = new Map<string, string>()
  const set = (role: string, node: Node | null | undefined) => { if (node) assignments.set(role, node.id) }
  set('Hips', hips); set('Head', head); set('Neck', neck)
  if (path.length === 1) set('Spine', path[0])
  else {
    set('Spine', path[0]); set('Spine2', path[path.length - 1])
    if (path.length >= 3) set('Spine1', path[Math.floor((path.length - 1) / 2)])
  }
  const describeArm = (chain: Node[]) => {
    let list = chain
    const clavicle = list.length >= 4 && linkLength(list, 1) < 0.6 * linkLength(list, 2) ? list[0]! : null
    if (clavicle) list = list.slice(1)
    if (list.length >= 4 && linkLength(list, list.length - 1) < 0.2 * linkLength(list, list.length - 2)) list = list.slice(0, -1) // wrist end effector
    const fore = middleJoint(list, list.length - 1)
    return fore ? { clavicle, arm: list[0]!, fore, hand: list[list.length - 1]! } : null
  }
  const armLeft = describeArm(leftArm), armRight = describeArm(rightArm)
  if (!armLeft || !armRight) return null
  for (const [side, leg, arm] of [['Left', leftLeg, armLeft], ['Right', rightLeg, armRight]] as const) {
    set(`${side}Shoulder`, arm.clavicle); set(`${side}Arm`, arm.arm); set(`${side}ForeArm`, arm.fore); set(`${side}Hand`, arm.hand)
    set(`${side}UpLeg`, leg.up); set(`${side}Leg`, leg.knee); set(`${side}Foot`, leg.foot); set(`${side}ToeBase`, leg.toe)
  }
  if (new Set(assignments.values()).size !== assignments.size) return null

  // 6. confidence
  const symmetry = 1 - clamp01(((relativeDifference(chainLength(legA), chainLength(legB)) + relativeDifference(chainLength(armsA), chainLength(armsB))) / 2) / 0.25)
  const hipsRatio = (hips.p.y - gMin) / height, legRatio = (legs[0]!.up.p.y - legs[0]!.foot.p.y) / height
  const plausible = hipsRatio >= 0.3 && hipsRatio <= 0.65 && legRatio >= 0.2 && legRatio <= 0.55 && head.p.y > arms.fork.p.y
  if (!plausible) notes.push('Body proportions look unusual for a biped (hips height, leg length or head position).')
  const confidence = Math.round(facingConfidence * (0.5 + 0.5 * symmetry) * (plausible ? 1 : 0.7) * 100) / 100
  notes.push('Mapping inferred from hierarchy and rest geometry (names not recognised): confirm it before using the output.')
  return { assignments, confidence, notes }
}
