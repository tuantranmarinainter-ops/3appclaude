// SPDX-License-Identifier: GPL-3.0-or-later
// Playback end policy adapted from Blockbench js/animations/timeline.js (Timeline.loop),
// commit ec0b2827104d0799c153bfb5f867579c0c44652f.
// Copyright (c) JannisX11 and Blockbench contributors.
// Adaptation: pure elapsed-time sampling, A-B range, delays and App 3 project data;
// no Vue, jQuery, global Timeline or Molang dependency. Navigation/color helpers are new.
export const KEY_COLORS = [
  '#e57373',
  '#ffb74d',
  '#fff176',
  '#81c784',
  '#4dd0e1',
  '#64b5f6',
  '#ba68c8',
  '#f48fb1',
];
export function playMode(project) {
  return (
    project.playMode ?? (project.loopEnabled === false || project.loop === false ? 'once' : 'loop')
  );
}
export function validateTimeline(project) {
  if (project.playMode !== undefined && !['once', 'loop', 'hold'].includes(project.playMode))
    throw Error('Chế độ phát không hợp lệ.');
  for (const name of ['startDelay', 'loopDelay'])
    if (project[name] !== undefined && (!Number.isFinite(project[name]) || project[name] < 0))
      throw Error('Thời gian chờ phải là số giây không âm.');
  for (const keys of Object.values(project.keys ?? {})) {
    if (!Array.isArray(keys)) continue; // Core retains its existing structural error messages.
    for (const key of keys)
      if (key?.color !== undefined && !KEY_COLORS.includes(key.color))
        throw Error('Màu keyframe không hợp lệ.');
  }
}
/** Ties are one stop; navigation never changes keys or adds history. */
export function adjacentKey(project, selected, time, direction) {
  const tracks = selected
    ? [project.keys[selected] ?? []]
    : [
        ...Object.values(project.keys),
        ...Object.values(project.ikModes ?? {}),
        ...Object.values(project.ikOptions ?? {}),
      ];
  const times = [...new Set(tracks.flatMap((keys) => keys.map((key) => key.time)))].sort(
    (a, b) => a - b,
  );
  return direction > 0
    ? (times.find((t) => t > time + 1e-7) ?? null)
    : (times.findLast((t) => t < time - 1e-7) ?? null);
}
export function colorKeys(project, refs, color) {
  if (color !== null && !KEY_COLORS.includes(color)) throw Error('Màu keyframe không hợp lệ.');
  const result = structuredClone(project);
  for (const ref of refs) {
    const key = result[ref.kind || 'keys']?.[ref.id]?.find(
      (k) => Math.abs(k.time - ref.time) < 1e-7,
    );
    if (key) {
      if (color === null) delete key.color;
      else key.color = color;
    }
  }
  return result;
}
export const colorKey = (ref) => `${ref.kind || 'keys'}|${ref.id}|${ref.time.toFixed(7)}`;
export function colorIndex(project) {
  const index = new Map();
  for (const kind of ['keys', 'ikModes', 'ikOptions'])
    for (const [id, keys] of Object.entries(project[kind] ?? {}))
      for (const key of keys)
        if (KEY_COLORS.includes(key.color))
          index.set(colorKey({ kind, id, time: key.time }), key.color);
  return index;
}
export function keyColor(project, refs, index) {
  if (index) return refs.map((ref) => index.get(colorKey(ref))).find(Boolean);
  return refs
    .map(
      (ref) =>
        project[ref.kind || 'keys']?.[ref.id]?.find((k) => Math.abs(k.time - ref.time) < 1e-7)
          ?.color,
    )
    .find((color) => KEY_COLORS.includes(color));
}
/** Seconds since Play, excluding paused/hidden time. Delays follow preview speed. */
export function previewAt(project, elapsed, range = project.loop, initial = range[0]) {
  const [a, b] = range,
    mode = playMode(project),
    start = project.startDelay ?? 0,
    wait = project.loopDelay ?? 0;
  const value = Math.max(0, elapsed) - start;
  if (value < 0) return { time: initial, playing: true };
  const first = b - initial,
    length = b - a;
  if (!(length > 0)) return { time: a, playing: false };
  if (value < first) return { time: initial + value, playing: true };
  if (mode === 'once') return { time: a, playing: false };
  if (mode === 'hold') return { time: b, playing: false };
  const tail = value - first;
  if (tail < wait) return { time: b, playing: true };
  const phase = (tail - wait) % (length + wait);
  return { time: phase < length ? a + phase : b, playing: true };
}
