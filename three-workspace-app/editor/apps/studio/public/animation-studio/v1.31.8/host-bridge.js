(() => {
  const CHANNEL = 'bbs-animation-studio-v1.31.8'
  let savedSnapshot = ''
  let lastDirty = null
  const reply = (requestId, ok, value) => parent.postMessage({ channel: CHANNEL, requestId, ok, ...(ok ? { value } : { error: String(value?.message || value) }) }, location.origin)
  const waitForStudio = () => new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = () => {
      if (window.__studio?.ready) return resolve(window.__studio)
      if (Date.now() - started > 30000) return reject(new Error('Animation Studio khởi động quá thời gian.'))
      setTimeout(poll, 100)
    }
    poll()
  })
  addEventListener('message', async (event) => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.channel !== CHANNEL || typeof event.data.requestId !== 'string') return
    const { requestId, type, value } = event.data
    try {
      const studio = await waitForStudio()
      if (type === 'open') {
        const current = JSON.stringify(studio.serialized(false))
        if ((studio.state.draft || studio.state.dirty && current !== savedSnapshot) && savedSnapshot) throw new Error('Có animation chưa lưu. Hãy lưu hoặc bỏ sửa trước khi mở animation khác.')
        await studio.installAsset(value.bytes, value.name, true)
        if (value.nativeProject) await studio.loadProject(value.nativeProject)
        savedSnapshot = JSON.stringify(studio.serialized(false))
        reply(requestId, true, { state: studio.state, bones: studio.recordNames() })
      } else if (type === 'save') {
        if (studio.state.draft || studio.state.sourceClip) throw new Error('Hãy hoàn tất hoặc hủy chỉnh sửa đang chờ trước khi lưu.')
        const nativeProject = studio.serialized(false)
        const baked = await studio.exportCapture()
        reply(requestId, true, { nativeProject, derivativeBase64: baked.data, duration: nativeProject.duration, fps: nativeProject.fps })
      } else if (type === 'saved') {
        savedSnapshot = JSON.stringify(studio.serialized(false))
        reply(requestId, true, { saved: true })
      } else if (type === 'active') {
        if (!value.active && studio.state.playing) document.getElementById('playBtn')?.click()
        studio.setHostActive?.(value.active)
        reply(requestId, true, { active: value.active })
      } else if (type === 'ping') reply(requestId, true, { ready: true })
      else throw new Error('Lệnh host không được hỗ trợ.')
    } catch (error) { reply(requestId, false, error) }
  })
  setInterval(() => {
    const studio = window.__studio
    if (!studio?.ready) return
    const current = JSON.stringify(studio.serialized(false))
    const dirty = !!studio.state.draft || !!studio.state.dirty && current !== savedSnapshot
    if (dirty !== lastDirty) {
      lastDirty = dirty
      parent.postMessage({ channel: CHANNEL, type: 'dirty', dirty }, location.origin)
    }
  }, 400)
  parent.postMessage({ channel: CHANNEL, type: 'bridge-ready' }, location.origin)
})()
