import assert from 'node:assert/strict'
import test from 'node:test'
import { Bone, Group, PerspectiveCamera } from 'three'
import { canonicalJoint, DEFAULT_JOINT_SETTINGS, JointOverlay, jointSettings, showJointLabel } from '../workbench/public/joint-overlay.js'

test('joint display validates persisted values without accepting invalid CSS or non-finite sizes', () => {
  assert.deepEqual(jointSettings(null), DEFAULT_JOINT_SETTINGS)
  assert.deepEqual(jointSettings({ points: 'false', color: 'red;display:none', size: Infinity, labels: 1, fontSize: NaN, scope: 'bogus' }), DEFAULT_JOINT_SETTINGS)
  assert.deepEqual(jointSettings({ points: false, color: '#abcdef', size: 99, labels: true, fontSize: 1, scope: 'all' }), { points: false, color: '#abcdef', size: 20, labels: true, fontSize: 8, scope: 'all' })
})

test('label scopes distinguish selected and unmapped joints, independent of point visibility', () => {
  for (const points of [true, false]) {
    for (const selected of [true, false]) for (const mapped of [true, false]) {
      const settings = { ...DEFAULT_JOINT_SETTINGS, points, labels: true }
      assert.equal(showJointLabel({ ...settings, scope: 'all' }, selected, mapped), true)
      assert.equal(showJointLabel({ ...settings, scope: 'selected' }, selected, mapped), selected)
      assert.equal(showJointLabel({ ...settings, scope: 'unmapped' }, selected, mapped), !mapped)
      assert.equal(showJointLabel({ ...settings, labels: false }, selected, mapped), false)
    }
  }
  assert.equal(canonicalJoint('mixamorig:Hips'), 'Hips')
  assert.equal(canonicalJoint('mixamorigLeftArm'), 'LeftArm')
  assert.equal(canonicalJoint('joint_Hip'), 'joint_Hip')
})

test('overlay tracks the camera, preserves offscreen selection, picks names safely and clears old markers', (t) => {
  const element = () => ({
    children: [] as any[], dataset: {} as Record<string, string>, hidden: false,
    style: { transform: '', setProperty() {} },
    classList: { values: new Set(), toggle(key: string, on: boolean) { on ? this.values.add(key) : this.values.delete(key) } },
    attributes: {} as Record<string, string>, events: {} as Record<string, Function>,
    append(child: any) { this.children.push(child) }, replaceChildren() { this.children = [] },
    setAttribute(key: string, value: string) { this.attributes[key] = value },
    addEventListener(key: string, callback: Function) { this.events[key] = callback },
  })
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: element } })
  t.after(() => { if (original) Object.defineProperty(globalThis, 'document', original); else delete (globalThis as any).document })
  const overlay = new JointOverlay(element())
  const group = new Group(), bone = new Bone()
  bone.name = 'mixamorig:Hips'; group.add(bone); group.updateMatrixWorld(true)
  overlay.setModel(group)
  const camera = new PerspectiveCamera(45, 1, 0.01, 100)
  camera.position.z = 5; camera.updateMatrixWorld(true)
  overlay.canonical = true; overlay.selected = new Set(['Hips'])
  overlay.render(camera, 400, 400)
  const marker = overlay.entries[0].marker
  assert.equal(marker.hidden, false)
  assert.equal(marker.style.transform, 'translate(200px,200px) translate(-50%,-50%)')
  let picked = ''
  overlay.onPick = (name: string) => { picked = name }
  marker.events.click()
  assert.equal(picked, bone.name)
  bone.position.x = 100; group.updateMatrixWorld(true)
  overlay.render(camera, 400, 400)
  assert.equal(marker.hidden, true)
  assert.equal(marker.attributes['aria-pressed'], 'true')
  assert.equal(marker.classList.values.has('selected'), true)
  overlay.clear()
  assert.equal(overlay.entries.length, 0)
  assert.equal(overlay.element.children.length, 0)
})
