import { register } from 'node:module';
register('./shot_test_loader.mjs', import.meta.url);
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const T = await import('three');
const S = await import('./scene_shot.js');
const { validateShot, sha256 } = await import('./shot_package.js');

const near = (a, b, eps = 1e-9, label = '') =>
  assert.ok(Math.abs(a - b) <= eps, `${label} expected ${b}, got ${a}`);
const nearArray = (a, b, eps = 1e-9) => a.forEach((v, i) => near(v, b[i], eps, 'element ' + i));
const rad = T.MathUtils.degToRad;

test('Y-up <-> Z-up conversion is the editor basis (rotation X +90) and round-trips', () => {
  const z = S.pointToZUp([1, 2, 3]);
  nearArray(z.toArray(), [1, -3, 2]);
  nearArray(S.pointToYUp(z).toArray(), [1, 2, 3]);
  // Same as the wrapper the editor puts on every model: rotation X +90 degrees.
  const viaBasis = new T.Vector3(1, 2, 3).applyQuaternion(S.BASIS);
  nearArray(viaBasis.toArray(), z.toArray());
  // App 2 up (+Y) is editor up (+Z); App 2 forward (+Z) is editor -Y.
  nearArray(S.pointToZUp([0, 1, 0]).toArray(), [0, 0, 1]);
  nearArray(S.pointToZUp([0, 0, 1]).toArray(), [0, -1, 0]);
});

test('placement wrapper equals B·T(p)·R_y(yaw)·S(s) and maps back to the App 2 world matrix', () => {
  const placement = { position: [1.5, 0.25, -2], yawDegrees: 135 },
    scale = 1.25;
  const wrapper = new T.Object3D();
  S.applyPlacement(wrapper, placement, scale);
  // Position is the Z-up image of p; rotation is a yaw about +Z composed with the basis.
  nearArray(wrapper.position.toArray(), [1.5, 2, 0.25]);
  const expectQuat = new T.Quaternion()
    .setFromAxisAngle(new T.Vector3(0, 0, 1), rad(135))
    .multiply(S.BASIS);
  near(Math.abs(wrapper.quaternion.dot(expectQuat)), 1, 1e-12, 'quaternion');
  nearArray(wrapper.scale.toArray(), [1.25, 1.25, 1.25]);
  // A model-space point, placed in App 2 (Y-up) directly, equals wrapper · point converted back to Y-up.
  const point = new T.Vector3(0.3, 1.1, -0.2);
  const app2 = point
    .clone()
    .multiplyScalar(scale)
    .applyAxisAngle(new T.Vector3(0, 1, 0), rad(135))
    .add(new T.Vector3(...placement.position));
  const editor = point.clone().applyMatrix4(wrapper.matrixWorld);
  nearArray(S.pointToYUp(editor).toArray(), app2.toArray(), 1e-9);
  // matrixToYUp of the wrapper is exactly T·R_y·S.
  const expected = new T.Matrix4().compose(
    new T.Vector3(...placement.position),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), rad(135)),
    new T.Vector3(scale, scale, scale),
  );
  nearArray(S.matrixToYUp(wrapper.matrixWorld), expected.toArray(), 1e-9);
  // Facing: +Z model forward at yaw 90 points to App 2 +X, and to editor +X as well.
  const w = new T.Object3D();
  S.applyPlacement(w, { position: [0, 0, 0], yawDegrees: 90 }, 1);
  const forward = new T.Vector3(0, 0, 1).transformDirection(w.matrixWorld);
  nearArray(forward.toArray(), [1, 0, 0], 1e-9);
});

test('identity placement is exactly the editor basis wrapper (existing single-character behaviour)', () => {
  const w = new T.Object3D();
  S.applyPlacement(w, { position: [0, 0, 0], yawDegrees: 0 }, 1);
  near(Math.abs(w.quaternion.dot(S.BASIS)), 1, 1e-12);
  nearArray(w.position.toArray(), [0, 0, 0]);
  assert.ok(S.matrixClose(w.matrix, S.placementMatrix({ position: [0, 0, 0], yawDegrees: 0 }, 1)));
  assert.ok(!S.matrixClose(w.matrix, S.placementMatrix({ position: [0, 0, 1], yawDegrees: 0 }, 1)));
});

