import { spawn } from 'node:child_process'
import path from 'node:path'
import { loadPlaywright, playwrightDir } from './playwright.mjs'

const GPU_RENDERER_SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software rasterizer|microsoft basic render|\bwarp\b|mesa offscreen|virtualbox|virgl/i

export function gpuRenderRequested(env = process.env, platform = process.platform) {
  if (env.W01_RENDER_GPU === '0') return false
  if (env.W01_RENDER_GPU === '1') return true
  return platform === 'win32'
}

export function chromiumRenderArgs(gpu, platform = process.platform) {
  const gpuAngle = platform === 'win32' ? 'd3d11' : platform === 'darwin' ? 'metal' : 'gl'
  return [
    ...(gpu
      ? [`--use-angle=${gpuAngle}`, '--enable-gpu', '--ignore-gpu-blocklist']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']),
    '--disable-dev-shm-usage',
    '--disable-web-security',
  ]
}

export function classifyWebglRenderer(info) {
  const raw = typeof info?.renderer === 'string' ? info.renderer.trim() : ''
  const unmasked = typeof info?.unmaskedRenderer === 'string' ? info.unmaskedRenderer.trim() : ''
  const actual = unmasked || raw || 'WebGL unavailable'
  const software = !info?.webgl || !unmasked || GPU_RENDERER_SOFTWARE.test(`${unmasked} ${raw}`)
  return {
    kind: software ? 'cpu' : 'gpu',
    name: software ? actual : unmasked,
    raw: actual,
  }
}

async function inspectWebglRenderer(browser) {
  const page = await browser.newPage()
  try {
    return await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      if (!gl) return { webgl: false, renderer: '', unmaskedRenderer: '' }
      const extension = gl.getExtension('WEBGL_debug_renderer_info')
      return {
        webgl: true,
        renderer: String(gl.getParameter(gl.RENDERER) || ''),
        unmaskedRenderer: extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) || '') : '',
      }
    })
  } finally {
    await page.close()
  }
}

export async function launchRenderBrowser(chromium, { gpu = gpuRenderRequested() } = {}) {
  const launch = (tryGpu) => chromium.launch({
    args: chromiumRenderArgs(tryGpu),
    chromiumSandbox: false,
  })
  const launchInspected = async (tryGpu) => {
    const browser = await launch(tryGpu)
    try {
      return { browser, renderer: classifyWebglRenderer(await inspectWebglRenderer(browser)) }
    } catch (error) {
      await browser.close().catch(() => undefined)
      throw error
    }
  }
  if (!gpu) {
    return { ...await launchInspected(false), warnings: [] }
  }

  let fallbackWarning
  try {
    const attempt = await launchInspected(true)
    if (attempt.renderer.kind === 'gpu') return { ...attempt, warnings: [] }
    await attempt.browser.close()
    fallbackWarning = `GPU_RENDER_FALLBACK: GPU unavailable (${attempt.renderer.raw}); using deterministic CPU mode.`
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error)
    fallbackWarning = `GPU_RENDER_FALLBACK: GPU launch/probe failed (${detail}); using deterministic CPU mode.`
  }
  const fallback = await launchInspected(false)
  return {
    ...fallback,
    warnings: [`${fallbackWarning} Actual CPU renderer: ${fallback.renderer.raw}.`],
  }
}

function runPlaywright(args) {
  return new Promise((resolve, reject) => {
    // stdout carries the command's JSON result; installer progress goes to stderr.
    const child = spawn(process.execPath, [path.join(playwrightDir(), 'cli.js'), ...args],
      { stdio: ['ignore', process.stderr, 'inherit'] })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`PLAYWRIGHT_INSTALL_FAILED:${signal || code}`))
    })
  })
}

export async function ensureBrowser({ withDeps = false } = {}) {
  if (withDeps && process.platform !== 'linux') {
    throw new Error('--with-deps is supported on Linux only; macOS and Windows use their native browser dependencies')
  }

  if (withDeps) await runPlaywright(['install-deps', 'chromium'])
  await runPlaywright(['install', 'chromium'])

  const { chromium } = await loadPlaywright()
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    return {
      ok: true,
      browser: 'chromium',
      version: browser.version(),
      executablePath: chromium.executablePath(),
      platform: process.platform,
      arch: process.arch,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (process.platform === 'linux' && !withDeps) {
      throw new Error(`CHROMIUM_LAUNCH_FAILED:${detail}\nRetry with: node cli.mjs browser ensure --with-deps`)
    }
    throw new Error(`CHROMIUM_LAUNCH_FAILED:${detail}`)
  } finally {
    if (browser) await browser.close()
  }
}
