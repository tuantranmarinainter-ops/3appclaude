import * as T from 'three';
import * as Tex from './texture_assets.js';
import { decodeDDS, readTexture as readWarcraftTexture } from './warcraft_loader.js';

// Format references: LeagueToolkit/league-toolkit ltk_mesh::skinned and ltk_anim.
const decoder = new TextDecoder('utf-8', { fatal: false });
const viewOf = (input) => {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  return { b, v: new DataView(b.buffer, b.byteOffset, b.byteLength) };
};
const guard = (v, p, n, label) => {
  if (
    !Number.isSafeInteger(p) ||
    !Number.isSafeInteger(n) ||
    p < 0 ||
    n < 0 ||
    p + n > v.byteLength
  )
    throw Error('LoL ' + label + ': dữ liệu thiếu hoặc offset sai.');
  return p;
};
const u16 = (v, p) => v.getUint16(guard(v, p, 2, 'u16'), true),
  i16 = (v, p) => v.getInt16(guard(v, p, 2, 'i16'), true),
  u32 = (v, p) => v.getUint32(guard(v, p, 4, 'u32'), true),
  i32 = (v, p) => v.getInt32(guard(v, p, 4, 'i32'), true);
const f32 = (v, p) => {
  const f = v.getFloat32(guard(v, p, 4, 'f32'), true);
  if (!Number.isFinite(f)) throw Error('LoL: transform không hữu hạn.');
  return f;
};
const vec = (v, p, n = 3) => Array.from({ length: n }, (_, i) => f32(v, p + i * 4));
const str = (b, p, n) =>
  decoder.decode(b.subarray(p, guard({ byteLength: b.length }, p, n, 'string') + n)).split('\0')[0];
const nul = (b, p) => {
  if (p < 0 || p >= b.length) throw Error('LoL SKL: tên xương ngoài file.');
  let end = p;
  while (end < b.length && b[end] && end - p < 256) end++;
  return str(b, p, end - p);
};
const range = (v, p, count, size, max, label) => {
  if (!Number.isInteger(count) || count < 0 || count > max)
    throw Error('LoL ' + label + ': số lượng quá lớn.');
  guard(v, p, count * size, label);
};
export const fnv = (name) => {
  let h = 2166136261;
  for (const byte of new TextEncoder().encode(name.toLowerCase()))
    h = Math.imul(h ^ byte, 16777619);
  return h >>> 0;
};
const elf = (name) => {
  let h = 0;
  for (const byte of new TextEncoder().encode(name.toLowerCase())) {
    h = ((h << 4) + byte) >>> 0;
    const high = h & 0xf0000000;
    if (high) h ^= high >>> 24;
    h &= ~high;
  }
  return h >>> 0;
};
const quat = (v, p) => {
  const q = new T.Quaternion(...vec(v, p, 4));
  if (q.lengthSq() < 1e-12) throw Error('LoL: quaternion rỗng.');
  return q.normalize();
};
const packedQuat = (v, p) => {
  const bits = BigInt(u16(v, p)) | (BigInt(u16(v, p + 2)) << 16n) | (BigInt(u16(v, p + 4)) << 32n),
    idx = Number((bits >> 45n) & 3n);
  const a = [30n, 15n, 0n].map(
    (shift) => (Number((bits >> shift) & 32767n) * Math.SQRT2) / 32767 - Math.SQRT1_2,
  );
  const d = Math.sqrt(Math.max(0, 1 - a.reduce((sum, x) => sum + x * x, 0)));
  a.splice(idx, 0, d);
  return new T.Quaternion(...a).normalize();
};

