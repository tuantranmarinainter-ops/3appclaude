// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMolang } from './molang.js';

const value = (source, context) => {
  const result = evaluateMolang(source, context);
  assert.equal(result.error, null);
  return result.value;
};
test('operator precedence, comparisons and conditional expressions', () => {
  assert.equal(value('1 + 2 * 3'), 7);
  assert.equal(value('-(1 + 2) * 3 / 2'), -4.5);
  assert.equal(value('1 + 2 * 3 >= 7 ? 12 : 0'), 12);
  assert.equal(value('1 != 1 ? 0 : 2 < 3 ? 4 : 5'), 4);
  assert.equal(value('0 ? 1 / 0 : 8'), 8);
});
test('math functions use degrees and random is stable for each seed and call', () => {
  assert.ok(Math.abs(value('math.sin(90)') - 1) < 1e-12);
  assert.ok(Math.abs(value('math.cos(180)') + 1) < 1e-12);
  assert.equal(value('math.abs(-4) + math.clamp(7, 0, 3)'), 7);
  assert.equal(value('math.lerp(2, 10, .25) + math.min(3, 8) + math.max(3, 8)'), 15);
  const expression = 'math.random(-2, 3)';
  const first = value(expression, { seed: 42 });
  assert.equal(value(expression, { seed: 42 }), first);
  assert.notEqual(value(expression, { seed: 43 }), first);
  assert.ok(first >= -2 && first < 3);
});
test('query aliases and placeholder variables resolve at each time', () => {
  const source = 'math.sin(q.anim_time * 360) * variable.amplitude + query.life_time + v.offset';
  const context = { variables: { amplitude: 15, offset: 2 }, life_time: 3 };
  for (const [time, expected] of [[0, 5], [0.25, 20], [0.5, 5]]) {
    assert.ok(Math.abs(value(source, { ...context, 'query.anim_time': time }) - expected) < 1e-10);
  }
  assert.equal(value('v.foo + variable.missing', { 'variable.foo': 7 }), 7);
  assert.equal(value('v.Speed + VARIABLE.OFFSET', { variables: { Speed: 3 }, 'v.Offset': 4 }), 7);
  assert.equal(value('variable.speed', { 'VaRiAbLe.SpEeD': 5 }), 5);
  assert.equal(value('query.anim_time + q.life_time', { query: { anim_time: 2, life_time: 3 } }), 5);
});
test('invalid or unsafe input reports Vietnamese error and never executes code', () => {
  for (const source of ['', '1 +', '(2', '2 3', 'math.sin()', 'math.tan(0)', 'window.alert(1)', '1 / 0', '1e999', '1; globalThis.x=1', '('.repeat(150) + '1' + ')'.repeat(150)]) {
    const result = evaluateMolang(source);
    assert.equal(result.value, null, source);
    assert.equal(typeof result.error, 'string', source);
    assert.ok(result.error.length > 0, source);
  }
  assert.ok(evaluateMolang('v.a', { variables: { a: Infinity } }).error);
  assert.ok(evaluateMolang('1'.repeat(5000)).error);
});
