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
test('viewport layout select keeps 1/2/3/4 khung and appends "1 khung · Cả cảnh" (sceneSingle); the shot camera button starts hidden', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const select = html.match(/<select id="viewportLayout"[^>]*>(.*?)<\/select>/s)[1];
  assert.deepEqual(
    [...select.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]),
    [
      ['single', '1 khung'],
      ['dual', '2 khung · Front + Pers'],
      ['triple', '3 khung · Front / Pers / Left'],
      ['quad', '4 khung · Front / Pers / Back / Left'],
      ['sceneSingle', '1 khung · Cả cảnh'],
    ],
  );
  assert.match(html, /<button id="sceneCameraBtn"[^>]* hidden[^>]*aria-pressed="false"[^>]*>Nhìn qua camera cảnh<\/button>/);
  const css = readFileSync(new URL('./workspace_ui.css', import.meta.url), 'utf8');
  assert.match(css, /#viewportGrid\[data-layout="sceneSingle"\]/);
});