export function decodeTEX(input) {
  const { b, v } = viewOf(input);
  guard(v, 0, 12, 'TEX');
  if (u32(v, 0) !== 0x00584554) throw Error('LoL TEX: magic sai.');
  const width = u16(v, 4),
    height = u16(v, 6),
    depth = b[8],
    format = b[9],
    kind = b[10],
    flags = b[11];
  if (
    !width ||
    !height ||
    width * height > 16777216 ||
    kind !== 0 ||
    depth > 1 ||
    flags & ~1 ||
    ![0, 1, 3].includes(format)
  )
    throw Error('LoL TEX: cần texture 2D BGRA8/BC1/BC3 hợp lệ.');
  let start = 12;
  if (flags & 1)
    for (let level = Math.floor(Math.log2(Math.max(width, height))); level > 0; level--) {
      const w = Math.max(1, width >> level),
        h = Math.max(1, height >> level);
      start +=
        format === 0 ? w * h * 4 : Math.ceil(w / 4) * Math.ceil(h / 4) * (format === 1 ? 8 : 16);
    }
  const size =
    format === 0
      ? width * height * 4
      : Math.ceil(width / 4) * Math.ceil(height / 4) * (format === 1 ? 8 : 16);
  guard(v, start, size, 'TEX mip0');
  const image = b.subarray(start, start + size);
  if (format === 0) {
    const rgba = new Uint8ClampedArray(size);
    for (let i = 0; i < size; i += 4) {
      rgba[i] = image[i + 2];
      rgba[i + 1] = image[i + 1];
      rgba[i + 2] = image[i];
      rgba[i + 3] = image[i + 3];
    }
    return new ImageData(rgba, width, height);
  }
  const dds = new Uint8Array(128 + size),
    dv = new DataView(dds.buffer);
  dds.set([68, 68, 83, 32], 0);
  dv.setUint32(4, 124, true);
  dv.setUint32(8, 0x1007, true);
  dv.setUint32(12, height, true);
  dv.setUint32(16, width, true);
  dv.setUint32(20, size, true);
  dv.setUint32(76, 32, true);
  dv.setUint32(80, 4, true);
  dds.set(format === 1 ? [68, 88, 84, 49] : [68, 88, 84, 53], 84);
  dv.setUint32(108, 0x1000, true);
  dds.set(image, 128);
  return decodeDDS(dds.buffer);
}
export async function readTexture(file) {
  if (!/\.tex$/i.test(file.name)) return readWarcraftTexture(file);
  if (file.size > 32 * 1024 * 1024) throw Error('LoL TEX: vượt 32 MB.');
  const pixels = decodeTEX(await file.arrayBuffer()),
    canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext('2d').putImageData(pixels, 0, 0);
  return { name: file.webkitRelativePath || file.name, data: canvas.toDataURL('image/png') };
}

export function parseSKL(input) {
  const { b, v } = viewOf(input);
  guard(v, 0, 64, 'SKL');
  if (u32(v, 4) !== 0x22fd4fc3) throw Error('LoL SKL: cần skeleton hiện đại (token 0x22FD4FC3).');
  if (u32(v, 8) !== 0) throw Error('LoL SKL: phiên bản chưa hỗ trợ.');
  const count = u16(v, 14),
    ic = u32(v, 16),
    jp = i32(v, 20),
    ip = i32(v, 28);
  range(v, jp, count, 100, 2048, 'SKL joints');
  range(v, ip, ic, 2, 65536, 'SKL influences');
  const joints = [];
  for (let i = 0; i < count; i++) {
    const p = jp + i * 100,
      id = i16(v, p + 2),
      parent = i16(v, p + 4),
      np = p + 96 + i32(v, p + 96),
      name = nul(b, np);
    if (!name || name.length > 128) throw Error('LoL SKL: tên joint rỗng hoặc quá dài.');
    const q = quat(v, p + 40),
      iq = quat(v, p + 80);
    joints.push({
      id,
      parent,
      name,
      hash: u32(v, p + 8),
      p: vec(v, p + 16),
      s: vec(v, p + 28),
      q: q.toArray(),
      inverse: new T.Matrix4().compose(
        new T.Vector3(...vec(v, p + 56)),
        iq,
        new T.Vector3(...vec(v, p + 68)),
      ),
    });
  }
  const ids = new Map(joints.map((j, i) => [j.id, i]));
  if (ids.size !== joints.length) throw Error('LoL SKL: trùng ID joint.');
  for (const j of joints)
    if (j.parent !== -1 && !ids.has(j.parent))
      throw Error('LoL SKL: thiếu parent ' + j.parent + '.');
  const influences = Array.from({ length: ic }, (_, i) => {
    const id = i16(v, ip + i * 2);
    return ids.has(id) ? ids.get(id) : id >= 0 && id < count ? id : -1;
  });
  if (influences.some((i) => i < 0 || i >= count))
    throw Error('LoL SKL: influence ngoài danh sách joint.');
  return { joints, influences, name: i32(v, 32) > 0 ? nul(b, i32(v, 32)) : 'LoL' };
}

