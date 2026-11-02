/** Match the native duplicate-drag modifier on each desktop platform. */
export function duplicateClipGesture(event: { ctrlKey: boolean; altKey: boolean }, platform: string): boolean {
  return /Mac|iPhone|iPad/.test(platform) ? event.altKey : event.ctrlKey
}

/** Input widgets retain their native text clipboard shortcuts. */
export function timelineClipboardCommand(event: { key: string; ctrlKey: boolean; metaKey: boolean }, editing: boolean): 'copy' | 'paste' | null {
  if (editing || !(event.ctrlKey || event.metaKey)) return null
  return event.key.toLowerCase() === 'c' ? 'copy' : event.key.toLowerCase() === 'v' ? 'paste' : null
}
