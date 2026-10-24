/** A temporary screen-space wire; all assignments use the same mapping transaction as the chooser. */
export function mappingDrag(target, source, callbacks) {
  let drag = null
  const resetHover = () => { source.hovered = null }
  const finish = (event, assign = false) => {
    if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return
    const current = drag
    const hit = assign ? document.elementFromPoint(event.clientX, event.clientY)?.closest('.joint-marker') : null
    const bone = hit && source.element.contains(hit) && !hit.hidden ? hit.dataset.bone : null
    drag = null
    current.wire.remove()
    resetHover()
    current.marker.releasePointerCapture?.(current.pointerId)
    if (current.moved) {
      const suppress = (click) => { click.preventDefault(); click.stopImmediatePropagation() }
      current.marker.addEventListener('click', suppress, { capture: true, once: true })
      setTimeout(() => current.marker.removeEventListener('click', suppress, true), 0)
    }
    try { if (assign && current.moved && bone) callbacks.assign(bone) }
    finally { callbacks.end() }
  }
  target.element.addEventListener('pointerdown', (event) => {
    const marker = event.target.closest('.joint-marker')
    if (event.button !== 0 || drag || !marker || marker.hidden || !callbacks.start(marker.dataset.bone)) return
    event.preventDefault()
    const wire = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    wire.classList.add('mapping-wire')
    wire.setAttribute('aria-hidden', 'true')
    const line = document.createElementNS(wire.namespaceURI, 'line')
    wire.append(line); document.body.append(wire)
    const box = marker.getBoundingClientRect()
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    for (const [key, value] of Object.entries({ x1: x, y1: y, x2: event.clientX, y2: event.clientY })) line.setAttribute(key, String(value))
    drag = { marker, wire, line, pointerId: event.pointerId, x, y, moved: false }
    marker.setPointerCapture(event.pointerId)
  }, true)
  window.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    if (!drag.marker.isConnected) { finish(event); return }
    drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4
    drag.line.setAttribute('x2', String(event.clientX)); drag.line.setAttribute('y2', String(event.clientY))
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('.joint-marker')
    source.hovered = hit && source.element.contains(hit) && !hit.hidden ? hit.dataset.bone : null
  })
  window.addEventListener('pointerup', (event) => finish(event, true))
  window.addEventListener('pointercancel', (event) => finish(event))
  target.element.addEventListener('lostpointercapture', (event) => finish(event))
  window.addEventListener('blur', () => { if (drag) finish({ pointerId: drag.pointerId }) })
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && drag) { event.preventDefault(); finish({ pointerId: drag.pointerId }) } })
  const observer = new MutationObserver((changes) => { if (drag && (!drag.marker.isConnected || changes.some((change) => change.target === source.element))) finish({ pointerId: drag.pointerId }) })
  observer.observe(target.element, { childList: true })
  observer.observe(source.element, { childList: true })
}
