import * as T from 'three';
import * as E from './easing.js';
import * as N from './motion_smoothing.js';
export const defaults = {
  ikParent: 'scene',
  poleParent: 'scene',
  stretch: 0,
  maxStretch: 1.5,
  wristPivot: 0,
  footRoll: 0,
  footRock: 0,
};
export function validate(x = {}) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error('Rig options không hợp lệ.');
  const o = { ...defaults, ...x };
  for (const k of ['ikParent', 'poleParent'])
    if (!['scene', 'world', 'root', 'body'].includes(o[k]))
      throw Error('Parent không hợp lệ: ' + k);
  for (const [k, min, max] of [
    ['stretch', 0, 1],
    ['maxStretch', 1, 3],
    ['wristPivot', 0, 1],
    ['footRoll', -90, 90],
    ['footRock', -45, 45],
  ])
    if (!Number.isFinite(o[k]) || o[k] < min || o[k] > max)
      throw Error('Rig option không hợp lệ: ' + k);
  return Object.fromEntries(Object.keys(defaults).map((k) => [k, o[k]]));
}
export function init(rig, c, wrapper) {
  c.options = { ...defaults };
  c.frames = {};
  c.baseB = c.b.o.position.clone();
  c.baseE = c.c.o.position.clone();
  c.bendMemory = null;
  c.bendMemory = poleDirection(
    c,
    c.a.o.getWorldPosition(new T.Vector3()),
    c.b.o.getWorldPosition(new T.Vector3()),
    c.c.o.getWorldPosition(new T.Vector3()),
  );
  c.bendAxisLocal = c.bendMemory
    .clone()
    .applyQuaternion(c.a.o.getWorldQuaternion(new T.Quaternion()).invert());
  const child = c.c.o.children.find((o) => o.isBone),
    offset = child?.position.clone() || c.baseE.clone().multiplyScalar(0.45);
  c.pivotOffset = offset.length() > 1e-7 ? offset : new T.Vector3(0, 0.1, 0);
  for (const kind of ['world', 'root', 'body']) {
    const g = new T.Group();
    g.name = 'Control parent ' + c.id + ' ' + kind;
    wrapper.add(g);
    c.frames[kind] = g;
  }
  updateFrames(rig, c);
}
export function updateFrames(rig, c) {
  if (!c.frames) return;
  const wrapper = c.frames.world.parent;
  wrapper.updateWorldMatrix(true, false);
  rig.root.updateMatrixWorld(true);
  const scale = wrapper.getWorldScale(new T.Vector3());
  for (const kind of ['world', 'root', 'body']) {
    const anchor = kind === 'root' ? rig.root : c.a.o.parent;
    const p = kind === 'world' ? new T.Vector3() : anchor.getWorldPosition(new T.Vector3()),
      q =
        kind === 'world'
          ? wrapper.getWorldQuaternion(new T.Quaternion())
          : anchor.getWorldQuaternion(new T.Quaternion());
    const local = wrapper.matrixWorld
      .clone()
      .invert()
      .multiply(new T.Matrix4().compose(p, q, scale));
    local.decompose(c.frames[kind].position, c.frames[kind].quaternion, c.frames[kind].scale);
    c.frames[kind].updateWorldMatrix(true, true);
  }
}
export function configure(rig, c, options, keepWorld = true) {
  const next = validate(options);
  updateFrames(rig, c);
  for (const [prefix, k] of [
    ['ik_', 'ikParent'],
    ['pole_', 'poleParent'],
  ]) {
    const o = rig.controls[prefix + c.id].object,
      parent = next[k] === 'scene' ? c.frames.world.parent : c.frames[next[k]];
    if (o.parent !== parent) {
      if (keepWorld) parent.attach(o);
      else parent.add(o);
    }
  }
  c.options = next;
}
export function target(c, o) {
  const p = o.getWorldPosition(new T.Vector3()),
    q = o.getWorldQuaternion(new T.Quaternion());
  const isLeg = /Leg/i.test(c.id),
    amount = isLeg ? 1 : c.options.wristPivot;
  const offset = c.pivotOffset
    .clone()
    .multiplyScalar(amount)
    .multiply(o.getWorldScale(new T.Vector3()));
  const rotation = isLeg
    ? new T.Quaternion().setFromEuler(
        new T.Euler(
          T.MathUtils.degToRad(c.options.footRoll),
          0,
          T.MathUtils.degToRad(c.options.footRock),
        ),
      )
    : new T.Quaternion();
  const desired = q.clone().multiply(rotation);
  // Rotate about the selected end pivot; preserve its world point.
  if (isLeg || amount)
    p.add(offset.clone().applyQuaternion(q)).sub(offset.applyQuaternion(desired));
  return { p, q: desired };
}