export function parseSKN(input) {
  const { b, v } = viewOf(input);
  guard(v, 0, 16, 'SKN');
  if (u32(v, 0) !== 0x00112233) throw Error('LoL SKN: magic sai.');
  const major = u16(v, 4),
    minor = u16(v, 6);
  if (![0, 1, 2, 4].includes(major) || minor !== 1)
    throw Error('LoL SKN: phiên bản ' + major + '.' + minor + ' chưa hỗ trợ.');
  let p = 8,
    flags = 0,
    ranges = [];
  if (major) {
    const n = u32(v, p);
    p += 4;
    range(v, p, n, 80, 512, 'SKN submesh');
    for (let i = 0; i < n; i++) {
      const r = p + i * 80;
      ranges.push({
        name: str(b, r, 64) || 'Material ' + i,
        startVertex: i32(v, r + 64),
        vertexCount: i32(v, r + 68),
        startIndex: i32(v, r + 72),
        indexCount: i32(v, r + 76),
      });
    }
    p += n * 80;
  }
  if (major === 4) {
    flags = u32(v, p);
    p += 4;
  }
  const ni = u32(v, p),
    nv = u32(v, p + 4);
  p += 8;
  range(v, 0, ni, 2, 3000000, 'SKN indices');
  range(v, 0, nv, 52, 1000000, 'SKN vertices');
  let stride = 52,
    type = 0;
  if (major === 4) {
    stride = u32(v, p);
    type = u32(v, p + 4);
    p += 8;
    const sizes = [52, 56, 72, 104];
    if (stride !== sizes[type]) throw Error('LoL SKN: vertex type/size chưa hỗ trợ.');
    p += 40;
  }
  if (!major)
    ranges = [{ name: 'Base', startVertex: 0, vertexCount: nv, startIndex: 0, indexCount: ni }];
  if (flags & 1) {
    const size = u16(v, p);
    p += 2;
    guard(v, p, size, 'SKN direct blend block');
    p += size;
  }
  const indexStart = p;
  range(v, p, ni, 2, 3000000, 'SKN indices');
  p += ni * 2;
  range(v, p, nv, stride, 1000000, 'SKN vertices');
  const vertexStart = p;
  const indices = new Uint32Array(ni);
  for (const r of ranges) {
    if (
      r.startVertex < 0 ||
      r.vertexCount <= 0 ||
      r.startVertex + r.vertexCount > nv ||
      r.startIndex < 0 ||
      r.indexCount < 0 ||
      r.startIndex + r.indexCount > ni ||
      r.indexCount % 3
    )
      throw Error('LoL SKN: submesh range sai.');
    for (let j = r.startIndex; j < r.startIndex + r.indexCount; j++) {
      const raw = u16(v, indexStart + j * 2),
        actual = flags & 2 ? r.startVertex + raw : raw;
      if (actual < r.startVertex || actual >= r.startVertex + r.vertexCount)
        throw Error('LoL SKN: index ngoài submesh ' + r.name + '.');
      indices[j] = actual;
    }
  }
  const pos = new Float32Array(nv * 3),
    normal = new Float32Array(nv * 3),
    uv = new Float32Array(nv * 2),
    blend = new Uint8Array(nv * 4),
    weights = new Float32Array(nv * 4);
  for (let i = 0; i < nv; i++) {
    const at = vertexStart + i * stride;
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = f32(v, at + k * 4);
      normal[i * 3 + k] = f32(v, at + 32 + k * 4);
    }
    for (let k = 0; k < 2; k++) uv[i * 2 + k] = f32(v, at + 44 + k * 4);
    for (let k = 0; k < 4; k++) {
      blend[i * 4 + k] = b[at + 12 + k];
      weights[i * 4 + k] = f32(v, at + 16 + k * 4);
    }
  }
  return { major, flags, ranges, indices, pos, normal, uv, blend, weights };
}

