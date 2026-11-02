/**
 * Space = play/pause only when it is a clean tap. Holding Space and dragging in
 * the viewport is camera pan (ViewportNavigation), so a pointer press while
 * Space is held cancels the toggle.
 */
export function createSpaceTap(toggle: () => void) {
  let down = false
  let cancelled = false
  return {
    keyDown(repeat: boolean): void {
      if (repeat) {
        if (down) cancelled = true
        return
      }
      down = true
      cancelled = false
    },
    pointerDown(): void {
      if (down) cancelled = true
    },
    keyUp(): boolean {
      const fire = down && !cancelled
      down = false
      cancelled = false
      if (fire) toggle()
      return fire
    },
    reset(): void {
      down = false
      cancelled = false
    },
  }
}
