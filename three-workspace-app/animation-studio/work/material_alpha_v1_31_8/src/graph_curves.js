import * as T from 'three';
import * as E from './easing.js';
import * as N from './motion_smoothing.js';
export const types = ['linear', 'step', 'auto', 'smooth', 'spline'];
const clone = (x) => structuredClone(x),
  clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const euler = (q) =>
  new T.Euler()
    .setFromQuaternion(new T.Quaternion().fromArray(q).normalize(), 'XYZ')
    .toArray()
    .slice(0, 3)
    .map(T.MathUtils.radToDeg);
export const quaternion = (e) =>
  new T.Quaternion()
    .setFromEuler(new T.Euler(...e.map(T.MathUtils.degToRad), 'XYZ'))
    .normalize()
    .toArray();
export function continuous(q, previous) {
  const e = euler(q);
  if (!previous) return e;
  const candidates = [e, [e[0] + 180, 180 - e[1], e[2] + 180]].map((a) =>
    a.map((v, i) => v + 360 * Math.round((previous[i] - v) / 360)),
  );
  return candidates.sort(
    (a, b) =>
      a.reduce((n, v, i) => n + (v - previous[i]) ** 2, 0) -
      b.reduce((n, v, i) => n + (v - previous[i]) ** 2, 0),
  )[0];
}
export const value = (k, path, axis) =>
  path === 'r' ? (k.graph?.euler || euler(k.q))[axis] : k[path][axis];
