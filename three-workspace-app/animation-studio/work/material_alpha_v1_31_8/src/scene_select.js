// "1 khung · Cả cảnh" (S3): pure helpers for per-character editing. No DOM and no editor globals, so Node can test them.
// Glue (state store, switching, picking, UI) lives in shot_controller.js.
import * as T from 'three';

/** Two independent 32-bit FNV-1a passes -> 16 hex chars. Sync (SHA-256 is async in browsers) and stable. */
export function hashString(text) {
  let a = 0x811c9dc5,
    b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c ^ (i & 255), 0x85ebca6b) >>> 0;
    b = ((b << 13) | (b >>> 19)) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
/** Everything a user edit can change on a project (keys, IK modes/options, skin adjustments, Lab, Molang, in-place), in a fixed order. */
export function keysHash(project) {
  if (!project) return '';
  return hashString(
    JSON.stringify([
      project.keys ?? {},
      project.ikModes ?? {},
      project.ikOptions ?? {},
      project.skinAdjustments ?? {},
      // Motion Lab / Molang / in-place edits also count as an edit of the character.
      project.lab ?? null,
      project.molangVariables ?? null,
      project.inPlace ?? null,
    ]),
  );
}

/** Label text for a scene character: the optional shot name, else a short form of the id. */
export function displayName(character) {
  const name = typeof character?.name === 'string' ? character.name.trim() : '';
  if (name) return name;
  const id = String(character?.characterId ?? '');
  return id.length > 12 ? id.slice(0, 8) + '…' : id || '?';
}

/** True when pointerdown -> pointerup is a click (not an orbit drag). */
export const isClick = (down, up, threshold = 4) =>
  !!down && Math.hypot(up.x - down.x, up.y - down.y) <= threshold;

/**
 * Pick the character a click selects. `hits` = [{ characterId, distance, editing }] (nearest hit per character).
 * The nearest hit decides; if it belongs to the character already being edited nothing changes (it occludes the rest).
 */
export function pickCharacter(hits) {
  let best = null;
  for (const h of hits) if (!best || h.distance < best.distance) best = h;
  return best && !best.editing ? best.characterId : null;
}

/** Replaces every mesh material under root by a translucent clone, so the editing rig's own materials stay untouched. */
export function dimViewer(root, opacity = 0.5) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const dim = (m) => {
      const c = m.clone();
      c.transparent = true;
      c.opacity = opacity;
      // depthWrite stays on: a translucent body must not show its own back faces/limbs through itself.
      c.depthWrite = true;
      c.needsUpdate = true;
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(dim) : dim(o.material);
    o.userData.sceneDimmed = true;
  });
}

/** Child-index path of `node` below `root` (null when node is not under root). */
export function pathOf(root, node) {
  const path = [];
  for (let o = node; o && o !== root; o = o.parent) {
    if (!o.parent) return null;
    path.unshift(o.parent.children.indexOf(o));
  }
  return path;
}
export function resolvePath(root, path) {
  let o = root;
  for (const i of path) {
    o = o.children[i];
    if (!o) return null;
  }
  return o;
}

/**
 * Pairs every node of `rigNodes` (editor rig root + records) with the node at the same child-index path in a viewer
 * parsed from the same GLB. Virtual helper bones the rig adds have no counterpart and are skipped.
 */
export function pairNodes(rigRoot, rigNodes, viewerRoot) {
  const pairs = [];
  for (const rigNode of new Set(rigNodes)) {
    const path = pathOf(rigRoot, rigNode),
      target = path && resolvePath(viewerRoot, path);
    if (target && target.name === rigNode.name) pairs.push({ rigNode, target });
  }
  return pairs;
}

/** Sample times 0..duration at `fps` (last sample exactly at duration). */
export function sampleTimes(duration, fps = 30) {
  const n = Math.max(1, Math.ceil(duration * fps - 1e-6)),
    times = [];
  for (let i = 0; i < n; i++) times.push(i / fps);
  times.push(duration);
  return times;
}

/**
 * Bakes the EDITED pose of a rig into an AnimationClip that drives `pairs[i].target` (viewer nodes):
 * `evaluate(t)` must pose the rig (C.evaluate(rig, project, t)); the rig nodes' local transforms are then sampled.
 * Playing this clip on the viewer reproduces the editor's own evaluation at the sampled times (exact at every 1/fps
 * step, linear/slerp in between), including IK, since IK is solved by the evaluation itself.
 */
export function bakePoseClip(pairs, times, evaluate, name = 'edited') {
  const cols = pairs.map(() => ({
    p: new Float32Array(times.length * 3),
    q: new Float32Array(times.length * 4),
    s: new Float32Array(times.length * 3),
  }));
  times.forEach((t, i) => {
    evaluate(t);
    pairs.forEach(({ rigNode }, k) => {
      rigNode.position.toArray(cols[k].p, i * 3);
      rigNode.quaternion.toArray(cols[k].q, i * 4);
      rigNode.scale.toArray(cols[k].s, i * 3);
    });
  });
  const tracks = [];
  pairs.forEach(({ target }, k) => {
    tracks.push(
      new T.VectorKeyframeTrack(target.uuid + '.position', times, cols[k].p),
      new T.QuaternionKeyframeTrack(target.uuid + '.quaternion', times, cols[k].q),
      new T.VectorKeyframeTrack(target.uuid + '.scale', times, cols[k].s),
    );
  });
  return new T.AnimationClip(name, times[times.length - 1], tracks);
}

/** Pointer position in a canvas rectangle -> normalised device coordinates. */
export const toNDC = (clientX, clientY, rect) => ({
  x: ((clientX - rect.left) / rect.width) * 2 - 1,
  y: -(((clientY - rect.top) / rect.height) * 2 - 1),
});
