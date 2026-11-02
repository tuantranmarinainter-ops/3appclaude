import assert from 'node:assert/strict';
import type { Page } from 'playwright';

/** Real pointer/keyboard acceptance against the disposable production fixture. */
export async function checkTimelineClipboard(page: Page) {
    console.log('timelineInitial', await page.evaluate(() => { const s = (window as any).__store.getState(); return { visible: s.timelineVisible, open: s.timelineOpen, mode: s.workspaceMode, clips: s.doc.content.timeline.animation.motionClips.length }; }));
    await page.evaluate(() => { const s = (window as any).__store.getState(); if (!s.timelineVisible) s.toggleTimelinePanel(); if (!s.timelineOpen) s.toggleTimeline(); });
    const timeline = page.locator('.t3d-timeline').first();
    const clip = page.locator('.t3d-timeline-clip-motion:not(.t3d-timeline-clip-ghost)').first();
    await clip.waitFor();
    const originalId = await clip.getAttribute('data-clip-id');
    const snapshot = () => page.evaluate(() => {
        const state = (window as any).__store.getState();
        return { clips: JSON.parse(JSON.stringify(state.doc.content.timeline.animation.motionClips)), assets: JSON.stringify(state.doc.content.asset) };
    });
    const initial = await snapshot();
    await clip.click();
    await page.keyboard.press('Control+c');
    await page.evaluate(() => (window as any).__store.getState().setFrame(90));
    await page.keyboard.press('Control+v');
    await page.waitForFunction(n => (window as any).__store.getState().doc.content.timeline.animation.motionClips.length === n, initial.clips.length + 1);
    const pasted = await snapshot();
    const copy = pasted.clips.find((item: any) => !initial.clips.some((old: any) => old.id === item.id));
    assert.equal(copy.frameStart, 90);
    assert.deepEqual(copy.motion, initial.clips[0].motion);
    assert.deepEqual(copy.playback, initial.clips[0].playback);
    assert.equal(pasted.assets, initial.assets);

    const source = page.locator(`[data-clip-id="${originalId}"]`).first();
    await source.click({ button: 'right' });
    for (const label of ['Sao chép', 'Dán tại đầu phát', 'Nhân bản', 'Xoá']) await page.getByRole('menuitem', { name: label, exact: true }).waitFor();
    await page.getByRole('menuitem', { name: 'Nhân bản', exact: true }).click();
    await page.waitForFunction(n => (window as any).__store.getState().doc.content.timeline.animation.motionClips.length === n, initial.clips.length + 2);
    const afterMenu = await snapshot();
    const duplicate = afterMenu.clips.find((item: any) => !pasted.clips.some((old: any) => old.id === item.id));
    const duplicateBlock = page.locator(`[data-clip-id="${duplicate.id}"]`).first();
    await duplicateBlock.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Xoá', exact: true }).click();
    await page.waitForFunction(n => (window as any).__store.getState().doc.content.timeline.animation.motionClips.length === n, initial.clips.length + 1);

    await source.scrollIntoViewIfNeeded();
    const box = await source.boundingBox();
    assert.ok(box);
    await page.keyboard.down('Control');
    await page.mouse.move(box.x + Math.min(15, box.width / 2), box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(15, box.width / 2) + 100, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    await page.waitForFunction(n => (window as any).__store.getState().doc.content.timeline.animation.motionClips.length === n, initial.clips.length + 2);
    const dragged = await snapshot();
    assert.equal(dragged.clips.find((item: any) => item.id === originalId).frameStart, initial.clips[0].frameStart);
    assert.equal(dragged.assets, initial.assets);

    await source.click();
    const settings = page.locator('.t3d-motion-clip-settings');
    await settings.getByRole('button', { name: '0.25x', exact: true }).click();
    await page.waitForFunction(id => (window as any).__store.getState().doc.content.timeline.animation.motionClips.find((item: any) => item.id === id).playback.speed === 0.25, originalId);
    const speed = settings.locator('input').first();
    await speed.fill('0.5');
    await speed.press('Enter');
    await page.waitForFunction(id => (window as any).__store.getState().doc.content.timeline.animation.motionClips.find((item: any) => item.id === id).playback.speed === 0.5, originalId);
    await speed.focus();
    const beforeInput = (await snapshot()).clips.length;
    await page.keyboard.press('Control+v');
    assert.equal((await snapshot()).clips.length, beforeInput, 'input clipboard must not paste timeline clip');
    assert.ok(await timeline.count());
    console.log(JSON.stringify({ timelineClipboard: 'PASS', ctrlPaste: true, contextMenu: true, ctrlDrag: true, slowPreset: true, numericSpeed: true, inputShortcutScope: true }));
}