function compressed(input) {
  const { v } = viewOf(input),
    version = u32(v, 8);
  if (![1, 2, 3].includes(version)) throw Error('LoL ANM nén: phiên bản chưa hỗ trợ.');
  guard(v, 0, 128, 'ANM nén');
  const flags = u32(v, 20),
    jointCount = u32(v, 24),
    frameCount = u32(v, 28),
    cacheCount = i32(v, 32),
    duration = f32(v, 36),
    fps = f32(v, 40);
  range(v, 0, jointCount, 4, 2048, 'ANM joints');
  range(v, 0, frameCount, 10, 2000000, 'ANM frames');
  if (
    cacheCount < 0 ||
    cacheCount > 65536 ||
    duration <= 0 ||
    duration > 300 ||
    fps <= 0 ||
    fps > 240
  )
    throw Error('LoL ANM: thời lượng/FPS/cache sai.');
  const tm = vec(v, 68),
    tx = vec(v, 80),
    sm = vec(v, 92),
    sx = vec(v, 104),
    framesOff = i32(v, 116) + 12,
    cacheOff = i32(v, 120) + 12,
    hashOff = i32(v, 124) + 12;
  range(v, hashOff, jointCount, 4, 2048, 'ANM hashes');
  range(v, framesOff, frameCount, 10, 2000000, 'ANM frames');
  range(
    v,
    cacheOff,
    cacheCount * jointCount,
    frameCount < 65537 ? 24 : 48,
    134217728,
    'ANM jump cache',
  );
  const hashes = Array.from({ length: jointCount }, (_, i) => u32(v, hashOff + i * 4));
  const sets = hashes.map(() => ({ p: [], q: [], s: [] }));
  const mins = { p: tm, s: sm },
    maxs = { p: tx, s: sx };
  for (let i = 0; i < frameCount; i++) {
    const p = framesOff + i * 10,
      t = (u16(v, p) / 65535) * duration,
      code = u16(v, p + 2),
      joint = code & 0x3fff,
      kind = code >>> 14,
      key = ['q', 'p', 's'][kind];
    if (joint >= jointCount || !key) throw Error('LoL ANM: joint/type frame sai.');
    const value =
      key === 'q'
        ? packedQuat(v, p + 4).toArray()
        : [0, 1, 2].map(
            (k) => mins[key][k] + (u16(v, p + 4 + k * 2) / 65535) * (maxs[key][k] - mins[key][k]),
          );
    sets[joint][key].push({ t, value });
  }
  for (const set of sets) for (const kind of ['p', 'q', 's']) set[kind].sort((a, b) => a.t - b.t);
  return { version, compressed: true, duration, fps, hashes, sets, flags };
}
function uncompressed(input) {
  const { b, v } = viewOf(input),
    version = u32(v, 8);
  if (![3, 4, 5].includes(version)) throw Error('LoL ANM: phiên bản chưa hỗ trợ.');
  let trackCount,
    frameCount,
    fps,
    duration,
    hashes = [],
    sets = [];
  if (version === 3) {
    trackCount = u32(v, 16);
    frameCount = u32(v, 20);
    fps = u32(v, 24);
    duration = frameCount / fps;
    range(v, 28, trackCount, 40, 2048, 'ANM v3');
    if (!(duration > 0 && duration <= 300 && fps > 0 && fps <= 240))
      throw Error('LoL ANM v3: thời lượng sai.');
    let p = 28;
    for (let j = 0; j < trackCount; j++) {
      const name = str(b, p, 32);
      p += 36;
      hashes.push(elf(name));
      const set = { p: [], q: [], s: [] };
      range(v, p, frameCount, 28, 72000, 'ANM v3 frames');
      for (let f = 0; f < frameCount; f++) {
        set.q.push({ t: f / fps, value: quat(v, p).toArray() });
        set.p.push({ t: f / fps, value: vec(v, p + 16) });
        p += 28;
      }
      sets.push(set);
    }
  } else {
    guard(v, 0, 60, 'ANM header');
    trackCount = u32(v, 28);
    frameCount = u32(v, 32);
    fps = 1 / f32(v, 36);
    duration = frameCount / fps;
    range(v, 0, trackCount, 6, 2048, 'ANM tracks');
    if (!(duration > 0 && duration <= 300 && fps > 0 && fps <= 240 && frameCount <= 72000))
      throw Error('LoL ANM: thời lượng/FPS sai.');
    const offsets = [i32(v, 40), i32(v, 52), i32(v, 56), i32(v, 60)].map((x) => x + 12);
    const [hashOff, vecOff, quatOff, frameOff] = offsets;
    let hashCount = 0;
    if (version === 5) {
      if (hashOff < quatOff || (frameOff - hashOff) % 4)
        throw Error('LoL ANM v5: hash section sai.');
      hashCount = (frameOff - hashOff) / 4;
      range(v, hashOff, hashCount, 4, 2048, 'ANM hashes');
      hashes = Array.from({ length: hashCount }, (_, i) => u32(v, hashOff + i * 4));
    }
    if (
      quatOff < vecOff ||
      (quatOff - vecOff) % 12 ||
      frameOff < quatOff ||
      ((version === 5 ? hashOff : frameOff) - quatOff) % (version === 5 ? 6 : 16)
    )
      throw Error('LoL ANM: palette sai.');
    const vectors = Array.from({ length: (quatOff - vecOff) / 12 }, (_, i) =>
      vec(v, vecOff + i * 12),
    );
    const qEnd = version === 5 ? hashOff : frameOff,
      quats = Array.from({ length: (qEnd - quatOff) / (version === 5 ? 6 : 16) }, (_, i) =>
        version === 5
          ? packedQuat(v, quatOff + i * 6).toArray()
          : quat(v, quatOff + i * 16).toArray(),
      );
    range(v, frameOff, trackCount * frameCount, version === 5 ? 6 : 12, 144000000, 'ANM frames');
    sets = Array.from({ length: trackCount }, () => ({ p: [], q: [], s: [] }));
    for (let f = 0; f < frameCount; f++)
      for (let j = 0; j < trackCount; j++) {
        const p = frameOff + (f * trackCount + j) * (version === 5 ? 6 : 12),
          hash = version === 5 ? hashes[j] : u32(v, p),
          a = u16(v, p + (version === 5 ? 0 : 4)),
          s = u16(v, p + (version === 5 ? 2 : 6)),
          q = u16(v, p + (version === 5 ? 4 : 8));
        if (!vectors[a] || !vectors[s] || !quats[q]) throw Error('LoL ANM: palette index sai.');
        if (version === 4) {
          if (f === 0) hashes[j] = hash;
          else if (hashes[j] !== hash) throw Error('LoL ANM v4: thứ tự hash thay đổi.');
        }
        sets[j].p.push({ t: f / fps, value: vectors[a] });
        sets[j].s.push({ t: f / fps, value: vectors[s] });
        sets[j].q.push({ t: f / fps, value: quats[q] });
      }
    if (version === 5) sets.length = hashCount;
  }
  return { version, compressed: false, duration, fps, hashes, sets, flags: 0 };
}
export function parseANM(input) {
  const { b } = viewOf(input),
    magic = str(b, 0, 8);
  if (magic === 'r3d2canm') return compressed(input);
  if (magic === 'r3d2anmd') return uncompressed(input);
  throw Error('LoL ANM: magic sai.');
}

