// SPDX-License-Identifier: GPL-3.0-or-later
// Minecraft Bedrock animation JSON (*.animation.json) export / import for App 3.
// Format conventions (keyframe layout, `loop` values, pre/post + lerp_mode, ZYX Euler order, sign flip of
// rotation X/Y and position X, 16 pixels per block) follow Blockbench `js/formats/bedrock/bedrock_animation.js`
// at commit ec0b2827104d0799c153bfb5f867579c0c44652f (© JannisX11 and contributors, GPL-3.0-or-later).
// The code below is a new implementation for App 3's key model; see vendor/BLOCKBENCH_PROVENANCE.md.
import * as T from 'three';
import { evaluateMolang } from './molang.js';
import { playMode } from './timeline_tools.js';

export const FORMAT_VERSION = '1.8.0';
const ORDER = 'ZYX', PX = 16, R2D = 180 / Math.PI, D2R = Math.PI / 180;
const SPLINE = new Set(['auto', 'cubic']);
const CHANNELS = { r: 'rotation', p: 'position', s: 'scale' };

export const shortName = (name) => String(name).replace(/^mixamorig[:_]?/i, '');
const canon = (name) => shortName(name).replace(/[^a-z0-9]/gi, '').toLowerCase();
const num = (v) => (Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(6)));
export const timecode = (t) => {
  const s = String(Number(t.toFixed(4)));
  return s.includes('.') ? s : s + '.0';
};
const wrap180 = (d) => {
  const r = ((((d + 180) % 360) + 360) % 360) - 180;
  return Math.abs(r + 180) < 1e-9 && d > 0 ? 180 : r;
};
export function eulerZYX(q) {
  const e = new T.Euler().setFromQuaternion(new T.Quaternion().fromArray(q).normalize(), ORDER);
  return [e.x * R2D, e.y * R2D, e.z * R2D];
}
export function quatZYX(deg) {
  return new T.Quaternion()
    .setFromEuler(new T.Euler(deg[0] * D2R, deg[1] * D2R, deg[2] * D2R, ORDER))
    .toArray();
}
const eulerXYZ = (q) => {
  const e = new T.Euler().setFromQuaternion(new T.Quaternion().fromArray(q).normalize(), 'XYZ');
  return [e.x * R2D, e.y * R2D, e.z * R2D];
};

