// Legacy regression cases deliberately exercise the unchanged classic interface.
// Default/new layout behavior is covered by layout_modes.browser.test.mjs.
export async function useClassicLayout(page) {
  await page.addInitScript(() => {
    try {
      const key = 'animation-studio-settings';
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      localStorage.setItem(key, JSON.stringify({ ...saved, layoutMode: 'classic' }));
    } catch {
      /* Native storage denial remains handled by the product. */
    }
  });
}
