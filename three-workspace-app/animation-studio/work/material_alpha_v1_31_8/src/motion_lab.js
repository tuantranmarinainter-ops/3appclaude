import * as T from 'three';
const copy = (x) => structuredClone(x),
  neutral = { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
  clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function create(project) {
  const base = copy(project);
  delete base.lab;
  delete base.parallelModes;
  return {
    version: 1,
    base,
    layers: [
      {
        id: 'layer1',
        name: 'Sửa chuyển động',
        weight: 1,
        muted: false,
        keys: {},
        ikModes: {},
        ikOptions: {},
      },
    ],
    activeLayer: 'layer1',
    clips: [
      {
        id: 'clip1',
        start: 0,
        length: base.duration,
        sourceStart: 0,
        sourceLength: base.duration,
        speed: 1,
        loop: false,
        reverse: false,
        fade: 0,
      },
    ],
    pins: [],
    markers: [],
    bodyMode: 'part',
    floorContact: false,
    groundY: 0,
  };
}
export const active = (p) => p.lab.layers.find((l) => l.id === p.lab.activeLayer);
export function sync(p) {
  const a = active(p);
  a.keys = copy(p.keys);
  a.ikModes = copy(p.ikModes);
  a.ikOptions = copy(p.ikOptions || {});
}
export function switchLayer(p, id) {
  sync(p);
  const a = p.lab.layers.find((l) => l.id === id);
  if (!a) throw Error('Lớp sửa không tồn tại.');
  p.lab.activeLayer = id;
  p.keys = copy(a.keys);
  p.ikModes = copy(a.ikModes);
  p.ikOptions = copy(a.ikOptions);
}
export function addLayer(p) {
  sync(p);
  const id = 'layer' + (1 + Math.max(...p.lab.layers.map((l) => Number(l.id.slice(5)) || 0)));
  p.lab.layers.push({
    id,
    name: 'Lớp sửa ' + id.slice(5),
    weight: 1,
    muted: false,
    keys: {},
    ikModes: {},
    ikOptions: {},
  });
  switchLayer(p, id);
}
function sampleTime(c, t) {
  const d = (t - c.start) * c.speed,
    phase = c.loop
      ? ((d % c.sourceLength) + c.sourceLength) % c.sourceLength
      : clamp(d, 0, c.sourceLength);
  return c.sourceStart + (c.reverse ? c.sourceLength - phase : phase);
}
function capture(r, api) {
  return {
    root: api.snap(r.root),
    bones: r.records.map((x) => api.snap(x.o)),
    controls: Object.fromEntries(
      Object.entries(r.controls).map(([id, x]) => [id, api.snap(x.object)]),
    ),
    modes: r.chains.map((x) => x.mode),
    options: r.chains.map((x) => copy(x.options)),
  };
}
function applyCapture(r, d, api) {
  api.apply(r.root, d.root);
  r.records.forEach((x, i) => api.apply(x.o, d.bones[i]));
  r.chains.forEach((x, i) => {
    x.mode = d.modes[i];
    api.configure(r, x, d.options[i], false);
  });
  for (const [id, v] of Object.entries(d.controls)) api.apply(r.controls[id].object, v);
  r.root.updateMatrixWorld(true);
}
function mix(a, b, f) {
  return {
    p: a.p.map((v, i) => v + (b.p[i] - v) * f),
    q: new T.Quaternion()
      .fromArray(a.q)
      .slerp(new T.Quaternion().fromArray(b.q), f)
      .normalize()
      .toArray(),
    s: a.s.map((v, i) => v + (b.s[i] - v) * f),
  };
}
export function evaluate(r, p, t, api, omitActive = false) {
  const lab = p.lab,
    clips = lab.clips
      .filter((c) => t >= c.start - 1e-7 && t <= c.start + c.length + 1e-7)
      .sort((a, b) => a.start - b.start);
  const last = clips.at(-1);
  api.raw(
    r,
    last ? lab.base : { ...lab.base, keys: {}, ikModes: {}, ikOptions: {} },
    last ? sampleTime(last, t) : Math.min(t, lab.base.duration),
  );
  if (clips.length > 1 && last.fade > 0) {
    const b = capture(r, api),
      prev = clips.at(-2);
    api.raw(r, lab.base, sampleTime(prev, t));
    const a = capture(r, api),
      f = clamp((t - last.start) / last.fade, 0, 1);
    applyCapture(
      r,
      {
        root: mix(a.root, b.root, f),
        bones: a.bones.map((x, i) => mix(x, b.bones[i], f)),
        controls: Object.fromEntries(
          Object.keys(a.controls).map((id) => [id, mix(a.controls[id], b.controls[id], f)]),
        ),
        modes: f < 0.5 ? a.modes : b.modes,
        options: f < 0.5 ? a.options : b.options,
      },
      api,
    );
  }
  for (const layer of lab.layers) {
    if (layer.muted || layer.weight <= 0 || (omitActive && layer.id === lab.activeLayer)) continue;
    const keys = layer.id === lab.activeLayer ? p.keys : layer.keys,
      modes = layer.id === lab.activeLayer ? p.ikModes : layer.ikModes,
      options = layer.id === lab.activeLayer ? p.ikOptions : layer.ikOptions;
    for (const [id, ks] of Object.entries(keys)) {
      if (!ks?.length || t < ks[0].time - 1e-7) continue;
      const o =
        id === 'root' ? r.root : r.controls[id]?.object || r.records.find((x) => x.id === id)?.o;
      if (!o) continue;
      const d = api.sample(ks, t, neutral),
        w = layer.weight;
      o.position.addScaledVector(new T.Vector3().fromArray(d.p), w);
      o.quaternion
        .multiply(new T.Quaternion().fromArray(d.q).slerp(new T.Quaternion(), 1 - w))
        .normalize();
      o.scale.multiply(new T.Vector3().fromArray(d.s).lerp(new T.Vector3(1, 1, 1), 1 - w));
    }
    for (const c of r.chains) {
      let m = null;
      for (const k of modes[c.id] || []) if (k.time <= t + 1e-7) m = k.mode;
      if (m) c.mode = m;
      let opt = null;
      for (const k of options?.[c.id] || []) if (k.time <= t + 1e-7) opt = k.options;
      if (opt) api.configure(r, c, opt, false);
    }
    r.root.updateMatrixWorld(true);
  }
  for (const c of r.chains) if (c.mode === 'ik') api.solveIK(r, c);
  constrain(r, p, t, api);
  r.root.updateMatrixWorld(true);
}
export function constrain(r, p, t, api) {
  const lab = p.lab;
  for (const pin of lab.pins) {
    if (t < pin.start - 1e-7 || t > pin.end + 1e-7) continue;
    const c = r.chains.find((x) => 'ik_' + x.id === pin.id),
      o = r.controls[pin.id]?.object;
    if (!c || !o) continue;
    o.parent.updateWorldMatrix(true, false);
    if (pin.position) {
      const v = new T.Vector3().fromArray(pin.p);
      if (r.editorUp === 'z') v.applyAxisAngle(new T.Vector3(1, 0, 0), Math.PI / 2);
      if (lab.floorContact && c.id.toLowerCase().includes('leg'))
        v[r.editorUp === 'z' ? 'z' : 'y'] = Math.max(
          v[r.editorUp === 'z' ? 'z' : 'y'],
          lab.groundY,
        );
      o.position.copy(o.parent.worldToLocal(v));
    }
    if (pin.rotation) {
      const q = new T.Quaternion().fromArray(pin.q);
      if (r.editorUp === 'z')
        q.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI / 2));
      api.setWorldQ(o, q);
    }
    c.mode = 'ik';
    api.solveIK(r, c);
  }
  if (lab.floorContact)
    for (const c of r.chains)
      if (c.mode === 'ik' && c.id.toLowerCase().includes('leg')) {
        const o = r.controls['ik_' + c.id]?.object;
        if (o) {
          const v = o.getWorldPosition(new T.Vector3());
          const up = r.editorUp === 'z' ? 'z' : 'y';
          if (v[up] < lab.groundY) {
            v[up] = lab.groundY;
            o.position.copy(o.parent.worldToLocal(v));
            api.solveIK(r, c);
          }
        }
      }
  r.root.updateMatrixWorld(true);
}
export function encode(r, p, t, ids, api) {
  const layer = active(p);
  if (layer.muted || layer.weight <= 0)
    throw Error('Bật lớp sửa và đặt mức ảnh hưởng lớn hơn 0 trước khi ghi key.');
  const live = capture(r, api);
  evaluate(r, p, t, api, true);
  const baseline = capture(r, api);
  applyCapture(r, live, api);
  const out = {};
  for (const id of ids) {
    const i = r.records.findIndex((x) => x.id === id),
      a = id === 'root' ? baseline.root : i >= 0 ? baseline.bones[i] : baseline.controls[id],
      b = id === 'root' ? live.root : i >= 0 ? live.bones[i] : live.controls[id];
    if (!a || !b) continue;
    const w = layer.weight,
      q = new T.Quaternion()
        .fromArray(a.q)
        .invert()
        .multiply(new T.Quaternion().fromArray(b.q))
        .normalize();
    const axis = new T.Vector3(q.x, q.y, q.z),
      angle = 2 * Math.atan2(axis.length(), q.w);
    if (axis.lengthSq() > 1e-12) axis.normalize();
    const expanded = new T.Quaternion().setFromAxisAngle(axis, angle / w).normalize();
    out[id] = {
      p: b.p.map((v, j) => (v - a.p[j]) / w),
      q: expanded.toArray(),
      s: b.s.map((v, j) => 1 + (v / a.s[j] - 1) / w),
    };
  }
  return out;
}
export function validate(p, r, validateProject) {
  const l = p.lab;
  if (!l) return;
  if (
    l.version !== 1 ||
    !Array.isArray(l.layers) ||
    !l.layers.length ||
    l.layers.length > 16 ||
    !Array.isArray(l.clips) ||
    l.clips.length > 128 ||
    !Array.isArray(l.pins) ||
    l.pins.length > 64 ||
    !Array.isArray(l.markers) ||
    l.markers.length > 128 ||
    !['part', 'full'].includes(l.bodyMode) ||
    typeof l.floorContact !== 'boolean' ||
    !Number.isFinite(l.groundY)
  )
    throw Error('Animation Lab không hợp lệ.');
  const base = copy(l.base);
  delete base.lab;
  validateProject(base, r);
  const ids = new Set();
  for (const a of l.layers) {
    if (
      typeof a.id !== 'string' ||
      ids.has(a.id) ||
      typeof a.name !== 'string' ||
      typeof a.muted !== 'boolean' ||
      !Number.isFinite(a.weight) ||
      a.weight < 0 ||
      a.weight > 1
    )
      throw Error('Lớp sửa không hợp lệ.');
    ids.add(a.id);
    validateProject(
      {
        ...base,
        duration: p.duration,
        loop: p.loop,
        keys: a.id === l.activeLayer ? p.keys : a.keys,
        ikModes: a.id === l.activeLayer ? p.ikModes : a.ikModes,
        ikOptions: a.id === l.activeLayer ? p.ikOptions : a.ikOptions,
      },
      r,
    );
  }
  if (!ids.has(l.activeLayer)) throw Error('Lớp sửa đang chọn không tồn tại.');
  const clipIds = new Set();
  for (const c of l.clips) {
    if (
      typeof c.id !== 'string' ||
      clipIds.has(c.id) ||
      ![c.start, c.length, c.sourceStart, c.sourceLength, c.speed, c.fade].every(Number.isFinite) ||
      c.start < 0 ||
      c.length <= 0 ||
      c.start + c.length > p.duration + 1e-7 ||
      c.sourceStart < 0 ||
      c.sourceLength <= 0 ||
      c.sourceStart + c.sourceLength > base.duration + 1e-7 ||
      c.speed <= 0 ||
      c.speed > 16 ||
      c.fade < 0 ||
      c.fade > c.length ||
      typeof c.loop !== 'boolean' ||
      typeof c.reverse !== 'boolean'
    )
      throw Error('Clip Animation Lab không hợp lệ.');
    clipIds.add(c.id);
  }
  for (const m of l.markers)
    if (typeof m.name !== 'string' || !Number.isFinite(m.time) || m.time < 0 || m.time > p.duration)
      throw Error('Marker không hợp lệ.');
  for (const x of l.pins)
    if (
      !r.chains.some((c) => 'ik_' + c.id === x.id) ||
      typeof x.position !== 'boolean' ||
      typeof x.rotation !== 'boolean' ||
      !Array.isArray(x.p) ||
      x.p.length !== 3 ||
      !Array.isArray(x.q) ||
      x.q.length !== 4 ||
      ![x.start, x.end, ...x.p, ...x.q].every(Number.isFinite) ||
      x.start < 0 ||
      x.end > p.duration ||
      x.start > x.end
    )
      throw Error('Điểm ghim không hợp lệ.');
}
