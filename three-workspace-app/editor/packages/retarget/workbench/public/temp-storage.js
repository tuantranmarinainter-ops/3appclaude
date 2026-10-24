(() => {
  const size = document.getElementById('tempStorageSize')
  const cleanup = document.getElementById('tempStorageCleanup')
  if (!size || !cleanup) return

  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes < 0) return 'không rõ'
    if (bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB', 'TB']
    let value = bytes, unit = -1
    do { value /= 1024; unit++ } while (value >= 1024 && unit < units.length - 1)
    return `${value.toLocaleString('vi-VN', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`
  }

  const show = (data) => {
    size.textContent = formatBytes(data.sessionBytes)
    if (data.sessionDir) size.title = `${data.sessionDir}\nTự dọn phiên cũ sau ${data.retentionDays} ngày`
  }
  const refresh = async () => {
    try {
      const response = await fetch('/api/temp-storage', { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      show(await response.json())
    } catch { size.textContent = 'không đo được' }
  }

  cleanup.addEventListener('click', async () => {
    cleanup.disabled = true; cleanup.textContent = 'Đang dọn…'
    try {
      const response = await fetch('/api/temp-storage/cleanup', { method: 'POST' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json(); show(data)
      cleanup.textContent = data.freedBytes ? `Đã dọn ${formatBytes(data.freedBytes)}` : 'Không có dữ liệu cũ'
    } catch { cleanup.textContent = 'Dọn thất bại' }
    setTimeout(() => { cleanup.disabled = false; cleanup.textContent = 'Dọn dữ liệu tạm' }, 2500)
  })

  refresh()
  setInterval(() => { if (!document.hidden) refresh() }, 5000)
})()