const keys = [
  { frame: 10, position: [0, 1, 4], lookAt: [0, 1, 0], fovYDegrees: 40 },
  { frame: 20, position: [2, 1, 4], lookAt: [1, 1, 0], fovYDegrees: 50 },
  { frame: 40, position: [2, 3, 8], lookAt: [1, 1, 2], fovYDegrees: 30 },
];
test('camera key interpolation is linear between integer frames and clamped outside', () => {
  nearArray(S.sampleCameraKeys(keys, 10).position, [0, 1, 4]);
  nearArray(S.sampleCameraKeys(keys, 15).position, [1, 1, 4]);
  near(S.sampleCameraKeys(keys, 15).fovYDegrees, 45);
  nearArray(S.sampleCameraKeys(keys, 15).lookAt, [0.5, 1, 0]);
  nearArray(S.sampleCameraKeys(keys, 20).position, [2, 1, 4]);
  nearArray(S.sampleCameraKeys(keys, 30).position, [2, 2, 6]);
  near(S.sampleCameraKeys(keys, 30).fovYDegrees, 40);
  nearArray(S.sampleCameraKeys(keys, 20.25).position, [2, 1 + 2 * (0.25 / 20), 4 + 4 * (0.25 / 20)]);
  // Clamp before the first and after the last key.
  nearArray(S.sampleCameraKeys(keys, 0).position, [0, 1, 4]);
  nearArray(S.sampleCameraKeys(keys, 99).position, [2, 3, 8]);
  assert.equal(S.sampleCameraKeys([], 3), null);
  const z = S.cameraToZUp(S.sampleCameraKeys(keys, 15));
  nearArray(z.position.toArray(), [1, -4, 1]);
  nearArray(z.lookAt.toArray(), [0.5, 0, 1]);
  near(z.fovYDegrees, 45);
});

test('film aspect: shot.camera.aspect when valid, else 16:9; letterbox/pillarbox rectangles', () => {
  near(S.filmAspect({ camera: { aspect: 2 } }), 2);
  near(S.filmAspect({ camera: {} }), 16 / 9);
  near(S.filmAspect({ camera: { aspect: 0 } }), 16 / 9);
  near(S.filmAspect({ camera: { aspect: -1 } }), 16 / 9);
  near(S.filmAspect({ camera: { aspect: Infinity } }), 16 / 9);
  // Wider film than the view: bars above and below.
  const wide = S.filmRect(2, 1000, 700);
  assert.deepEqual(wide, { x: 0, y: 100, w: 1000, h: 500 });
  // Narrower film (9:16): bars left and right.
  const tall = S.filmRect(9 / 16, 1000, 700);
  near(tall.h, 700);
  near(tall.w, 700 * (9 / 16));
  near(tall.x, (1000 - 700 * (9 / 16)) / 2);
});

test('viewport FOV keeps the film rectangle at the shot FOV', () => {
  // Pillarbox: vertical FOV unchanged.
  near(S.viewportFov(40, 9 / 16, 1000, 700), 40);
  // Letterbox: tan(F_view/2) = tan(F/2) · filmAspect / viewAspect, so the inner rectangle sees exactly F.
  const view = S.viewportFov(40, 2, 1000, 700);
  const rect = S.filmRect(2, 1000, 700);
  const innerHalf = Math.tan(rad(view) / 2) * (rect.h / 700);
  near(innerHalf, Math.tan(rad(40) / 2), 1e-12);
});

