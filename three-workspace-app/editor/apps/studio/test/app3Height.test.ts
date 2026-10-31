import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
import { app3HeightHint, shotPlacementAtHeight } from '../src/app3Height'
import { APP3_EMBED_VERSION } from '../src/app3Embed'

test('S1 height snapshots require positive finite values and legacy models have no override', () => {
  assert.equal(app3HeightHint({}),undefined)
  assert.deepEqual(app3HeightHint({libraryHeightBlocks:3.6,libraryHeightScale:2}),{heightBlocks:3.6,heightScale:2})
  for(const n of [0,-1,NaN,Infinity]) assert.throws(()=>app3HeightHint({libraryHeightBlocks:n,libraryHeightScale:2}))
})

test('S1 root-placement delta scales once around its world anchor; canonical Action input remains immutable', () => {
  const keys=[{frame:0,position:[107,-60,207],yawDegrees:10},{frame:30,position:[108,-60,205],yawDegrees:20}]
  const original=structuredClone(keys),base=[107,-60,207]
  assert.deepEqual(shotPlacementAtHeight(keys,base,2),[{...keys[0],position:[107,-60,207]},{...keys[1],position:[109,-60,203]}])
  assert.deepEqual(keys,original)
  assert.deepEqual(shotPlacementAtHeight(keys,base),keys)
})

test('S1 native App3 display uses outer viewport wrapper while preserving canonical rig/fingerprint/Action scale', () => {
  const source=readFileSync(fileURLToPath(new URL(`../public/animation-studio/v${APP3_EMBED_VERSION}/host-bridge.js`,import.meta.url)),'utf8')
  const functions=source.slice(source.indexOf('  let displayHeight'),source.indexOf('  let loadedSha'))
  const root={scale:{x:1,y:1,z:1}},rig={root,height:1.8},otherRig={root:{},height:3}
  const wrapper=()=>({scale:{x:1,y:1,z:1,setScalar(n:number){this.x=this.y=this.z=n}},updateMatrixWorld(){}})
  const primary={rig,wrapper:wrapper(),dirty:false},secondary={rig:otherRig,wrapper:wrapper(),dirty:false}
  const studio={rig:()=>rig,view:primary,editorViews:()=>[primary,secondary]}
  const context=vm.createContext({window:{__studio:studio}})
  vm.runInContext(functions+';globalThis.heightAPI={setDisplayHeight,syncDisplayHeight}',context)
  context.heightAPI.setDisplayHeight(3.6)
  assert.equal(primary.wrapper.scale.y,2);assert.equal(secondary.wrapper.scale.y,1)
  assert.deepEqual(root.scale,{x:1,y:1,z:1})
  primary.wrapper.scale.setScalar(2/1.8);context.heightAPI.syncDisplayHeight()
  assert.equal(primary.wrapper.scale.y,2)
  context.heightAPI.syncDisplayHeight();assert.equal(primary.wrapper.scale.y,2)
  assert.throws(()=>context.heightAPI.setDisplayHeight(-1))
})