export function preserveWristPivot(c, o, before) {
  if (!/Arm/i.test(c.id) || !c.options.wristPivot || !before) return;
  const parent = o.parent,
    oldP = new T.Vector3().fromArray(before.p),
    oldQ = new T.Quaternion().fromArray(before.q),
    offset = c.pivotOffset.clone().multiplyScalar(c.options.wristPivot).multiply(o.scale);
  const pivot = oldP.add(offset.clone().applyQuaternion(oldQ));
  o.position.copy(pivot.sub(offset.applyQuaternion(o.quaternion)));
  o.updateWorldMatrix(true, true);
}

export function sampleOptions(keys, t) {
  if (!keys?.length) return { ...defaults };
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].time <= t + 1e-7) i++;
  const a = keys[i],
    b = keys[i + 1],
    o = validate(a.options);
  if (t <= a.time || !b || a.interp === 'step') return o;
  const spline = N.isSpline(a),
    u = spline
      ? 0
      : E.progress((t - a.time) / (b.time - a.time), { ...a, interp: a.interp || 'linear' });
  const next = validate(b.options);
  for (const [k, min, max] of [
    ['stretch', 0, 1],
    ['maxStretch', 1, 3],
    ['wristPivot', 0, 1],
    ['footRoll', -90, 90],
    ['footRock', -45, 45],
  ])
    o[k] = T.MathUtils.clamp(
      spline
        ? N.sampleScalar(keys, i, t, (x) => validate(x.options)[k])
        : T.MathUtils.lerp(o[k], next[k], u),
      min,
      max,
    );
  return o;
}

export function controlKeys(keys, options, prefix) {
  if (!keys?.length || !options?.length) return keys;
  const field = prefix === 'pole_' ? 'poleParent' : 'ikParent';
  return keys.map((k, i) =>
    keys[i + 1] &&
    sampleOptions(options, k.time)[field] !== sampleOptions(options, keys[i + 1].time)[field]
      ? { ...k, interp: 'step', forceGraphHold: true }
      : k,
  );
}

// Source bone-local channels stay unchanged; the scene basis maps Y-up to Blender Z-up.
export const blenderBasis = new T.Quaternion().setFromAxisAngle(
  new T.Vector3(1, 0, 0),
  Math.PI / 2,
);
export function blenderPoint(v) {
  return v.applyQuaternion(blenderBasis);
}
export function poleDirection(c, A, B, E) {
  const axis = E.clone().sub(A).normalize(),
    side = B.clone().sub(A).addScaledVector(axis, -B.clone().sub(A).dot(axis));
  if (side.lengthSq() < 1e-10 && c.bendMemory)
    side.copy(c.bendMemory).addScaledVector(axis, -c.bendMemory.dot(axis));
  if (side.lengthSq() < 1e-10) {
    side.set(0, 0, 1).applyQuaternion(c.a.o.getWorldQuaternion(new T.Quaternion()));
    side.addScaledVector(axis, -side.dot(axis));
  }
  if (side.lengthSq() < 1e-10) {
    side.set(Math.abs(axis.x) < 0.8 ? 1 : 0, Math.abs(axis.x) < 0.8 ? 0 : 1, 0);
    side.addScaledVector(axis, -side.dot(axis));
  }
  return side.normalize();
}
