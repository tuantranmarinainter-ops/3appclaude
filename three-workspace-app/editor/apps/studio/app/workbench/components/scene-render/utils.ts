import { loadUnifiedJobFile, type UnifiedJobView } from '../../../../src/unifiedApi'

interface BrowserDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
}

type PickerWindow = Window & { showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<BrowserDirectoryHandle> }

export async function chooseDirectory(): Promise<BrowserDirectoryHandle> {
  const pickerWindow = window as PickerWindow
  if (!pickerWindow.showDirectoryPicker) throw new Error('Trình duyệt này chưa hỗ trợ chọn thư mục để lưu render.')
  return pickerWindow.showDirectoryPicker({ mode: 'readwrite' })
}

export async function saveJob(projectId: string, job: UnifiedJobView, directory: BrowserDirectoryHandle, prefix = 'render'): Promise<void> {
  if ((await directory.queryPermission({ mode: 'readwrite' })) !== 'granted' &&
      (await directory.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Chưa được cấp quyền ghi vào thư mục đã chọn.')
  const folderName = `${prefix}-${job.jobId}`
  try {
    await directory.getDirectoryHandle(folderName)
    throw new Error(`Thư mục ${prefix} đã tồn tại. Hãy chọn thư mục khác để giữ các file hiện có.`)
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
  }
  const verified: Array<{ name: string; data: Blob }> = []
  for (const file of job.result?.files ?? []) {
    const data = await loadUnifiedJobFile(projectId, job.jobId, file.id)
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await data.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join('')
    if (data.size !== file.sizeBytes || hash !== file.sha256) throw new Error(`File render sai dung lượng hoặc SHA-256: ${file.name}`)
    verified.push({ name: file.name, data })
  }
  const outputDirectory = await directory.getDirectoryHandle(folderName, { create: true })
  for (const { name, data } of verified) {
    const handle = await outputDirectory.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(data); await writable.close() }
    catch (error) { await writable.abort().catch(() => undefined); throw error }
  }
}

export function parseRenderFrames(text: string, start: number, end: number): number[] | null {
  if (!/^\s*\d+\s*(,\s*\d+\s*)*$/.test(text)) return null
  const frames = text.split(',').map(Number)
  return frames.length <= 9 && new Set(frames).size === frames.length &&
    frames.every((frame) => Number.isSafeInteger(frame) && frame >= start && frame <= end) ? frames : null
}