test('registry samples bones/root in App 2 Y-up and follows the editor time', async () => {
  // A one-bone viewer actor whose bone moves 1 m in X over 1 s.
  const bone = new T.Bone();
  bone.name = 'mixamorig:Hips';
  const root = new T.Group();
  root.add(bone);
  const clip = new T.AnimationClip('c', 1, [
    new T.VectorKeyframeTrack(bone.uuid + '.position', [0, 1], [0, 1, 0, 1, 1, 0]),
  ]);
  S.prepareViewerRoot(root, [clip]);
  assert.equal(bone.name, 'mixamorig:Hips');
  const mixer = new T.AnimationMixer(root),
    action = mixer.clipAction(clip);
  action.setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const group = new T.Group();
  const placement = { position: [3, 0, -1], yawDegrees: 90 },
    scale = 2;
  S.applyPlacement(group, placement, scale);
  group.add(root);
  const registry = S.createRegistry();
  assert.equal(registry.active, false);
  const character = { clip: { sourceStartSeconds: 0, sourceEndSeconds: 1, speed: 1, loop: false, reverse: false } };
  registry.add({ characterId: 'a', character, duration: 1, placement, scale, editing: false, group, root, viewer: { group, root, mixer, action } });
  assert.equal(registry.active, true);
  assert.equal(registry.sync(0.5), true);
  assert.equal(registry.sync(0.5), false, 'same time is not re-sampled');
  const [sample] = registry.sample();
  assert.equal(sample.characterId, 'a');
  assert.equal(sample.editing, false);
  // Model-space hips at t=0.5 = (0.5, 1, 0); App 2 = T(p)·R_y(90)·S(2)·hips.
  const expected = new T.Vector3(0.5, 1, 0)
    .multiplyScalar(2)
    .applyAxisAngle(new T.Vector3(0, 1, 0), rad(90))
    .add(new T.Vector3(3, 0, -1));
  nearArray(
    new T.Matrix4().fromArray(sample.bones['mixamorig:Hips']).elements.slice(12, 15),
    expected.toArray(),
    1e-6,
  );
  // Root = the placed root node, in Y-up: T·R_y·S.
  nearArray(sample.root.slice(12, 15), [3, 0, -1], 1e-9);
  // Clamped beyond the clip.
  registry.sync(5);
  const end = new T.Matrix4().fromArray(registry.sample()[0].bones['mixamorig:Hips']);
  nearArray(
    end.elements.slice(12, 15),
    new T.Vector3(1, 1, 0).multiplyScalar(2).applyAxisAngle(new T.Vector3(0, 1, 0), rad(90)).add(new T.Vector3(3, 0, -1)).toArray(),
    1e-6,
  );
  // Going back in time works after the LoopOnce action finished.
  registry.sync(0);
  nearArray(registry.sample()[0].bones['mixamorig:Hips'].slice(12, 15), new T.Vector3(0, 1, 0).multiplyScalar(2).applyAxisAngle(new T.Vector3(0, 1, 0), rad(90)).add(new T.Vector3(3, 0, -1)).toArray(), 1e-6);
  assert.deepEqual(registry.stats(), { characters: 1, viewers: 1, fps: null, openMs: null });
  registry.tick(0, true);
  registry.tick(500, true);
  registry.tick(1000, true);
  near(registry.stats().fps, 2);
  registry.clear();
  assert.equal(registry.active, false);
});

test('shot package validator accepts sceneMode and camera.aspect and rejects bad values', async () => {
  const enc = (x) => new TextEncoder().encode(JSON.stringify(x));
  const glb = new Uint8Array([1, 2, 3]);
  const hash = await sha256(glb);
  const make = async (edit) => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    const manifest = { version: '1.0.0', glbSha256: hash, actions: [{ uuid, name: 'A', glbAnimationIndex: 0 }] };
    const character = (id) => ({ characterId: id, glb: id + '.glb', manifest: id + '.json', glbSha256: hash, actionUuid: uuid, clip: { sourceStartSeconds: 0, sourceEndSeconds: 1, speed: 1, loop: false, reverse: false }, placement: { position: [0, 0, 0], yawDegrees: 0 }, rootPolicy: 'skeletal', editable: true });
    const shot = { version: '1.0.0', shotId: 's', sceneId: 'x', fps: 30, frameRange: [0, 30], camera: { keys: [{ frame: 0, position: [0, 1, 4], lookAt: [0, 1, 0], fovYDegrees: 40 }] }, characters: [character('a'), character('b')], references: [] };
    edit?.(shot);
    return { 'shot.json': enc(shot), 'a.glb': glb, 'b.glb': glb, 'a.json': enc(manifest), 'b.json': enc(manifest) };
  };
  const codes = async (edit) => (await validateShot(await make(edit))).map((i) => i.code + ' ' + i.path);
  assert.deepEqual(await codes((s) => { s.sceneMode = true; s.camera.aspect = 16 / 9; }), []);
  assert.deepEqual(await codes((s) => { s.sceneMode = true; }), [], 'several editable characters in scene mode');
  assert.deepEqual(await codes(), [], 'optional fields may be absent');
  assert.deepEqual(await codes((s) => { s.sceneMode = 'yes'; }), ['INVALID_TYPE shot.json.sceneMode']);
  for (const bad of [0, -1, '2', null, NaN, Infinity])
    assert.deepEqual(await codes((s) => { s.camera.aspect = bad; }), ['INVALID_VALUE shot.json.camera.aspect'], 'aspect ' + bad);
});

