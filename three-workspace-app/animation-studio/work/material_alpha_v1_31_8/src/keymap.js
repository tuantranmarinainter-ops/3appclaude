// SPDX-License-Identifier: GPL-3.0-or-later
// Original router: one native keyboard listener, independent registrations per widget.
import { ACTIONS, GROUPS } from './keymap_catalog.js';
import { PRESETS } from './keymaps/presets.js';
export const actions = new Map(ACTIONS.map((a) => [a.id, a]));
const listeners = [],
  subscribers = new Set();
let serial = 0,
  installed = false,
  context = () => ({}),
  capture = null;
export let state = { version: 1, preset: 'app3', priority: 'app3', mouse: 'default', custom: {} };
let resolved = new Map(),
  collisions = new Map(),
  sources = new Map();
const inputSelector =
  'input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox]';
export function eventKey(event) {
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return '';
  let key = event.code?.startsWith('Numpad') ? event.code : event.key === ' ' ? 'Space' : event.key;
  if (key.length === 1) key = key.toUpperCase();
  return [
    event.ctrlKey || event.metaKey ? 'Mod' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    key,
  ]
    .filter(Boolean)
    .join('+');
}
export function canonical(value) {
  if (typeof value !== 'string' || value.length > 64) throw Error('Tổ hợp phím không hợp lệ.');
  let parts = value.split('+'),
    key = parts.pop();
  if (
    !key ||
    !/^(?:[A-Za-z0-9,. /;\[\]`=-]|Space|Escape|Enter|Tab|Home|End|Delete|Backspace|Arrow(?:Left|Right|Up|Down)|F(?:[1-9]|1[012])|Numpad[0-9])$/.test(
      key,
    )
  )
    throw Error('Phím không được hỗ trợ.');
  parts = parts.map((p) => (['Ctrl', 'Cmd', 'Meta', 'Control', 'Mod'].includes(p) ? 'Mod' : p));
  if (parts.some((p) => !['Mod', 'Alt', 'Shift'].includes(p)))
    throw Error('Modifier không hợp lệ.');
  return ['Mod', 'Alt', 'Shift']
    .filter((p) => parts.includes(p))
    .concat(key.length === 1 ? key.toUpperCase() : key)
    .join('+');
}
const overlap = (a, b) => {
  if (
    state.priority === 'preset' &&
    new Set([a.id, b.id]).size === 2 &&
    [a.id, b.id].every((id) => ['timeline.play', 'tool.swap'].includes(id))
  )
    return false;
  return a.scope === b.scope || a.scope === 'global' || b.scope === 'global';
};
export function recalculate() {
  resolved = new Map();
  collisions = new Map();
  sources = new Map();
  for (const a of actions.values()) {
    resolved.set(a.id, a.defaults.map(canonical));
    sources.set(a.id, 'App 3');
  }
  const preset = PRESETS[state.preset] || {};
  if (state.priority === 'preset' && state.preset !== 'app3')
    for (const id of Object.keys(preset.keys || {})) if (actions.has(id)) resolved.set(id, []);
  for (const [id, keys] of Object.entries(preset.keys || {})) {
    if (!actions.has(id)) continue;
    const selected = [];
    for (const raw of keys) {
      const key = canonical(raw),
        conflicts = [...actions.values()].filter(
          (a) => a.id !== id && overlap(a, actions.get(id)) && resolved.get(a.id).includes(key),
        );
      if (conflicts.length) {
        collisions.set(id, (collisions.get(id) || []).concat(key));
        if (state.priority === 'app3') continue;
        for (const a of conflicts) {
          resolved.set(
            a.id,
            resolved.get(a.id).filter((k) => k !== key),
          );
          collisions.set(a.id, (collisions.get(a.id) || []).concat(key));
        }
      }
      selected.push(key);
    }
    if (state.priority === 'app3')
      resolved.set(id, [...new Set([...resolved.get(id), ...selected])].slice(0, 2));
    else resolved.set(id, selected.slice(0, 2));
    if (selected.length && state.priority === 'preset') sources.set(id, 'Bộ phím đã chọn');
  }
  // Manual assignments are applied last, including explicitly cleared bindings.
  for (const [id, keys] of Object.entries(state.custom))
    if (actions.has(id)) {
      for (const a of actions.values())
        if (a.id !== id && overlap(a, actions.get(id)))
          resolved.set(
            a.id,
            resolved.get(a.id).filter((k) => !keys.includes(k)),
          );
      resolved.set(id, [...keys]);
      sources.set(id, 'Thủ công');
    }
  for (const notify of subscribers) notify();
}
export const keysFor = (id) => [...(resolved.get(id) || [])];
export const conflictFor = (id) => [...(collisions.get(id) || [])];
export function sourceFor(id, key) {
  if (!key) return sources.get(id) || 'App 3';
  if (Object.hasOwn(state.custom, id)) return 'Thủ công';
  const preset = (PRESETS[state.preset]?.keys?.[id] || []).map(canonical);
  const original = (actions.get(id)?.defaults || []).map(canonical);
  return preset.includes(key) && (state.priority === 'preset' || !original.includes(key))
    ? 'Bộ phím đã chọn'
    : 'App 3';
}
export function exportState() {
  return JSON.parse(JSON.stringify(state));
}
export function load(value, notify = true) {
  if (typeof value === 'string') value = JSON.parse(value || '{}');
  if (!value || typeof value !== 'object' || (value.version !== undefined && value.version !== 1))
    throw Error('Bộ phím không hợp lệ.');
  const custom = {};
  for (const [id, keys] of Object.entries(value.custom || {})) {
    if (!/^[a-z][a-zA-Z0-9_.-]{0,127}$/.test(id)) continue;
    if (!Array.isArray(keys) || keys.length > 2) throw Error('Mỗi hành động tối đa 2 phím.');
    custom[id] = [...new Set(keys.map(canonical))];
  }
  state = {
    version: 1,
    preset: value.preset === 'app3' || PRESETS[value.preset] ? value.preset : 'app3',
    priority: value.priority === 'preset' ? 'preset' : 'app3',
    mouse: ['default', 'trackpad', 'blender', 'maya', 'cinema4d'].includes(value.mouse)
      ? value.mouse
      : 'default',
    custom,
  };
  recalculate();
  if (notify) save();
  return exportState();
}
export function save() {
  const field = globalThis.document?.getElementById('keymapState');
  if (field) field.value = JSON.stringify(state);
  try {
    const settings = JSON.parse(localStorage.getItem('animation-studio-settings') || '{}');
    settings.keymapState = JSON.stringify(state);
    localStorage.setItem('animation-studio-settings', JSON.stringify(settings));
  } catch {}
}
export function initialize() {
  try {
    const saved = JSON.parse(localStorage.getItem('animation-studio-settings') || '{}');
    if (saved.keymapState) load(saved.keymapState, false);
  } catch {}
  const field = globalThis.document?.getElementById('keymapState');
  if (field) field.value = JSON.stringify(state);
}
export function conflicts(id, key) {
  key = canonical(key);
  return [...actions.values()].filter(
    (a) => a.id !== id && overlap(a, actions.get(id)) && keysFor(a.id).includes(key),
  );
}
export function assign(id, key, index = 0, replace = false) {
  if (!actions.has(id) || ![0, 1].includes(index)) throw Error('Hành động không hợp lệ.');
  key = canonical(key);
  const used = conflicts(id, key);
  if (used.length && !replace) return used;
  for (const a of used) state.custom[a.id] = keysFor(a.id).filter((k) => k !== key);
  const keys = keysFor(id);
  keys[index] = key;
  state.custom[id] = [...new Set(keys.filter(Boolean))].slice(0, 2);
  recalculate();
  save();
  return [];
}
export function clear(id) {
  state.custom[id] = [];
  recalculate();
  save();
}
export function reset(id) {
  if (id) delete state.custom[id];
  else state = { version: 1, preset: 'app3', priority: 'app3', mouse: 'default', custom: {} };
  recalculate();
  save();
}
export function setPreference(key, value) {
  load({ ...exportState(), [key]: value });
}
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
export function setCapture(fn) {
  capture = fn;
}
export function register(definition, handler, target = globalThis.window) {
  if (actions.has(definition.id)) throw Error('Trùng mã hành động: ' + definition.id);
  actions.set(definition.id, { defaults: [], scope: 'global', group: 'Khung 3D', ...definition });
  GROUPS['registered.' + definition.id] = [{ id: definition.id, original: 'Enter', direct: true }];
  const unbind = on(target, 'registered.' + definition.id, handler);
  recalculate();
  return unbind;
}
export function on(target, group, handler, options = false) {
  if (!target) return () => {};
  const registration = {
    target,
    group,
    handler,
    capture: options === true || !!options?.capture,
    order: serial++,
    owner: options?.owner,
  };
  listeners.push(registration);
  return () => {
    const i = listeners.indexOf(registration);
    if (i >= 0) listeners.splice(i, 1);
  };
}
function virtualEvent(event, original, target, flags) {
  const parts = canonical(original).split('+'),
    key = parts.pop();
  return new Proxy(event, {
    get(object, name) {
      if (name === 'nativeKey') return event.key;
      if (name === 'nativeCode') return event.code;
      if (name === 'key') return key === 'Space' ? ' ' : key.length === 1 ? key.toLowerCase() : key;
      if (name === 'code')
        return key === 'Space'
          ? 'Space'
          : key.length === 1 && /[A-Z]/.test(key)
            ? 'Key' + key
            : key;
      if (name === 'ctrlKey') return parts.includes('Mod') && !event.metaKey;
      if (name === 'metaKey') return parts.includes('Mod') && !!event.metaKey;
      if (name === 'altKey') return parts.includes('Alt');
      if (name === 'shiftKey') return parts.includes('Shift');
      if (name === 'currentTarget') return target;
      if (name === 'stopPropagation')
        return () => {
          flags.stopped = true;
          event.stopPropagation();
        };
      if (name === 'stopImmediatePropagation')
        return () => {
          flags.immediate = true;
          flags.stopped = true;
          event.stopImmediatePropagation();
        };
      const value = Reflect.get(object, name, object);
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });
}
export function dispatch(event) {
  if (event.isComposing || event.key === 'Process') return;
  if (capture) {
    if (capture(eventKey(event), event) !== false) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    return;
  }
  const key = eventKey(event);
  if (!key) return;
  const editing = event.target?.closest?.(inputSelector),
    modal = globalThis.document?.querySelector('dialog[open]');
  if (
    editing &&
    !['Escape', 'Enter'].includes(event.key) &&
    !(event.key.startsWith('Arrow') && event.target?.matches?.('input[type=number]'))
  )
    return;
  const path = event.composedPath?.() || [event.target, globalThis.document, globalThis.window];
  for (let i = listeners.length - 1; i >= 0; i--)
    if (
      listeners[i].owner?.isConnected === false ||
      (listeners[i].target !== globalThis.window &&
        listeners[i].target !== globalThis.document &&
        listeners[i].target.isConnected === false)
    )
      listeners.splice(i, 1);
  const candidates = listeners.filter(
    (r) =>
      (r.target === globalThis.window ||
        r.target === globalThis.document ||
        path.includes(r.target) ||
        r.target.contains?.(event.target)) &&
      (r.target === globalThis.window ||
        r.target === globalThis.document ||
        r.target.isConnected !== false),
  );
  const distance = (r) => {
    const i = path.indexOf(r.target);
    return i < 0 ? 999 : i;
  };
  candidates.sort((a, b) =>
    a.capture !== b.capture
      ? a.capture
        ? -1
        : 1
      : a.capture
        ? distance(b) - distance(a) || a.order - b.order
        : distance(a) - distance(b) || a.order - b.order,
  );
  const flags = { stopped: false, immediate: false };
  const current = context();
  let stoppedTarget = null;
  for (const r of candidates) {
    if (flags.immediate) break;
    if (flags.stopped && r.target !== stoppedTarget) break;
    if (
      modal &&
      (r.target === globalThis.window || r.target === globalThis.document) &&
      !['Escape', 'Enter'].includes(event.key)
    )
      continue;
    const defs = GROUPS[r.group] || [];
    const binding = defs.find((d) => {
      const action = actions.get(d.id);
      if (
        d.id === 'timeline.play' &&
        state.priority === 'preset' &&
        state.preset !== 'app3' &&
        globalThis.document?.body?.dataset.layoutTab === 'pose'
      )
        return false;
      if (
        d.direct &&
        action?.scope === 'timeline' &&
        globalThis.document?.body?.classList.contains('layout-modes') &&
        globalThis.document?.body?.dataset.layoutTab !== 'animate'
      )
        return false;
      if (!action || !keysFor(d.id).includes(key)) return false;
      if (!d.direct) {
        const defaults = action.defaults;
        const original = defaults[Math.min(keysFor(d.id).indexOf(key), defaults.length - 1)];
        if (original && canonical(d.original) !== canonical(original)) return false;
      }
      return (
        action &&
        (!action.context || event.target?.closest?.(action.context)) &&
        (!action.enabled || action.enabled(current, event)) &&
        !(action.mutates && current.readOnly)
      );
    });
    if (!binding) continue;
    const action = actions.get(binding.id);
    // Escape/Enter are contextual in text fields; never pass input keys into a global command.
    if (
      editing &&
      (r.target === globalThis.window || r.target === globalThis.document) &&
      !['Escape'].includes(event.key)
    )
      continue;
    try {
      r.handler(binding.direct ? event : virtualEvent(event, binding.original, r.target, flags));
    } catch (error) {
      globalThis.console?.error(error);
    }
    if (flags.stopped) stoppedTarget = r.target;
  }
}
export function install(getContext) {
  context = getContext || context;
  if (!installed) {
    window.addEventListener('keydown', dispatch, true);
    installed = true;
  }
}
recalculate();

export function nativeControlActivation(e) {
  return (e.nativeCode ?? e.code) === 'Space' || (e.nativeKey ?? e.key) === 'Enter';
}
