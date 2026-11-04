export async function saveBeforeExit(
  locked: boolean,
  dirty: boolean,
  saveState: string,
  save: () => Promise<string | null>,
  confirmFailure: () => boolean,
): Promise<boolean> {
  if (!dirty && saveState !== 'saving' && saveState !== 'error') return true
  const error = locked && saveState !== 'saving' ? 'save.locked' : await save()
  return !error || confirmFailure()
}
