import {test} from 'node:test';
import assert from 'node:assert/strict';
import {widgetOwnsKey, timelineActionAllowed} from './shortcut_context.js';

test('widget navigation and panel cancellation precede global bindings', () => {
  const target = {closest: selector => selector.includes('[role=tab]') ? {} : null};
  assert.equal(widgetOwnsKey({key:'ArrowRight',target}), true);
  assert.equal(widgetOwnsKey({key:'q',target}), false);
  const panel = {closest: selector => selector.includes('#easingPanel') ? {} : null};
  assert.equal(widgetOwnsKey({key:'Escape',target:panel}), true);
  assert.equal(widgetOwnsKey({key:'ArrowRight',target:{closest:()=>null}}), false);
});

test('read-only timeline still permits navigation but rejects mutation', () => {
  for (const id of ['key.moveBack','key.moveForward','timeline.setEnd']) {
    assert.equal(timelineActionAllowed(id,true), false);
    assert.equal(timelineActionAllowed(id,false), true);
  }
  for (const id of ['timeline.start','timeline.end','timeline.frameBack','timeline.frameNext'])
    assert.equal(timelineActionAllowed(id,true), true);
});

test('central dispatcher routes from focused control outward and respects cancellation', async () => {
  const {registerWidgetKey, dispatchWidgetKey} = await import('./shortcut_context.js');
  const parent = {parentNode:null}, child = {parentNode:parent}, seen = [];
  const offParent = registerWidgetKey(parent, () => seen.push('parent'));
  const offChild = registerWidgetKey(child, e => { seen.push('child'); e.cancelBubble = true; });
  assert.equal(dispatchWidgetKey({target:child,cancelBubble:false}), true);
  assert.deepEqual(seen, ['child']);
  offChild(); seen.length = 0;
  assert.equal(dispatchWidgetKey({target:child,cancelBubble:false}), false);
  assert.deepEqual(seen, ['parent']);
  offParent();
});

test('capture callbacks cancel later captures and focused widget dispatch', async () => {
  const {registerWidgetCapture, dispatchWidgetCapture} = await import('./shortcut_context.js');
  const calls = [];
  const first = registerWidgetCapture(e => { calls.push('drag rollback'); e.cancelBubble = true; });
  const second = registerWidgetCapture(() => calls.push('later capture'));
  assert.equal(dispatchWidgetCapture({key:'Escape',cancelBubble:false}), true);
  assert.deepEqual(calls, ['drag rollback']);
  first(); second();
});

test('dispatcher phases preserve capture, focused control, document, window order', async () => {
  const {registerWidgetCapture,dispatchWidgetCapture,registerWidgetKey,dispatchWidgetKey,registerWidgetBubble,dispatchWidgetBubble} = await import('./shortcut_context.js');
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  globalThis.document = {}; globalThis.window = {};
  const target = {parentNode:null}, calls = [], event = {target,cancelBubble:false};
  const off = [registerWidgetBubble(window,()=>calls.push('window')), registerWidgetBubble(document,()=>calls.push('document')), registerWidgetKey(target,()=>calls.push('target')), registerWidgetCapture(()=>calls.push('capture'))];
  dispatchWidgetCapture(event); dispatchWidgetKey(event); dispatchWidgetBubble(event);
  assert.deepEqual(calls,['capture','target','document','window']);
  off.forEach(fn=>fn()); globalThis.document = oldDocument; globalThis.window = oldWindow;
});
