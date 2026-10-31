import { register } from 'node:module';
register('./shot_test_loader.mjs', import.meta.url);
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const T = await import('three');
const { defaults, validate, spreadOffset } = await import('./onion_skin.js');

test('onion spread settings validate defaults and bounds', () => {
  assert.equal(validate().onionSpread, '0');
  assert.equal(defaults.onionSpreadAxis, 'screen');
  assert.equal(validate({onionSpread: 220}).onionSpread, '200');
  assert.equal(validate({onionSpread: -5}).onionSpread, '0');
  assert.equal(validate({onionSpread: 'NaN', onionSpreadAxis: 'bad', onionSpreadGuides: 'false'}).onionSpread, '0');
  assert.equal(validate({onionSpreadAxis: 'bad'}).onionSpreadAxis, 'screen');
  assert.equal(validate({onionSpreadGuides: 'false'}).onionSpreadGuides, true);
});

test('spread offsets honor rank, side, axes, and stationary motion fallback', () => {
  const screen = new T.Vector3(1, 0, 0), up = new T.Vector3(0, 0, 1);
  const calc = (axis, motion, side='after', rank=1) => spreadOffset(axis, screen, motion, up, 2, 60, side, rank).toArray();
  assert.deepEqual(calc('screen', new T.Vector3(), 'after', 10), [12, 0, 0]);
  assert.deepEqual(calc('x', new T.Vector3(), 'before', 1), [-1.2, -0, -0]);
  assert.deepEqual(calc('z', new T.Vector3()), [0, 0, 1.2]);
  assert.deepEqual(calc('motion', new T.Vector3(0, 2, 0)), [0, 1.2, 0]);
  assert.deepEqual(calc('motion', new T.Vector3(0, .001, 0)), [1.2, 0, 0]);
  assert.ok(Math.abs(calc('screen', new T.Vector3(), 'after', 10)[0] - calc('screen', new T.Vector3())[0] - 9 * .6 * 2) < 1e-12);
});

test('skeleton-only ghosts spread without changing the source or project', () => {
  return import('./core.js').then(C => import('./onion_skin.js').then(({ OnionSkin }) => {
    const scene = new T.Scene(), wrapper = new T.Group(), root = new T.Group();
    const bone = new T.Bone(), tip = new T.Bone();
    bone.name = 'rootBone'; tip.name = 'tip'; tip.position.y = 2;
    bone.add(tip); root.add(bone); wrapper.add(root); scene.add(wrapper);
    const camera = new T.PerspectiveCamera(); camera.up.set(0, 0, 1);
    camera.position.set(0, -5, 2); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    const rig = C.makeRig(root), project = C.newProject(rig);
    project.duration = 10;
    project.keys.root = [{...rig.rootRest, time: 0, interp: 'linear'}, {...rig.rootRest, time: 10, interp: 'linear'}];
    const saved = JSON.stringify(project), savedPose = JSON.stringify(C.capture(rig));
    const onion = new OnionSkin({ scene, wrapper, camera });
    const settings = validate({...defaults, onionEnabled: true, onionBefore: '10', onionAfter: '10', onionStep: '3', onionSpread: '60', onionParts: 'bones'});
    onion.update(rig, project, 5, settings, 1, false, 1000);
    assert.equal(onion.samples.length, 20);
    const first = onion.slots[10].wrapper.position.clone(), tenth = onion.slots[19].wrapper.position.clone();
    assert.ok(Math.abs(first.distanceTo(tenth) - 9 * .6 * rig.height) < 1e-9);
    assert.equal(JSON.stringify(project), saved);
    assert.equal(JSON.stringify(C.capture(rig)), savedPose);
    assert.equal(onion.slots[10].guide.visible, true);
    assert.equal(onion.slots[10].line.visible, true);
    camera.position.set(5, 0, 2); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    onion.update(rig, project, 5, settings, 1, false, 1100);
    assert.ok(onion.slots[10].wrapper.position.distanceTo(first) > .1);
    onion.update(rig, project, 5, {...settings, onionSpread: '0'}, 1, false, 1200);
    assert.equal(onion.slots[10].wrapper.position.distanceTo(wrapper.position), 0);
    assert.equal(onion.slots[10].guide.visible, false);
    onion.clear();
  }));
});

test('motion axis follows animated root at small wrapper scale without editing the source', async () => {
  const C = await import('./core.js');
  const { OnionSkin } = await import('./onion_skin.js');
  const scene = new T.Scene(), wrapper = new T.Group(), root = new T.Group(), bone = new T.Bone();
  bone.name = 'rootBone'; root.add(bone); wrapper.add(root); scene.add(wrapper); wrapper.scale.setScalar(.01);
  const camera = new T.PerspectiveCamera(); camera.up.set(0,0,1); camera.position.set(0,-5,2); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
  const rig = C.makeRig(root), project = C.newProject(rig);
  project.keys.root = [{...rig.rootRest,p:[0,0,0],time:0,interp:'linear'}, {...rig.rootRest,p:[0,10,0],time:2,interp:'linear'}];
  C.evaluate(rig, project, 1); wrapper.updateMatrixWorld(true);
  const original = JSON.stringify(C.capture(rig)), onion = new OnionSkin({scene,wrapper,camera});
  const settings = validate({...defaults,onionEnabled:true,onionSampling:'interval',onionBefore:'1',onionAfter:'1',onionStep:'3',onionSpread:'100',onionSpreadAxis:'motion',onionParts:'bones'});
  onion.update(rig,project,1,settings,1,false,1000);
  assert.ok(onion.slots[1].wrapper.position.y > 0);
  assert.ok(onion.slots[0].wrapper.position.y < 0);
  assert.equal(JSON.stringify(C.capture(rig)),original);
  onion.clear();
});
