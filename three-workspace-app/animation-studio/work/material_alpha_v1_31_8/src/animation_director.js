import * as C from './core.js';
const copy = (x) => structuredClone(x),
  EPS = 1e-7;
const fail = (m) => {
  throw Error(m);
};
const num = (v, min, max, name) =>
  Number.isFinite(v) && v >= min && v <= max ? v : fail(name + ' không hợp lệ.');
const same = (a, b) => Math.abs(a - b) < EPS;
const tracks = (p) => [
  ...Object.values(p.keys),
  ...Object.values(p.ikModes || {}),
  ...Object.values(p.ikOptions || {}),
];
const plain = (p) => {
  if (p.lab)
    fail('Tạo Blocking từ clip trước khi thiết kế nhịp; Animation Lab gốc được giữ trong Undo.');
};
export { validate } from './director_schema.js';
import { validate } from './director_schema.js';
export const metadata = (p) => copy(p.director || { version: 1, idea: '', markers: [] });
export function rest(rig, id) {
  return id === 'root'
    ? rig.rootRest
    : rig.controls[id]?.rest ||
        rig.records.find((r) => r.id === id)?.rest ||
        fail('Không tìm thấy bone ID: ' + id);
}
export function ids(rig, input) {
  const valid = new Set(['root', ...rig.records.map((r) => r.id), ...Object.keys(rig.controls)]);
  if (
    !Array.isArray(input) ||
    !input.length ||
    input.length > 2048 ||
    input.some((id) => !valid.has(id))
  )
    fail('Danh sách bone ID không hợp lệ.');
  return [...new Set(input)];
}
function marker(p, id) {
  return p.director?.markers.find((m) => m.id === id) || fail('Không tìm thấy mốc.');
}
function unlocked(p, t) {
  if (p.director?.markers.some((m) => m.locked && same(m.time, t)))
    fail('Pose tại mốc này đã khóa. Mở khóa trước khi sửa.');
}
function addMarker(p, m) {
  const d = p.director || (p.director = metadata(p));
  if (d.markers.some((x) => same(x.time, m.time))) fail('Thời điểm đã có mốc.');
  d.markers.push(m);
  d.markers.sort((a, b) => a.time - b.time);
  validate(d, p);
}
export function blocking(rig, source, { idea = '', markers }, samplePose) {
  if (
    typeof idea !== 'string' ||
    idea.length > 4000 ||
    !Array.isArray(markers) ||
    markers.length < 2 ||
    markers.length > 128
  )
    fail('Blocking cần 2–128 pose chính.');
  const p = C.newProject(rig);
  p.name = source.name + ' · Blocking';
  p.duration = source.duration;
  p.fps = source.fps;
  p.loop = copy(source.loop);
  p.skinAdjustments = copy(source.skinAdjustments || {});
  p.jointLimits = copy(source.jointLimits);
  p.inPlace = source.inPlace;
  p.inPlaceExport = source.inPlaceExport;
  for (const c of rig.chains) p.ikModes[c.id] = [{ time: 0, mode: 'fk' }];
  p.director = {
    version: 1,
    idea,
    markers: markers
      .map((m, i) => ({
        id: m.id || 'pose' + i,
        label: m.label || 'Pose ' + (i + 1),
        time: m.time,
        kind: m.kind || 'pose',
        locked: m.locked ?? false,
      }))
      .sort((a, b) => a.time - b.time),
  };
  validate(p.director, p);
  if (!same(p.director.markers[0].time, 0) || !same(p.director.markers.at(-1).time, p.duration))
    fail('Blocking cần mốc đầu 0 và mốc cuối bằng thời lượng clip.');
  for (const m of p.director.markers) {
    const pose = samplePose(m.time);
    for (const id of ['root', ...rig.records.map((r) => r.id)])
      C.addKey(p, id, m.time, pose[id], 'step');
  }
  C.validateProject(p, rig);
  return p;
}
function remap(p, oldTimes, newTimes) {
  const map = (t) => {
    let i = 0;
    while (i < oldTimes.length - 2 && t > oldTimes[i + 1] + EPS) i++;
    const a = oldTimes[i],
      b = oldTimes[i + 1];
    return newTimes[i] + ((t - a) / (b - a)) * (newTimes[i + 1] - newTimes[i]);
  };
  for (const keys of tracks(p)) {
    const original = copy(keys),
      ts = keys.map((k) => k.time),
      nt = ts.map(map);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      for (const [channel, c] of Object.entries(k.graph?.channels || {}))
        for (const side of ['in', 'out']) {
          const j = side === 'in' ? i - 1 : i + 1;
          if (j >= 0 && j < keys.length && c[side].type !== 'step')
            c[side] = {
              type: 'spline',
              slope:
                (C.graphCurves.slope(original, i, channel[0], Number(channel[1]), side) *
                  (ts[j] - ts[i])) /
                (nt[j] - nt[i]),
            };
        }
      k.time = nt[i];
    }
  }

  p.loop = p.loop.map(map);
  p.duration = newTimes.at(-1);
  return map;
}
export function retime(p, { markerId, time }) {
  plain(p);
  const d = p.director;
  if (!d || d.markers.length < 2) fail('Tạo Blocking trước khi chỉnh nhịp.');
  const m = marker(p, markerId),
    i = d.markers.indexOf(m);
  num(time, 0, 300, 'Thời điểm');
  if (i === 0) fail('Mốc đầu giữ ở 0.');
  if (m.locked && !same(m.time, time)) fail('Mốc đã khóa thời gian.');
  const old = d.markers.map((x) => x.time),
    next = [...old];
  next[i] = time;
  if (next.some((t, j) => j && t - next[j - 1] < 1 / p.fps - EPS))
    fail('Các pose chính cần cách nhau ít nhất một frame.');
  remap(p, old, next);
  d.markers.forEach((x, j) => (x.time = next[j]));
  validate(d, p);
  return p;
}
export function hold(rig, p, { markerId, duration }) {
  plain(p);
  num(duration, 1 / p.fps, 30, 'Thời gian giữ');
  const m = marker(p, markerId),
    t = m.time;
  if (p.duration + duration > 300) fail('Clip dài quá 300 giây.');
  if (p.director.markers.some((x) => x.locked && x.time > t + EPS))
    fail('Có mốc khóa phía sau; mở khóa trước khi thêm thời gian.');
  const endId = m.id + '-hold';
  if (p.director.markers.some((x) => x.id === endId)) fail('Mốc đã có đoạn giữ pose.');
  for (const [id, keys] of Object.entries(p.keys)) {
    const value = C.sampleKeys(keys, t, rest(rig, id)),
      at = keys.find((k) => same(k.time, t)),
      end = at ? copy(at) : { ...copy(value), time: t, interp: 'linear' };
    for (const k of keys) if (k.time > t + EPS) k.time += duration;
    C.addKey(p, id, t, value, 'step');
    const start = keys.find((k) => same(k.time, t));
    if (at?.graph) {
      start.graph = copy(end.graph);
      for (const c of Object.values(start.graph.channels || {})) c.out = { type: 'step', slope: 0 };
    }
    keys.push({ ...end, time: t + duration });
    keys.sort((a, b) => a.time - b.time);
  }
  for (const bank of [p.ikModes || {}, p.ikOptions || {}])
    for (const keys of Object.values(bank))
      for (const k of keys) if (k.time > t + EPS) k.time += duration;
  p.duration += duration;
  p.loop = p.loop.map((x) => (x > t + EPS ? x + duration : x));
  if (same(p.loop[1], t)) p.loop[1] += duration;
  for (const x of p.director.markers) if (x.time > t + EPS) x.time += duration;
  addMarker(p, {
    id: endId,
    time: t + duration,
    label: m.label + ' · hết giữ',
    kind: 'hold',
    locked: false,
  });
  return p;
}
export function breakdown(rig, p, { time, label = 'Breakdown', boneIds, offsets = {}, fraction }) {
  plain(p);
  num(time, 0, p.duration, 'Thời điểm');
  unlocked(p, time);
  const chosen = ids(rig, boneIds),
    d = p.director || metadata(p),
    left = d.markers.findLast((m) => m.time < time - EPS),
    right = d.markers.find((m) => m.time > time + EPS);
  if (!left || !right) fail('Đặt breakdown giữa hai pose chính.');
  const u =
    fraction === undefined
      ? (time - left.time) / (right.time - left.time)
      : num(fraction, 0, 1, 'Tỷ lệ pose');
  for (const id of chosen) {
    const ks = p.keys[id] || [],
      a = copy(C.sampleKeys(ks, left.time, rest(rig, id))),
      b = copy(C.sampleKeys(ks, right.time, rest(rig, id))),
      value = C.sampleKeys(
        [
          { ...a, time: 0, interp: 'linear' },
          { ...b, time: 1, interp: 'linear' },
        ],
        u,
        rest(rig, id),
      );
    // Preserve explicit Euler winding on authored rotation curves, including Spin.
    const ka = ks.find((k) => same(k.time, left.time)),
      kb = ks.find((k) => same(k.time, right.time));
    let euler;
    if (ka?.graph?.euler && kb?.graph?.euler) {
      euler = ka.graph.euler.map((x, j) => x + (kb.graph.euler[j] - x) * u);
      value.q = C.graphCurves.quaternion(euler);
    }
    if (offsets[id]) {
      if (
        !Array.isArray(offsets[id]) ||
        offsets[id].length !== 3 ||
        !offsets[id].every(Number.isFinite)
      )
        fail('Offset cần ba số theo đơn vị model.');
      value.p = value.p.map((v, j) => v + offsets[id][j]);
    }
    C.addKey(p, id, time, value, 'linear');
    if (euler)
      p.keys[id].find((k) => same(k.time, time)).graph = {
        version: 1,
        euler,
        channels: Object.fromEntries(
          [0, 1, 2].map((j) => [
            'r' + j,
            { linked: false, in: { type: 'linear', slope: 0 }, out: { type: 'linear', slope: 0 } },
          ]),
        ),
      };
  }
  addMarker(p, {
    id: 'break-' + String(Math.round(time * 1e7)),
    time,
    label,
    kind: 'breakdown',
    locked: false,
  });
  return p;
}
export function setPose(rig, p, { time, transforms, interpolation = 'step' }) {
  plain(p);
  num(time, 0, p.duration, 'Thời điểm');
  unlocked(p, time);
  ids(rig, Object.keys(transforms || {}));
  for (const [id, value] of Object.entries(transforms)) C.addKey(p, id, time, value, interpolation);
  return C.validateProject(p, rig);
}
export function smooth(
  rig,
  p,
  { boneIds, start, end, strength = 0.35, window = 2, channels = ['q'], method = 'filter' },
) {
  plain(p);
  const chosen = ids(rig, boneIds);
  const locks = (p.director?.markers || [])
    .filter((m) => m.locked || m.kind === 'contact')
    .map((m) => m.time);
  if (!['filter', 'auto', 'cubic'].includes(method)) fail('Phương pháp curve không hợp lệ.');
  const holdStarts = (p.director?.markers || [])
    .filter((m) => m.kind === 'hold' && m.id.endsWith('-hold'))
    .map((m) => p.director.markers.find((x) => x.id === m.id.slice(0, -5))?.time);
  if (method !== 'filter')
    for (const id of chosen)
      for (const k of p.keys[id] || [])
        if (
          k.time >= start - EPS &&
          k.time <= end + EPS &&
          !holdStarts.some((t) => same(t, k.time)) &&
          k.interp === 'step'
        )
          k.interp = 'linear';
  const result = C.smoothing.processTracks(
    p.keys,
    { method, start, end, strength, window, fps: p.fps, tension: 0, channels, ids: chosen },
    C.sampleKeys,
    (id) => rest(rig, id),
    () => locks,
  );
  p.keys = result.tracks;
  return p;
}
export function patch(rig, project, operation, args) {
  const p = copy(project);
  let out;
  switch (operation) {
    case 'retime_segment':
      out = retime(p, args);
      break;
    case 'set_hold':
      out = hold(rig, p, args);
      break;
    case 'insert_breakdown':
      out = breakdown(rig, p, args);
      break;
    case 'set_pose':
      out = setPose(rig, p, args);
      break;
    case 'smooth_motion':
      out = smooth(rig, p, args);
      break;
    case 'set_marker': {
      plain(p);
      const m = marker(p, args.markerId);
      if (args.label !== undefined) m.label = args.label;
      if (args.locked !== undefined) m.locked = args.locked;
      if (args.kind !== undefined) m.kind = args.kind;
      out = p;
      break;
    }
    case 'set_idea': {
      if (typeof args.idea !== 'string') fail('Ý tưởng phải là văn bản.');
      p.director ||= metadata(p);
      p.director.idea = args.idea;
      out = p;
      break;
    }
    case 'edit_curves': {
      plain(p);
      const { boneId, path, axis, times, type, side = 'both', slope } = args;
      ids(rig, [boneId]);
      if (
        !['p', 'r', 's'].includes(path) ||
        ![0, 1, 2].includes(axis) ||
        !Array.isArray(times) ||
        !['in', 'out', 'both'].includes(side)
      )
        fail('Kênh curve không hợp lệ.');
      const keys = p.keys[boneId] || [],
        indices = times.map((t) => {
          unlocked(p, t);
          const i = keys.findIndex((k) => same(k.time, t));
          if (i < 0) fail('Không tìm thấy key.');
          return i;
        });
      if (!indices.length) fail('Chọn ít nhất một key.');
      if (path === 'r' && keys.some((k) => !k.graph?.euler))
        fail('Cần tạo Euler curves bằng Graph Editor trước khi sửa từng trục Rotation.');
      if (slope !== undefined) {
        for (const i of indices)
          for (const s of side === 'both' ? ['in', 'out'] : [side])
            C.graphCurves.handle(keys, i, path, axis, s, slope);
      } else C.graphCurves.tangent(keys, indices, path, axis, type, side);
      out = p;
      break;
    }
    case 'edit_keyframes': {
      plain(p);
      if (
        !Array.isArray(args.refs) ||
        !args.refs.length ||
        args.refs.length > 1000 ||
        !['move', 'delete', 'copy'].includes(args.action)
      )
        fail('Thao tác key không hợp lệ.');
      for (const r of args.refs) {
        ids(rig, [r.id]);
        if (r.kind !== 'keys') fail('Chỉ chỉnh track transform.');
        unlocked(p, r.time);
      }
      if (args.action !== 'delete') {
        const shift = args.targetTime - Math.min(...args.refs.map((r) => r.time));
        for (const r of args.refs) unlocked(p, r.time + shift);
      }
      out = C.editKeyframes(p, args.refs, args.action, args.targetTime, 'linear').project;
      break;
    }
    default:
      fail('Thao tác Director không hỗ trợ: ' + operation);
  }
  validate(out.director, out);
  return C.validateProject(out, rig);
}
export function analyze(rig, p, { boneIds, start = 0, end = p.duration, samples = 120 } = {}) {
  const chosen = ids(rig, boneIds || Object.keys(p.keys).slice(0, 24));
  num(start, 0, p.duration, 'Đầu đoạn');
  num(end, start + EPS, p.duration, 'Cuối đoạn');
  num(samples, 4, 600, 'Số mẫu');
  if (!Number.isInteger(samples)) fail('Số mẫu cần nguyên.');
  const dt = (end - start) / samples,
    results = [];
  for (const id of chosen) {
    let prev = null,
      velocity = null,
      maxSpeed = 0,
      maxJump = 0,
      maxAngularSpeed = 0,
      maxAngularJump = 0,
      angularVelocity = null;
    for (let i = 0; i <= samples; i++) {
      const v = C.sampleKeys(p.keys[id], start + i * dt, rest(rig, id));
      if (prev) {
        const speed = Math.hypot(...v.p.map((x, j) => (x - prev.p[j]) / dt));
        maxSpeed = Math.max(maxSpeed, speed);
        if (velocity !== null) maxJump = Math.max(maxJump, Math.abs(speed - velocity));
        velocity = speed;
        const dot = Math.min(1, Math.abs(v.q.reduce((n, x, j) => n + x * prev.q[j], 0))),
          angular = (2 * Math.acos(dot) * 180) / Math.PI / dt;
        maxAngularSpeed = Math.max(maxAngularSpeed, angular);
        if (angularVelocity !== null)
          maxAngularJump = Math.max(maxAngularJump, Math.abs(angular - angularVelocity));
        angularVelocity = angular;
      }
      prev = v;
    }
    const a = C.sampleKeys(p.keys[id], start, rest(rig, id)),
      b = C.sampleKeys(p.keys[id], end, rest(rig, id)),
      dot = Math.min(1, Math.abs(a.q.reduce((n, x, i) => n + x * b.q[i], 0)));
    results.push({
      boneId: id,
      maxPositionSpeed: maxSpeed,
      maxSpeedChange: maxJump,
      maxAngularSpeedDegreesPerSecond: maxAngularSpeed,
      maxAngularSpeedChange: maxAngularJump,
      loopPositionGap: Math.hypot(...a.p.map((x, j) => x - b.p[j])),
      loopRotationGapDegrees: (2 * Math.acos(dot) * 180) / Math.PI,
    });
  }
  return {
    space: 'local model units',
    sampleRate: samples / (end - start),
    results,
    note: 'Chỉ số số học để phát hiện vị trí cần xem; chưa đánh giá thẩm mỹ, va chạm hoặc trượt chân.',
  };
}
