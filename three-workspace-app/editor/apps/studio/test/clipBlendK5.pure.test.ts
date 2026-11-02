import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { packLibraryGlb, unpackLibraryGlb } from '../src/libraryModels'
import { addBakedAnimationToGlb, type BakedFrame } from '../src/shotBake'
import { BLEND_EDIT_REQUEST_KEY, parseBlendEditRequest, takePendingBlendEditRequest } from '../src/blendEditRequest'
import { defaultMergedClipInfo, planShotCoverage, shotRangeSuggestions, type ShotChainClip } from '../src/shotChain'

const blend = (frames: number, extra: Record<string, unknown> = {}) => ({ frames, curve: 'smooth', footLock: true, ...extra })
function clip(id: string, start: number, end: number, blendIn?: Record<string, unknown>, nodeId = 'actor'): ShotChainClip & { playback: { blendIn?: any } } {
  return { id, frameStart: start, frameEnd: end, target: { nodeId }, playback: { version: 1, speed: 1, loop: false, ...(blendIn ? { blendIn } : {}) }, motion: { name: id, assetId: id } } as never
}

test('shot coverage: one clip, a blend chain, and the widened span', () => {
  const clips = [clip('run', 0, 58), clip('cast', 44, 134, blend(15)), clip('other', 0, 200, undefined, 'x')]
  const single = planShotCoverage(clips, 'actor', 10, 40, 'Gỗ Xưa')
  assert.ok(single.ok && single.kind === 'single' && single.clips[0].id === 'run')
  const inside = planShotCoverage(clips, 'actor', 60, 100, 'Gỗ Xưa')
  assert.ok(inside.ok && inside.kind === 'single' && inside.clips[0].id === 'cast')
  const chain = planShotCoverage(clips, 'actor', 10, 100, 'Gỗ Xưa')
  assert.ok(chain.ok && chain.kind === 'chain')
  assert.deepEqual(chain.clips.map((c) => c.id), ['run', 'cast'])
  assert.deepEqual(chain.span, [0, 134])
  const three = planShotCoverage([...clips, clip('walk', 120, 200, blend(15))], 'actor', 100, 150, 'Gỗ Xưa')
  assert.ok(three.ok && three.kind === 'chain' && three.clips.map((c) => c.id).join() === 'cast,walk' && three.span[0] === 44)
})

test('shot coverage: unconnected clips are rejected with Vietnamese clip list and suggested ranges', () => {
  const clips = [clip('run', 0, 58), clip('cast', 59, 149)]
  const result = planShotCoverage(clips, 'actor', 10, 100, 'Gỗ Xưa')
  assert.ok(!result.ok)
  assert.match(result.message, /cần đúng một MotionClip phủ hết frame 10–100/)
  assert.match(result.message, /run \(0–58\) và cast \(59–149\)/)
  assert.match(result.message, /Khoảng hợp lệ: 0–58, 59–149/)
  assert.match(result.message, /Trộn với clip trước/)
  assert.deepEqual(result.suggestions, [[0, 58], [59, 149]])
  assert.deepEqual(shotRangeSuggestions([clip('A', 0, 58), clip('B', 44, 134, blend(15)), clip('C', 200, 260)]), [[0, 134], [200, 260]])
})

test('shot coverage: neighbour clip that only shares the boundary frame is ignored', () => {
  // Đen: 0–22 then 22–76, and 68–142 blended into 22–76.
  const clips = [clip('stand', 0, 22), clip('stun', 22, 76), clip('stun2', 68, 142, blend(9))]
  const chain = planShotCoverage(clips, 'actor', 22, 142, 'Đen')
  assert.ok(chain.ok && chain.kind === 'chain' && chain.clips.map((c) => c.id).join() === 'stun,stun2')
  const single = planShotCoverage(clips, 'actor', 22, 60, 'Đen')
  assert.ok(single.ok && single.kind === 'single' && single.clips[0].id === 'stun')
  const head = planShotCoverage(clips, 'actor', 0, 22, 'Đen')
  assert.ok(head.ok && head.kind === 'single' && head.clips[0].id === 'stand')
})

test('shot coverage: no clip, outside range, bad overlaps', () => {
  assert.match((planShotCoverage([], 'actor', 0, 10, 'Đen') as { message: string }).message, /chưa có clip nào trên timeline/)
  assert.match((planShotCoverage([clip('A', 0, 58)], 'actor', 100, 120, 'Đen') as { message: string }).message, /không có clip nào trong khoảng này/)
  assert.match((planShotCoverage([clip('A', 0, 58)], 'actor', 20, 80, 'Đen') as { message: string }).message, /vượt ra ngoài clip A \(0–58\)/)
  // Overlap without blendIn is not a chain; neither is a blendIn that does not point at the earlier clip.
  assert.ok(!planShotCoverage([clip('A', 0, 58), clip('B', 44, 134)], 'actor', 10, 100, 'Đen').ok)
  const triple = [clip('A', 0, 58), clip('B', 40, 100, blend(19)), clip('C', 45, 134, blend(14))]
  const bad = planShotCoverage(triple, 'actor', 10, 120, 'Đen')
  assert.ok(!bad.ok)
  // A range that runs past the end of the chain is rejected too.
  assert.match((planShotCoverage([clip('A', 0, 58), clip('B', 44, 134, blend(15))], 'actor', 10, 200, 'Đen') as { message: string }).message, /vượt ra ngoài/)
})

