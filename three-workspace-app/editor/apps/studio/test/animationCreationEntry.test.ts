import assert from 'node:assert/strict'
import test from 'node:test'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { libraryAnimationEntry } from '../app/workbench/components/animation-creation/utils'

test('library edit/new entrypoints use the selected character clip range directly',()=>{
  const project={characters:{hero:{nodeId:'hero-node'}},scene:{content:{nodes:[{id:'hero-node',metadata:{libraryCharacterId:'hero-library'}}],timeline:{animation:{motionClips:[{id:'other',frameStart:0,frameEnd:900},{id:'first',frameStart:30,frameEnd:90},{id:'selected',frameStart:120,frameEnd:240}]}}}},bindings:{other:{characterId:'other',motionId:'selected-motion'},first:{characterId:'hero',motionId:'first-motion'},selected:{characterId:'hero',motionId:'selected-motion'}}} as unknown as UnifiedProject
  assert.deepEqual(libraryAnimationEntry(project,'hero','selected-motion'),{range:[120,240],blank:false})
  assert.deepEqual(libraryAnimationEntry(project,'hero'),{range:[30,90],blank:true})
  assert.throws(()=>libraryAnimationEntry(project,'hero','unbound-motion'),/Nháp/)
  project.scene.content.nodes[0]!.metadata={}
  assert.equal(libraryAnimationEntry(project,'hero','selected-motion'),null)
})
