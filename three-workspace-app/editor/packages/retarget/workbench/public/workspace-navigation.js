(() => {
  const root = document.querySelector('.workspace-navigation')
  if (!root) return

  const workspaces = [
    ['normalize', 'Chuẩn hoá'], ['scene', 'Dựng cảnh'], ['animation', 'Animation'], ['vfx', 'VFX'], ['library', 'Thư viện'],
  ]
  const hints = {
    scene: 'Chưa cấu hình W01_STUDIO_URL', animation: 'Chưa cấu hình W01_ANIMATION_STUDIO_URL',
    vfx: 'Chưa cấu hình W01_VFX_URL', library: 'Chưa cấu hình W01_STUDIO_URL',
  }
  const unified = new URLSearchParams(location.search).get('unified')
  const configured = {}

  const safeUrl = (value) => {
    if (typeof value !== 'string' || !value) return null
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
    } catch { return null }
  }

  const hrefFor = (id) => {
    if (id === 'normalize') return location.href
    const url = safeUrl(id === 'scene' || id === 'library' ? configured.studioUrl : configured[`${id}Url`])
    if (!url) return null
    if (id === 'library') url.pathname = `${url.pathname.replace(/\/$/, '')}/library`
    if (unified) url.searchParams.set('unified', unified)
    return url.toString()
  }

  const render = () => {
    const list = document.createElement('ol')
    for (const [index, [id, label]] of workspaces.entries()) {
    const item = document.createElement('li')
    const href = hrefFor(id)
    const control = document.createElement(href ? 'a' : 'span')
    const number = document.createElement('span')
    number.textContent = String(index + 1)
    number.setAttribute('aria-hidden', 'true')
    control.append(number, document.createTextNode(label))
    if (href) control.href = href
    else {
      control.className = 'is-disabled'
      control.setAttribute('aria-disabled', 'true')
      control.title = hints[id] || ''
    }
    if (id === root.dataset.activeWorkspace) {
      control.classList.add('is-active')
      control.setAttribute('aria-current', 'page')
    }
    item.append(control)
      list.append(item)
    }
    root.replaceChildren(list)
  }

  render()
  fetch('/api/workspace-navigation', { headers: { accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : {})
    .then((value) => {
      for (const key of ['studioUrl', 'animationUrl', 'vfxUrl']) {
        if (typeof value?.[key] === 'string') configured[key] = value[key]
      }
      render()
    })
    .catch(() => {})
})()