test('default merged clip name and description follow the clips', () => {
  const info = defaultMergedClipInfo([clip('run', 0, 58), clip('Kid_Run_Wobble_Bump', 44, 134, blend(15, { mirror: true }))] as never)
  assert.equal(info.name, 'run + Kid_Run_Wobble_Bump')
  assert.equal(info.description, 'Gộp từ run (khung 0–58) + Kid_Run_Wobble_Bump (khung 44–134), trộn 15 khung, khóa chân, đảo chân')
  assert.ok(!defaultMergedClipInfo([clip('A', 0, 58), clip('B', 44, 134, blend(10))] as never).description.includes('đảo chân'))
})

test('blend edit request parsing and one-shot pickup', () => {
  const request = { projectId: 'p', characterNodeId: 'n', clipId: 'c', frameStart: 0, frameEnd: 134 }
  assert.deepEqual(parseBlendEditRequest(request), request)
  assert.equal(parseBlendEditRequest({ ...request, frameEnd: 0 }), null)
  assert.equal(parseBlendEditRequest({ ...request, clipId: 3 }), null)
  const store = new Map<string, string>([[BLEND_EDIT_REQUEST_KEY, JSON.stringify(request)]])
  const storage = { getItem: (key: string) => store.get(key) ?? null, removeItem: (key: string) => { store.delete(key) } }
  assert.equal(takePendingBlendEditRequest('other', storage), null)
  assert.equal(store.size, 1, 'a request for another project stays')
  assert.deepEqual(takePendingBlendEditRequest('p', storage), request)
  assert.equal(takePendingBlendEditRequest('p', storage), null)
})

function syntheticModel() {
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'bobj-model', children: [1], scale: [0.5, 0.5, 0.5] }, { name: 'Root', children: [2], translation: [0, 0.1, 0] }, { name: 'Hip', translation: [0, 1, 0] }],
    buffers: [{ byteLength: 4 }],
  }
  return packLibraryGlb(json, Buffer.alloc(4))
}

test('addBakedAnimationToGlb writes bone channels, keeps quaternion continuity and derives the wrapper node motion', () => {
  const frames: BakedFrame[] = []
  const rest = new Matrix4().compose(new Vector3(0, 0.1, 0), new Quaternion(), new Vector3(1, 1, 1))
  for (let i = 0; i < 4; i++) {
    const wrapper = new Matrix4().compose(new Vector3(i * 0.25, 0, 0), new Quaternion(), new Vector3(0.5, 0.5, 0.5))
    const rootWorld = wrapper.clone().multiply(rest)
    // q and -q describe the same rotation; the bake must not flip between hemispheres.
    const sign = i % 2 ? -1 : 1
    frames.push({
      actorWorld: new Matrix4().toArray(),
      bones: [
        { name: 'Root', position: [0, 0.1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], worldMatrix: rootWorld.toArray() },
        { name: 'Hip', position: [0, 1 + i * 0.1, 0], rotation: [0, sign * Math.sin(0.1 * i), 0, sign * Math.cos(0.1 * i)], scale: [1, 1, 1], worldMatrix: rootWorld.toArray() },
      ],
    })
  }
  const glb = addBakedAnimationToGlb(syntheticModel(), frames, 30, 'baked')
  const { json, binary } = unpackLibraryGlb(glb)
  assert.equal(json.animations.length, 1)
  const channels = json.animations[0].channels as Array<{ sampler: number; target: { node: number; path: string } }>
  const find = (node: number, path: string) => channels.find((c) => c.target.node === node && c.target.path === path)
  const read = (channel: { sampler: number }) => {
    const accessor = json.accessors[json.animations[0].samplers[channel.sampler].output]
    const view = json.bufferViews[accessor.bufferView]
    const size = accessor.type === 'VEC4' ? 4 : 3
    return Array.from({ length: accessor.count * size }, (_, i) => binary.readFloatLE((view.byteOffset ?? 0) + i * 4))
  }
  assert.ok(find(1, 'rotation') && find(2, 'rotation'), 'rotation for each sampled bone')
  assert.ok(!find(1, 'translation'), 'Root never moves from its rest translation')
  const hipPosition = read(find(2, 'translation')!)
  assert.ok(Math.abs(hipPosition[3 * 3 + 1]! - 1.3) < 1e-6)
  const hipRotation = read(find(2, 'rotation')!)
  for (let i = 1; i < 4; i++) {
    const dot = [0, 1, 2, 3].reduce((sum, k) => sum + hipRotation[i * 4 + k]! * hipRotation[(i - 1) * 4 + k]!, 0)
    assert.ok(dot > 0, `quaternion hemisphere continuity at frame ${i}`)
  }
  const wrapper = read(find(0, 'translation')!)
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(wrapper[i * 3]! - i * 0.25) < 1e-6, `wrapper x at frame ${i}`)
  assert.ok(!find(0, 'scale') && !find(0, 'rotation'), 'unchanged wrapper channels are omitted')
  const times = json.accessors[json.animations[0].samplers[0].input]
  assert.deepEqual([times.min[0], times.max[0]], [0, 3 / 30].map((v) => Math.fround(v)))
})

test('addBakedAnimationToGlb rejects models that lack sampled bones', () => {
  const frames: BakedFrame[] = [0, 1].map(() => ({ bones: [{ name: 'Missing', position: [0, 0, 0], rotation: [0, 0, 0, 1] }] }))
  assert.throws(() => addBakedAnimationToGlb(syntheticModel(), frames, 30, 'x'), /thiếu xương: Missing/)
  assert.throws(() => addBakedAnimationToGlb(syntheticModel(), frames.slice(0, 1), 30, 'x'), /ít nhất hai khung/)
})