export function valid(k) {
  const g = k.graph;
  if (g === undefined) return true;
  if (
    !g ||
    g.version !== 1 ||
    Object.keys(g).some((x) => !['version', 'euler', 'channels', 'legacyOut'].includes(x))
  )
    return false;
  if (
    g.legacyOut !== undefined &&
    (!Array.isArray(g.legacyOut) ||
      g.legacyOut.length > 9 ||
      g.legacyOut.some((x) => !/^[psr][012]$/.test(x)))
  )
    return false;
  if (
    g.euler !== undefined &&
    (!Array.isArray(g.euler) || g.euler.length !== 3 || !g.euler.every(Number.isFinite))
  )
    return false;
  if (g.channels !== undefined) {
    if (!g.channels || Array.isArray(g.channels) || typeof g.channels !== 'object') return false;
    for (const [id, c] of Object.entries(g.channels)) {
      if (
        !/^[psr][012]$/.test(id) ||
        !c ||
        typeof c.linked !== 'boolean' ||
        Object.keys(c).some((x) => !['in', 'out', 'linked'].includes(x))
      )
        return false;
      for (const side of ['in', 'out']) {
        const h = c[side];
        if (
          !h ||
          !types.includes(h.type) ||
          !Number.isFinite(h.slope) ||
          Object.keys(h).some((x) => !['type', 'slope'].includes(x))
        )
          return false;
      }
      if (id[0] === 'r' && !g.euler) return false;
    }
  }
  return true;
}
function graph(k) {
  return k.graph || (k.graph = { version: 1, channels: {} });
}
export function channel(k, path, axis) {
  const g = graph(k),
    id = path + axis;
  if (g.legacyOut) g.legacyOut = g.legacyOut.filter((x) => x !== id);
  g.channels ||= {};
  return (
    g.channels[id] ||
    (g.channels[id] = {
      linked: false,
      in: { type: 'linear', slope: 0 },
      out: { type: 'linear', slope: 0 },
    })
  );
}
function boundary(a, b, path, axis) {
  return (
    a.interp === 'step' ||
    a.graph?.channels?.[path + axis]?.out.type === 'step' ||
    b.graph?.channels?.[path + axis]?.in.type === 'step'
  );
}
export function slope(keys, i, path, axis, side) {
  const c = keys[i].graph?.channels?.[path + axis]?.[side];
  if (c?.type === 'spline') return c.slope;
  const a = keys[i],
    prev = keys[i - 1],
    next = keys[i + 1],
    v = value(a, path, axis),
    left =
      prev && !boundary(prev, a, path, axis)
        ? (v - value(prev, path, axis)) / (a.time - prev.time)
        : null,
    right =
      next && !boundary(a, next, path, axis)
        ? (value(next, path, axis) - v) / (next.time - a.time)
        : null;
  if (c?.type === 'step') return 0;
  if (c?.type === 'linear' || !c) return (side === 'in' ? left : right) ?? left ?? right ?? 0;
  if (left === null) return right ?? 0;
  if (right === null) return left;
  const h0 = a.time - prev.time,
    h1 = next.time - a.time;
  if (c.type === 'auto') {
    if (left * right <= 0) return 0;
    return (3 * (h0 + h1)) / ((2 * h1 + h0) / left + (h1 + 2 * h0) / right);
  }
  return (left * h1 + right * h0) / (h0 + h1);
}
function scalar(keys, i, t, path, axis) {
  const a = keys[i],
    b = keys[i + 1],
    out = a.graph?.channels?.[path + axis]?.out,
    inside = b.graph?.channels?.[path + axis]?.in,
    v = value(a, path, axis),
    w = value(b, path, axis),
    dt = b.time - a.time,
    u = clamp((t - a.time) / dt, 0, 1);
  if (a.graph?.legacyOut?.includes(path + axis) || (!out && !inside)) {
    if (a.interp === 'step') return v;
    if (N.isSpline(a)) return N.sampleScalar(keys, i, t, (k) => value(k, path, axis));
    return v + (w - v) * E.progress(u, a);
  }
  if (out?.type === 'step' || inside?.type === 'step' || (!out && a.interp === 'step')) return v;
  const m = slope(keys, i, path, axis, 'out'),
    n = slope(keys, i + 1, path, axis, 'in');
  return (
    (2 * u ** 3 - 3 * u * u + 1) * v +
    (u ** 3 - 2 * u * u + u) * dt * m +
    (-2 * u ** 3 + 3 * u * u) * w +
    (u ** 3 - u * u) * dt * n
  );
}
export function overlay(keys, t, base) {
  if (!keys?.length) return base;
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].time <= t) i++;
  const at = t <= keys[0].time ? keys[0] : keys[i],
    last = t <= keys[0].time || i === keys.length - 1,
    result = at.graph || (!last && keys[i + 1].graph) ? clone(base) : base;
  if (at.forceGraphHold) return result;
  for (const path of ['p', 's'])
    for (let j = 0; j < 3; j++) {
      if (last) {
        if (at.graph?.channels?.[path + j]) result[path][j] = value(at, path, j);
      } else if (at.graph?.channels?.[path + j] || keys[i + 1].graph?.channels?.[path + j])
        result[path][j] = scalar(keys, i, t, path, j);
      if (path === 's' && Math.abs(result.s[j]) < 1e-6)
        result.s[j] = result.s[j] < 0 ? -1e-6 : 1e-6;
    }
  if (at.graph?.euler) {
    const r = [0, 1, 2].map((j) =>
      last
        ? at.graph.euler[j]
        : keys[i + 1].graph?.euler
          ? scalar(keys, i, t, 'r', j)
          : at.graph.euler[j],
    );
    result.q = quaternion(r);
    result.graph = { version: 1, euler: r };
  }
  return result;
}
export function setValue(k, path, axis, v) {
  if (!Number.isFinite(v) || (path === 's' && Math.abs(v) < 1e-6))
    throw Error('Giá trị không hợp lệ; Scale không được bằng 0.');
  if (path === 'r') {
    if (!k.graph?.euler) throw Error('Tạo đường cong Euler trước khi sửa Rotation.');
    k.graph.euler[axis] = v;
    k.q = quaternion(k.graph.euler);
  } else k[path][axis] = v;
  channel(k, path, axis);
}
export function tangent(keys, indices, path, axis, type, side = 'both', linked) {
  if (!types.includes(type) && !['break', 'unify'].includes(type))
    throw Error('Loại tiếp tuyến không hợp lệ.');
  for (const i of indices) {
    const c = channel(keys[i], path, axis);
    if (keys[i - 1]?.graph?.legacyOut)
      keys[i - 1].graph.legacyOut = keys[i - 1].graph.legacyOut.filter((x) => x !== path + axis);
    if (type === 'break') {
      c.linked = false;
      continue;
    }
    if (type === 'unify') {
      const m = slope(keys, i, path, axis, 'out');
      c.linked = true;
      c.in = { type: 'spline', slope: m };
      c.out = { type: 'spline', slope: m };
      continue;
    }
    for (const s of side === 'both' ? ['in', 'out'] : [side])
      c[s] = { type, slope: slope(keys, i, path, axis, s) };
    if (side !== 'both') c.linked = false;
    if (linked !== undefined) c.linked = linked;
  }
}
export function handle(keys, i, path, axis, side, m) {
  if (!Number.isFinite(m)) throw Error('Slope không hữu hạn.');
  const c = channel(keys[i], path, axis);
  if (side === 'in' && keys[i - 1]?.graph?.legacyOut)
    keys[i - 1].graph.legacyOut = keys[i - 1].graph.legacyOut.filter((x) => x !== path + axis);
  c[side] = { type: 'spline', slope: m };
  if (c.linked) c[side === 'in' ? 'out' : 'in'] = { type: 'spline', slope: m };
}
export function edit(keys, times, path, axis, { dt = 0, dv = 0, duration }) {
  const out = clone(keys),
    set = new Set(times),
    moving = out.filter((k) => set.has(k.time));
  if (!moving.length) throw Error('Chọn key trước khi chỉnh.');
  if (![dt, dv, duration].every(Number.isFinite)) throw Error('Thông số key không hợp lệ.');
  dt = clamp(
    dt,
    -Math.min(...moving.map((k) => k.time)),
    duration - Math.max(...moving.map((k) => k.time)),
  );
  for (const k of moving) {
    const t = k.time + dt;
    if (out.some((x) => !set.has(x.time) && Math.abs(x.time - t) < 1e-7))
      throw Error('Frame đích đã có key; dữ liệu được giữ nguyên.');
    setValue(k, path, axis, value(k, path, axis) + dv);
  }
  for (const k of moving) k.time += dt;
  out.sort((a, b) => a.time - b.time);
  return { keys: out, times: moving.map((k) => k.time) };
}
export function convert(keys, fps, rest, sample) {
  if (keys.length < 2) throw Error('Cần ít nhất hai key Rotation.');
  if (keys.some((k) => k.graph?.euler)) throw Error('Track đã có Euler curves.');
  const out = clone(keys),
    times = [
      ...new Set([
        ...keys.map((k) => k.time),
        ...Array.from({ length: Math.ceil((keys.at(-1).time - keys[0].time) * fps) + 1 }, (_, i) =>
          Math.min(keys.at(-1).time, keys[0].time + i / fps),
        ),
      ]),
    ].sort((a, b) => a - b);
  let prev = null;
  for (const t of times) {
    prev = continuous(sample(keys, t, rest).q, prev);
    const k = out.find((k) => Math.abs(k.time - t) < 1e-8);
    if (k) {
      graph(k).euler = [...prev];
      for (let j = 0; j < 3; j++)
        tangent(out, [out.indexOf(k)], 'r', j, k.interp === 'step' ? 'step' : 'linear');
    }
  }
  let error = 0,
    gimbal = false;
  for (let i = 0; i + 1 < times.length; i++)
    for (const f of [0, 0.25, 0.5, 0.75]) {
      const t = times[i] + (times[i + 1] - times[i]) * f,
        original = sample(keys, t, rest),
        converted = overlay(out, t, original);
      error = Math.max(
        error,
        T.MathUtils.radToDeg(
          new T.Quaternion()
            .fromArray(original.q)
            .angleTo(new T.Quaternion().fromArray(converted.q)),
        ),
      );
      gimbal ||= Math.abs(Math.cos(T.MathUtils.degToRad(continuous(original.q, null)[1]))) < 0.02;
    }
  return { keys: out, error, gimbal };
}
