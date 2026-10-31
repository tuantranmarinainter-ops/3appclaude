import { validateTimeline } from './timeline_tools.js';
import { validate as validateDirector } from './director_schema.js';
import * as T from 'three';
import * as J from './joint_limits.js';
export { J as jointLimits };
import * as S from './skin_shape.js';
import * as K from './rig_kinematics.js';
import * as M from './motion_lab.js';
import * as E from './easing.js';
import * as N from './motion_smoothing.js';
import * as G from './graph_curves.js';
export { G as graphCurves };
export { N as smoothing };
export { E as easing };
export { M as motionLab };
export { K as kinematics };
export const clone = (x) => structuredClone(x),
  short = (n) => n.replace(/^mixamorig[:_]?/i, ''),
  canon = (n) =>
    short(n)
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
export const snap = (o) => ({
  p: o.position.toArray(),
  q: o.quaternion.toArray(),
  s: o.scale.toArray(),
});
export function apply(o, x) {
  o.position.fromArray(x.p);
  o.quaternion.fromArray(x.q).normalize();
  o.scale.fromArray(x.s || [1, 1, 1]);
}
export function fingerprint(records) {
  let hash = 2166136261;
  const str = JSON.stringify(
    records.map((r) => [
      r.name,
      r.parent,
      r.rest.p.map((v) => +v.toFixed(5)),
      r.rest.q.map((v) => +v.toFixed(5)),
    ]),
  );
  for (let i = 0; i < str.length; i++) hash = Math.imul(hash ^ str.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export function makeRig(root, name = 'Rig', asset = null) {
  root.updateMatrixWorld(true);
  const bones = [];
  root.traverse((o) => {
    if (o.isBone) bones.push(o);
  });
  if (!bones.length) throw Error('File không có bone. Cần FBX / GLB chứa armature.');
  const mesh = [];
  root.traverse((o) => {
    if (o.isMesh) mesh.push(o);
  });
  const weighted = new Set();
  for (const m of mesh) {
    if (!m.isSkinnedMesh) continue;
    const idx = m.geometry.getAttribute('skinIndex'),
      w = m.geometry.getAttribute('skinWeight');
    if (idx && w)
      for (let i = 0; i < w.count; i++)
        for (let j = 0; j < 4; j++)
          if (w.array[i * 4 + j] > 1e-6) {
            const b = m.skeleton.bones[idx.array[i * 4 + j]];
            if (b) weighted.add(b.uuid);
          }
  }
  const records = bones.map((o, i) => {
    let bp = o.parent;
    while (bp && !bp.isBone) bp = bp.parent;
    const q = o.getWorldQuaternion(new T.Quaternion()),
      p = o.getWorldPosition(new T.Vector3());
    return {
      id: 'b' + i,
      name: o.name || 'Bone ' + i,
      o,
      parent: bp ? 'b' + bones.indexOf(bp) : null,
      rest: snap(o),
      worldQ: q.toArray(),
      worldP: p.toArray(),
      weighted: weighted.has(o.uuid),
      parentWorldMatrix: o.parent ? o.parent.matrixWorld.toArray() : new T.Matrix4().toArray(),
    };
  });
  const roots = records.filter((r) => !r.parent),
    box = new T.Box3().setFromObject(root);
  for (const r of records) box.expandByPoint(new T.Vector3().fromArray(r.worldP));
  const size = box.getSize(new T.Vector3());
  let height = size.y;
  if (!Number.isFinite(height) || height < 1e-6) {
    const ys = records.map((r) => r.worldP[1]);
    height = Math.max(...ys) - Math.min(...ys);
  }
  height = Math.max(height, 1);
  const names = records.map((r) => canon(r.name)),
    major = ['hips', 'spine', 'head', 'leftarm', 'rightarm', 'leftupleg', 'rightupleg'];
  const mix = major.filter((n) => names.includes(n)).length;
  const meta =
    records.some((r) => /^spine(\.|$)/i.test(r.name)) &&
    records.some((r) => /^upper_arm\.L$/i.test(r.name)) &&
    records.some((r) => /^thigh\.R$/i.test(r.name));
  const iclone = names.includes('ccbaseboneroot') && names.includes('ccbasehip');
  const mc20 = [
    'anchor',
    'body',
    'lowbody',
    'head',
    'leftarm',
    'lowleftarm',
    'lowleftarmend',
    'rightarm',
    'lowrightarm',
    'lowrightarmend',
    'rightleg',
    'lowlegright',
    'leftleg',
    'lowleftleg',
    'miscbone1',
    'miscbone2',
    'miscbone3',
    'miscgbone1',
    'miscgbone2',
    'miscgbone3',
  ];
  const profile =
    names.length === 20 && mc20.every((n) => names.includes(n))
      ? 'Minecraft20'
      : mix === major.length
        ? 'Mixamo'
        : meta
          ? 'Metarig'
          : iclone
            ? 'iClone'
            : 'Khác';
  // MC20 global helper roots belong to the same logical armature; keep their physical parent records unchanged.
  if (profile === 'Minecraft20')
    roots.splice(
      0,
      roots.length,
      records.find((r) => canon(r.name) === 'anchor'),
    );
  const warnings = [];
  if (profile === 'Mixamo' && records.length !== 65)
    warnings.push(
      'Profile Mixamo theo khớp chính; ' + records.length + ' bone vật lý, chưa đúng 65.',
    );
  const duplicates = records.filter((r, i) => records.findIndex((x) => x.name === r.name) !== i);
  if (duplicates.length)
    warnings.push(
      duplicates.length +
        ' tên trùng: ' +
        duplicates
          .slice(0, 6)
          .map((r) => r.name)
          .join(', ') +
        (duplicates.length > 6 ? ' … Chọn armature để phân biệt.' : ''),
    );
  for (const r of records) {
    if ([...r.rest.p, ...r.rest.q, ...r.rest.s].some((v) => !Number.isFinite(v)))
      throw Error('Transform không hữu hạn tại ' + r.name);
    if (r.rest.s.some((v) => v <= 0) || Math.max(...r.rest.s) - Math.min(...r.rest.s) > 1e-4)
      warnings.push('Scale âm / không đều: ' + r.name);
  }
  const rig = {
    root,
    name,
    asset,
    records,
    roots,
    mesh,
    height,
    profile,
    warnings,
    clips: root.animations || [],
    fingerprint: fingerprint(records),
    rootRest: snap(root),
    armatures: roots.map((r) => ({ id: r.id, name: r.name })),
    activeRoot: null,
    controls: {},
    chains: [],
  };
  return rig;
}
export function descendants(rig, id) {
  if (rig.profile === 'Minecraft20' && id === rig.roots[0].id) return rig.records;
  return rig.records.filter((r) => {
    let p = r;
    while (p) {
      if (p.id === id) return true;
      p = rig.records.find((x) => x.id === p.parent);
    }
    return false;
  });
}
export function activeRecords(rig) {
  return rig.activeRoot ? descendants(rig, rig.activeRoot) : rig.records;
}
export function resetRig(rig) {
  apply(rig.root, rig.rootRest);
  for (const r of rig.records) apply(r.o, r.rest);
  rig.root.updateMatrixWorld(true);
}
export function capture(rig, scope = 'all', selected = null) {
  const list =
    scope === 'node'
      ? rig.records.filter((r) => r.id === selected)
      : scope === 'branch'
        ? descendants(rig, selected)
        : activeRecords(rig);
  const p = {};
  for (const r of list) p[r.id] = snap(r.o);
  if (scope === 'all') p.root = snap(rig.root);
  return p;
}
function sampleLegacy(keys, t, rest) {
  if (!keys?.length) return clone(rest);
  if (t <= keys[0].time) return clone(keys[0]);
  const end = keys.at(-1);
  if (t >= end.time) return clone(end);
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].time <= t) i++;
  const a = keys[i],
    b = keys[i + 1];
  if (a.interp === 'step') return clone(a);
  if (N.isSpline(a)) return N.sampleTransform(keys, i, t, rest);
  const u = E.progress((t - a.time) / (b.time - a.time), a);
  return {
    p: new T.Vector3().fromArray(a.p).lerp(new T.Vector3().fromArray(b.p), u).toArray(),
    q: new T.Quaternion()
      .fromArray(a.q)
      .slerp(new T.Quaternion().fromArray(b.q), u)
      .normalize()
      .toArray(),
    s: new T.Vector3()
      .fromArray(a.s || rest.s)
      .lerp(new T.Vector3().fromArray(b.s || rest.s), u)
      .toArray()
      .map((v, i) =>
        !a.interp.startsWith('ease:')
          ? v
          : (a.s || rest.s)[i] > 0 && (b.s || rest.s)[i] > 0
            ? Math.max(1e-6, v)
            : (a.s || rest.s)[i] < 0 && (b.s || rest.s)[i] < 0
              ? Math.min(-1e-6, v)
              : v,
      ),
  };
}
export function sampleKeys(keys, t, rest) {
  return G.overlay(keys, t, sampleLegacy(keys, t, rest));
}
export function evaluateRaw(rig, project, t) {
  resetRig(rig);
  for (const r of rig.records) apply(r.o, sampleKeys(project.keys[r.id], t, r.rest));
  apply(rig.root, sampleKeys(project.keys.root, t, rig.rootRest));
  rig.root.updateMatrixWorld(true);
  for (const c of rig.chains) {
    const options = K.sampleOptions(project.ikOptions?.[c.id], t);
    K.configure(rig, c, options, false);
  }
  for (const [id, c] of Object.entries(rig.controls)) {
    const prefix = id.startsWith('pole_') ? 'pole_' : 'ik_',
      chain = id.slice(prefix.length),
      keys = K.controlKeys(project.keys[id], project.ikOptions?.[chain], prefix);
    apply(c.object, sampleKeys(keys, t, c.rest));
  }
  for (const chain of rig.chains) {
    const keys = project.ikModes[chain.id] || [];
    let mode = 'fk';
    for (const k of keys) if (k.time <= t + 1e-7) mode = k.mode;
    chain.mode = mode;
    if (mode === 'ik') solveIK(rig, chain);
  }
  rig.root.updateMatrixWorld(true);
}
function evaluatePose(rig, project, t) {
  if (project.lab)
    return M.evaluate(rig, project, t, {
      raw: evaluateRaw,
      snap,
      apply,
      sample: sampleKeys,
      solveIK,
      setWorldQ,
      configure: K.configure,
    });
  return evaluateRaw(rig, project, t);
}
export function motionOrigins(rig) {
  const roots = activeRecords(rig).filter(
    (r) => !r.parent || /^(hips|pelvis)$/.test(canon(r.name)),
  );
  return new Map([
    [rig.root, rig.root.getWorldPosition(new T.Vector3())],
    ...roots.map((r) => [r.o, r.o.getWorldPosition(new T.Vector3())]),
  ]);
}
export function applyInPlace(rig, anchors) {
  const before = rig.chains.map((c) => ({
    c,
    end: c.c.o.getWorldPosition(new T.Vector3()),
    controls: ['ik_' + c.id, 'pole_' + c.id]
      .filter((id) => rig.controls[id])
      .map((id) => [id, rig.controls[id].object.getWorldPosition(new T.Vector3())]),
  }));
  for (const [o, a] of anchors) {
    const p = o.getWorldPosition(new T.Vector3());
    p.x = a.x;
    if (rig.editorUp === 'z') p.y = a.y;
    else p.z = a.z;
    o.position.copy(o.parent ? o.parent.worldToLocal(p) : p);
    o.updateWorldMatrix(true, true);
  }
  for (const { c, end, controls } of before) {
    const delta = c.c.o.getWorldPosition(new T.Vector3()).sub(end);
    for (const [id, p] of controls) {
      const o = rig.controls[id].object;
      o.position.copy(o.parent ? o.parent.worldToLocal(p.add(delta)) : p.add(delta));
      o.updateWorldMatrix(true, true);
    }
  }
  rig.root.updateMatrixWorld(true);
}
export function evaluate(rig, project, t, options = {}) {
  if (!(options.inPlace ?? project.inPlace)) return evaluatePose(rig, project, t);
  evaluatePose(rig, project, 0);
  const anchors = motionOrigins(rig);
  evaluatePose(rig, project, t);
  applyInPlace(rig, anchors);
}
export function addKey(project, id, time, value, interp, easingStrength = 1) {
  if (!Number.isFinite(time) || time < 0 || time > project.duration + 1e-7)
    throw Error('Frame nằm ngoài thời lượng clip.');
  const metadata = E.metadata(interp, easingStrength),
    key = { ...clone(value), time, ...metadata },
    keys = project.keys[id] || (project.keys[id] = []);
  const i = keys.findIndex((k) => Math.abs(k.time - time) < 1e-7);
  if (keys.some((k) => k.graph?.euler)) {
    const near =
      i >= 0
        ? keys[i]
        : keys[
            Math.max(
              0,
              keys.findLastIndex((k) => k.time <= time),
            )
          ];
    key.graph = {
      version: 1,
      euler: G.continuous(key.q, near.graph?.euler),
      channels: i >= 0 ? clone(keys[i].graph?.channels || {}) : {},
    };
  } else if (i >= 0 && keys[i].graph) key.graph = clone(keys[i].graph);
  if (i >= 0) keys[i] = key;
  else keys.push(key);
  keys.sort((a, b) => a.time - b.time);
}
export function newProject(rig) {
  return {
    type: 'animation-studio',
    version: 1,
    name: 'Animation mới',
    duration: 2,
    fps: 30,
    keys: {},
    poses: [],
    ikModes: {},
    ikOptions: {},
    rig: { name: rig.name, fingerprint: rig.fingerprint, profile: rig.profile },
    settings: {},
    skinAdjustments: {},
    loop: [0, 2],
  };
}
export function validateProject(p, rig) {
  for (const k of ['inPlace', 'inPlaceExport'])
    if (p?.[k] !== undefined && typeof p[k] !== 'boolean')
      throw Error('Tùy chọn đi tại chỗ không hợp lệ.');
  if (!p || p.type !== 'animation-studio' || p.version !== 1)
    throw Error('Không phải dự án Animation Studio phiên bản 1.');
  if (
    !Number.isFinite(p.duration) ||
    p.duration < 0.1 ||
    p.duration > 300 ||
    ![24, 30, 60, 120].includes(p.fps)
  )
    throw Error('Thời lượng / FPS không hợp lệ.');
  validateTimeline(p);
  validateDirector(p.director, p);
  J.validate(p.jointLimits, rig);
  if (p.rig?.fingerprint !== rig.fingerprint)
    throw Error('Rig tham chiếu khác dự án. Hãy nhập đúng model đã lưu.');
  if (
    !Array.isArray(p.loop) ||
    p.loop.length !== 2 ||
    !p.loop.every(Number.isFinite) ||
    p.loop[0] < 0 ||
    p.loop[1] > p.duration ||
    p.loop[0] >= p.loop[1]
  )
    throw Error('Vùng lặp không hợp lệ.');
  if (
    typeof p.name !== 'string' ||
    !p.keys ||
    Array.isArray(p.keys) ||
    !Array.isArray(p.poses) ||
    !p.ikModes
  )
    throw Error('Cấu trúc JSON không hợp lệ.');
  const ids = new Set(['root', ...rig.records.map((r) => r.id), ...Object.keys(rig.controls)]);
  const valid = (x) =>
    x &&
    ['p', 'q', 's'].every(
      (k) =>
        Array.isArray(x[k]) && x[k].length === (k === 'q' ? 4 : 3) && x[k].every(Number.isFinite),
    ) &&
    x.q.reduce((s, n) => s + n * n, 0) > 1e-12;
  for (const [id, keys] of Object.entries(p.keys)) {
    if (!ids.has(id) || !Array.isArray(keys) || keys.length > 50000)
      throw Error('Kênh key không hợp lệ: ' + id);
    let prev = -1;
    for (const k of keys) {
      if (
        !valid(k) ||
        !Number.isFinite(k.time) ||
        k.time < 0 ||
        k.time > p.duration + 1e-7 ||
        k.time <= prev ||
        !E.validKey(k) ||
        !G.valid(k)
      )
        throw Error('Key không hợp lệ: ' + id);
      prev = k.time;
    }
  }
  for (const pose of p.poses) {
    if (
      typeof pose.name !== 'string' ||
      !pose.data ||
      Object.entries(pose.data).some(([id, v]) => !ids.has(id) || !valid(v))
    )
      throw Error('Pose không hợp lệ.');
  }
  for (const [id, keys] of Object.entries(p.ikModes)) {
    if (!rig.chains.some((c) => c.id === id) || !Array.isArray(keys))
      throw Error('Chuỗi IK không hợp lệ.');
    let prev = -1;
    for (const k of keys) {
      if (
        !Number.isFinite(k.time) ||
        k.time < 0 ||
        k.time > p.duration ||
        k.time <= prev ||
        !['fk', 'ik'].includes(k.mode)
      )
        throw Error('Mode IK không hợp lệ.');
      prev = k.time;
    }
  }
  for (const [id, keys] of Object.entries(p.ikOptions || {})) {
    if (!rig.chains.some((c) => c.id === id) || !Array.isArray(keys))
      throw Error('Rig option chain không hợp lệ.');
    let prev = -1;
    for (const k of keys) {
      if (!Number.isFinite(k.time) || k.time < 0 || k.time > p.duration || k.time <= prev)
        throw Error('Rig option frame không hợp lệ.');
      K.validate(k.options);
      if (!E.validKey({ ...k, interp: k.interp || 'linear' }))
        throw Error('Rig option interpolation không hợp lệ.');
      prev = k.time;
    }
  }
  if (p.lab) M.validate(p, rig, validateProject);
  const result = clone(p);
  result.ikOptions = p.ikOptions || {};
  result.skinAdjustments = S.validate(p.skinAdjustments, rig);
  return result;
}
export function chainSpecs(rig) {
  if (rig.profile === 'Minecraft20') {
    const find = (name) => rig.records.find((r) => canon(r.name) === canon(name));
    return [
      ['leftArm', 'Tay trái', 'left_arm', 'low_left_arm', 'low_left_arm.end'],
      ['rightArm', 'Tay phải', 'right_arm', 'low_right_arm', 'low_right_arm.end'],
      ['leftLeg', 'Chân trái', 'left_leg', 'low_left_leg'],
      ['rightLeg', 'Chân phải', 'right_leg', 'low_leg_right'],
    ]
      .map(([id, label, a, b, end]) => {
        const upper = find(a),
          lower = find(b);
        let tip = end ? find(end) : null;
        if (!tip && lower && upper) {
          const o = lower.o.mc20IKTip || new T.Object3D();
          o.name = 'MC20 IK endpoint';
          if (!o.parent) {
            o.parent = lower.o;
            const p = lower.o
              .getWorldPosition(new T.Vector3())
              .multiplyScalar(2)
              .sub(upper.o.getWorldPosition(new T.Vector3()));
            o.position.copy(lower.o.worldToLocal(p));
            lower.o.mc20IKTip = o;
          }
          tip = { id: lower.id, name: lower.name, o, parent: lower.id, virtual: true };
        }
        return {
          id,
          label,
          root: rig.roots[0].id,
          a: upper,
          b: lower,
          c: tip,
          mode: 'fk',
          virtualEnd: !end,
        };
      })
      .filter((c) => c.a && c.b && c.c);
  }
  const sets =
    rig.roots.length > 1
      ? rig.roots.map((root) => ({ root: root.id, records: descendants(rig, root.id) }))
      : [{ root: rig.roots[0].id, records: rig.records }];
  const specs = [
    [
      'leftArm',
      'Tay trái',
      'LeftArm',
      'LeftForeArm',
      'LeftHand',
      'upper_arm.L',
      'forearm.L',
      'hand.L',
    ],
    [
      'rightArm',
      'Tay phải',
      'RightArm',
      'RightForeArm',
      'RightHand',
      'upper_arm.R',
      'forearm.R',
      'hand.R',
    ],
    ['leftLeg', 'Chân trái', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'thigh.L', 'shin.L', 'foot.L'],
    ['rightLeg', 'Chân phải', 'RightUpLeg', 'RightLeg', 'RightFoot', 'thigh.R', 'shin.R', 'foot.R'],
  ];
  const aliases = {
    LeftArm: 'Upper_Arm_L',
    LeftForeArm: 'Lower_Arm_L',
    LeftHand: 'Hand_L',
    RightArm: 'Upper_Arm_R',
    RightForeArm: 'Lower_Arm_R',
    RightHand: 'Hand_R',
    LeftUpLeg: 'Upper_Leg_L',
    LeftLeg: 'Lower_Leg_L',
    LeftFoot: 'Foot_L',
    RightUpLeg: 'Upper_Leg_R',
    RightLeg: 'Lower_Leg_R',
    RightFoot: 'Foot_R',
  };
  const cc = {
    LeftArm: ['CC_Base_L_Upperarm', 'CC_Base_L_UpperArm'],
    LeftForeArm: ['CC_Base_L_Forearm'],
    LeftHand: ['CC_Base_L_Hand'],
    RightArm: ['CC_Base_R_Upperarm', 'CC_Base_R_UpperArm'],
    RightForeArm: ['CC_Base_R_Forearm'],
    RightHand: ['CC_Base_R_Hand'],
    LeftUpLeg: ['CC_Base_L_Thigh'],
    LeftLeg: ['CC_Base_L_Calf'],
    LeftFoot: ['CC_Base_L_Foot'],
    RightUpLeg: ['CC_Base_R_Thigh'],
    RightLeg: ['CC_Base_R_Calf'],
    RightFoot: ['CC_Base_R_Foot'],
  };
  return sets.flatMap((set) => {
    const find = (mix, meta) => {
      const accepted = new Set([
        canon(mix),
        canon(meta),
        canon(aliases[mix]),
        ...(cc[mix] || []).map(canon),
      ]);
      const matches = set.records.filter((r) => accepted.has(canon(r.name)));
      return matches.length === 1 ? matches[0] : null;
    };
    return specs
      .map(([id, label, a, b, c, ma, mb, mc]) => ({
        id: rig.roots.length > 1 ? set.root + '_' + id : id,
        root: set.root,
        label: (rig.roots.length > 1 ? set.root + ' · ' : '') + label,
        a: find(a, ma),
        b: find(b, mb),
        c: find(c, mc),
        mode: 'fk',
      }))
      .filter((s) => s.a && s.b && s.c && s.b.parent === s.a.id && s.c.parent === s.b.id);
  });
}
export function setWorldQ(o, q) {
  const pq = o.parent ? o.parent.getWorldQuaternion(new T.Quaternion()) : new T.Quaternion();
  o.quaternion.copy(pq.invert().multiply(q)).normalize();
  o.updateWorldMatrix(false, true);
}
export function solveIK(rig, c) {
  const a = c.a.o,
    b = c.b.o,
    e = c.c.o,
    target = rig.controls['ik_' + c.id].object,
    pole = rig.controls['pole_' + c.id].object;
  K.updateFrames(rig, c);
  b.position.copy(c.baseB);
  e.position.copy(c.baseE);
  rig.root.updateMatrixWorld(true);
  const effective = K.target(c, target);
  const A = a.getWorldPosition(new T.Vector3()),
    B = b.getWorldPosition(new T.Vector3()),
    C = e.getWorldPosition(new T.Vector3()),
    goal = effective.p,
    P = pole.getWorldPosition(new T.Vector3());
  let l1 = A.distanceTo(B),
    l2 = B.distanceTo(C);
  if (l1 < 1e-8 || l2 < 1e-8) return;
  const factor =
    1 +
    (Math.min(c.options.maxStretch, Math.max(1, goal.distanceTo(A) / (l1 + l2))) - 1) *
      c.options.stretch;
  if (factor > 1) {
    b.position.multiplyScalar(factor);
    e.position.multiplyScalar(factor);
    rig.root.updateMatrixWorld(true);
    B.copy(b.getWorldPosition(new T.Vector3()));
    C.copy(e.getWorldPosition(new T.Vector3()));
    l1 = A.distanceTo(B);
    l2 = B.distanceTo(C);
  }
  const d = goal.clone().sub(A),
    distance = T.MathUtils.clamp(d.length(), Math.abs(l1 - l2) + 1e-6, l1 + l2 - 1e-6);
  if (d.lengthSq() < 1e-12) d.copy(C).sub(A);
  if (d.lengthSq() < 1e-12) d.set(0, -1, 0);
  d.normalize();
  let bend = P.clone().sub(A).addScaledVector(d, -P.clone().sub(A).dot(d));
  if (bend.lengthSq() < 1e-10) {
    bend = B.clone().sub(A).addScaledVector(d, -B.clone().sub(A).dot(d));
  }
  if (bend.lengthSq() < 1e-10 && c.bendMemory) {
    bend.copy(c.bendMemory).addScaledVector(d, -c.bendMemory.dot(d));
  }
  if (bend.lengthSq() < 1e-10) {
    bend = new T.Vector3(0, 0, 1).cross(d);
    if (bend.lengthSq() < 1e-10) bend.set(1, 0, 0);
  }
  bend.normalize();
  c.bendMemory = bend.clone();
  const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance),
    h = Math.sqrt(Math.max(0, l1 * l1 - along * along)),
    mid = A.clone().addScaledVector(d, along).addScaledVector(bend, h),
    end = A.clone().addScaledVector(d, distance);
  const q1 = new T.Quaternion()
    .setFromUnitVectors(B.clone().sub(A).normalize(), mid.clone().sub(A).normalize())
    .multiply(a.getWorldQuaternion(new T.Quaternion()));
  if (c.bendAxisLocal) {
    const axis = mid.clone().sub(A).normalize(),
      normal = c.bendAxisLocal.clone().applyQuaternion(q1);
    normal.addScaledVector(axis, -normal.dot(axis));
    const desired = bend.clone().addScaledVector(axis, -bend.dot(axis));
    if (normal.lengthSq() > 1e-10 && desired.lengthSq() > 1e-10) {
      normal.normalize();
      desired.normalize();
      const angle = Math.atan2(axis.dot(normal.clone().cross(desired)), normal.dot(desired));
      q1.premultiply(new T.Quaternion().setFromAxisAngle(axis, angle));
    }
  }
  setWorldQ(a, q1);
  const nowB = b.getWorldPosition(new T.Vector3()),
    nowC = e.getWorldPosition(new T.Vector3());
  const q2 = new T.Quaternion()
    .setFromUnitVectors(nowC.sub(nowB).normalize(), end.sub(nowB).normalize())
    .multiply(b.getWorldQuaternion(new T.Quaternion()));
  setWorldQ(b, q2);
  if (!c.virtualEnd) setWorldQ(e, effective.q);
  c.outOfReach = goal.distanceTo(A) > l1 + l2;
}
export function suggestMapping(src, dst) {
  const mapping = {};
  const aliases = {
    upperarml: 'leftarm',
    forearml: 'leftforearm',
    handl: 'lefthand',
    thighl: 'leftupleg',
    shinl: 'leftleg',
    footl: 'leftfoot',
    upperarmr: 'rightarm',
    forearmr: 'rightforearm',
    handr: 'righthand',
    thighr: 'rightupleg',
    shinr: 'rightleg',
    footr: 'rightfoot',
    spine: 'hips',
    spine001: 'spine',
    spine002: 'spine1',
    spine003: 'spine2',
    spine004: 'neckbase',
    spine005: 'neck',
    spine006: 'head',
    shoulderl: 'leftshoulder',
    shoulderr: 'rightshoulder',
    toel: 'lefttoebase',
    toer: 'righttoebase',
  };
  const role = (r, rig) =>
    rig.profile === 'Metarig' ? aliases[canon(r.name)] || canon(r.name) : canon(r.name);
  for (const d of dst.records) {
    let candidates = activeRecords(src).filter((s) => canon(s.name) === canon(d.name));
    if (candidates.length !== 1)
      candidates = activeRecords(src).filter((s) => role(s, src) === role(d, dst));
    if (candidates.length === 1) mapping[d.id] = candidates[0].id;
  }
  return mapping;
}
export function retarget(src, dst, mapping) {
  resetRig(dst);
  const oldParent = dst.root.parent;
  if (oldParent) oldParent.updateMatrixWorld(true);
  const scale = dst.height / src.height;
  dst.root.position
    .fromArray(dst.rootRest.p)
    .add(
      src.root.position
        .clone()
        .sub(new T.Vector3().fromArray(src.rootRest.p))
        .multiplyScalar(scale),
    );
  dst.root.quaternion.copy(
    src.root.quaternion
      .clone()
      .multiply(new T.Quaternion().fromArray(src.rootRest.q).invert())
      .multiply(new T.Quaternion().fromArray(dst.rootRest.q)),
  );
  dst.root.updateMatrixWorld(true);
  for (const d of dst.records) {
    const s = src.records.find((r) => r.id === mapping[d.id]);
    if (!s) continue;
    const swq = s.o.getWorldQuaternion(new T.Quaternion()),
      spq = src.root.parent
        ? src.root.parent.getWorldQuaternion(new T.Quaternion())
        : new T.Quaternion();
    const dwq = dst.root.parent
      ? dst.root.parent.getWorldQuaternion(new T.Quaternion())
      : new T.Quaternion();
    const current = spq.clone().invert().multiply(swq),
      delta = current.multiply(new T.Quaternion().fromArray(s.worldQ).invert()),
      desired = dwq.multiply(delta).multiply(new T.Quaternion().fromArray(d.worldQ));
    setWorldQ(d.o, desired);
    if (!d.parent || canon(d.name) === 'hips') {
      const offset = s.o.position.clone().sub(new T.Vector3().fromArray(s.rest.p));
      offset
        .applyMatrix3(
          new T.Matrix3().setFromMatrix4(new T.Matrix4().fromArray(s.parentWorldMatrix)),
        )
        .applyMatrix3(
          new T.Matrix3().setFromMatrix4(new T.Matrix4().fromArray(d.parentWorldMatrix).invert()),
        );
      d.o.position.fromArray(d.rest.p).add(offset.multiplyScalar(scale));
    }
  }
  dst.root.updateMatrixWorld(true);
}
export function csvCell(v) {
  const s = String(v ?? '');
  return '"' + (/^[=+@\-\t\r]/.test(s) ? "'" : '') + s.replaceAll('"', '""') + '"';
}