const sample = (keys, t, kind, catmull, parametrized) => {
  if (!keys.length) return kind === 'q' ? [0, 0, 0, 1] : kind === 's' ? [1, 1, 1] : [0, 0, 0];
  if (t <= keys[0].t) return keys[0].value;
  if (t >= keys.at(-1).t) return keys.at(-1).value;
  let i = 0;
  while (keys[i + 1].t < t) i++;
  const a = keys[i],
    b = keys[i + 1],
    u = (t - a.t) / (b.t - a.t || 1);
  if (!catmull)
    return kind === 'q'
      ? new T.Quaternion(...a.value).slerp(new T.Quaternion(...b.value), u).toArray()
      : a.value.map((x, k) => x * (1 - u) + b.value[k] * u);
  const p0 = keys[Math.max(0, i - 1)],
    p3 = keys[Math.min(keys.length - 1, i + 2)],
    dt = b.t - a.t,
    e0 = parametrized ? dt / (b.t - p0.t || 1) : 0.5,
    e1 = parametrized ? dt / (p3.t - a.t || 1) : 0.5,
    m0 = ((2 - u) * u - 1) * (u * e0),
    m1 = ((2 - e1) * u + (e1 - 3)) * u * u + 1,
    m2 = ((3 - e0 * 2 + (e0 - 2) * u) * u + e0) * u,
    m3 = (u - 1) * u * u * e1;
  const points = [p0, a, b, p3].map((k) => k.value);
  if (kind === 'q') {
    const base = new T.Quaternion(...points[0]);
    for (let j = 1; j < 4; j++)
      if (base.dot(new T.Quaternion(...points[j])) < 0) points[j] = points[j].map((x) => -x);
  }
  const v = points[1].map(
    (x, k) => m1 * x + m0 * points[0][k] + m3 * points[3][k] + m2 * points[2][k],
  );
  return kind === 'q' ? new T.Quaternion(...v).normalize().toArray() : v;
};

