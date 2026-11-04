export function isSaveShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'code'>, active: boolean, owner: boolean): boolean {
  return active && owner && (event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyS'
}
