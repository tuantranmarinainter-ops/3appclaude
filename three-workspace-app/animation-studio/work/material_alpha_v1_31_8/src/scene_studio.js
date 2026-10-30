// Scene contract: placements are metres, editor Z-up; model transforms remain native.
export const clone = (v) => structuredClone(v);
const fail = (m) => {
    throw Error(m);
  },
  eps = 1e-7;
const finite = (v, label) => (Number.isFinite(v) ? v : fail(label + ' phải hữu hạn.'));
const identity = (v, label = 'ID') =>
  typeof v === 'string' &&
  /^[A-Za-z0-9_-]{1,100}$/.test(v) &&
  !['__proto__', 'prototype', 'constructor'].includes(v)
    ? v
    : fail(label + ' không hợp lệ.');
const text = (v, label, max = 120) =>
  typeof v === 'string' && v.length <= max ? v : fail(label + ' không hợp lệ.');
const one = (v, values, label) => (values.includes(v) ? v : fail(label + ' không hợp lệ.'));
const list = (v, max, label) =>
  Array.isArray(v) && v.length <= max ? v : fail(label + ' vượt giới hạn hoặc sai kiểu.');
const unique = (xs, label) => {
  const s = new Set();
  for (const x of xs) {
    identity(x?.id, label);
    if (s.has(x.id)) fail(label + ' trùng ID: ' + x.id);
    s.add(x.id);
  }
};
const vec = (v, n, label) => {
  if (!Array.isArray(v) || v.length !== n || !v.every(Number.isFinite))
    fail(label + ' không hợp lệ.');
  return [...v];
};
const bool = (v, label) => (typeof v === 'boolean' ? v : fail(label + ' phải là boolean.'));
const policies = ['baked', 'in-place', 'bbs-path'],
  kinds = ['pose', 'contact', 'reaction', 'land', 'grab', 'release'];
export function minecraftRotation(degrees) {
  const [x, y, z] = degrees.map((v) => (v * Math.PI) / 360),
    sx = Math.sin(x),
    sy = Math.sin(y),
    sz = Math.sin(z),
    cx = Math.cos(x),
    cy = Math.cos(y),
    cz = Math.cos(z),
    qx = sx * cy * cz + cx * sy * sz,
    qy = cx * sy * cz - sx * cy * sz,
    qz = cx * cy * sz + sx * sy * cz,
    qw = cx * cy * cz - sx * sy * sz,
    X = qx,
    Y = qz,
    Z = -qy,
    W = qw,
    m11 = 1 - 2 * (Y * Y + Z * Z),
    m12 = 2 * (X * Y - Z * W),
    m13 = 2 * (X * Z + Y * W),
    m22 = 1 - 2 * (X * X + Z * Z),
    m23 = 2 * (Y * Z - X * W),
    m32 = 2 * (Y * Z + X * W),
    m33 = 1 - 2 * (X * X + Y * Y),
    ey = Math.asin(Math.max(-1, Math.min(1, m13))),
    ex = Math.abs(m13) < 0.9999999 ? Math.atan2(-m23, m33) : Math.atan2(m32, m22),
    ez = Math.abs(m13) < 0.9999999 ? Math.atan2(-m12, m11) : 0;
  return {
    rotationDegrees: [ex, ey, ez].map((v) => (v * 180) / Math.PI),
    rotationQuaternion: [X, Y, Z, W],
  };
}
export function placement(v = {}) {
  const value = {
    position: vec(v.position ?? [0, 0, 0], 3, 'Vị trí'),
    rotation: vec(v.rotation ?? [0, 0, 0], 3, 'Góc quay'),
    scale: finite(v.scale ?? 1, 'Tỷ lệ'),
  };
  if (value.scale <= 0 || value.scale > 100) fail('Tỷ lệ ngoài (0,100].');
  return value;
}
export function create({ name = 'Cảnh mới', duration = 10, fps = 30 } = {}) {
  const s = {
    type: 'animation-studio-scene',
    version: 1,
    coordinateSystem: 'blender-z-up',
    name,
    duration,
    fps,
    actors: [],
    markers: [],
    contacts: [],
    library: { motions: [], poses: [], rigProfiles: [], templates: [] },
    settings: { minecraftTickRate: 20, rootMotion: 'baked', blockSizeMeters: 1 },
    revision: 0,
  };
  return validate(s);
}
export const actor = (s, id) =>
  s.actors.find((a) => a.id === id) || fail('Không tìm thấy actor: ' + id);
