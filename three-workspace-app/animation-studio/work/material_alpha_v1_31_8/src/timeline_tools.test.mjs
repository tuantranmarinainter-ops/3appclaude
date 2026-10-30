import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjacentKey,
  colorKeys,
  colorIndex,
  keyColor,
  KEY_COLORS,
  playMode,
  previewAt,
  validateTimeline,
} from './timeline_tools.js';
test('key navigation deduplicates equal times, respects selected bone and boundaries', () => {
  const p = { keys: { a: [{ time: 0 }, { time: 1 }, { time: 2 }], b: [{ time: 1 }, { time: 3 }] } };
  assert.equal(adjacentKey(p, null, 0, 1), 1);
  assert.equal(adjacentKey(p, null, 1, 1), 2);
  assert.equal(adjacentKey(p, null, 2, -1), 1);
  assert.equal(adjacentKey(p, 'b', 1, 1), 3);
  assert.equal(adjacentKey(p, 'a', 2, 1), null);
  assert.equal(adjacentKey(p, null, 0, -1), null);
  assert.equal(adjacentKey({ ...p, ikModes: { arm: [{ time: 0.25 }] } }, null, 0, 1), 0.25);
});
test('color survives JSON, applies to all selected keys and clears without changing samples', () => {
  const p = { keys: { a: [{ time: 1, p: [1, 2, 3] }], b: [{ time: 1, p: [4, 5, 6] }] } };
  const refs = [
    { id: 'a', time: 1 },
    { id: 'b', time: 1 },
  ];
  const colored = colorKeys(p, refs, KEY_COLORS[3]);
  assert.equal(p.keys.a[0].color, undefined);
  const saved = JSON.parse(JSON.stringify(colored));
  assert.equal(keyColor(saved, refs, colorIndex(saved)), KEY_COLORS[3]);
  assert.equal(saved.keys.a[0].color, KEY_COLORS[3]);
  assert.equal(saved.keys.b[0].color, KEY_COLORS[3]);
  assert.deepEqual(colorKeys(saved, refs, null), p);
  assert.throws(() => colorKeys(p, refs, 'red'));
});
test('legacy preview defaults to loop; once resets and hold retains last frame', () => {
  const p = { keys: {}, loop: [0, 2] };
  assert.equal(playMode(p), 'loop');
  for (const [mode, last] of [
    ['once', 0],
    ['loop', 0.5],
    ['hold', 2],
  ]) {
    const project = { ...p, playMode: mode };
    assert.deepEqual(previewAt(project, 0), { time: 0, playing: true });
    assert.equal(previewAt(project, 1).time, 1);
    assert.equal(previewAt(project, 2.5).time, last);
    assert.equal(previewAt(project, 2.5).playing, mode === 'loop');
  }
  assert.equal(playMode({ ...p, loopEnabled: false }), 'once');
});
test('start and loop waits hold poses and preserve overshoot over many cycles', () => {
  const p = { keys: {}, loop: [1, 3], playMode: 'loop', startDelay: 1, loopDelay: 0.5 };
  for (const [elapsed, time] of [
    [0, 1],
    [0.5, 1],
    [1, 1],
    [2, 2],
    [3, 3],
    [3.25, 3],
    [3.5, 1],
    [4.5, 2],
    [5.5, 3],
    [6, 1],
    [101, 1],
  ])
    assert.equal(previewAt(p, elapsed).time, time, `elapsed ${elapsed}`);
  assert.equal(previewAt(p, 1.5, p.loop, 2).time, 2.5);
});
test('new fields are optional, invalid mode/delay/color rejected without mutating old project', () => {
  const p = { keys: {}, loop: [0, 2] };
  const saved = JSON.stringify(p);
  validateTimeline(p);
  assert.equal(JSON.stringify(p), saved);
  for (const patch of [
    { playMode: 'bad' },
    { startDelay: -1 },
    { loopDelay: NaN },
    { keys: { a: [{ color: 'bad' }] } },
  ])
    assert.throws(() => validateTimeline({ ...p, ...patch }));
});
