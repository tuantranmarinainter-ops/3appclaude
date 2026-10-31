import { browserOptions } from './browser_test_options.mjs';
import { useClassicLayout } from './classic_test_layout.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(
  new URL('../../../../editor/packages/director-cli/package.json', import.meta.url),
);
const { chromium } = require('playwright');
test(
  'pane dividers resize, reload, clamp and leave project/history unchanged',
  async () => {
    const html = await readFile(
      new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url),
    );
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch(browserOptions({
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--enable-unsafe-swiftshader',
        '--proxy-server=direct://',
        '--proxy-bypass-list=*',
      ],
    }));
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.on('console', (message) => {
        if (message.type() === 'error') console.error(message.text());
      });
      page.on('pageerror', (error) => console.error(error));
      page.setDefaultTimeout(60000);
      await useClassicLayout(page);
      await page.goto(`http://127.0.0.1:${server.address().port}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      try {
        await page.waitForFunction(
          () => window.__studio?.state.bones > 0,
          {},
          { timeout: 60000, polling: 100 },
        );
      } catch (error) {
        console.error(
          await page.evaluate(() => ({
            title: document.title,
            studio: !!window.__studio,
            ready: window.__studio?.ready,
            status: document.querySelector('#status')?.textContent,
            body: document.body.textContent.slice(-500),
          })),
        );
        throw error;
      }
      await page.evaluate(() => __studio.setHostActive(false));
      await page.locator('#animationListToggle').click({ force: true });
      const snapshot = () =>
        page.evaluate(() =>
          JSON.stringify({
            project: __studio.serialized(false),
            history: __studio.state.historyIndex,
            dirty: __studio.state.dirty,
          }),
        );
      const before = await snapshot();
      const measure = () =>
        page.evaluate(() =>
          Object.fromEntries(
            [
              ['left', '#floatingAnimationList'],
              ['right', '#minimalSidebar'],
              ['timeline', '#animationArea'],
              ['viewport', '#viewportShell'],
            ].map(([k, s]) => {
              const r = document.querySelector(s).getBoundingClientRect();
              return [k, { width: r.width, height: r.height }];
            }),
          ),
        );
      const out = process.env.APP3_RESIZE_EVIDENCE || '/tmp/app3-a11-evidence';
      await mkdir(out, { recursive: true });
      const initial = await measure();
      await page.screenshot({ path: path.join(out, 'desktop-initial.png'), timeout: 60000 });
      const drag = async (selector, dx, dy) => {
        const r = await page.locator(selector).boundingBox();
        assert.ok(r);
        await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
        await page.mouse.down();
        await page.mouse.move(r.x + r.width / 2 + dx, r.y + r.height / 2 + dy, { steps: 8 });
        await page.mouse.up();
      };
      await drag('#studioLeftDivider', 55, 0);
      await drag('[data-resize=right]', -60, 0);
      await drag('[data-resize=timeline]', 0, 50);
      const resized = await measure();
      console.log(JSON.stringify({ initial, resized }));
      assert.ok(resized.left.width > initial.left.width + 40);
      assert.ok(resized.right.width > initial.right.width + 40);
      assert.ok(resized.timeline.height < initial.timeline.height - 30);
      assert.equal(await snapshot(), before);
      const stored = await page.evaluate(() =>
        localStorage.getItem('animation-studio-pane-sizes-v1'),
      );
      assert.ok(stored);
      const timelineState = await page.evaluate(() => ({
        inline: parseFloat(document.documentElement.style.getPropertyValue('--timeline-height')),
        computed: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-height')),
        stored: JSON.parse(localStorage.getItem('animation-studio-pane-sizes-v1')).timeline,
      }));
      assert.ok(Math.abs(timelineState.inline - timelineState.computed) < 0.01);
      assert.ok(Math.abs(timelineState.inline - timelineState.stored) < 0.01);
      assert.ok(Math.abs(timelineState.inline - resized.timeline.height) < 2);
      await page.screenshot({ path: path.join(out, 'desktop-resized.png'), timeout: 60000 });
      await page.reload();
      await page.waitForFunction(
        () => window.__studio?.state.bones > 0,
        {},
        { timeout: 60000, polling: 100 },
      );
      await page.evaluate(() => __studio.setHostActive(false));
      await page.locator('#animationListToggle').click({ force: true });
      const reloaded = await measure();
      for (const k of ['left', 'right'])
        assert.ok(Math.abs(reloaded[k].width - resized[k].width) < 2);
      assert.ok(Math.abs(reloaded.timeline.height - resized.timeline.height) < 2);
      await page.locator('[data-resize=timeline]').focus();
      await page.keyboard.press('End');
      const maxTimeline = await measure();
      assert.ok(maxTimeline.viewport.height >= 450, JSON.stringify(maxTimeline));
      await page.setViewportSize({ width: 1024, height: 768 });
      const tablet = await measure();
      console.log(JSON.stringify({ classicMaxTimeline: maxTimeline, classicTablet: tablet, stage: await page.evaluate(() => [...document.querySelector('.stage').children].map(el => ({ id: el.id, cls: el.className, height: el.getBoundingClientRect().height }))) }));
      assert.ok(tablet.viewport.height >= 345 && tablet.viewport.width > 0, JSON.stringify(tablet));
      assert.ok(tablet.timeline.height >= 80, JSON.stringify(tablet));
      await page.locator('#playMode').scrollIntoViewIfNeeded();
      await page.locator('#playMode').focus();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'playMode');
      await page.keyboard.press('Alt+ArrowDown');
      await page.keyboard.press('Escape');
      await page.locator('#restartBtn').scrollIntoViewIfNeeded();
      await page.locator('#restartBtn').click();
      await page.locator('#viewportSettingsBtn').scrollIntoViewIfNeeded();
      await page.locator('#viewportSettingsBtn').click();
      assert.equal(await page.locator('#viewportSettingsPanel').isVisible(), true);
      await page.locator('#viewportSettingsPanel [data-close]').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.setViewportSize({ width: 1440, height: 1000 });
      let stable = await snapshot();
      await page.locator('[data-resize=right]').focus();
      await page.keyboard.press('ArrowLeft');
      assert.equal(await snapshot(), stable);
      await page.evaluate(() => document.querySelector('#modeCompare').click());
      const compareBefore = await snapshot();
      await drag('.compare-side-resize', -40, 0);
      await drag('#compareABResize', -50, 0);
      assert.equal(await snapshot(), compareBefore);
      const compareSizes = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('animation-studio-pane-sizes-v1')),
      );
      assert.ok(compareSizes.compareSide > 300);
      assert.ok(compareSizes.compareSplit < 50);
      await page.evaluate(() => document.querySelector('#modeCreate').click());
      stable = await snapshot();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(100);
      const mobile = await measure();
      assert.ok(mobile.viewport.width >= 380);
      assert.ok(mobile.viewport.height >= 100);
      assert.ok(mobile.timeline.height >= 80);
      assert.equal(mobile.left.width, 0);
      assert.equal(mobile.right.width, 0);
      assert.equal(await snapshot(), stable);
      await page.screenshot({ path: path.join(out, 'mobile-clamped.png'), timeout: 60000 });
      const mobileRight = page.getByRole('button', { name: 'Mở / đóng Công cụ', exact: true }),
        mobileLeft = page.getByRole('button', { name: 'Mở / đóng Animation', exact: true });
      await mobileRight.click({ force: true });
      const rightOpen = await measure();
      await drag('[data-resize=right]', 30, 0);
      assert.ok((await measure()).right.width < rightOpen.right.width - 20);
      assert.equal((await measure()).left.width, 0);
      await mobileRight.click({ force: true });
      await mobileLeft.click({ force: true });
      const leftOpen = await measure();
      await drag('#studioLeftDivider', -40, 0);
      console.log(
        JSON.stringify({
          leftOpen,
          leftAfter: await measure(),
          prefs: await page.evaluate(() => localStorage.getItem('animation-studio-pane-sizes-v1')),
        }),
      );
      assert.ok((await measure()).left.width < leftOpen.left.width - 20);
      assert.equal((await measure()).right.width, 0);
      assert.equal(await snapshot(), stable);
      await page.screenshot({ path: path.join(out, 'mobile-drawer.png'), timeout: 60000 });
      await mobileLeft.click({ force: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForTimeout(100);
      const desktopRestored = await measure();
      assert.equal(desktopRestored.left.width, 315);
      assert.equal(desktopRestored.right.width, 390);
      console.log(
        JSON.stringify({
          desktopRestored,
          mobilePreferences: await page.evaluate(() =>
            JSON.parse(localStorage.getItem('animation-studio-pane-sizes-v1')),
          ),
        }),
      );

      await page.evaluate(() => document.querySelector('#sceneStudioBtn').click());
      await page.waitForFunction(() => !document.querySelector('#sceneStudioDialog').hidden, null, {
        polling: 100,
        timeout: 60000,
      });
      const sceneBefore = await snapshot();
      const sceneWidth = await page
        .locator('#sceneStudioDialog')
        .evaluate((el) => el.getBoundingClientRect().width);
      await drag('#studioSceneDivider', -40, 0);
      const sceneAfterWidth = await page
        .locator('#sceneStudioDialog')
        .evaluate((el) => el.getBoundingClientRect().width);
      assert.ok(sceneAfterWidth > sceneWidth + 30);
      assert.equal(await snapshot(), sceneBefore);
      console.log(JSON.stringify({ sceneWidth, sceneAfterWidth }));

      console.log(
        JSON.stringify({
          initial,
          resized,
          reloaded,
          mobile,
          stored,
          compareSizes,
          projectSha256: createHash('sha256').update(before).digest('hex'),
          projectUnchanged: true,
        }),
      );
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test('mode layout dividers resize and retain sizes across reload without changing project', async () => {
  const html = await readFile(new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url));
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch(browserOptions({ headless: true, args: ['--disable-dev-shm-usage'] }));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(60000);
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__studio?.state.bones > 0, null, { timeout: 60000 });
    await page.locator('#layoutTab-animate').click();
    const snapshot = () => page.evaluate(() => JSON.stringify({ project: __studio.serialized(false), history: __studio.state.historyIndex, dirty: __studio.state.dirty }));
    const before = await snapshot();
    const width = (selector) => page.locator(selector).evaluate((node) => node.getBoundingClientRect().width);
    const drag = async (selector, dx, dy = 0) => {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
      await page.mouse.up();
    };
    const left = await width('#layoutLeft'), right = await width('#layoutRight');
    await drag('[data-layout-grip=left]', 50);
    await drag('[data-layout-grip=right]', -50);
    const resizedLeft = await width('#layoutLeft'), resizedRight = await width('#layoutRight');
    assert.ok(resizedLeft > left + 35);
    assert.ok(resizedRight > right + 35);
    const timelineBefore = await page.locator('#animationArea').evaluate((node) => node.getBoundingClientRect().height);
    await drag('[data-resize=timeline]', 0, -40);
    const timelineAfter = await page.locator('#animationArea').evaluate((node) => node.getBoundingClientRect().height);
    console.log(JSON.stringify({ timelineBefore, timelineAfter, modeStage: await page.evaluate(() => [...document.querySelector('.stage').children].map(el => ({ id: el.id, cls: el.className, height: el.getBoundingClientRect().height }))) }));
    assert.ok(timelineAfter > timelineBefore + 10);
    assert.equal(await snapshot(), before);
    await page.locator('#layoutTab-pose').click();
    await page.locator('#layoutTab-animate').click();
    assert.ok(Math.abs(await width('#layoutLeft') - resizedLeft) < 2);
    assert.ok(Math.abs(await width('#layoutRight') - resizedRight) < 2);
    assert.equal(await snapshot(), before);
    await page.locator('[data-resize=timeline]').focus();
    await page.keyboard.press('End');
    const maxTimeline = await page.locator('#animationArea').evaluate((node) => node.getBoundingClientRect().height);
    const viewportHeight = () => page.locator('#viewportShell').evaluate((node) => node.getBoundingClientRect().height);
    const modesDesktopViewport = await viewportHeight();
    assert.ok(modesDesktopViewport >= 449);
    await page.setViewportSize({ width: 1024, height: 768 });
    const modesTabletViewport = await viewportHeight();
    const modesTabletTimeline = await page.locator('#animationArea').evaluate((node) => node.getBoundingClientRect().height);
    console.log(JSON.stringify({ modesDesktopViewport, modesTabletViewport, modesTabletTimeline, maxTimeline }));
    assert.ok(modesTabletViewport >= 344);
    assert.ok(modesTabletTimeline >= 60);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.waitForFunction(() => window.__studio?.state.bones > 0, null, { timeout: 60000 });
    await page.locator('#layoutTab-animate').click();
    assert.ok(Math.abs(await width('#layoutLeft') - resizedLeft) < 2);
    assert.ok(Math.abs(await width('#layoutRight') - resizedRight) < 2);
    assert.ok(Math.abs(await page.locator('#animationArea').evaluate((node) => node.getBoundingClientRect().height) - maxTimeline) < 2);
    assert.ok(await viewportHeight() >= 449);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
