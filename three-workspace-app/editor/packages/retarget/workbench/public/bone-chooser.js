let closeCurrent = () => {}
let sequence = 0

export function closeBoneChooser() { closeCurrent() }

/** Editable source name plus a viewport-bound, keyboard-accessible list. */
export function boneChooser(input, names, assign) {
  const host = document.createElement('div')
  host.className = 'bone-chooser'
  const arrow = document.createElement('button')
  arrow.type = 'button'
  arrow.textContent = '▾'
  arrow.setAttribute('aria-label', `${input.getAttribute('aria-label')}: mở danh sách`)
  const id = `bone-options-${++sequence}`
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-controls', id)
  input.setAttribute('aria-expanded', 'false')
  arrow.setAttribute('aria-controls', id)
  arrow.setAttribute('aria-expanded', 'false')
  host.append(input, arrow)
  let popup, filtered = [], active = -1
  function close() {
    if (!popup) return
    popup.remove()
    popup = null
    input.setAttribute('aria-expanded', 'false')
    arrow.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
    window.removeEventListener('resize', position)
    document.removeEventListener('scroll', position, true)
    document.removeEventListener('pointerdown', outside, true)
    closeCurrent = () => {}
  }
  function position() {
    if (!popup) return
    const r = host.getBoundingClientRect()
    const width = document.documentElement.clientWidth
    const height = document.documentElement.clientHeight
    if (!host.isConnected || r.bottom <= 0 || r.top >= height || r.right <= 0 || r.left >= width) { close(); return }
    const below = Math.max(0, height - Math.max(8, r.bottom) - 8)
    const above = Math.max(0, Math.min(height - 8, r.top) - 8)
    const down = below >= Math.min(240, above)
    const room = Math.min(320, down ? below : above)
    popup.style.width = `${Math.max(0, Math.min(Math.max(r.width, 240), width - 16))}px`
    popup.style.left = `${Math.max(8, Math.min(r.left, width - popup.offsetWidth - 8))}px`
    popup.style.maxHeight = `${room}px`
    popup.style.top = `${down ? Math.max(8, r.bottom) : Math.min(height - 8, r.top) - Math.min(popup.scrollHeight, room)}px`
  }
  function outside(event) {
    if (!host.contains(event.target) && !popup?.contains(event.target)) close()
  }
  function select(name) {
    close()
    input.value = name
    assign(name)
  }
  function highlight(index) {
    active = index
    for (const [i, option] of [...popup.children].entries()) option.setAttribute('aria-selected', String(i === active))
    const option = popup.children[active]
    if (option) {
      input.setAttribute('aria-activedescendant', option.id)
      option.scrollIntoView({ block: 'nearest' })
    } else input.removeAttribute('aria-activedescendant')
  }
  function render(query) {
    filtered = names.filter(name => name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    popup.replaceChildren()
    for (const [i, name] of filtered.entries()) {
      const option = document.createElement('div')
      option.id = `${id}-${i}`
      option.setAttribute('role', 'option')
      option.textContent = name
      option.addEventListener('pointerdown', event => event.preventDefault())
      option.addEventListener('click', () => select(name))
      popup.append(option)
    }
    if (!filtered.length) {
      const empty = document.createElement('div')
      empty.textContent = 'Không có xương phù hợp'
      empty.setAttribute('role', 'status')
      popup.append(empty)
    }
    active = -1
    input.removeAttribute('aria-activedescendant')
    position()
  }
  function open(query = '') {
    if (!popup) {
      closeCurrent()
      popup = document.createElement('div')
      popup.id = id
      popup.className = 'bone-options'
      popup.setAttribute('role', 'listbox')
      popup.setAttribute('aria-label', 'Xương nguồn')
      document.body.append(popup)
      closeCurrent = close
      input.setAttribute('aria-expanded', 'true')
      arrow.setAttribute('aria-expanded', 'true')
      window.addEventListener('resize', position)
      document.addEventListener('scroll', position, true)
      document.addEventListener('pointerdown', outside, true)
    }
    render(query)
  }
  arrow.addEventListener('pointerdown', event => event.preventDefault())
  arrow.addEventListener('click', () => { input.focus(); if (popup) close(); else open() })
  input.addEventListener('input', () => open(input.value))
  input.addEventListener('blur', close)
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && popup) { event.preventDefault(); close() }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!popup) open()
      if (filtered.length) highlight(active < 0 ? (event.key === 'ArrowDown' ? 0 : filtered.length - 1) : Math.max(0, Math.min(filtered.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Enter' && popup && active >= 0) { event.preventDefault(); select(filtered[active]) }
    else if (event.key === 'Tab') close()
  })
  return host
}