export async function parse(
  sknBytes,
  sklBytes,
  animations = [],
  resources = [],
  name = 'League.skn',
) {
  const skn = parseSKN(sknBytes),
    skl = parseSKL(sklBytes),
    root = new T.Group(),
    anchor = new T.Bone();
  root.name = 'LeagueModel';
  anchor.name = 'League_Root';
  root.add(anchor);
  const bones = skl.joints.map((j) => {
    const bone = new T.Bone();
    bone.name = j.name;
    bone.position.fromArray(j.p);
    bone.quaternion.fromArray(j.q);
    bone.scale.fromArray(j.s);
    bone.userData.leagueId = j.id;
    return bone;
  });
  const ids = new Map(skl.joints.map((j, i) => [j.id, i]));
  const visiting = new Set(),
    done = new Set();
  function attach(i) {
    if (done.has(i)) return;
    if (visiting.has(i)) throw Error('LoL SKL: hierarchy có chu trình.');
    visiting.add(i);
    const p = skl.joints[i].parent;
    if (p >= 0) {
      attach(ids.get(p));
      bones[ids.get(p)].add(bones[i]);
    } else anchor.add(bones[i]);
    visiting.delete(i);
    done.add(i);
  }
  bones.forEach((_, i) => attach(i));
  root.updateMatrixWorld(true);
  const bind = new T.Skeleton([anchor, ...bones]);
  const indices = new Uint16Array(skn.blend.length);
  for (let i = 0; i < skn.blend.length; i++) {
    const w = skn.weights[i];
    if (!w) continue;
    const inf = skn.blend[i],
      joint = skn.flags & 1 ? inf : skl.influences[inf];
    if (joint === undefined || !bones[joint])
      throw Error('LoL SKN/SKL: skin influence ' + inf + ' không có joint.');
    indices[i] = joint + 1;
  }
  const warnings = [],
    materials = [];
  for (const r of skn.ranges) {
    const m = new T.MeshStandardMaterial({ color: 0xd5dbe1, side: T.DoubleSide, roughness: 0.9 });
    m.name = r.name;
    m.userData.studioSourceTexture = r.name + '.dds';
    const stem = r.name.toLowerCase(),
      candidates = resources.filter((x) => Tex.imageStem(x.name) === stem),
      match =
        candidates.length === 1 ? candidates[0] : resources.length === 1 ? resources[0] : null;
    if (match) {
      m.map = await Tex.decode(match, false);
      m.color.set(0xffffff);
    } else if (resources.length) warnings.push('Chưa ghép texture cho material ' + r.name + '.');
    materials.push(m);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(skn.pos, 3));
  geometry.setAttribute('normal', new T.BufferAttribute(skn.normal, 3));
  geometry.setAttribute('uv', new T.BufferAttribute(skn.uv, 2));
  geometry.setAttribute('skinIndex', new T.BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new T.BufferAttribute(skn.weights, 4));
  geometry.setIndex(new T.BufferAttribute(skn.indices, 1));
  skn.ranges.forEach((r, i) => geometry.addGroup(r.startIndex, r.indexCount, i));
  const mesh = new T.SkinnedMesh(geometry, materials);
  mesh.name = name.replace(/\.skn$/i, '');
  mesh.frustumCulled = false;
  root.add(mesh);
  mesh.bind(bind);
  const aliases = new Map(),
    influential = new Set(skl.influences);
  skl.joints.forEach((j, i) => {
    for (const hash of [fnv(j.name), elf(j.name), j.hash]) {
      if (!hash) continue;
      const list = aliases.get(hash) || [];
      if (!list.includes(i)) list.push(i);
      aliases.set(hash, list);
    }
  });
  for (const list of aliases.values())
    list.sort((a, b) => Number(influential.has(b)) - Number(influential.has(a)) || a - b);
  const clips = [];
  for (const a of animations) {
    const data = parseANM(a.bytes),
      tracks = [],
      mapped = new Map(),
      used = new Map();
    if (data.duration > 300 || Math.ceil(data.duration * 60) * skl.joints.length > 2000000)
      throw Error('LoL ANM: quá nhiều mẫu.');
    for (let i = 0; i < data.hashes.length; i++) {
      const list = aliases.get(data.hashes[i]);
      if (!list) {
        warnings.push(a.name + ': thiếu joint hash ' + data.hashes[i]);
        continue;
      }
      const count = used.get(data.hashes[i]) || 0,
        which = list[count];
      if (which === undefined) {
        warnings.push(a.name + ': nhiều track hơn số joint cho hash ' + data.hashes[i]);
        continue;
      }
      used.set(data.hashes[i], count + 1);
      if (list.length > 1)
        warnings.push(
          a.name +
            ': hash trùng ' +
            data.hashes[i] +
            '; ưu tiên joint có skin rồi theo thứ tự khai báo.',
        );
      mapped.set(bones[which], i);
    }
    if (!mapped.size) throw Error('LoL ANM ' + a.name + ': không khớp skeleton.');
    const n = Math.max(1, Math.ceil(data.duration * 60)),
      times = Array.from({ length: n + 1 }, (_, i) =>
        i === n ? data.duration : (i * data.duration) / n,
      );
    for (const [bone, i] of mapped) {
      const set = data.sets[i];
      for (const [k, prop, Track] of [
        ['p', 'position', T.VectorKeyframeTrack],
        ['q', 'quaternion', T.QuaternionKeyframeTrack],
        ['s', 'scale', T.VectorKeyframeTrack],
      ]) {
        if (!set[k].length) continue;
        const values = times.flatMap((t) =>
          sample(set[k], t, k, data.compressed, !!(data.flags & 4)),
        );
        tracks.push(new Track(bone.uuid + '.' + prop, times, values));
      }
    }
    const clip = new T.AnimationClip(a.name.replace(/\.anm$/i, ''), data.duration, tracks);
    clip.userData = { league: true, compressed: data.compressed, sampleFps: 60 };
    clips.push(clip);
  }
  root.animations = clips;
  root.userData.league = { warnings, sknVersion: skn.major, sklJoints: skl.joints.length };
  return root;
}
