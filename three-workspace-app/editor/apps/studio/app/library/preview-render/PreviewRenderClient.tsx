'use client'

import { useEffect } from 'react'

declare global { interface Window { __libraryPreviewResult?: { data: string; mime: string; error?: string } } }

export default function PreviewRenderClient() {
  useEffect(() => {
    let disposed = false
    let renderer: import('three').WebGLRenderer | undefined
    let frame = 0
    const query = new URLSearchParams(window.location.search)
    const actionUuid = query.get('actionUuid') ?? ''
    const charId = query.get('charId') ?? ''
    const done = (value: NonNullable<Window['__libraryPreviewResult']>) => { if (!disposed) window.__libraryPreviewResult = value }
    void (async () => {
      try {
        const THREE = await import('three')
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
        const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js')
        const scene = new THREE.Scene(); scene.background = new THREE.Color('#171a20')
        scene.add(new THREE.HemisphereLight(0xffffff, 0x454b59, 2.1))
        const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(3, 5, 4); scene.add(key)
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 320
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
        renderer.setPixelRatio(1); renderer.setSize(320, 320, false)
        const draco = new DRACOLoader().setDecoderPath('/draco/')
        const loader = new GLTFLoader().setDRACOLoader(draco)
        const mannequin = query.get('mannequin') === '1'
        const [character, action] = await Promise.all([
          mannequin ? Promise.resolve(null) : loader.loadAsync(`/api/library/character/${encodeURIComponent(charId)}`),
          loader.loadAsync(`/api/library/animation/${encodeURIComponent(actionUuid)}`),
        ])
        draco.dispose()
        const clip = action.animations[Number(query.get('animationIndex') ?? 0)]
        if (!clip) throw new Error('Action animation clip is missing from its GLB')
        const modelScene = mannequin ? action.scene : character!.scene
        if (mannequin) {
          const bones: import('three').Bone[] = []
          modelScene.traverse(object => { if ((object as import('three').Bone).isBone) bones.push(object as import('three').Bone); if ((object as import('three').Mesh).isMesh) object.parent?.remove(object) })
          const material = new THREE.MeshStandardMaterial({ color: '#8794a7', roughness: 0.92 })
          for (const bone of bones) {
            const joint = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.075), material); bone.add(joint)
            for (const child of bone.children) {
              if (!(child as import('three').Bone).isBone) continue
              const direction = (child as import('three').Bone).position.clone(), length = direction.length()
              if (length < 0.001) continue
              const segment = new THREE.Mesh(new THREE.BoxGeometry(0.09, length, 0.09), material)
              segment.position.copy(direction.multiplyScalar(0.5)); segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); bone.add(segment)
            }
          }
        }
        scene.add(modelScene)
        const bounds = new THREE.Box3().setFromObject(modelScene), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3())
        const span = Math.max(size.x, size.y, size.z); if (!Number.isFinite(span) || span < 0.001) throw new Error('Character preview model has no visible geometry')
        const floorY = bounds.min.y
        const grid = new THREE.GridHelper(span * 2.4, 16, 0x555b66, 0x343a44); grid.position.set(center.x, floorY, center.z); scene.add(grid)
        const camera = new THREE.PerspectiveCamera(35, 1, Math.max(0.001, span / 1000), span * 100)
        camera.position.set(center.x + span * 1.8, center.y + span * 0.75, center.z + span * 2.2); camera.lookAt(center)
        const canonical = (name: string) => name.split(':').at(-1)!.replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
        const targets = new Map<string, string>()
        modelScene.traverse(object => { if (object.name) targets.set(canonical(object.name), object.name) })
        for (const track of clip.tracks) {
          const property = track.name.match(/\.(position|quaternion|scale)$/)?.[1]; if (!property) continue
          const sourceBone = track.name.slice(0, -(property.length + 1)), targetBone = targets.get(canonical(sourceBone))
          if (targetBone) track.name = `${targetBone}.${property}`
        }
        const mixer = new THREE.AnimationMixer(modelScene), running = mixer.clipAction(clip); running.play()
        const seconds = Math.min(2.5, clip.duration), start = Math.max(0, (clip.duration - seconds) / 2)
        const stream = canvas.captureStream(15)
        const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(type => MediaRecorder.isTypeSupported(type))
        if (!mime) throw new Error('This browser cannot record WebM previews')
        const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 180000 })
        const chunks: BlobPart[] = []
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
        recorder.onerror = () => done({ data: '', mime, error: 'Browser video recording failed' })
        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: mime }), bytes = new Uint8Array(await blob.arrayBuffer())
          let binary = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
          done({ data: btoa(binary), mime })
        }
        const clock = new THREE.Clock(); mixer.setTime(start)
        const draw = () => {
          if (disposed) return
          mixer.update(Math.min(clock.getDelta(), 0.05)); renderer?.render(scene, camera); frame = requestAnimationFrame(draw)
        }
        draw(); await new Promise<void>(resolve => { recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: mime }), bytes = new Uint8Array(await blob.arrayBuffer())
          let binary = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
          done({ data: btoa(binary), mime }); resolve()
        }; recorder.start(100); setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop() }, seconds * 1000) })
        stream.getTracks().forEach(track => track.stop()); mixer.stopAllAction(); renderer?.dispose()
      } catch (error) { done({ data: '', mime: '', error: error instanceof Error ? error.message : String(error) }) }
    })()
    return () => { disposed = true; cancelAnimationFrame(frame); renderer?.dispose() }
  }, [])
  return <main style={{ width: 320, height: 320, background: '#171a20' }} />
}
