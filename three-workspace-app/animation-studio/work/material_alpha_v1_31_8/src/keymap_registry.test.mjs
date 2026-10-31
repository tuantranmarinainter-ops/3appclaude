import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createKeymapRegistry, normalizeKey} from './keymap_registry.js';
const actions = [
  {id:'camera',label:'Camera',group:'View',scope:'global',bindings:['Q']},
  {id:'add',label:'Add',group:'Key',scope:'global',bindings:['I','K']},
  {id:'delete',label:'Delete',group:'Key',scope:'timeline',bindings:['Delete']},
  {id:'graphDelete',label:'Delete graph',group:'Graph',scope:'graph',bindings:['Delete']},
];
const presets={blockbench:{add:['Q'], camera:['V']}};
const make=()=>createKeymapRegistry(actions,presets);
test('normalizes modifiers, shifted punctuation, numpad, composition',()=>{
 assert.equal(normalizeKey({key:'?',code:'Slash',shiftKey:true,ctrlKey:true}),'Ctrl+Shift+/');
 assert.equal(normalizeKey({key:'1',code:'Numpad1'}),'Numpad1');
 assert.equal(normalizeKey('command+control+z'),'Ctrl+Meta+Z');
 assert.equal(normalizeKey({key:'Dead',isComposing:true}),null);
 assert.equal(normalizeKey('Ctrl+Shift'),null);
});
test('same key allowed in disjoint scope, global conflicts and replacement',()=>{
 const r=make(); assert.equal(r.resolve('Delete','timeline'),'delete'); assert.equal(r.resolve('Delete','graph'),'graphDelete');
 assert.deepEqual(r.findConflicts('camera',['Delete']).map(x=>x.id),['delete','graphDelete']);
 assert.equal(r.setBindings('camera',['Delete']).ok,false);
 assert.equal(r.setBindings('camera',['Delete'],{replace:true}).ok,true);
 assert.equal(r.resolve('Delete','timeline'),'camera'); assert.deepEqual(r.getBindings('graphDelete'),[]);
});
test('priority recalculates conflicts while manual overrides survive',()=>{
 const r=make(); r.applyPreset('blockbench');
 assert.deepEqual(r.getBindings('camera'),['Q','V']); assert.deepEqual(r.getBindings('add'),['I','K']);
 assert.equal(r.getEntries().find(x=>x.id==='add').conflicts[0].binding,'Q');
 r.setPriority('preset'); assert.equal(r.resolve('Q'),'add');
 assert.equal(r.setBindings('camera',['X']).ok,true); r.setPriority('app3'); r.setPriority('preset');
 assert.deepEqual(r.getBindings('camera'),['X']); assert.equal(r.resolve('Q'),'add');
});
test('roundtrip persists preset, priority, cleared and manually assigned keys; invalid import atomic',()=>{
 const r=make(); r.applyPreset('blockbench'); r.setPriority('preset'); r.setBindings('camera',[]); r.setBindings('delete',['Shift+D']);
 const copy=make(); assert.deepEqual(copy.importJSON(r.exportJSON()),{ok:true}); assert.deepEqual(copy.getEntries(),r.getEntries());
 const before=copy.exportJSON(); assert.equal(copy.importJSON('{').ok,false); assert.equal(copy.importJSON({version:1,preset:'app3',priority:'app3',overrides:{camera:['Q','W','E']}}).ok,false); assert.equal(copy.exportJSON(),before);
 copy.reset('delete'); assert.deepEqual(copy.getBindings('delete'),['Delete']); copy.reset(); assert.deepEqual(copy.getState(),{preset:'app3',priority:'app3',overrides:{}});
});

test('legacy modifiers work only while their base binding is active and explicit chords win', async () => {
  const {matchesShortcut} = await import('./keymap_registry.js');
  const registry = createKeymapRegistry([
    {id:'view.reset',scope:'global',bindings:['Q']},
    {id:'key.addDirect',scope:'global',bindings:['K']},
    {id:'timeline.play',scope:'global',bindings:['Space']},
    {id:'other',scope:'global',bindings:['Ctrl+K']},
  ]);
  const event = (key, mods={}) => ({key, code:key === ' ' ? 'Space' : '', ...mods});
  assert.equal(matchesShortcut(registry,'view.reset',event('Q',{shiftKey:true})),true);
  assert.equal(matchesShortcut(registry,'view.reset',event('q',{altKey:true})),false);
  assert.equal(matchesShortcut(registry,'key.addDirect',event('K',{shiftKey:true})),true);
  assert.equal(matchesShortcut(registry,'key.addDirect',event('k',{ctrlKey:true})),false);
  assert.equal(matchesShortcut(registry,'other',event('k',{ctrlKey:true})),true);
  assert.equal(matchesShortcut(registry,'timeline.play',event(' ',{altKey:true})),true);
  registry.setBindings('timeline.play',['P']);
  assert.equal(matchesShortcut(registry,'timeline.play',event(' ',{altKey:true})),false);
});

test('viewport Pose swap and playback may share Space and resolve by focus', () => {
  const registry = createKeymapRegistry([
    {id:'timeline.play',scope:'global',bindings:['Space']},
    {id:'tool.swap',scope:'viewport',bindings:[]},
  ], {blockbench:{'tool.swap':['Space']}});
  registry.applyPreset('blockbench');
  assert.deepEqual(registry.getBindings('tool.swap'), ['Space']);
  assert.equal(registry.resolve('Space','viewport'), 'tool.swap');
  assert.equal(registry.resolve('Space','timeline'), 'timeline.play');
  assert.equal(registry.resolve('Space','global'), 'timeline.play');
  assert.equal(registry.setBindings('tool.swap',['Space']).ok, true);
  const restored = createKeymapRegistry([
    {id:'timeline.play',scope:'global',bindings:['Space']},
    {id:'tool.swap',scope:'viewport',bindings:[]},
  ], {blockbench:{'tool.swap':['Space']}});
  assert.equal(restored.importJSON(registry.exportJSON()).ok,true);
});
