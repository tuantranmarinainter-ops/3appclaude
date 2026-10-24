const root = typeof document === 'undefined' ? null : document.querySelector('.layout')

const specs = {
  steps: { axis: 'x', property: '--steps-width', fallback: 320, min: 240, max: 480, direction: 1 },
  results: { axis: 'x', property: '--results-width', fallback: 460, min: 300, max: 620, direction: -1 },
  review: { axis: 'x', property: '--review-width', fallback: 300, min: 240, direction: -1 },
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

const viewers = root?.querySelector('.viewers')
const review = root?.querySelector('#review')
const targetFor = (name) => ['viewer', 'timeline', 'review'].includes(name) ? root?.querySelector('.stage') : root
const reviewVisible = () => review && !review.hidden
function panelSpec(name) {
  return name === 'review' && viewers?.classList.contains('review-below')
    ? { axis: 'y', property: '--review-height', fallback: 220, min: 220, direction: -1 }
    : specs[name]
}
function reviewWidth() {
  return reviewVisible() && !viewers.classList.contains('review-below') ? (review.getBoundingClientRect().width || 300) + 6 : 0
}

function bounds(name, spec) {
  if (name === 'review') {
    const available = spec.axis === 'x' ? (viewers?.clientWidth ?? 720) - 372 : (viewers?.clientHeight ?? 600) - 186
    return { min: spec.min, max: Math.max(spec.min, available) }
  }
  if (name === 'viewer') {
    const width = root?.querySelector('.viewers')?.clientWidth ?? 720
    return { min: spec.min, max: Math.max(spec.min, width - reviewWidth() - spec.min - 6) }
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
  return Math.max(spec.min, (width - reviewWidth() - 6) * spec.fallback)
}

function apply(name, value) {
  const spec = panelSpec(name)
  const range = bounds(name, spec)
  const next = clampPanelSize(value, range.min, range.max)
  const target = targetFor(name)
  target?.style.setProperty(spec.property, `${next}px`)
  const handle = root?.querySelector(`[data-resize-panel="${name}"]`)
  handle?.setAttribute('aria-valuemin', String(range.min))
  handle?.setAttribute('aria-valuemax', String(range.max))
  handle?.setAttribute('aria-valuenow', String(next))
  handle?.setAttribute('aria-orientation', spec.axis === 'x' ? 'vertical' : 'horizontal')
  if (name === 'review') {
    const current = Number.parseFloat(targetFor('viewer')?.style.getPropertyValue('--source-width'))
    apply('viewer', current > 0 ? current : defaultValue('viewer', specs.viewer))
  }
  return next
}

if (root) {
  const resizeTargets = [root, root.querySelector('.viewers'), root.querySelector('.stage')].filter(Boolean)
  const fitToViewport = () => {
    viewers.classList.toggle('review-below', reviewVisible() && targetFor('review').clientWidth < 732)
    const handle = root.querySelector('[data-resize-panel="review"]')
    handle.hidden = !reviewVisible()
    for (const name of ['review', 'viewer']) {
      const spec = panelSpec(name)
      const current = Number.parseFloat(targetFor(name).style.getPropertyValue(spec.property))
      apply(name, current > 0 ? current : storedNumber(`w01.workbench.panel.${name}${spec.axis === 'y' && name === 'review' ? '.height' : ''}`) ?? defaultValue(name, spec))
    }
    for (const [name, spec] of Object.entries(specs)) {
      if (name === 'review' || name === 'viewer') continue
      const target = targetFor(name)
      const current = Number.parseFloat(target?.style.getPropertyValue(spec.property))
      apply(name, Number.isFinite(current) && current > 0 ? current : storedNumber(`w01.workbench.panel.${name}`) ?? defaultValue(name, spec))
    }
  }

  for (const handle of root.querySelectorAll('[data-resize-panel]')) {
    const name = handle.dataset.resizePanel
    if (!specs[name]) continue
    const storageKey = () => `w01.workbench.panel.${name}${name === 'review' && panelSpec(name).axis === 'y' ? '.height' : ''}`
    const enabled = () => !handle.hidden && !(matchMedia('(max-width: 1279px)').matches && ['steps', 'results'].includes(name))
    handle.addEventListener('keydown', (event) => {
      if (!enabled()) return
      const spec = panelSpec(name)
      const keys = spec.axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
      if (![...keys, 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      const range = bounds(name, spec)
      const current = Number.parseFloat(targetFor(name).style.getPropertyValue(spec.property)) || defaultValue(name, spec)
      const value = event.key === 'Home' ? range.min : event.key === 'End' ? range.max : current + (event.key === keys[0] ? -1 : 1) * spec.direction * (event.shiftKey ? 40 : 10)
      saveNumber(storageKey(), apply(name, value))
    })

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !enabled()) return
      const spec = panelSpec(name)
      const key = storageKey()
      event.preventDefault()
      const start = spec.axis === 'x' ? event.clientX : event.clientY
      const target = targetFor(name)
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
      const spec = panelSpec(name)
      clearNumber(storageKey())
      apply(name, defaultValue(name, spec))
    })
  }

  new MutationObserver(fitToViewport).observe(review, { attributes: true, attributeFilter: ['hidden'] })
  fitToViewport()

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(fitToViewport)
    for (const target of resizeTargets) observer.observe(target)
  }
}
