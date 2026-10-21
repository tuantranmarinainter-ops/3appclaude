(() => {
  const CHANNEL = 'bbs-animation-studio-v1.32.0'
  let savedSnapshot = ''
  let lastDirty = null
  let localActive = true
  let loadedSha = null
  let loadedRig = null
  let localBinding = null
  let localLease = null
  let localBusy = false
  let localGeneration = 0
  let localError = 'APP3_NOT_READY'
  let disposed = false
  let opening = false
  let bindingBusy = false
  let parentAccessible = false
  try { parentAccessible = parent !== window && parent.location.origin === location.origin } catch {}
  const editorIdentity = () => { const c = localContext(); return JSON.stringify([c.rig, c.rootUuid, c.slot, c.activeRoot]) }
  const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('')
  const hostVisible = () => { try { return localActive && document.visibilityState !== 'hidden' && (!window.frameElement || window.frameElement.getClientRects().length > 0) } catch { return false } }
  const localContext = () => window.__studio?.director?.context() || { ready: false }
  const candidates = () => {
    const matches = []
    for (const project of Object.values(parentAccessible ? parent.__bbsApp3Projects || {} : {})) {
      for (const character of Object.values(project.characters || {})) {
        if (project.assets[character.assetId]?.source.sha256 === loadedSha) matches.push({ projectId: project.projectId, characterId: character.id })
        for (const motion of Object.values(project.motions || {})) if (project.assets[motion.assetId]?.source.sha256 === loadedSha && Object.values(project.bindings || {}).some(b => b.characterId === character.id && b.motionId === motion.id)) matches.push({ projectId: project.projectId, characterId: character.id, sourceMotionId: motion.id })
      }
    }
    return matches
  }
  const broker = async (command, args, projectId) => {
    const response = await fetch('/api/unified/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), projectId, command, args }) })
    const body = await response.json()
    if (!response.ok || body.ok !== true) throw Error(body.error?.code || 'APP3_TRANSPORT_ERROR')
    return body.result
  }
  const leaseArgs = lease => ({ sessionId: lease.sessionId, epoch: lease.epoch, characterId: lease.characterId, serverInstance: lease.serverInstance, receiverToken: lease.receiverToken })
  async function resetLocal() {
    localGeneration++
    const old = localLease; localLease = null; localBinding = null
    window.__studio?.director?.bridge()?.resetLocal()
    if (old) try { await broker('app3.session.close', leaseArgs(old), old.projectId) } catch {}
  }
  async function actualSha() {
    const data = window.__studio?.rig?.()?.asset?.data
    if (typeof data !== 'string') throw Error('IDENTITY_MISMATCH')
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
    return digest(bytes)
  }
  async function bindLocal(explicit) {
    if (bindingBusy) throw Error('APP3_BUSY')
    bindingBusy = true
    try {
    if (await actualSha() !== loadedSha) throw Error('IDENTITY_MISMATCH')
    if (disposed || !loadedSha || !loadedRig || editorIdentity() !== loadedRig) throw Error('APP3_NOT_READY')
    let matches = candidates()
    const shot = window.__studio?.shot?.session
    if (shot) matches = matches.filter(c => c.projectId === shot.shot.sceneId && c.characterId === shot.character.characterId && c.sourceMotionId === shot.character.actionUuid)
    if (explicit) {
      if (Object.keys(explicit).some(k => !['projectId', 'characterId', 'sourceMotionId'].includes(k))) throw Error('VALIDATION_FAILED')
      matches = matches.filter(c => c.projectId === explicit.projectId && c.characterId === explicit.characterId && c.sourceMotionId === explicit.sourceMotionId)
    }
    if (matches.length !== 1) throw Error(matches.length ? 'APP3_BINDING_AMBIGUOUS' : 'APP3_BINDING_REQUIRED')
    await resetLocal()
    localBinding = matches[0]
    const generation = localGeneration
    const result = await broker('app3.session.register', { sessionId: crypto.randomUUID(), epoch: crypto.randomUUID(), characterId: localBinding.characterId, ...(localBinding.sourceMotionId ? { sourceMotionId: localBinding.sourceMotionId } : {}), sourceSha256: loadedSha, ready: !!localContext().ready, active: hostVisible(), context: localContext() }, localBinding.projectId)
    if (generation !== localGeneration) { await broker('app3.session.close', leaseArgs(result), result.projectId); return }
    localLease = result; localError = null
    return { ...result, receiverToken: undefined }
    } finally { bindingBusy = false }
  }
  async function pollLocal() {
    if (disposed || localBusy || !localLease) return
    localBusy = true
    const lease = localLease, generation = localGeneration
    try {
      const context = localContext()
      if (editorIdentity() !== loadedRig) { await resetLocal(); throw Error('APP3_BINDING_REQUIRED') }
      const response = await broker('app3.session.poll', { ...leaseArgs(lease), ready: !!context.ready, active: hostVisible(), context }, lease.projectId)
      if (generation !== localGeneration || localLease !== lease) return
      if (['projectId', 'sessionId', 'epoch', 'characterId', 'serverInstance'].some(key => response[key] !== lease[key])) throw Error('SESSION_REPLACED')
      for (const cmd of response.commands || []) {
        const result = await window.__studio.director.bridge().localRead(cmd, JSON.stringify([lease.projectId, lease.sessionId, lease.epoch, lease.characterId, lease.serverInstance]))
        if (generation !== localGeneration || localLease !== lease) return
        if (editorIdentity() !== loadedRig) { await resetLocal(); throw Error('SESSION_REPLACED') }
        await broker('app3.session.result', { ...leaseArgs(lease), commandId: cmd.commandId, result, context: localContext() }, lease.projectId)
      }
      localError = null
    } catch (error) {
      localError = error.message
      if (['SESSION_REPLACED', 'APP3_NOT_OPEN', 'APP3_OFFLINE', 'RECEIVER_REJECTED'].includes(localError)) { await resetLocal(); loadedSha = null; loadedRig = null }
    } finally { localBusy = false }
  }
  // Context may arrive after the iframe opens. Only exact SHA/unique identity can auto-bind.
  const onProject = () => { if (!disposed && loadedSha && !localLease && !localBusy) void bindLocal().catch(e => { localError = e.message }) }
  if (parentAccessible) parent.addEventListener('bbs-app3-project', onProject)
  const localTimer = setInterval(() => pollLocal(), 1000)
  addEventListener('pagehide', () => { disposed = true; clearInterval(localTimer); if (parentAccessible) parent.removeEventListener('bbs-app3-project', onProject); void resetLocal() }, { once: true })
  window.__app3LocalBridge = { status: () => ({ bound: !!localLease, error: localError, ...(localLease ? { projectId: localLease.projectId, sessionId: localLease.sessionId, epoch: localLease.epoch, characterId: localLease.characterId, serverInstance: localLease.serverInstance } : {}) }) }

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
    const replaces = type === 'open' || type === 'shotOpen' || type === 'app3-bind'
    if (replaces && opening) { reply(requestId, false, 'APP3_BUSY'); return }
    if (replaces) opening = true
    try {
      const studio = await waitForStudio()
      if (type === 'app3-bind') {
        reply(requestId, true, await bindLocal(value))
      } else if (type === 'open') {
        const current = JSON.stringify(studio.serialized(false))
        if ((studio.state.draft || studio.state.dirty && current !== savedSnapshot) && savedSnapshot) throw new Error('Có animation chưa lưu. Hãy lưu hoặc bỏ sửa trước khi mở animation khác.')
        await resetLocal(); loadedSha = null; loadedRig = null
        await studio.installAsset(value.bytes, value.name, true)
        if (value.nativeProject) await studio.loadProject(value.nativeProject)
        savedSnapshot = JSON.stringify(studio.serialized(false))
        loadedSha = await digest(value.bytes); loadedRig = editorIdentity()
        await bindLocal().catch(e => { localError = e.message })
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
        localActive = value.active === true
        if (!value.active && studio.state.playing) document.getElementById('playBtn')?.click()
        studio.setHostActive?.(value.active)
        reply(requestId, true, { active: value.active })
      } else if (type === 'shotOpen') {
        // Shot package ZIP from App 2 (shot.export). Opening replaces the editor content, so unsaved work blocks it.
        if (studio.state.draft || studio.state.dirty && JSON.stringify(studio.serialized(false)) !== savedSnapshot && savedSnapshot) throw new Error('Có animation chưa lưu. Hãy lưu hoặc bỏ sửa trước khi mở shot.')
        if (!studio.shot?.openZip) throw new Error('Bản Animation Studio này không hỗ trợ gói shot.')
        await resetLocal(); loadedSha = null; loadedRig = null
        await studio.shot.openZip(value.bytes)
        savedSnapshot = JSON.stringify(studio.serialized(false))
        const session = studio.shot.session
        if (session) { loadedSha = session.character.glbSha256; loadedRig = editorIdentity(); await bindLocal().catch(e => { localError = e.message }) }
        reply(requestId, true, { shotId: session?.shot?.shotId, characterId: session?.character?.characterId })
      } else if (type === 'shotExport') {
        if (!studio.shot?.session) throw new Error('Chưa mở gói shot nào.')
        const zip = await studio.shot.exportZip({ includeMinecraft20: !!value?.includeMinecraft20 })
        reply(requestId, true, { shotId: studio.shot.session.shot.shotId, zip: zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) })
      } else if (type === 'ping') reply(requestId, true, { ready: true })
      else throw new Error('Lệnh host không được hỗ trợ.')
    } catch (error) { reply(requestId, false, error) } finally { if (replaces) opening = false }
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