// ---- editor bake sampler (shot_controller openFiles): regression for held channels falling back to rest ----
function sampleRig() {
  const root = new T.Group(),
    armature = new T.Object3D(),
    hips = new T.Bone();
  armature.name = 'Armature';
  hips.name = 'Hips';
  hips.position.set(0, 0.75, 0);
  root.add(armature);
  armature.add(hips);
  const bind = (o, path) => o.uuid + '.' + path;
  // frames 0..5 at 30 fps: height rises at frame 2 then is HELD (the failing case), yaw is held from frame 3.
  const times = [0, 1, 2, 3, 4, 5].map((f) => f / 30);
  const heights = [0, 0, 1, 1, 1, 1];
  const position = new T.VectorKeyframeTrack(
    bind(hips, 'position'), times, heights.flatMap((h) => [0, 0.75 + h * 0.07, 0]));
  const yaw = [0, 0, 0, 1, 1, 1].map((k) => new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), k * 0.5));
  const quaternion = new T.QuaternionKeyframeTrack(bind(hips, 'quaternion'), times, yaw.flatMap((q) => q.toArray()));
  return { root, armature, hips, position, quaternion, times, heights, yaw, bind };
}

test('createClipSampler: held channels keep their value after the rig is reset to rest between frames', () => {
  const { root, hips, position, quaternion, heights, yaw } = sampleRig();
  const clip = new T.AnimationClip('c', -1, [position, quaternion]),
    sampler = S.createClipSampler(clip, root);
  assert.equal(sampler.channels, 2);
  for (let frame = 0; frame <= 5; frame++) {
    hips.position.set(0, 0.75, 0); // resetRig
    hips.quaternion.identity();
    sampler.sample(frame / 30);
    near(hips.position.y, 0.75 + heights[frame] * 0.07, 1e-6, 'height frame ' + frame);
    assert.ok(hips.quaternion.angleTo(yaw[frame]) < 1e-3, 'yaw frame ' + frame);
  }
  // time clamps to the clip like LoopOnce + clampWhenFinished
  hips.position.set(0, 0.75, 0);
  sampler.sample(99);
  near(hips.position.y, 0.82, 1e-6, 'clamped past the end');
  sampler.sample(-3);
  near(hips.position.y, 0.75, 1e-6, 'clamped before the start');
});

test('createClipSampler.animates: only nodes the clip drives (a plain single shot has no animated ancestor)', () => {
  const { root, armature, hips, position, bind } = sampleRig();
  const plain = S.createClipSampler(new T.AnimationClip('p', -1, [position]), root);
  assert.equal(plain.animates(hips), true);
  assert.equal(plain.animates(armature), false, 'no Armature motion: the editor keeps the plain bone keys');
  const armatureTrack = new T.VectorKeyframeTrack(bind(armature, 'position'), [0, 1], [0, 0, 0, 0, 0, 0.5]);
  const chained = S.createClipSampler(new T.AnimationClip('c', -1, [position, armatureTrack]), root);
  assert.equal(chained.animates(armature), true, 'baked chain / K2: Armature moves, so the fold runs');
  // morph / unknown tracks and tracks for missing nodes are ignored
  const ghost = new T.VectorKeyframeTrack('no-such-uuid.position', [0, 1], [0, 0, 0, 1, 1, 1]);
  assert.equal(S.createClipSampler(new T.AnimationClip('g', -1, [ghost]), root).channels, 0);
});