export function bodyKeyRefs(rig, project, time) {
  const ids = new Set(['root', ...activeRecords(rig).map((r) => r.id)]),
    chains = rig.chains.filter((c) => !rig.activeRoot || c.root === rig.activeRoot);
  for (const c of chains) for (const prefix of ['ik_', 'pole_']) ids.add(prefix + c.id);
  const chainIds = new Set(chains.map((c) => c.id)),
    refs = [];
  for (const kind of ['keys', 'ikModes', 'ikOptions'])
    for (const [id, keys] of Object.entries(project[kind] || {}))
      if ((kind === 'keys' ? ids : chainIds).has(id))
        for (const k of keys)
          if (time === undefined || Math.abs(k.time - time) < 1e-7)
            refs.push({ kind, id, time: k.time });
  return refs;
}
export function editKeyframes(project, refs, action, targetTime, interp, easingStrength = 1) {
  if (!refs.length) throw Error('Chọn ít nhất một key trên timeline.');
  if (!['move', 'copy', 'delete', 'interp'].includes(action))
    throw Error('Thao tác key không hợp lệ.');
  if (action === 'interp' && !E.validKey({ interp, easingStrength }))
    throw Error('Nội suy không hợp lệ.');
  const next = clone(project),
    selected = [
      ...new Map(
        refs.map((r) => {
          const x = { ...r, kind: r.kind || 'keys' };
          return [x.kind + '|' + x.id + '|' + x.time, x];
        }),
      ).values(),
    ],
    find = (ks, t) => ks?.find((k) => Math.abs(k.time - t) < 1e-7);
  const entries = selected.map((r) => {
    const ks = next[r.kind]?.[r.id];
    if (
      !['keys', 'ikModes', 'ikOptions'].includes(r.kind) ||
      !Array.isArray(ks) ||
      !find(ks, r.time)
    )
      throw Error('Key đã thay đổi; chọn lại trên timeline.');
    return { ref: r, keys: ks, value: clone(find(ks, r.time)) };
  });
  const shift = targetTime - Math.min(...selected.map((r) => r.time));
  if (action === 'move' || action === 'copy') {
    for (const { ref: r, keys } of entries) {
      const t = r.time + shift;
      if (!Number.isFinite(t) || t < 0 || t > project.duration + 1e-7)
        throw Error('Frame đích ngoài clip.');
      const hit = find(keys, t),
        isMoving = selected.some(
          (x) => x.kind === r.kind && x.id === r.id && Math.abs(x.time - t) < 1e-7,
        );
      if (hit && (action === 'copy' || !isMoving))
        throw Error('Frame đích đã có key; hãy chọn vị trí khác.');
    }
    if (action === 'move')
      for (const { ref: r, keys } of entries) keys.splice(keys.indexOf(find(keys, r.time)), 1);
    for (const { ref: r, keys, value } of entries) {
      value.time = r.time + shift;
      keys.push(value);
      keys.sort((a, b) => a.time - b.time);
    }
  } else
    for (const { ref: r, keys } of entries) {
      const key = find(keys, r.time);
      if (action === 'delete') keys.splice(keys.indexOf(key), 1);
      else if (r.kind !== 'ikModes') {
        delete key.easingStrength;
        delete key.curveTension;
        Object.assign(key, E.metadata(interp, easingStrength));
        if (key.graph) key.graph.legacyOut = ['p0', 'p1', 'p2', 's0', 's1', 's2', 'r0', 'r1', 'r2'];
      }
    }
  return {
    project: next,
    selection:
      action === 'delete'
        ? []
        : selected.map((r) => ({
            ...r,
            time: r.time + (['move', 'copy'].includes(action) ? shift : 0),
          })),
  };
}
