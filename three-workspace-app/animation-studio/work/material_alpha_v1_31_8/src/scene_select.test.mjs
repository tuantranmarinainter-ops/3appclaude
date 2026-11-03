import { register } from 'node:module';
register('./shot_test_loader.mjs', import.meta.url);
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const T = await import('three');
const S = await import('./scene_select.js');

test('keysHash is stable, order-fixed and sensitive to keys/ik/skin only', () => {
  const p = { keys: { a: [{ time: 0, p: [1, 2, 3] }] }, ikModes: {}, name: 'x' };
  assert.equal(S.keysHash(p), S.keysHash(structuredClone(p)));
  assert.match(S.keysHash(p), /^[0-9a-f]{16}$/);
  assert.equal(S.keysHash({ ...p, name: 'other' }), S.keysHash(p));
  const edited = structuredClone(p);
  edited.keys.a[0].p[2] = 3.0000001;
  assert.notEqual(S.keysHash(edited), S.keysHash(p));
  assert.notEqual(S.keysHash({ ...p, skinAdjustments: { a: [1, 1, 2] } }), S.keysHash(p));
  // Motion Lab, Molang variables and in-place edits mark a character edited too.
  assert.notEqual(S.keysHash({ ...p, lab: { layers: [] } }), S.keysHash(p));
  assert.notEqual(S.keysHash({ ...p, molangVariables: { v: 1 } }), S.keysHash(p));
  assert.notEqual(S.keysHash({ ...p, inPlace: true }), S.keysHash(p));
  assert.equal(S.keysHash({ ...p, lab: undefined, molangVariables: undefined, inPlace: undefined }), S.keysHash(p));
});

test('displayName: shot name, else short id', () => {
  assert.equal(S.displayName({ characterId: 'c1', name: ' Đen ' }), 'Đen');
  assert.equal(S.displayName({ characterId: 'c1' }), 'c1');
  assert.equal(S.displayName({ characterId: '0123456789abcdef' }), '01234567…');
});

test('isClick threshold and pickCharacter (nearest hit wins; editing occludes)', () => {
  assert.ok(S.isClick({ x: 0, y: 0 }, { x: 3, y: 2 }));
  assert.ok(!S.isClick({ x: 0, y: 0 }, { x: 5, y: 5 }));
  assert.equal(S.pickCharacter([]), null);
  assert.equal(
    S.pickCharacter([
      { characterId: 'a', distance: 5, editing: true },
      { characterId: 'b', distance: 6, editing: false },
    ]),
    null,
  );
  assert.equal(
    S.pickCharacter([
      { characterId: 'a', distance: 5, editing: true },
      { characterId: 'b', distance: 4, editing: false },
    ]),
    'b',
  );
});

test('dimViewer clones materials (originals untouched)', () => {
  const m = new T.MeshStandardMaterial({ color: 0xff0000 }),
    mesh = new T.Mesh(new T.BoxGeometry(), m),
    root = new T.Group().add(mesh);
  S.dimViewer(root, 0.5);
  assert.notEqual(mesh.material, m);
  assert.equal(mesh.material.opacity, 0.5);
  assert.ok(mesh.material.transparent);
  assert.equal(m.opacity, 1);
  assert.equal(m.transparent, false);
});

test('pairNodes/bakePoseClip: viewer nodes reproduce the sampled rig', () => {
  const build = () => {
    const root = new T.Group(),
      a = new T.Bone(),
      b = new T.Bone();
    a.name = 'a';
    b.name = 'b';
    root.add(a);
    a.add(b);
    return { root, a, b };
  };
  const rig = build(),
    view = build();
  const pairs = S.pairNodes(rig.root, [rig.root, rig.a, rig.b], view.root);
  assert.equal(pairs.length, 3);
  const times = S.sampleTimes(1, 30);
  assert.equal(times.length, 31);
  assert.equal(times.at(-1), 1);
  const clip = S.bakePoseClip(pairs, times, (t) => {
    rig.b.position.set(t, 2 * t, 0);
    rig.a.quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), t);
  });
  const mixer = new T.AnimationMixer(view.root);
  // track names use uuids; bind through PropertyBinding like the viewer does
  const action = mixer.clipAction(clip);
  action.play();
  mixer.setTime(0.5);
  assert.ok(Math.abs(view.b.position.y - 1) < 1e-5);
  assert.ok(Math.abs(view.a.quaternion.z - Math.sin(0.25)) < 1e-5);
});
