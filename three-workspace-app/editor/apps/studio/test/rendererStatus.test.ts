import assert from 'node:assert/strict'
import test from 'node:test'
import { rendererStatusText } from '../app/workbench/components/scene-render/RendererStatus.tsx'

test('renderer status stays hidden without inspected renderer metadata', () => {
  assert.equal(rendererStatusText(undefined), null)
  assert.equal(rendererStatusText({ renderer: '@topview/3d-director-cli' }), null)
  assert.equal(rendererStatusText({ renderDevices: [{ kind: 'gpu', name: '' }] }), null)
})

test('renderer status reports actual GPU names and generic CPU fallback', () => {
  assert.equal(rendererStatusText({
    renderDevices: [{ kind: 'gpu', name: 'NVIDIA GeForce RTX 3060' }],
  }), 'GPU: NVIDIA GeForce RTX 3060')
  assert.equal(rendererStatusText({
    renderDevices: [{ kind: 'cpu', name: 'SwiftShader' }],
  }), 'CPU')
})

test('renderer status displays mixed devices explicitly', () => {
  assert.equal(rendererStatusText({
    renderDevices: [
      { kind: 'gpu', name: 'AMD Radeon RX 7900 XT' },
      { kind: 'cpu', name: 'SwiftShader' },
    ],
  }), 'GPU: AMD Radeon RX 7900 XT · CPU')
})
