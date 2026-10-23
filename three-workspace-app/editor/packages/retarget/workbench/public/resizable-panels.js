const root = typeof document === 'undefined' ? null : document.querySelector('.layout')

const specs = {
  steps: { axis: 'x', property: '--steps-width', fallback: 320, min: 240, max: 480, direction: 1 },
  results: { axis: 'x', property: '--results-width', fallback: 460, min: 300, max: 620, direction: -1 },
  viewer: { axis: 'x', property: '--source-width', fallback: 0.5, min: 180, direction: 1 },
  timeline: { axis: 'y', property: '--transport-height', fallback: 104, min: 86, max: 260, direction: -1 },
}

export const clampPanelSize = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)))

function storedNumber(key) {
  try {
    const value = Number(window.localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch { return null }
}

function saveNumber(key, value) {
  try { window.localStorage.setItem(key, String(Math.round(value))) } catch { /* resizing remains available */ }
}

function clearNumber(key) {
  try { window.localStorage.removeItem(key) } catch { /* reset still applies in memory */ }
}

function bounds(name, spec) {
  if (name === 'viewer') {
    const width = root?.querySelector('.viewers')?.clientWidth ?? 720
    return { min: spec.min, max: Math.max(spec.min, width - spec.min - 6) }
  }
  if (name === 'steps' || name === 'results') {
    const width = root?.clientWidth ?? 1440
    return { min: spec.min, max: Math.min(spec.max, Math.max(spec.min, width - 660)) }
  }
  const stageHeight = root?.querySelector('.stage')?.clientHeight ?? 600
  return { min: spec.min, max: Math.min(spec.max, Math.max(spec.min, stageHeight - 186)) }
}

function defaultValue(name, spec) {
  if (name !== 'viewer') return spec.fallback
  const width = root?.querySelector('.viewers')?.clientWidth ?? 720
  return Math.max(spec.min, (width - 6) * spec.fallback)
}

function apply(name, value) {
  const spec = specs[name]
  const range = bounds(name, spec)
  const next = clampPanelSize(value, range.min, range.max)
  const target = name === 'viewer' || name === 'timeline' ? root?.querySelector('.stage') : root
  target?.style.setProperty(spec.property, `${next}px`)
  return next
}

if (root) {
  const resizeTargets = [root, root.querySelector('.viewers'), root.querySelector('.stage')].filter(Boolean)
  const fitToViewport = () => {
    for (const [name, spec] of Object.entries(specs)) {
      const target = name === 'viewer' || name === 'timeline' ? root.querySelector('.stage') : root
      const current = Number.parseFloat(target?.style.getPropertyValue(spec.property))
      apply(name, Number.isFinite(current) && current > 0 ? current : storedNumber(`w01.workbench.panel.${name}`) ?? defaultValue(name, spec))
    }
  }

  for (const handle of root.querySelectorAll('[data-resize-panel]')) {
    const name = handle.dataset.resizePanel
    const spec = specs[name]
    if (!spec) continue
    const key = `w01.workbench.panel.${name}`
    apply(name, storedNumber(key) ?? defaultValue(name, spec))

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || matchMedia('(max-width: 1279px)').matches) return
      event.preventDefault()
      const start = spec.axis === 'x' ? event.clientX : event.clientY
      const target = name === 'viewer' || name === 'timeline' ? root.querySelector('.stage') : root
      const current = Number.parseFloat(target.style.getPropertyValue(spec.property)) || defaultValue(name, spec)
      handle.classList.add('is-dragging')
      document.body.style.cursor = spec.axis === 'x' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      const move = (moveEvent) => {
        const point = spec.axis === 'x' ? moveEvent.clientX : moveEvent.clientY
        apply(name, current + spec.direction * (point - start))
      }
      const stop = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
        window.removeEventListener('pointercancel', stop)
        handle.classList.remove('is-dragging')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        const value = Number.parseFloat(target.style.getPropertyValue(spec.property))
        saveNumber(key, value)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop)
      window.addEventListener('pointercancel', stop)
    })

    handle.addEventListener('dblclick', () => {
      clearNumber(key)
      apply(name, defaultValue(name, spec))
    })
  }

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(fitToViewport)
    for (const target of resizeTargets) observer.observe(target)
  }
}
