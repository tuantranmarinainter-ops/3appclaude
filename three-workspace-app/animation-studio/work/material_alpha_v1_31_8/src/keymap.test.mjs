import test from 'node:test';
import assert from 'node:assert/strict';
import * as Keymap from './keymap.js';
import { PRESETS } from './keymaps/presets.js';
test('exact modifiers, portable Cmd/Ctrl and numpad normalization', () => {
  assert.equal(Keymap.canonical('Ctrl+Shift+z'), 'Mod+Shift+Z');
  for (const key of ['Q', 'K', 'Space'])
    for (const modifier of ['Mod', 'Alt', 'Shift'])
      assert.notEqual(Keymap.canonical(modifier + '+' + key), key);
  assert.equal(Keymap.eventKey({ key: '5', code: 'Numpad5' }), 'Numpad5');
  assert.throws(() => Keymap.load({ version: 2 }));
  assert.throws(() => Keymap.assign('key.add', 'Bad+K'));
});
test('App3 conflict precedence, preset precedence, manual wins, clear and exact round trip', () => {
  Keymap.reset();
  Keymap.setPreference('preset', 'blockbench');
  for (const a of Keymap.actions.values())
    for (const key of a.defaults)
      assert.ok(Keymap.keysFor(a.id).includes(Keymap.canonical(key)), a.id + key);
  assert.deepEqual(Keymap.keysFor('key.add'), ['K']);
  assert.ok(Keymap.conflictFor('key.add').includes('Q'));
  assert.equal(Keymap.sourceFor('tool.translate', 'G'), 'App 3');
  assert.equal(Keymap.sourceFor('tool.translate', 'V'), 'Bộ phím đã chọn');
  Keymap.setPreference('priority', 'preset');
  assert.deepEqual(Keymap.keysFor('key.add'), ['Q']);
  assert.deepEqual(Keymap.keysFor('view.reset'), []);
  Keymap.assign('key.add', 'L', 0, true);
  Keymap.setPreference('priority', 'app3');
  assert.deepEqual(Keymap.keysFor('key.add'), ['L']);
  const saved = Keymap.exportState();
  Keymap.reset();
  Keymap.load(JSON.stringify(saved));
  assert.deepEqual(Keymap.exportState(), saved);
  assert.ok(Keymap.assign('key.add', 'Q').some((a) => a.id === 'view.reset'));
  Keymap.assign('key.add', 'Q', 0, true);
  assert.deepEqual(Keymap.keysFor('view.reset'), []);
  Keymap.clear('key.add');
  assert.deepEqual(Keymap.keysFor('key.add'), []);
  Keymap.reset('key.add');
  assert.deepEqual(Keymap.keysFor('key.add'), ['K']);
  Keymap.reset();
});
test('preset data is extracted, includes minimum mapped keys and numpad projection', () => {
  const p = PRESETS.blockbench.keys;
  assert.deepEqual(p['key.add'], ['Q']);
  assert.deepEqual(p['timeline.frameBack'], [',']);
  assert.deepEqual(p['timeline.graph'], ['F3']);
  assert.deepEqual(p['view.projection'], ['Numpad5']);
  assert.deepEqual(p['view.screenshot'], ['Mod+P']);
  assert.deepEqual(PRESETS.blender.keys['tool.translate'], ['G']);
  assert.deepEqual(PRESETS.blender.keys['key.add'], ['I']);
  assert.ok(PRESETS.maya.mouse.preview_rotate);
});
test('saved bindings survive late registration of actions from future packages', () => {
  Keymap.load({
    version: 1,
    preset: 'app3',
    priority: 'app3',
    mouse: 'default',
    custom: { 'future.action': ['X'] },
  });
  Keymap.register({ id: 'future.action', name: 'Future', group: 'Test', defaults: [] }, () => {});
  assert.deepEqual(Keymap.keysFor('future.action'), ['X']);
  const state = Keymap.exportState();
  Keymap.reset();
  Keymap.load(state);
  assert.deepEqual(Keymap.keysFor('future.action'), ['X']);
  Keymap.reset();
});
test('browser setup uses CHROMIUM_PATH only when specified, otherwise bundled Chromium', async () => {
  const { browserOptions } = await import('./browser_test_options.mjs');
  assert.equal(Object.hasOwn(browserOptions({}, {}, 'win32'), 'executablePath'), false);
  assert.equal(Object.hasOwn(browserOptions({}, {}, 'linux'), 'executablePath'), false);
  assert.equal(
    browserOptions({}, { CHROMIUM_PATH: 'C:\\test\\chrome.exe' }, 'win32').executablePath,
    'C:\\test\\chrome.exe',
  );
  assert.ok(browserOptions({}, {}, 'linux').args.includes('--use-angle=swiftshader'));
});