export const motion = (s, id) =>
  s.library.motions.find((m) => m.id === id) || fail('Không tìm thấy nguồn clip: ' + id);
const findClip = (s, actorId, clipId) =>
  actor(s, actorId).clips.find((c) => c.id === clipId) || fail('Không tìm thấy clip: ' + clipId);
function checkClip(s, a, c) {
  identity(c.id, 'Clip ID');
  identity(c.sourceId, 'Source ID');
  text(c.name, 'Tên clip');
  for (const k of ['start', 'length', 'sourceStart', 'sourceLength', 'speed', 'fade'])
    finite(c[k], k);
  if (
    c.start < 0 ||
    c.length <= 0 ||
    c.start + c.length > s.duration + eps ||
    c.sourceStart < 0 ||
    c.sourceLength <= 0 ||
    c.speed <= 0 ||
    c.speed > 16 ||
    c.fade < 0 ||
    c.fade > c.length
  )
    fail('Clip vượt timeline hoặc sai khoảng nguồn.');
  bool(c.loop, 'Loop');
  bool(c.reverse, 'Reverse');
  one(c.align, ['continue', 'origin'], 'Căn nối');
  one(c.rootMotion, policies, 'Root motion');
  const m = motion(s, c.sourceId);
  if (a.rigFingerprint !== m.rigFingerprint) fail('Clip khác rig; cần mapping đã xác nhận.');
  if (c.sourceStart + c.sourceLength > m.duration + eps) fail('Đoạn clip vượt thời lượng nguồn.');
}
function checkMarker(s, m) {
  identity(m.id, 'Marker ID');
  text(m.label, 'Tên mốc');
  finite(m.time, 'Thời gian mốc');
  if (m.time < 0 || m.time > s.duration + eps) fail('Mốc ngoài cảnh.');
  one(m.kind, kinds, 'Loại mốc');
  bool(m.locked, 'Khóa mốc');
  list(m.bindings, 64, 'Liên kết mốc');
  const seen = new Set();
  for (const b of m.bindings) {
    const c = findClip(s, b.actorId, b.clipId),
      key = b.actorId + ':' + b.clipId;
    if (seen.has(key)) fail('Mốc trùng liên kết clip.');
    seen.add(key);
    finite(b.localTime, 'Thời gian cục bộ');
    if (b.localTime < 0 || b.localTime > c.length + eps) fail('Mốc ngoài clip liên kết.');
  }
}
function checkContact(s, c) {
  identity(c.id, 'Contact ID');
  if (!s.markers.some((m) => m.id === c.markerId)) fail('Contact tham chiếu mốc không tồn tại.');
  const src = actor(s, c.source?.actorId),
    dst = actor(s, c.target?.actorId);
  identity(c.source.boneId, 'Bone nguồn');
  identity(c.target.boneId, 'Bone đích');
  if (src.id === dst.id) fail('Contact cần hai actor khác nhau.');
  for (const k of ['start', 'end', 'strength']) finite(c[k], k);
  if (
    c.start < 0 ||
    c.end < c.start ||
    c.end > s.duration + eps ||
    c.strength < 0 ||
    c.strength > 1
  )
    fail('Khoảng contact không hợp lệ.');
  one(c.mode, ['position', 'position-rotation'], 'Contact mode');
}
export function validate(input) {
  if (!input || input.type !== 'animation-studio-scene' || input.version !== 1)
    fail('Không phải dự án cảnh phiên bản 1.');
  const s = clone(input);
  s.coordinateSystem ??= 'blender-z-up';
  one(s.coordinateSystem, ['blender-z-up'], 'Hệ trục');
  text(s.name, 'Tên cảnh');
  finite(s.duration, 'Thời lượng');
  if (
    s.duration < 0.1 ||
    s.duration > 300 ||
    ![24, 30, 60, 120].includes(s.fps) ||
    Math.ceil(s.duration * s.fps) > 36000
  )
    fail('Cảnh dài 0.1–300 giây; FPS 24/30/60/120.');
  if (!Number.isSafeInteger(s.revision) || s.revision < 0) fail('Revision không hợp lệ.');
  for (const [k, max] of [
    ['actors', 32],
    ['markers', 512],
    ['contacts', 512],
  ]) {
    list(s[k], max, k);
    unique(s[k], k);
  }
  if (!s.library) fail('Thiếu thư viện.');
  for (const k of ['motions', 'poses', 'rigProfiles', 'templates']) {
    list(s.library[k], 512, k);
    unique(s.library[k], k);
    for (const item of s.library[k]) {
      text(item.name, 'Tên thư viện');
      list(item.tags, 32, 'Tags');
      item.tags.forEach((v) => text(v, 'Tag', 40));
    }
  }
  for (const m of s.library.motions) {
    text(m.rigFingerprint, 'Rig nguồn', 100);
    finite(m.duration, 'Thời lượng nguồn');
    if (m.duration <= 0 || m.duration > 300) fail('Thời lượng nguồn không hợp lệ.');
    if (
      !m.project ||
      m.project.type !== 'animation-studio' ||
      m.project.rig?.fingerprint !== m.rigFingerprint ||
      m.project.duration !== m.duration
    )
      fail('Project nguồn không khớp rig/thời lượng.');
  }
  for (const p of s.library.poses) {
    text(p.rigFingerprint, 'Rig pose', 100);
    if (
      !p.data ||
      typeof p.data !== 'object' ||
      Array.isArray(p.data) ||
      Object.keys(p.data).length > 2048
    )
      fail('Pose không hợp lệ.');
    for (const [id, v] of Object.entries(p.data)) {
      identity(id, 'Pose bone');
      vec(v.p, 3, 'Pose position');
      vec(v.q, 4, 'Pose quaternion');
      vec(v.s, 3, 'Pose scale');
      if (v.q.reduce((n, v) => n + v * v, 0) < 1e-12) fail('Quaternion pose bằng 0.');
    }
  }
  for (const p of s.library.rigProfiles) {
    text(p.rigFingerprint, 'Rig profile', 100);
    one(p.units, ['m', 'cm'], 'Đơn vị profile');
    list(p.bones, 2048, 'Bones profile');
    unique(p.bones, 'Profile bone');
    for (const b of p.bones) {
      text(b.name, 'Tên bone', 200);
      if (b.parent !== null && !p.bones.some((x) => x.id === b.parent))
        fail('Parent profile không tồn tại.');
    }
  }
  for (const t of s.library.templates) {
    list(t.clips || [], 512, 'Template clips');
    unique(t.clips || [], 'Template clip');
    for (const c of t.clips || []) {
      identity(c.role, 'Vai mẫu');
      motion(s, c.sourceId);
      for (const key of ['start', 'length', 'sourceStart', 'sourceLength', 'speed', 'fade'])
        finite(c[key], key);
      if (
        c.start < 0 ||
        c.length <= 0 ||
        c.sourceStart < 0 ||
        c.sourceLength <= 0 ||
        c.sourceStart + c.sourceLength > motion(s, c.sourceId).duration + eps ||
        c.speed <= 0 ||
        c.speed > 16 ||
        c.fade < 0 ||
        c.fade > c.length
      )
        fail('Clip mẫu không hợp lệ.');
    }
    list(t.markers || [], 512, 'Template markers');
    unique(t.markers || [], 'Template marker');
    for (const m of t.markers || []) {
      finite(m.time, 'Mốc mẫu');
      if (m.time < 0) fail('Mốc mẫu âm.');
      text(m.label, 'Nhãn mốc mẫu');
      one(m.kind, kinds, 'Loại mốc mẫu');
      for (const b of m.bindings || []) {
        const c = (t.clips || []).find((c) => c.id === b.clipId);
        if (!c || !Number.isFinite(b.localTime) || b.localTime < 0 || b.localTime > c.length + eps)
          fail('Liên kết mốc mẫu không hợp lệ.');
      }
    }
  }
  const slots = new Set();
  for (const a of s.actors) {
    text(a.name, 'Tên actor');
    one(a.slot, ['A', 'B', 'external'], 'Slot');
    if (a.slot !== 'external') {
      if (slots.has(a.slot)) fail('Hai actor trùng slot chỉnh.');
      slots.add(a.slot);
    }
    text(a.rigFingerprint, 'Rig fingerprint', 100);
    text(a.profile, 'Profile', 100);
    one(a.units, ['cm', 'm'], 'Đơn vị');
    a.transform = placement(a.transform);
    for (const k of ['visible', 'locked', 'muted']) bool(a[k], k);
    list(a.clips, 512, 'Clips');
    unique(a.clips, 'Clip');
    a.clips.forEach((c) => checkClip(s, a, c));
  }
  s.markers.forEach((m) => checkMarker(s, m));
  s.contacts.forEach((c) => checkContact(s, c));
  if (
    !s.settings ||
    s.settings.minecraftTickRate !== 20 ||
    !policies.includes(s.settings.rootMotion) ||
    s.settings.blockSizeMeters !== 1
  )
    fail('Thiết lập cảnh cần 20 tick/s và 1 mét/block.');
  return s;
}
function commit(s, fn) {
  const next = clone(s),
    value = fn(next);
  validate(next);
  next.revision = s.revision + 1;
  Object.assign(s, next);
  return value?.id
    ? s.actors.find((x) => x.id === value.id) ||
        s.markers.find((x) => x.id === value.id) ||
        s.contacts.find((x) => x.id === value.id) ||
        Object.values(s.library)
          .flat()
          .find((x) => x.id === value.id) ||
        value
    : value;
}
export function addActor(s, input = {}) {
  return commit(s, (n) => {
    const id = identity(input.id || 'actor' + (n.actors.length + 1), 'Actor ID');
    if (n.actors.some((a) => a.id === id)) fail('Actor ID đã tồn tại.');
    const a = {
      id,
      name: input.name || id,
      slot: input.slot || 'A',
      rigFingerprint: input.rigFingerprint || '',
      profile: input.profile || '',
      units: input.units || 'cm',
      transform: placement(input.transform),
      visible: true,
      locked: false,
      muted: false,
      clips: [],
    };
    n.actors.push(a);
    return a;
  });
}
export function setActor(s, actorId, patch) {
  return commit(s, (n) => {
    const a = actor(n, actorId);
    if (a.locked && (patch.transform || patch.name || patch.units))
      fail('Mở khóa actor trước khi sửa.');
    if (patch.transform) a.transform = placement(patch.transform);
    for (const k of ['name', 'visible', 'locked', 'muted', 'units'])
      if (patch[k] !== undefined) a[k] = patch[k];
    return a;
  });
}
export function addClip(s, actorId, input = {}) {
  return commit(s, (n) => {
    const a = actor(n, actorId);
    if (a.locked) fail('Actor đang khóa.');
    const m = motion(n, input.sourceId),
      c = {
        id: input.id || actorId + '-clip' + (a.clips.length + 1),
        sourceId: m.id,
        name: input.name || m.name,
        start: input.start ?? 0,
        length: input.length ?? m.duration,
        sourceStart: input.sourceStart ?? 0,
        sourceLength: input.sourceLength ?? m.duration,
        speed: input.speed ?? 1,
        loop: input.loop ?? false,
        reverse: input.reverse ?? false,
        fade: input.fade ?? 0,
        align: input.align ?? 'continue',
        rootMotion: input.rootMotion ?? n.settings.rootMotion,
      };
    a.clips.push(c);
    a.clips.sort((x, y) => x.start - y.start || x.id.localeCompare(y.id));
    return c;
  });
}
export function moveClip(s, actorId, clipId, patch = {}) {
  return commit(s, (n) => {
    const a = actor(n, actorId),
      c = findClip(n, actorId, clipId);
    if (a.locked) fail('Actor đang khóa.');
    for (const k of [
      'start',
      'length',
      'speed',
      'sourceStart',
      'sourceLength',
      'fade',
      'align',
      'rootMotion',
      'loop',
      'reverse',
    ])
      if (patch[k] !== undefined) c[k] = patch[k];
    if (
      n.markers.some(
        (m) => m.locked && m.bindings.some((b) => b.actorId === actorId && b.clipId === clipId),
      ) &&
      JSON.stringify(c) !== JSON.stringify(findClip(s, actorId, clipId))
    )
      fail('Clip có mốc khóa.');
    a.clips.sort((x, y) => x.start - y.start);
    return c;
  });
}
export function deleteClip(s, actorId, clipId) {
  return commit(s, (n) => {
    const a = actor(n, actorId);
    if (a.locked) fail('Actor đang khóa.');
    if (n.markers.some((m) => m.bindings.some((b) => b.actorId === actorId && b.clipId === clipId)))
      fail('Bỏ liên kết mốc trước khi xóa clip.');
    findClip(n, actorId, clipId);
    a.clips = a.clips.filter((c) => c.id !== clipId);
  });
}
export function sampleClip(c, time) {
  if (time < c.start - eps || time > c.start + c.length + eps) return null;
  let p = Math.max(0, time - c.start) * c.speed;
  p = c.loop ? p % c.sourceLength : Math.min(p, c.sourceLength);
  return {
    ...c,
    time: c.sourceStart + (c.reverse ? c.sourceLength - p : p),
    weight: c.fade ? Math.max(0, Math.min(1, (time - c.start) / c.fade)) : 1,
  };
}
export function evaluate(s, actorId, time) {
  finite(time, 'Thời gian');
  const a = actor(s, actorId),
    sorted = [...a.clips].sort((x, y) => x.start - y.start || x.id.localeCompare(y.id)),
    active = sorted.filter((c) => time >= c.start - eps && time <= c.start + c.length + eps),
    primary = active.at(-1);
  let p = primary ? sampleClip(primary, time) : null,
    previous = active.length > 1 ? sampleClip(active.at(-2), time) : null;
  if (!p) {
    const last = sorted.filter((c) => c.start + c.length < time).at(-1);
    if (last) p = sampleClip(last, last.start + last.length);
  }
  if (primary && !previous && primary.fade > 0 && time < primary.start + primary.fade) {
    const prev = sorted.filter((c) => c.start < primary.start).at(-1);
    if (prev) previous = sampleClip(prev, Math.min(time, prev.start + prev.length));
  }
  return {
    actorId,
    time,
    primary: p,
    previous,
    transform: clone(a.transform),
    visible: a.visible && !a.muted,
  };
}
export function addMarker(s, input = {}) {
  return commit(s, (n) => {
    const m = {
      id: input.id || 'marker' + (n.markers.length + 1),
      label: input.label || 'Mốc',
      time: input.time ?? 0,
      kind: input.kind || 'pose',
      locked: input.locked ?? false,
      bindings: clone(input.bindings || []),
    };
    n.markers.push(m);
    n.markers.sort((a, b) => a.time - b.time);
    return m;
  });
}
export function retimeMarker(s, markerId, time) {
  return commit(s, (n) => {
    const m = n.markers.find((x) => x.id === markerId) || fail('Không tìm thấy mốc.');
    if (m.locked) fail('Mốc đang khóa.');
    finite(time, 'Thời gian');
    const delta = time - m.time,
      changed = new Set();
    for (const b of m.bindings) {
      const a = actor(n, b.actorId),
        c = findClip(n, b.actorId, b.clipId);
      if (a.locked) fail('Actor liên kết đang khóa.');
      c.start += delta;
      changed.add(a.id + ':' + c.id);
    }
    for (const other of n.markers) {
      if (other.id === m.id) continue;
      const bindings = other.bindings.filter((b) => changed.has(b.actorId + ':' + b.clipId));
      if (bindings.length) {
        if (other.locked || bindings.length !== other.bindings.length)
          fail('Mốc khác giữ clip; cần bỏ liên kết trước.');
        other.time += delta;
        for (const c of n.contacts.filter((c) => c.markerId === other.id)) {
          c.start += delta;
          c.end += delta;
        }
      }
    }
    for (const c of n.contacts.filter((c) => c.markerId === m.id)) {
      c.start += delta;
      c.end += delta;
    }
    m.time = time;
    n.markers.sort((a, b) => a.time - b.time);
    return m;
  });
}
export function setMarker(s, markerId, patch) {
  return commit(s, (n) => {
    const m = n.markers.find((x) => x.id === markerId) || fail('Không tìm thấy mốc.');
    if (m.locked && (patch.bindings || patch.time !== undefined)) fail('Mốc đang khóa.');
    for (const k of ['label', 'kind', 'locked', 'bindings'])
      if (patch[k] !== undefined) m[k] = clone(patch[k]);
    return m;
  });
}
export function addContact(s, input = {}) {
  return commit(s, (n) => {
    const c = {
      id: input.id || 'contact' + (n.contacts.length + 1),
      markerId: input.markerId,
      source: clone(input.source),
      target: clone(input.target),
      start: input.start,
      end: input.end,
      mode: input.mode || 'position',
      strength: input.strength ?? 1,
    };
    n.contacts.push(c);
    return c;
  });
}
export function addLibraryItem(s, kind, item) {
  return commit(s, (n) => {
    if (!['motions', 'poses', 'rigProfiles', 'templates'].includes(kind))
      fail('Loại thư viện không hợp lệ.');
    if (n.library[kind].some((x) => x.id === item.id)) fail('Mục thư viện đã tồn tại.');
    const v = {
      ...clone(item),
      name: item.name || item.id,
      tags: [...new Set(item.tags || [])].slice(0, 32),
    };
    n.library[kind].push(v);
    return v;
  });
}
export function applyTemplate(s, templateId, bindings = {}) {
  return commit(s, (n) => {
    const t = n.library.templates.find((t) => t.id === templateId) || fail('Không tìm thấy mẫu.');
    const prefix = 'tpl' + (n.revision + 1) + '-',
      roleMap = {};
    for (const [role, aid] of Object.entries(bindings)) roleMap[role] = actor(n, aid);
    const clipMap = {};
    for (const spec of t.clips || []) {
      const a = roleMap[spec.role] || fail('Thiếu actor cho vai ' + spec.role),
        m = motion(n, spec.sourceId);
      if (m.rigFingerprint !== a.rigFingerprint) fail('Mẫu khác rig; cần đổi nguồn phù hợp.');
      const c = { ...clone(spec), id: prefix + spec.id, sourceId: m.id };
      delete c.role;
      const result = addClip(n, a.id, c);
      clipMap[spec.id] = { actorId: a.id, clipId: result.id };
    }
    for (const spec of t.markers || []) {
      addMarker(n, {
        ...clone(spec),
        id: prefix + spec.id,
        bindings: (spec.bindings || []).map((b) => ({
          ...clipMap[b.clipId],
          localTime: b.localTime,
        })),
      });
    }
    return n;
  });
}
export function operation(s, name, args = {}) {
  const next = validate(s);
  const calls = {
    add_actor: () => addActor(next, args),
    set_actor: () => setActor(next, args.actorId, args),
    add_clip: () => addClip(next, args.actorId, args),
    move_clip: () => moveClip(next, args.actorId, args.clipId, args),
    delete_clip: () => deleteClip(next, args.actorId, args.clipId),
    add_marker: () => addMarker(next, args),
    set_marker: () => setMarker(next, args.markerId, args),
    retime_marker: () => retimeMarker(next, args.markerId, args.time),
    add_contact: () => addContact(next, args),
    add_library_item: () => addLibraryItem(next, args.kind, args.item),
    apply_template: () => applyTemplate(next, args.templateId, args.bindings),
  };
  if (!calls[name]) fail('Thao tác cảnh không hỗ trợ.');
  calls[name]();
  return validate(next);
}
export function summary(s) {
  return {
    type: s.type,
    version: s.version,
    name: s.name,
    duration: s.duration,
    fps: s.fps,
    coordinateSystem: s.coordinateSystem,
    revision: s.revision,
    actors: s.actors.map(({ studio, ...a }) => clone(a)),
    markers: clone(s.markers),
    contacts: clone(s.contacts),
    library: Object.fromEntries(
      Object.entries(s.library).map(([k, items]) => [
        k,
        items.map(({ project, data, asset, ...m }) => clone(m)),
      ]),
    ),
    settings: clone(s.settings),
  };
}
export function manifest(s, files = {}, paths = {}) {
  validate(s);
  return {
    type: 'animation-studio-bbs-package',
    version: 2,
    coordinateSystem: 'minecraft-y-up',
    rotationOrder: 'XYZ',
    scene: { name: s.name, duration: s.duration, fps: s.fps, tickRate: 20, blocksPerMeter: 1 },
    actors: s.actors
      .filter((a) => a.visible && !a.muted)
      .map((a) => ({
        id: a.id,
        name: a.name,
        file: files[a.id],
        textures: files[a.id + ':textures'] || [],
        positionBlocks: [
          a.transform.position[0],
          a.transform.position[2],
          -a.transform.position[1],
        ],
        ...minecraftRotation(a.transform.rotation),
        scaleBaked: a.transform.scale,
        modelUnits: a.units,
        rootMotion: a.clips.map((c) => ({ clipId: c.id, policy: c.rootMotion })),
        path: paths[a.id] || [],
      })),
    markers: clone(s.markers),
    contacts: clone(s.contacts),
    note: 'BOBJ chứa mesh/animation theo mét; scale đã bake. Manifest hỗ trợ đặt actor, không phải định dạng scene native BBS FS. BBS-path cần đường đi ngoài animation.',
  };
}
