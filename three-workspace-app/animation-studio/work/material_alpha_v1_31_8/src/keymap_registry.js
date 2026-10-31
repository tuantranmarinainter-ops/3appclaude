// SPDX-License-Identifier: GPL-3.0-or-later
// Pure keymap registry for Animation Studio. No browser storage or DOM dependencies.
const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const MOD_ALIASES = {ctrl:'Ctrl', control:'Ctrl', alt:'Alt', option:'Alt', shift:'Shift', meta:'Meta', cmd:'Meta', command:'Meta'};
const KEY_ALIASES = { ' ':'Space', spacebar:'Space', space:'Space', esc:'Escape', del:'Delete', left:'ArrowLeft', right:'ArrowRight', up:'ArrowUp', down:'ArrowDown', os:'Meta' };
function normalizeBase(key) {
  if (typeof key !== 'string' || !key) return null;
  const alias = KEY_ALIASES[key.toLowerCase()];
  if (alias) return alias;
  if (key.length === 1) return key.toUpperCase();
  if (/^key[a-z]$/i.test(key)) return key.slice(-1).toUpperCase();
  if (/^digit[0-9]$/i.test(key)) return key.slice(-1);
  const named = ['Escape','Enter','Tab','Backspace','Delete','Insert','Home','End','PageUp','PageDown','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
  return named.find(x => x.toLowerCase() === key.toLowerCase()) || (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(key) ? key.toUpperCase() : /^numpad(?:[0-9]|add|subtract|multiply|divide|decimal|enter)$/i.test(key) ? 'Numpad' + key.slice(6).replace(/^./, c => c.toUpperCase()) : null);
}
/** Normalize keyboard event or a human-readable chord; modifier-only and unknown keys return null. */
export function normalizeKey(input) {
  let key, mods = new Set();
  if (typeof input === 'string') {
    const parts = input.split('+').map(x => x.trim());
    if (!parts.length || parts.some(x => !x)) return null;
    key = parts.pop();
    for (const part of parts) { const m = MOD_ALIASES[part.toLowerCase()]; if (!m || mods.has(m)) return null; mods.add(m); }
  } else if (input && typeof input === 'object') {
    if (input.isComposing || input.key === 'Dead' || input.key === 'Process') return null;
    const punctuation = {Comma:',', Period:'.', Slash:'/', Semicolon:';', Quote:"'", BracketLeft:'[', BracketRight:']', Backslash:'\\', Minus:'-', Equal:'=', Backquote:'`'};
    key = /^Numpad/.test(input.code || '') ? input.code : (input.shiftKey && punctuation[input.code]) || input.key;
    if (input.ctrlKey) mods.add('Ctrl'); if (input.altKey) mods.add('Alt');
    if (input.shiftKey) mods.add('Shift'); if (input.metaKey) mods.add('Meta');
  } else return null;
  if (MOD_ALIASES[String(key).toLowerCase()]) return null;
  key = normalizeBase(key); if (!key) return null;
  return [...MODIFIERS.filter(x => mods.has(x)), key].join('+');
}
function normalizeBindings(values) {
  if (!Array.isArray(values) || values.length > 2) throw new Error('Bindings must be an array of at most two keys');
  const keys = values.map(normalizeKey);
  if (keys.some(x => !x) || new Set(keys).size !== keys.length) throw new Error('Invalid or duplicate key');
  return keys;
}
const scopesOverlap = (a,b) => a === b || a === 'global' || b === 'global';
// Pose viewport tool switching and playback intentionally share a chord.
const actionsOverlap = (a,b) => !([a.id,b.id].includes('tool.swap') && [a.id,b.id].includes('timeline.play')) && scopesOverlap(a.scope,b.scope);
const clone = value => JSON.parse(JSON.stringify(value));
export function createKeymapRegistry(actions, presets = {}) {
  if (!Array.isArray(actions)) throw new Error('Actions must be an array');
  const byId = new Map();
  for (const action of actions) {
    if (!action || typeof action.id !== 'string' || !action.id || byId.has(action.id) || typeof action.scope !== 'string' || !action.scope) throw new Error('Invalid action');
    byId.set(action.id, {...action, bindings: normalizeBindings(action.bindings || [])});
  }
  const presetMap = {};
  for (const [name, mapping] of Object.entries(presets)) {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('Invalid preset');
    presetMap[name] = {};
    for (const [id, keys] of Object.entries(mapping)) { if (!byId.has(id)) throw new Error('Unknown preset action: ' + id); presetMap[name][id] = normalizeBindings(keys); }
  }
  let state = {preset:'app3', priority:'app3', overrides:{}};
  function calculate() {
    const rows = new Map([...byId].map(([id,a]) => [id, {...a, bindings:[], source:[], conflicts:[]}]));
    const assigned = [];
    function add(id, key, source) {
      const row = rows.get(id);
      const blockers = assigned.filter(x => x.id !== id && x.key === key && actionsOverlap(x,row));
      if (blockers.length) { row.conflicts.push(...blockers.map(x => ({id:x.id,binding:key,scope:x.scope,source:x.source,requestedSource:source}))); return; }
      if (row.bindings.includes(key) || row.bindings.length >= 2) return;
      row.bindings.push(key); row.source.push(source); assigned.push({id,key,scope:row.scope,source});
    }
    for (const [id,keys] of Object.entries(state.overrides)) for (const key of keys) add(id,key,'manual');
    const mapping = presetMap[state.preset] || {};
    const addLayer = layer => {
      for (const [id, a] of byId) {
        if (Object.hasOwn(state.overrides,id)) continue;
        const keys = layer === 'app3' ? a.bindings : mapping[id] || [];
        for (const key of keys) add(id,key,layer);
      }
    };
    if (state.preset === 'app3') addLayer('app3');
    else if (state.priority === 'app3') { addLayer('app3'); addLayer('preset'); }
    else { addLayer('preset'); addLayer('app3'); }
    return rows;
  }
  function validateId(id) { if (!byId.has(id)) throw new Error('Unknown action: ' + id); }
  function findConflicts(id, values) {
    validateId(id); const keys = normalizeBindings(values), scope = byId.get(id).scope;
    return [...calculate()].flatMap(([other,row]) => other === id || !actionsOverlap(byId.get(id),row) ? [] : row.bindings.filter(x=>keys.includes(x)).map(binding=>({id:other,binding,scope:row.scope,source:row.source[row.bindings.indexOf(binding)]})));
  }
  function setBindings(id, values, {replace=false} = {}) {
    validateId(id); const keys = normalizeBindings(values), conflicts = findConflicts(id,keys);
    if (conflicts.length && !replace) return {ok:false,conflicts};
    if (replace) {
      const rows = calculate();
      for (const other of new Set(conflicts.map(x=>x.id))) state.overrides[other] = rows.get(other).bindings.filter(k => !conflicts.some(c=>c.id === other && c.binding === k));
    }
    state.overrides[id] = keys; return {ok:true,conflicts};
  }
  function applyPreset(id) { if (id !== 'app3' && !Object.hasOwn(presetMap,id)) throw new Error('Unknown preset'); state.preset=id; }
  function setPriority(priority) { if (priority !== 'app3' && priority !== 'preset') throw new Error('Invalid priority'); state.priority=priority; }
  function reset(id) { if (id !== undefined) { validateId(id); delete state.overrides[id]; } else state = {preset:'app3',priority:'app3',overrides:{}}; }
  function importJSON(input) {
    try {
      const candidate = typeof input === 'string' ? JSON.parse(input) : input;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || candidate.version !== 1 || (candidate.preset !== 'app3' && !Object.hasOwn(presetMap,candidate.preset)) || !['app3','preset'].includes(candidate.priority) || !candidate.overrides || typeof candidate.overrides !== 'object' || Array.isArray(candidate.overrides)) throw new Error('Invalid keymap');
      const overrides = {};
      for (const [id, keys] of Object.entries(candidate.overrides)) { validateId(id); overrides[id] = normalizeBindings(keys); }
      const entries = Object.entries(overrides);
      for (let i=0;i<entries.length;i++) for(let j=i+1;j<entries.length;j++) if(actionsOverlap(byId.get(entries[i][0]),byId.get(entries[j][0])) && entries[i][1].some(k=>entries[j][1].includes(k))) throw new Error('Conflicting manual bindings');
      state = {preset:candidate.preset,priority:candidate.priority,overrides}; return {ok:true};
    } catch (error) { return {ok:false,error:error.message}; }
  }
  return {
    getState: () => clone(state), getBindings: id => { validateId(id); return [...calculate().get(id).bindings]; },
    getEntries: () => clone([...calculate().values()]), setBindings, findConflicts,
    resolve: (input, scope='global') => { const key = normalizeKey(input); if (!key) return null; const rows = [...calculate().values()]; return rows.find(r=>r.scope===scope && r.bindings.includes(key))?.id || rows.find(r=>r.scope==='global' && r.bindings.includes(key))?.id || null; },
    applyPreset, setPriority, reset, exportJSON: () => JSON.stringify({version:1,...state},null,2), importJSON,
  };
}

// Preserve the original permissive shortcuts while an explicit chord always wins.
export function matchesShortcut(registry, id, event, scope = 'global', readOnlyView = false) {
  const chord = normalizeKey(event);
  if (!chord) return false;
  const resolved = registry.resolve(chord, scope);
  if (resolved) return resolved === id;
  const bindings = registry.getBindings(id);
  const key = String(event.key || '').toLowerCase();
  if (id === 'view.reset' && bindings.includes('Q') && key === 'q' && (readOnlyView || (!event.ctrlKey && !event.altKey && !event.metaKey))) return true;
  if (id === 'key.addDirect' && bindings.includes('K') && key === 'k') return true;
  if (id === 'timeline.play' && bindings.includes('Space') && (event.code === 'Space' || event.key === ' ')) return true;
  return false;
}
