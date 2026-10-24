import { Vector3 } from 'three'

export const JOINT_SETTINGS_KEY = 'w01.joint-display.v1'
export const DEFAULT_JOINT_SETTINGS = Object.freeze({ points: true, color: '#48c8ff', size: 8, labels: false, fontSize: 11, scope: 'selected' })

export function jointSettings(value = {}) {
  const defaults = DEFAULT_JOINT_SETTINGS
  value = value && typeof value === 'object' ? value : {}
  const number = (key, min, max) => typeof value[key] === 'number' && Number.isFinite(value[key]) ? Math.max(min, Math.min(max, value[key])) : defaults[key]
  return {
    points: typeof value.points === 'boolean' ? value.points : defaults.points,
    color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : defaults.color,
    size: number('size', 3, 20),
    labels: typeof value.labels === 'boolean' ? value.labels : defaults.labels,
    fontSize: number('fontSize', 8, 24),
    scope: ['selected', 'all', 'unmapped'].includes(value.scope) ? value.scope : defaults.scope,
  }
}

export function showJointLabel(settings, selected, mapped) {
  return settings.labels && (settings.scope === 'all' || (settings.scope === 'selected' ? selected : !mapped))
}

export const canonicalJoint = (name) => name.replace(/^mixamorig:?/i, '')

/** Screen-space overlays share the Pane camera, including before a valid retarget exists. */
export class JointOverlay {
  constructor(host) {
    this.element = document.createElement('div')
    this.element.className = 'joint-overlay'
    host.append(this.element)
    this.settings = jointSettings()
    this.selected = new Set()
    this.mapped = new Set()
    this.entries = []
    this.point = new Vector3()
  }

  clear() { this.element.replaceChildren(); this.entries = [] }

  setModel(object) {
    this.clear()
    object.traverse((bone) => {
      if (!bone.isBone) return
      const name = bone.userData.jointName ?? bone.name
      const marker = document.createElement('button')
      marker.type = 'button'
      marker.className = 'joint-marker'
      marker.dataset.bone = name
      marker.setAttribute('aria-label', `Chọn xương ${name}`)
      marker.title = name
      const label = document.createElement('span')
      label.className = 'bone-label'
      label.textContent = name
      marker.append(label)
      marker.addEventListener('pointerdown', (event) => event.stopPropagation())
      marker.addEventListener('click', () => this.onPick?.(name))
      this.element.append(marker)
      this.entries.push({ bone, name, marker, label })
    })
  }

  render(camera, width, height) {
    const settings = this.settings
    this.element.style.setProperty('--joint-color', settings.color)
    this.element.style.setProperty('--joint-size', `${settings.size}px`)
    this.element.style.setProperty('--joint-font-size', `${settings.fontSize}px`)
    for (const { bone, name, marker, label } of this.entries) {
      const key = this.canonical ? canonicalJoint(name) : name
      const selected = this.selected.has(key)
      const showLabel = showJointLabel(settings, selected, this.mapped.has(key))
      bone.getWorldPosition(this.point).project(camera)
      const visible = (settings.points || showLabel) && this.point.z >= -1 && this.point.z <= 1 && Math.abs(this.point.x) <= 1 && Math.abs(this.point.y) <= 1
      marker.classList.toggle('selected', selected)
      marker.setAttribute('aria-pressed', String(selected))
      marker.hidden = !visible
      if (!visible) continue
      marker.style.transform = `translate(${(this.point.x + 1) * width / 2}px,${(1 - this.point.y) * height / 2}px) translate(-50%,-50%)`
      marker.classList.toggle('label-only', !settings.points)
      label.hidden = !showLabel
    }
  }
}
