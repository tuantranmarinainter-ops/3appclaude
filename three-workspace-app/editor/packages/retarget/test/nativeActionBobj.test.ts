import assert from 'node:assert/strict'
import test from 'node:test'
import { bobjModelToGlb, parseBobjModel } from '../src/bobjModel'
import { nativeActionBobj } from '../src/nativeActionBobj'
import { decodeGlb, encodeGlb } from '../cli/glb'

const original=Buffer.from(`arm_name synthetic
arm_bone Root  0 1 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1
o Body
v 0 0 0
vw Root 1
v 1 0 0
vw Root 1
v 0 1 0
vw Root 1
f 1 2 3
an source
ao Root
ag rotation 1
kf 0 0 LINEAR 0 0 0 0
kf 20 0.2 LINEAR 20 0.2 20 0.2
`)
const bytes=Buffer.from(bobjModelToGlb(parseBobjModel(original.toString())).bytes)

test('native bake keeps the original prefix and rejects unsafe accessor declarations before allocation',()=>{
  assert.ok(nativeActionBobj(original,bytes,'test').startsWith(original.toString()))
  for(const change of [
    (a:any,v:any)=>{a.count=Number.MAX_SAFE_INTEGER},
    (a:any,v:any)=>{a.byteOffset=-4},
    (a:any,v:any)=>{v.byteStride=2},
    (a:any,v:any)=>{v.byteLength=1},
    (a:any,v:any)=>{a.type='VEC4'},
    (a:any,v:any)=>{v.byteOffset=Number.MAX_SAFE_INTEGER},
  ]){
    const {json,bin}=decodeGlb(bytes),j=json as any,accessor=j.accessors[j.animations[0].samplers[0].input]
    change(accessor,j.bufferViews[accessor.bufferView])
    assert.throws(()=>nativeActionBobj(original,Buffer.from(encodeGlb(json,bin)),'test'),/accessor/)
  }
  const {json,bin}=decodeGlb(bytes),j=json as any,accessor=j.accessors[j.animations[0].samplers[0].output],view=j.bufferViews[accessor.bufferView]
  Buffer.from(bin.buffer,bin.byteOffset,bin.byteLength).writeFloatLE(NaN,(view.byteOffset??0)+(accessor.byteOffset??0))
  assert.throws(()=>nativeActionBobj(original,Buffer.from(encodeGlb(json,bin)),'test'),/finite/)
})
