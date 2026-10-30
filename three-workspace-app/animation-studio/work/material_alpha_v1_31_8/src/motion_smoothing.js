import * as T from 'three';
import * as G from './graph_curves.js';
export const isSpline = (k) => ['auto', 'cubic'].includes(k?.interp);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function neighbors(keys, i) {
  return [
    i > 0 && keys[i - 1].interp !== 'step' ? i - 1 : i,
    i + 1 < keys.length && keys[i].interp !== 'step' ? i + 1 : i,
  ];
}
function slope(keys, i, get, auto) {
  const [l, r] = neighbors(keys, i),
    a = get(keys[i]),
    dl = l === i ? 0 : (a - get(keys[l])) / (keys[i].time - keys[l].time),
    dr = r === i ? 0 : (get(keys[r]) - a) / (keys[r].time - keys[i].time);
  if (l === i) return dr;
  if (r === i) return dl;
  const h0 = keys[i].time - keys[l].time,
    h1 = keys[r].time - keys[i].time;
  if (auto) {
    if (dl * dr <= 0) return 0;
    const w0 = 2 * h1 + h0,
      w1 = h1 + 2 * h0;
    return (w0 + w1) / (w0 / dl + w1 / dr);
  }
  return (dl * h1 + dr * h0) / (h0 + h1);
}
export function sampleScalar(keys, i, t, get) {
  const a = keys[i],
    b = keys[i + 1],
    dt = b.time - a.time,
    u = clamp((t - a.time) / dt, 0, 1),
    u2 = u * u,
    u3 = u2 * u,
    auto = a.interp === 'auto';
  const va = get(a),
    vb = get(b),
    ma = slope(keys, i, get, auto) * (1 - (a.curveTension ?? 0)),
    mb = slope(keys, i + 1, get, auto) * (1 - (b.curveTension ?? 0));
  return (
    (2 * u3 - 3 * u2 + 1) * va +
    (u3 - 2 * u2 + u) * dt * ma +
    (-2 * u3 + 3 * u2) * vb +
    (u3 - u2) * dt * mb
  );
}
const quat = (q) => new T.Quaternion().fromArray(q).normalize();
function log(q) {
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const n = Math.hypot(q.x, q.y, q.z);
  return n < 1e-12
    ? new T.Vector3()
    : new T.Vector3(q.x, q.y, q.z).multiplyScalar(Math.atan2(n, q.w) / n);
}
function exp(v) {
  const n = v.length(),
    s = n < 1e-12 ? 1 : Math.sin(n) / n;
  return new T.Quaternion(v.x * s, v.y * s, v.z * s, Math.cos(n)).normalize();
}
function velocity(keys, i, auto) {
  const [l, r] = neighbors(keys, i),
    q = quat(keys[i].q),
    inv = q.clone().invert(),
    left =
      l === i
        ? null
        : log(inv.clone().multiply(quat(keys[l].q))).multiplyScalar(
            -1 / (keys[i].time - keys[l].time),
          ),
    right =
      r === i
        ? null
        : log(inv.clone().multiply(quat(keys[r].q))).multiplyScalar(
            1 / (keys[r].time - keys[i].time),
          );
  if (!left) return (right || new T.Vector3()).multiplyScalar(1 - (keys[i].curveTension ?? 0));
  if (!right) return left.multiplyScalar(1 - (keys[i].curveTension ?? 0));
  const h0 = keys[i].time - keys[l].time,
    h1 = keys[r].time - keys[i].time,
    v = left
      .clone()
      .multiplyScalar(h1)
      .addScaledVector(right, h0)
      .divideScalar(h0 + h1);
  if (auto) {
    if (left.dot(right) <= 0) v.set(0, 0, 0);
    else if (v.length() > 3 * Math.min(left.length(), right.length()))
      v.setLength(3 * Math.min(left.length(), right.length()));
  }
  return v.multiplyScalar(1 - (keys[i].curveTension ?? 0));
}
export function sampleTransform(keys, i, t, rest) {
  const a = keys[i],
    b = keys[i + 1],
    dt = b.time - a.time,
    u = clamp((t - a.time) / dt, 0, 1),
    auto = a.interp === 'auto';
  const q0 = quat(a.q),
    q3 = quat(b.q),
    q1 = q0.clone().multiply(exp(velocity(keys, i, auto).multiplyScalar(dt / 3))),
    q2 = q3.clone().multiply(exp(velocity(keys, i + 1, auto).multiplyScalar(-dt / 3)));
  const mix = (x, y) => x.clone().slerp(y, u).normalize(),
    q = mix(mix(mix(q0, q1), mix(q1, q2)), mix(mix(q1, q2), mix(q2, q3)));
  return {
    p: [0, 1, 2].map((j) => sampleScalar(keys, i, t, (k) => k.p[j])),
    q: q.toArray(),
    s: [0, 1, 2].map((j) => {
      const x = (a.s || rest.s)[j],
        y = (b.s || rest.s)[j],
        v = sampleScalar(keys, i, t, (k) => (k.s || rest.s)[j]);
      return x > 0 && y > 0 ? Math.max(1e-6, v) : x < 0 && y < 0 ? Math.min(-1e-6, v) : v;
    }),
  };
}
export function processTracks(
  tracks,
  {
    method,
    start,
    end,
    strength = 0.5,
    window = 3,
    fps = 30,
    tension = 0,
    channels = ['p', 'q'],
    ids,
  },
  sample,
  restFor,
  breaksFor = () => [],
) {
  if (
    !['auto', 'cubic', 'filter'].includes(method) ||
    ![start, end, strength, window, fps, tension].every(Number.isFinite) ||
    start < 0 ||
    end <= start ||
    strength < 0 ||
    strength > 1 ||
    window < 1 ||
    window > 12 ||
    !Number.isInteger(window) ||
    fps <= 0 ||
    tension < 0 ||
    tension > 1 ||
    !channels.length ||
    channels.some((c) => !['p', 'q', 's'].includes(c))
  )
    throw Error('Thông số làm mượt không hợp lệ.');
  const next = structuredClone(tracks);
  let count = 0;
  for (const id of ids) {
    const ks = tracks[id];
    if (!ks?.length) continue;
    const indices = ks
        .map((k, i) => (k.time >= start - 1e-7 && k.time <= end + 1e-7 ? i : -1))
        .filter((i) => i >= 0),
      breaks = breaksFor(id),
      holds = ks.flatMap((k, i) =>
        k.interp === 'step' && ks[i + 1] ? [[k.time, ks[i + 1].time]] : [],
      ),
      segments = new Map();
    for (const i of indices) {
      const k = ks[i],
        dst = next[id][i];
      if (method !== 'filter') {
        if (k.interp === 'step' || breaks.some((t) => t > k.time && t <= ks[i + 1]?.time)) continue;
        dst.interp = method;
        dst.curveTension = tension;
        delete dst.easingStrength;
        count++;
        continue;
      }
      if (
        i === indices[0] ||
        i === indices.at(-1) ||
        k.interp === 'step' ||
        ks[i - 1]?.interp === 'step' ||
        breaks.some((t) => Math.abs(t - k.time) < 1e-7)
      )
        continue;
      let lo = start,
        hi = end;
      for (const [a, b] of holds) {
        if (b <= k.time) lo = Math.max(lo, b);
        else hi = Math.min(hi, a);
      }
      for (const t of breaks) {
        if (t < k.time) lo = Math.max(lo, t);
        else hi = Math.min(hi, t - 1e-7);
      }
      const band = lo + '|' + hi;
      if (!segments.has(band))
        segments.set(
          band,
          ks.filter((x) => x.time >= lo - 1e-8 && x.time <= hi + 1e-8),
        );
      const segment = segments.get(band),
        samples = [];
      let sum = 0;
      for (let j = -window; j <= window; j++) {
        const t = k.time + j / fps;
        if (t < lo - 1e-7 || t > hi + 1e-7) continue;
        const w = Math.exp(-0.5 * (j / Math.max(1, window / 2)) ** 2);
        let l = 0,
          r = segment.length - 1;
        while (l < r) {
          const m = Math.ceil((l + r) / 2);
          if (segment[m].time <= t) l = m;
          else r = m - 1;
        }
        samples.push([sample(segment.slice(Math.max(0, l - 1), l + 3), t, restFor(id)), w]);
        sum += w;
      }
      if (!sum) continue;
      if (strength === 0) {
        count++;
        continue;
      }
      for (const channel of channels) {
        if (channel === 'q') {
          const base = quat(k.q),
            inv = base.clone().invert(),
            v = new T.Vector3();
          for (const [s, w] of samples)
            v.addScaledVector(log(inv.clone().multiply(quat(s.q))), w / sum);
          dst.q = base
            .multiply(exp(v.multiplyScalar(strength)))
            .normalize()
            .toArray();
        } else
          dst[channel] = [0, 1, 2].map((j) => {
            const original = (k[channel] || restFor(id)[channel])[j],
              v =
                original +
                (samples.reduce((n, [s, w]) => n + s[channel][j] * w, 0) / sum - original) *
                  strength;
            if (channel === 's')
              return original > 0 ? Math.max(1e-6, v) : original < 0 ? Math.min(-1e-6, v) : v;
            return v;
          });
      }
      count++;
    }
  }
  for (const id of ids)
    for (const k of next[id] || []) {
      const old = tracks[id]?.find((x) => x.time === k.time);
      if (k.graph && JSON.stringify(old) !== JSON.stringify(k)) {
        k.graph.legacyOut = [
          ...new Set([
            ...(k.graph.legacyOut || []),
            ...channels.flatMap((c) => [0, 1, 2].map((i) => (c === 'q' ? 'r' : c) + i)),
          ]),
        ];
        if (k.graph.euler) k.graph.euler = G.continuous(k.q, old.graph.euler);
      }
    }
  return { tracks: next, count };
}
