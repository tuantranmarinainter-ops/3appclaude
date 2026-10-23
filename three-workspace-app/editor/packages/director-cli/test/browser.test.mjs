import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chromiumRenderArgs,
  classifyWebglRenderer,
  gpuRenderRequested,
  launchRenderBrowser,
} from '../browser.mjs'

test('GPU mode follows W01_RENDER_GPU and defaults on Windows', () => {
  assert.equal(gpuRenderRequested({}, 'win32'), true)
  assert.equal(gpuRenderRequested({}, 'linux'), false)
  assert.equal(gpuRenderRequested({ W01_RENDER_GPU: '1' }, 'linux'), true)
  assert.equal(gpuRenderRequested({ W01_RENDER_GPU: '0' }, 'win32'), false)
})

test('Chromium GPU flags select the platform backend and CPU stays deterministic', () => {
  assert.deepEqual(chromiumRenderArgs(true, 'win32').slice(0, 3), [
    '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
  ])
  assert.equal(chromiumRenderArgs(true, 'linux')[0], '--use-angle=gl')
  assert.equal(chromiumRenderArgs(true, 'darwin')[0], '--use-angle=metal')
  assert.deepEqual(chromiumRenderArgs(false).slice(0, 3), [
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  ])
})

test('renderer classification uses unmasked WEBGL_debug_renderer_info', () => {
  assert.deepEqual(classifyWebglRenderer({
    webgl: true,
    renderer: 'ANGLE',
    unmaskedRenderer: 'NVIDIA GeForce RTX 3060 Direct3D11',
  }), {
    kind: 'gpu', name: 'NVIDIA GeForce RTX 3060 Direct3D11', raw: 'NVIDIA GeForce RTX 3060 Direct3D11',
  })
  assert.equal(classifyWebglRenderer({
    webgl: true, renderer: 'ANGLE', unmaskedRenderer: 'ANGLE (Google, Vulkan 1.3 SwiftShader Device)',
  }).kind, 'cpu')
  assert.equal(classifyWebglRenderer({
    webgl: true, renderer: 'WebKit WebGL', unmaskedRenderer: '',
  }).kind, 'cpu')
  assert.equal(classifyWebglRenderer({
    webgl: true, renderer: 'ANGLE', unmaskedRenderer: 'Microsoft Basic Render Driver (WARP)',
  }).kind, 'cpu')
  assert.equal(classifyWebglRenderer({
    webgl: true, renderer: 'ANGLE', unmaskedRenderer: 'llvmpipe (LLVM 19.1)',
  }).name, 'llvmpipe (LLVM 19.1)')
  assert.equal(classifyWebglRenderer({ webgl: false }).kind, 'cpu')
})

function fakeChromium(rendererInfos) {
  const launches = []
  return {
    launches,
    chromium: {
      async launch(options) {
        const info = rendererInfos[launches.length]
        const browser = {
          closed: false,
          async newPage() {
            return {
              evaluate: async () => info,
              close: async () => undefined,
            }
          },
          async close() { browser.closed = true },
        }
        launches.push({ options, browser })
        return browser
      },
    },
  }
}

test('GPU attempt returns the inspected hardware renderer without fallback', async () => {
  const fake = fakeChromium([{ webgl: true, renderer: 'ANGLE', unmaskedRenderer: 'NVIDIA RTX 3060' }])
  const result = await launchRenderBrowser(fake.chromium, { gpu: true })
  assert.equal(fake.launches.length, 1)
  assert.equal(result.renderer.kind, 'gpu')
  assert.deepEqual(result.warnings, [])
  assert.equal(result.browser, fake.launches[0].browser)
  await result.browser.close()
})

test('SwiftShader GPU attempt is closed before a clean CPU fallback', async () => {
  const software = { webgl: true, renderer: 'ANGLE', unmaskedRenderer: 'Google SwiftShader' }
  const fake = fakeChromium([software, software])
  const result = await launchRenderBrowser(fake.chromium, { gpu: true })
  assert.equal(fake.launches.length, 2)
  assert.equal(fake.launches[0].browser.closed, true)
  assert.equal(fake.launches[1].browser.closed, false)
  assert.equal(result.renderer.kind, 'cpu')
  assert.match(result.warnings[0], /^GPU_RENDER_FALLBACK:/)
  assert.ok(fake.launches[1].options.args.includes('--use-angle=swiftshader'))
  await result.browser.close()
})
