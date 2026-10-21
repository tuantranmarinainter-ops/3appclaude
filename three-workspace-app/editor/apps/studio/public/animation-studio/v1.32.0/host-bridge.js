(() => {
  const CHANNEL = 'bbs-animation-studio-v1.32.0'
  let savedSnapshot = ''
  let lastDirty = null
  let localActive = true
  let loadedSha = null
  let loadedRig = null
  let localBinding = null
  let localLease = null
  let localTransition = null
  let localBusy = false
  let localGeneration = 0
  let localError = 'APP3_NOT_READY'
  let disposed = false
  let opening = false
  let artifactBusy = false
  let bindingBusy = false
  const artifactCalls = new Map()
  let parentAccessible = false
  try { parentAccessible = parent !== window && parent.location.origin === location.origin } catch {}
  const editorIdentity = () => { const c = localContext(); return JSON.stringify([c.rig, c.rootUuid, c.slot, c.activeRoot]) }
  const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('')
  const hostVisible = () => {
    try {
      if (!localActive || document.visibilityState === 'hidden') return false
      const frame = window.frameElement
      if (frame && !frame.getClientRects().length) return false
      for (let element = frame; element; element = element.parentElement) {
        const style = element.ownerDocument.defaultView.getComputedStyle(element)
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden' || style.opacity === '0') return false
      }
      return true
    } catch { return false }
  }
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
    const response = await fetch('/api/unified/commands', { signal: globalThis.AbortSignal?.timeout?.(45000), method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), projectId, command, args }) })
    const body = await response.json()
    if (!response.ok || body.ok !== true) throw Error(body.error?.code || 'APP3_TRANSPORT_ERROR')
    return body.result
  }
  const leaseArgs = lease => ({ sessionId: lease.sessionId, epoch: lease.epoch, characterId: lease.characterId, serverInstance: lease.serverInstance, receiverToken: lease.receiverToken })
  async function resetLocal() {
    localGeneration++;localTransition=null
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
      if(localTransition){await artifactCommand(localTransition.cmd,localTransition.lease,localTransition.generation);return}
      const context = localContext()
      if (editorIdentity() !== loadedRig) { await resetLocal(); throw Error('APP3_BINDING_REQUIRED') }
      const response = await broker('app3.session.poll', { ...leaseArgs(lease), ready: !!context.ready, active: hostVisible(), context }, lease.projectId)
      if (generation !== localGeneration || localLease !== lease) return
      if (['projectId', 'sessionId', 'epoch', 'characterId', 'serverInstance'].some(key => response[key] !== lease[key])) throw Error('SESSION_REPLACED')
      for (const cmd of response.commands || []) {
        if (editorIdentity() !== loadedRig) { await resetLocal(); throw Error('SESSION_REPLACED') }
        if (['export_animation','shotOpen','shotExport'].includes(cmd.tool)) {
          await artifactCommand(cmd, lease, generation)
          if (localLease !== lease) return
          continue
        }
        const result = await window.__studio.director.bridge().localCall(cmd, JSON.stringify([lease.projectId, lease.sessionId, lease.epoch, lease.characterId, lease.serverInstance]), { isActive: hostVisible, isShot: () => !!window.__studio.shot?.session, verify: async () => { await broker('app3.session.claim', { ...leaseArgs(lease), commandId: cmd.commandId }, lease.projectId); if (generation !== localGeneration || localLease !== lease || editorIdentity() !== loadedRig) throw Error('SESSION_REPLACED') } })
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
  const shotIdentity = () => {
    const session=window.__studio?.shot?.session
    return session ? {shotId:session.shot.shotId,baseShotSha256:session.baseShotSha256,characterId:session.character.characterId,actionUuid:session.character.actionUuid,frameRange:session.shot.frameRange,fps:session.shot.fps,sourceSha256:session.character.glbSha256} : null
  }
  const checkShot = proof => {
    const current=shotIdentity()
    if(!current||['shotId','baseShotSha256','characterId','actionUuid','fps','sourceSha256'].some(k=>current[k]!== (k==='sourceSha256'?proof.glbSha256:proof[k]))||JSON.stringify(current.frameRange)!==JSON.stringify(proof.frameRange))throw Error('IDENTITY_MISMATCH')
  }
  const assertClean = () => {
    const studio=window.__studio,context=localContext()
    if(studio.state.draft||studio.state.sourceClip||context.preview)throw Error('PATCH_PENDING')
  }
  async function openShot(bytes,interactive=true) {
    const studio=window.__studio
    if(!studio.shot?.openZip)throw Error('CONTRACT_UNSUPPORTED')
    if(studio.state.draft||studio.state.dirty&&JSON.stringify(studio.serialized(false))!==savedSnapshot&&savedSnapshot)throw Error('UNSAVED_CHANGES')
    if(await studio.shot.openZip(bytes,{interactive})===false)throw Error('OPEN_CANCELLED')
    savedSnapshot=JSON.stringify(studio.serialized(false))
    return shotIdentity()
  }
  async function artifactCommand(cmd,lease,generation) {
    const key=JSON.stringify([lease.sessionId,lease.epoch,cmd.commandId]),fingerprint=JSON.stringify(cmd)
    let entry=artifactCalls.get(key)
    if(entry&&entry.fingerprint!==fingerprint)throw Error('REQUEST_ID_CONFLICT')
    if(!entry){
      const verify=async(changed=false)=>{
        if(disposed||generation!==localGeneration||localLease!==lease)throw Error('SESSION_REPLACED')
        if(!hostVisible())throw Error('APP3_INACTIVE')
        if(!changed&&(editorIdentity()!==loadedRig||await actualSha()!==loadedSha))throw Error('IDENTITY_MISMATCH')
        if(!changed&&localContext().revision!==cmd.expectedAnimationRevision)throw Error('REVISION_CONFLICT')
        await broker('app3.session.claim',{...leaseArgs(lease),commandId:cmd.commandId},lease.projectId)
        if(disposed||generation!==localGeneration||localLease!==lease)throw Error('SESSION_REPLACED')
        if(!hostVisible())throw Error('APP3_INACTIVE')
        if(!changed&&(editorIdentity()!==loadedRig||await actualSha()!==loadedSha||localContext().revision!==cmd.expectedAnimationRevision))throw Error('REVISION_CONFLICT')
        if(changed){checkShot(cmd.shot);if(await actualSha()!==cmd.shot.glbSha256)throw Error('IDENTITY_MISMATCH')}
      }
      entry={fingerprint,verify,promise:(async()=>{
        let replaced=false
        try{
          await verify();assertClean()
          if(cmd.tool==='shotOpen'){
            if(opening)throw Error('APP3_BUSY');opening=true
            const wasInert=!!document.body.inert;document.body.inert=true
            try{
              const proof=cmd.shot
              const response=await fetch(`/api/unified/projects/${encodeURIComponent(lease.projectId)}/jobs/${encodeURIComponent(proof.jobId)}/files/${encodeURIComponent(proof.fileId)}`,{signal:globalThis.AbortSignal?.timeout?.(45000)})
              if(!response.ok)throw Error('SHOT_PACKAGE_REQUIRED')
              const bytes=await response.arrayBuffer()
              if(await digest(bytes)!==proof.zipSha256)throw Error('IDENTITY_MISMATCH')
              await verify();assertClean()
              await openShot(bytes,false);replaced=true;document.body.inert=wasInert;entry.release=window.__studio.director.lockArtifact();entry.locked=true;checkShot(proof)
              if(await actualSha()!==proof.glbSha256)throw Error('IDENTITY_MISMATCH')
              await verify(true)
              return {result:{ok:true,value:shotIdentity()},transition:true}
            }finally{opening=false;if(!entry.release)document.body.inert=wasInert}
          }
          if(cmd.tool==='shotExport')checkShot(cmd.shot)
          const output=cmd.tool==='shotExport'?{bytes:await window.__studio.shot.exportZip({includeMinecraft20:!!cmd.args.includeMinecraft20}),filename:'shot.result.zip'}:await window.__studio.director.exportBytes(cmd.args.format,cmd.expectedAnimationRevision)
          entry.release=window.__studio.director.lockArtifact();entry.locked=true
          await verify();assertClean();if(cmd.tool==='shotExport')checkShot(cmd.shot)
          const response=await fetch('/api/unified/uploads',{signal:globalThis.AbortSignal?.timeout?.(45000),method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(output.filename)},body:output.bytes})
          const upload=await response.json();if(!response.ok)throw Error(upload.error?.code||'UPLOAD_FAILED')
          await verify();assertClean();if(cmd.tool==='shotExport')checkShot(cmd.shot)
          return {uploadId:upload.uploadId,animationRevision:localContext().revision,context:localContext()}
        }catch(error){
          if(editorIdentity()!==loadedRig)replaced=true
          else try{if(await actualSha()!==loadedSha)replaced=true}catch{replaced=true}
          return {result:{ok:false,error:String(error.message||error)},replaced}
        }
      })()}
      artifactCalls.set(key,entry)
      if(artifactCalls.size>256)artifactCalls.delete(artifactCalls.keys().next().value)
    }
    artifactBusy=true
    const output=await entry.promise
    if(disposed||generation!==localGeneration||localLease!==lease){entry.release?.();artifactBusy=false;return}
    try {
    if(output.uploadId){
      if(!entry.locked){entry.release=window.__studio.director.lockArtifact();entry.locked=true}
      await entry.verify();assertClean();if(cmd.tool==='shotExport')checkShot(cmd.shot)
    }
    if(output.transition){
      if(!entry.locked){entry.release=window.__studio.director.lockArtifact();entry.locked=true}
      checkShot(cmd.shot);if(await actualSha()!==cmd.shot.glbSha256)throw Error('IDENTITY_MISMATCH')
      localTransition={cmd,lease,generation}
    }
    const acknowledgment=output.uploadId?await broker('app3.session.artifact',{...leaseArgs(lease),commandId:cmd.commandId,uploadId:output.uploadId,animationRevision:output.animationRevision,context:output.context},lease.projectId):await broker('app3.session.result',{...leaseArgs(lease),commandId:cmd.commandId,result:output.result,context:localContext()},lease.projectId)
    if(generation!==localGeneration||localLease!==lease)return
    if(acknowledgment.nextLease){
      localTransition=null;localGeneration++;window.__studio.director.bridge().resetLocal()
      localLease=acknowledgment.nextLease;localBinding=null;loadedSha=await actualSha();loadedRig=editorIdentity();localError=null
    }else if(output.replaced){await resetLocal();loadedSha=null;loadedRig=null}
    } catch(error){
      if(['VALIDATION_FAILED','ARTIFACT_VALIDATION_REQUIRED','IDENTITY_MISMATCH','REVISION_CONFLICT','SHOT_PACKAGE_REQUIRED','CONTRACT_UNSUPPORTED'].includes(error.message)){
        delete output.uploadId;output.result={ok:false,error:error.message}
        await broker('app3.session.result',{...leaseArgs(lease),commandId:cmd.commandId,result:output.result,context:localContext()},lease.projectId)
        if(output.transition||output.replaced||editorIdentity()!==loadedRig){await resetLocal();loadedSha=null;loadedRig=null}
      }else{if(!output.transition&&editorIdentity()!==loadedRig){await resetLocal();loadedSha=null;loadedRig=null}throw error}
    }
    finally{entry.release?.();entry.locked=false;artifactBusy=false}
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
    if (replaces && (opening || artifactBusy)) { reply(requestId, false, 'APP3_BUSY'); return }
    if (replaces) opening = true
    try {
      const studio = await waitForStudio()
      if (type === 'view.silhouette.set') {
        if (!value || Object.keys(value).length !== 1 || typeof value.enabled !== 'boolean') throw Error('VALIDATION_FAILED')
        reply(requestId, true, studio.silhouette.set(value.enabled))
      } else if (type === 'app3-bind') {
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
        await openShot(value.bytes)
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
