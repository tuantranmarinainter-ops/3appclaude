import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLayout, panelState } from './layout_modes.js';
const store = (entries) => ({ getItem: (key) => entries[key] ?? null });
test('new users get modes, existing layouts remain classic, explicit choice wins', () => {
  assert.equal(initialLayout(store({})), 'modes');
  assert.equal(initialLayout(store({ 'animation-studio-layout-v2': '{}' })), 'classic');
  assert.equal(
    initialLayout(
      store({
        'animation-studio-layout-v2': '{}',
        'animation-studio-settings': '{"layoutMode":"modes"}',
      }),
    ),
    'modes',
  );
  assert.equal(
    initialLayout(store({ 'animation-studio-settings': '{"layoutMode":"classic"}' })),
    'classic',
  );
  assert.equal(
    initialLayout(
      store({ 'animation-studio-layout-v2': '{}', 'animation-studio-settings': 'broken' }),
    ),
    'classic',
  );
  assert.equal(
    initialLayout({
      getItem() {
        throw Error('storage denied');
      },
    }),
    'modes',
  );
});
test('per-tab panel snapshots are bounded, independent and tolerate malformed preferences', () => {
  const a = panelState({
    left: -5,
    right: 10000,
    timeline: NaN,
    leftOpen: false,
    drawer: 'bad',
    collapsed: { rig: true, bad: 'yes' },
  });
  assert.equal(a.left, 180);
  assert.equal(a.right, 600);
  assert.equal(a.timeline, 240);
  assert.equal(a.drawer, '');
  assert.equal(a.leftOpen, false);
  assert.deepEqual(a.collapsed, { rig: true });
  const b = panelState();
  b.collapsed.rig = false;
  assert.equal(a.collapsed.rig, true);
  assert.deepEqual(panelState(null), panelState());
});
