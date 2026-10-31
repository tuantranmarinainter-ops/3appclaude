// Context controls retain their keyboard behavior before application shortcuts.
export function widgetOwnsKey(event) {
  const target = event.target;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].includes(event.key) &&
      target?.closest?.('[role=tab],[role=separator],[data-joint],[data-resize],#motionLayerHandle,.motion-hand-grip')) return true;
  return event.key === 'Escape' && !!target?.closest?.('#easingPanel,#smoothingPanel,#texturePanel');
}
export function timelineActionAllowed(action, readOnly) {
  return !readOnly || !['key.moveBack', 'key.moveForward', 'timeline.setEnd'].includes(action);
}

// Keyboard handlers register with the application's single capture dispatcher.
// Invoke inner controls before their containing widgets, as DOM bubbling does.
const widgetHandlers = new Map();
export function registerWidgetKey(node, handler) {
  const handlers = widgetHandlers.get(node) || [];
  handlers.push(handler);
  widgetHandlers.set(node, handlers);
  return () => {
    const i = handlers.indexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
    if (!handlers.length) widgetHandlers.delete(node);
  };
}
export function dispatchWidgetKey(event) {
  for (let node = event.target; node; node = node.parentNode) {
    for (const handler of widgetHandlers.get(node) || []) {
      handler.call(node, event);
      if (event.cancelBubble) return true;
    }
  }
  return false;
}

const captureHandlers = [];
export function registerWidgetCapture(handler) {
  captureHandlers.push(handler);
  return () => { const i = captureHandlers.indexOf(handler); if (i >= 0) captureHandlers.splice(i, 1); };
}
export function dispatchWidgetCapture(event) {
  for (const handler of captureHandlers) {
    handler.call(globalThis.window, event);
    if (event.cancelBubble) return true;
  }
  return false;
}

const bubbleHandlers = [];
export function registerWidgetBubble(node, handler) {
  bubbleHandlers.push({node, handler});
  return () => { const i = bubbleHandlers.findIndex(x => x.node === node && x.handler === handler); if (i >= 0) bubbleHandlers.splice(i, 1); };
}
export function dispatchWidgetBubble(event) {
  // Document listeners precede window listeners in the native bubble phase.
  for (const node of [globalThis.document, globalThis.window]) {
    for (const item of bubbleHandlers) {
      if (item.node !== node) continue;
      item.handler.call(node, event);
      if (event.cancelBubble) return true;
    }
  }
  return false;
}