/** Bones App 3 can export: rig records plus the rig root, each with rest pose and pixel scale. */
export function exportBones(rig) {
  const unit = (object) => {
    const s = new T.Vector3(1, 1, 1);
    object?.parent?.getWorldScale?.(s);
    const m = (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3;
    return PX * (m > 1e-9 ? m : 1);
  };
  const bones = rig.records.map((r) => ({ id: r.id, name: shortName(r.name), rest: r.rest, unit: unit(r.o) }));
  bones.push({ id: 'root', name: 'root', rest: rig.rootRest, unit: unit(rig.root) });
  return bones;
}

// ---- value conversion (App 3 local transform  <->  Bedrock offset from rest) ----
export function toBedrock(path, key, bone) {
  const rest = bone.rest;
  if (path === 'r') {
    const a = eulerZYX(key.q), b = eulerZYX(rest.q);
    const d = a.map((v, i) => wrap180(v - b[i]));
    return [-d[0], -d[1], d[2]];
  }
  if (path === 'p') {
    const d = key.p.map((v, i) => (v - rest.p[i]) * bone.unit);
    return [-d[0], d[1], d[2]];
  }
  const rs = rest.s || [1, 1, 1];
  return (key.s || rs).map((v, i) => (Math.abs(rs[i]) > 1e-9 ? v / rs[i] : v));
}
export function fromBedrock(path, value, bone) {
  const rest = bone.rest;
  if (path === 'r') {
    const b = eulerZYX(rest.q);
    return quatZYX([b[0] - value[0], b[1] - value[1], b[2] + value[2]]);
  }
  if (path === 'p') {
    const d = [-value[0], value[1], value[2]];
    return rest.p.map((v, i) => v + d[i] / bone.unit);
  }
  const rs = rest.s || [1, 1, 1];
  return value.map((v, i) => (Math.abs(rs[i]) > 1e-9 ? v * rs[i] : v));
}

// ---- Molang strings ----
// App 3 stores absolute local values (rotation as XYZ Euler degrees). Bedrock wants offsets from rest, so the
// expression is wrapped in a fixed template that import recognises and unwraps exactly.
const fmt = (v) => String(num(v));
const balanced = (s) => {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
};
function wrapExpression(path, axis, source, bone) {
  if (path === 'r') {
    const c = fmt(eulerXYZ(bone.rest.q)[axis]);
    return axis === 2 ? `(${source}) - ${c}` : `-((${source}) - ${c})`;
  }
  if (path === 'p') {
    const core = `((${source}) - ${fmt(bone.rest.p[axis])}) * ${fmt(bone.unit)}`;
    return axis === 0 ? `-(${core})` : core;
  }
  return `(${source}) / ${fmt((bone.rest.s || [1, 1, 1])[axis] || 1)}`;
}
function unwrapExpression(path, axis, text, bone) {
  const t = text.trim();
  const patterns = path === 'r'
    ? [axis === 2 ? /^\((.*)\) - (-?[\d.e+-]+)$/s : /^-\(\((.*)\) - (-?[\d.e+-]+)\)$/s]
    : path === 'p'
      ? [axis === 0 ? /^-\(\(\((.*)\) - (-?[\d.e+-]+)\) \* (-?[\d.e+-]+)\)$/s : /^\(\((.*)\) - (-?[\d.e+-]+)\) \* (-?[\d.e+-]+)$/s]
      : [/^\((.*)\) \/ (-?[\d.e+-]+)$/s];
  for (const re of patterns) {
    const m = t.match(re);
    if (m && balanced(m[1]) && wrapExpression(path, axis, m[1], bone) === t) return m[1];
  }
  // Foreign expression (e.g. written in Blockbench): convert the Bedrock offset back to App 3's absolute value.
  if (path === 'r') {
    const c = fmt(eulerXYZ(bone.rest.q)[axis]);
    return axis === 2 ? `${c} + (${t})` : `${c} - (${t})`;
  }
  if (path === 'p') {
    const c = fmt(bone.rest.p[axis]), k = fmt(bone.unit);
    return axis === 0 ? `${c} - (${t}) / ${k}` : `${c} + (${t}) / ${k}`;
  }
  return `(${t}) * ${fmt((bone.rest.s || [1, 1, 1])[axis] || 1)}`;
}

// ---- export ----
function needsBake(keys) {
  return keys.some(
    (k) =>
      (k.interp && (k.interp === 'smooth' || k.interp.startsWith('ease:'))) ||
      (k.graph?.channels && Object.keys(k.graph.channels).length),
  );
}
const sameVec = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
function trackValues(path, key, bone) {
  const v = toBedrock(path, key, bone).map(num);
  if (!key.molang) return v;
  return v.map((value, axis) => {
    const source = key.molang[path + axis];
    return typeof source === 'string' && source.trim() ? wrapExpression(path, axis, source, bone) : value;
  });
}

/**
 * Builds a Bedrock animation file object. `sample(keys, time, rest)` returns an App 3 transform (core.sampleKeys);
 * it is used only for tracks Bedrock cannot express (smooth / ease / graph-edited curves), which are baked.
 */
export function exportAnimation(project, rig, { name, sample, fps = project.fps } = {}) {
  const warnings = [];
  const bones = {};
  const id = 'animation.' + (name || project.name || 'animation').toLowerCase().replace(/[^a-z0-9_.]+/g, '_').replace(/^_+|_+$/g, '') ;
  for (const bone of exportBones(rig)) {
    let keys = [...(project.keys[bone.id] || [])].sort((a, b) => a.time - b.time);
    if (!keys.length) continue;
    if (needsBake(keys)) {
      if (typeof sample !== 'function') throw Error('Thiếu hàm lấy mẫu để bake đường cong.');
      const count = Math.max(1, Math.round(project.duration * fps));
      const times = Array.from({ length: count + 1 }, (_, i) => Math.min(project.duration, i / fps));
      const hadMolang = keys.some((k) => k.molang && Object.keys(k.molang).length);
      keys = times.map((time) => ({ ...sample(keys, time, bone.rest), time, interp: 'linear' }));
      warnings.push(
        `Xương ${bone.name}: easing/smooth/đường cong Graph không có trong Bedrock — đã bake ${keys.length} key tuyến tính` +
          (hadMolang ? ' (biểu thức Molang của xương này được chuyển thành số).' : '.'),
      );
    }
    if (keys.some((k) => k.interp === 'cubic'))
      warnings.push(`Xương ${bone.name}: nội suy Cubic xuất thành catmullrom (nhập lại sẽ thành Auto).`);
    if (keys.some((k) => k.molang?.r0 || k.molang?.r1 || k.molang?.r2))
      warnings.push(`Xương ${bone.name}: biểu thức xoay được xuất theo phần chênh với tư thế nghỉ; chính xác khi xương xoay quanh một trục.`);
    const tag = {};
    for (const [path, channel] of Object.entries(CHANNELS)) {
      const values = keys.map((k) => trackValues(path, k, bone));
      const identity = path === 's' ? [1, 1, 1] : [0, 0, 0];
      if (values.every((v) => v.every((x, i) => typeof x === 'number' && Math.abs(x - identity[i]) < 1e-6))) continue;
      const out = {};
      keys.forEach((k, i) => {
        const value = values[i];
        const prevStep = i > 0 && keys[i - 1].interp === 'step';
        const spline = SPLINE.has(k.interp);
        if (prevStep || spline) {
          const entry = {};
          if (prevStep) entry.pre = values[i - 1];
          entry.post = value;
          if (spline) entry.lerp_mode = 'catmullrom';
          out[timecode(k.time)] = entry;
        } else out[timecode(k.time)] = value;
      });
      // Trailing step: the last key holds anyway; a single static linear key compresses to the bare value.
      const codes = Object.keys(out);
      tag[channel] = codes.length === 1 && Array.isArray(out[codes[0]]) && keys[0].time === 0 ? out[codes[0]] : out;
    }
    if (Object.keys(tag).length) bones[bone.name] = tag;
  }
  const mode = playMode(project);
  const animation = {
    loop: mode === 'hold' ? 'hold_on_last_frame' : mode === 'loop',
    animation_length: num(project.duration),
  };
  if (project.startDelay) animation.start_delay = num(project.startDelay);
  if (project.loopDelay && mode === 'loop') animation.loop_delay = num(project.loopDelay);
  if (Object.keys(bones).length) animation.bones = bones;
  return { file: { format_version: FORMAT_VERSION, animations: { [id]: animation } }, name: id, warnings };
}

// ---- import ----
export function listAnimations(json) {
  if (!json || typeof json !== 'object' || !json.animations || typeof json.animations !== 'object')
    throw Error('Không phải tệp animation Bedrock (thiếu "animations").');
  return Object.keys(json.animations);
}
/** Default bone matching by name (mixamorig prefix and punctuation ignored). */
export function matchBones(animation, rig) {
  const bones = exportBones(rig);
  const byCanon = new Map(bones.map((b) => [canon(b.name), b.id]));
  const mapping = {}, unmatched = [];
  for (const name of Object.keys(animation.bones || {})) {
    const id = byCanon.get(canon(name));
    if (id) mapping[name] = id;
    else unmatched.push(name);
  }
  return { mapping, unmatched, bones };
}
function parseTime(code) {
  const t = Number(code);
  if (!Number.isFinite(t) || t < 0) throw Error('Mốc thời gian keyframe không hợp lệ: ' + code);
  return t;
}
function vectorOf(value, path) {
  if (Array.isArray(value)) {
    if (value.length !== 3) throw Error('Giá trị keyframe phải có 3 thành phần.');
    return value;
  }
  if (typeof value === 'number' || typeof value === 'string') return path === 's' ? [value, value, value] : [value, value, value];
  throw Error('Giá trị keyframe không hợp lệ.');
}
function channelKeys(source, path) {
  if (source === undefined) return null;
  if (Array.isArray(source) || typeof source === 'number' || typeof source === 'string')
    return [{ time: 0, value: vectorOf(source, path) }];
  if (typeof source !== 'object') throw Error('Kênh keyframe không hợp lệ.');
  if ('post' in source || 'pre' in source || 'lerp_mode' in source)
    return [{ time: 0, value: vectorOf(source.post ?? source.pre, path), pre: source.pre === undefined ? undefined : vectorOf(source.pre, path), lerp: source.lerp_mode }];
  return Object.entries(source)
    .map(([code, v]) => {
      const time = parseTime(code);
      if (v && typeof v === 'object' && !Array.isArray(v))
        return { time, value: vectorOf(v.post ?? v.pre, path), pre: v.pre === undefined ? undefined : vectorOf(v.pre, path), lerp: v.lerp_mode };
      return { time, value: vectorOf(v, path) };
    })
    .sort((a, b) => a.time - b.time);
}
function numeric(vec, time, variables, fallback) {
  return vec.map((v, i) => {
    if (typeof v === 'number') return v;
    const r = evaluateMolang(String(v), { anim_time: time, life_time: time, variables });
    return !r.error && Number.isFinite(r.value) ? r.value : fallback[i];
  });
}
function sampleChannel(list, time, variables, identity) {
  if (!list?.length) return identity;
  let i = list.findLastIndex((k) => k.time <= time + 1e-9);
  if (i < 0) return numeric(list[0].value, time, variables, identity);
  const a = list[i], b = list[i + 1];
  const av = numeric(a.value, time, variables, identity);
  if (!b) return av;
  const bv = numeric(b.pre ?? b.value, time, variables, identity);
  const u = (time - a.time) / (b.time - a.time);
  return av.map((v, k) => v + (bv[k] - v) * u);
}

/**
 * Converts one Bedrock animation into App 3 keys for the mapped bones.
 * mapping: { bedrockBoneName: app3BoneId } — names left out are skipped.
 */
export function importAnimation(json, rig, { animation: name, mapping, variables = {} } = {}) {
  const names = listAnimations(json);
  const id = name ?? names[0];
  const animation = json.animations[id];
  if (!animation) throw Error('Không có animation "' + id + '" trong tệp.');
  const bones = new Map(exportBones(rig).map((b) => [b.id, b]));
  const map = mapping ?? matchBones(animation, rig).mapping;
  const keys = {}, warnings = [];
  let end = 0;
  for (const [boneName, tag] of Object.entries(animation.bones || {})) {
    const boneId = map[boneName];
    if (!boneId) continue;
    const bone = bones.get(boneId);
    if (!bone) throw Error('Xương đích không tồn tại: ' + boneId);
    if (tag.relative_to) warnings.push(`Xương ${boneName}: bỏ qua relative_to.`);
    const channels = Object.fromEntries(Object.entries(CHANNELS).map(([path, channel]) => [path, channelKeys(tag[channel], path)]));
    const times = [...new Set(Object.values(channels).flatMap((list) => (list || []).map((k) => k.time)))].sort((a, b) => a - b);
    if (!times.length) continue;
    const out = times.map((time) => {
      const key = { time, interp: 'linear' };
      for (const [path, list] of Object.entries(channels)) {
        const identity = path === 's' ? [1, 1, 1] : [0, 0, 0];
        const at = list?.find((k) => Math.abs(k.time - time) < 1e-9);
        const raw = at ? at.value : null;
        const value = raw ? numeric(raw, time, variables, identity) : sampleChannel(list, time, variables, identity);
        const local = fromBedrock(path, value, bone);
        if (path === 'r') key.q = local;
        else key[path] = local;
        if (raw)
          raw.forEach((v, axis) => {
            if (typeof v === 'string') (key.molang ||= {})[path + axis] = unwrapExpression(path, axis, v, bone);
          });
        if (at?.lerp === 'catmullrom') key.interp = 'auto';
      }
      return key;
    });
    // pre !== post on a key means the segment before it was held (step).
    out.forEach((key, i) => {
      if (i === 0) return;
      const stepped = Object.values(channels).some((list) => {
        const at = list?.find((k) => Math.abs(k.time - key.time) < 1e-9);
        return at?.pre && JSON.stringify(at.pre) !== JSON.stringify(at.value);
      });
      if (stepped) out[i - 1].interp = 'step';
    });
    keys[boneId] = out;
    end = Math.max(end, times.at(-1));
  }
  const length = Number(animation.animation_length);
  const duration = Number.isFinite(length) && length > 0 ? length : Math.max(end, 0.1);
  const result = {
    keys,
    duration,
    playMode: animation.loop === 'hold_on_last_frame' ? 'hold' : animation.loop === true ? 'loop' : 'once',
    warnings,
  };
  for (const [field, prop] of [['start_delay', 'startDelay'], ['loop_delay', 'loopDelay']]) {
    const v = animation[field];
    if (v === undefined) continue;
    if (typeof v === 'number' && v >= 0) result[prop] = v;
    else warnings.push(`${field} dạng biểu thức không được hỗ trợ khi xem trước — đã bỏ qua.`);
  }
  for (const field of ['anim_time_update', 'blend_weight', 'override_previous_animation'])
    if (animation[field] !== undefined) warnings.push(`Bỏ qua ${field} (App 3 chưa hỗ trợ).`);
  return result;
}
