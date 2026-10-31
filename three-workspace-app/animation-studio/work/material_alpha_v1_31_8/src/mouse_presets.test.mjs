import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mousePreset } from './mouse_presets.js';

test('preset chuột Blender và Maya tạo các tổ hợp riêng, không trùng', () => {
  for (const name of ['mouse', 'trackpad', 'blender', 'maya', 'cinema4d']) {
    const p = mousePreset(name);
    const bindings = ['orbit', 'pan', 'zoom'].map(id => p[id + 'Button'] + ':' + p[id + 'Modifier']);
    assert.equal(new Set(bindings).size, 3);
  }
  assert.equal(mousePreset('blender').panModifier, 'shift');
  assert.equal(mousePreset('maya').orbitModifier, 'alt');
  assert.equal(mousePreset('unknown'), null);
});
