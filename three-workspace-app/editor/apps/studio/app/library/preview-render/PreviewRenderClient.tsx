'use client'

import { useEffect } from 'react'
import { glbUsesDraco } from '../../../src/previewRenderUtils'

declare global { interface Window { __libraryPreviewResult?: { data: string; mime: string; error?: string } } }

const PREVIEW_BACKGROUND = '#d9dde3'
const PREVIEW_MANNEQUIN = '#5d6878'

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
        // Mixamo-style stage: plain light backdrop, no grid, a soft contact shadow so the feet still read against the floor.
        const scene = new THREE.Scene(); scene.background = new THREE.Color(PREVIEW_BACKGROUND)
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8a929e, 2.2))
        const key = new THREE.DirectionalLight(0xffffff, 2.2); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); scene.add(key)
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 320
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
        renderer.setPixelRatio(1); renderer.setSize(320, 320, false); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
        const loader = new GLTFLoader()
        const mannequin = query.get('mannequin') === '1'
        const characterUrl = `/api/library/character/${encodeURIComponent(charId)}`
        const actionUrl = `/api/library/animation/${encodeURIComponent(actionUuid)}`
        const buffers = await Promise.all([
          mannequin ? Promise.resolve(null) : fetch(characterUrl).then(async response => {
            if (!response.ok) throw new Error(`Character GLB request failed (${response.status})`)
            return response.arrayBuffer()
          }),
          fetch(actionUrl).then(async response => {
            if (!response.ok) throw new Error(`Action GLB request failed (${response.status})`)
            return response.arrayBuffer()
          }),
        ])
        const usesDraco = buffers.some(buffer => buffer !== null && glbUsesDraco(buffer))
        let draco: import('three/addons/loaders/DRACOLoader.js').DRACOLoader | undefined
        if (usesDraco) {
          const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js')
          draco = new DRACOLoader().setDecoderPath('/draco/')
          loader.setDRACOLoader(draco)
        }
        const parse = (buffer: ArrayBuffer, url: string) => loader.parseAsync(buffer, new URL(url, window.location.href).href)
        const [character, action] = await Promise.all([
          buffers[0] ? parse(buffers[0], characterUrl) : Promise.resolve(null),
          buffers[1] ? parse(buffers[1], actionUrl) : Promise.reject(new Error('Action GLB response was empty')),
        ])
        draco?.dispose()
        const clip = action.animations[Number(query.get('animationIndex') ?? 0)]
        if (!clip) throw new Error('Action animation clip is missing from its GLB')
        const modelScene = mannequin ? action.scene : character!.scene
        const isBone = (object: import('three').Object3D | null): object is import('three').Bone => Boolean((object as import('three').Bone | null)?.isBone)
        if (mannequin) {
          const bones: import('three').Bone[] = []
          modelScene.traverse(object => { if (isBone(object)) bones.push(object); if ((object as import('three').Mesh).isMesh) object.parent?.remove(object) })
          modelScene.updateMatrixWorld(true)
          const restBounds = new THREE.Box3(); for (const bone of bones) restBounds.expandByPoint(bone.getWorldPosition(new THREE.Vector3()))
          const thickness = Math.max(0.02, restBounds.getSize(new THREE.Vector3()).y * 0.05)
          const material = new THREE.MeshStandardMaterial({ color: PREVIEW_MANNEQUIN, roughness: 0.85 })
          for (const bone of bones) {
            const worldScale = bone.getWorldScale(new THREE.Vector3()).x || 1
            const joint = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material); joint.scale.setScalar(thickness * 0.85 / worldScale); joint.castShadow = true; bone.add(joint)
            for (const child of bone.children) {
              if (!isBone(child)) continue
              const direction = child.position.clone(), length = direction.length()
              if (length < 1e-6) continue
              const segment = new THREE.Mesh(new THREE.BoxGeometry(thickness / worldScale, length, thickness / worldScale), material); segment.castShadow = true
              segment.position.copy(direction.multiplyScalar(0.5)); segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); bone.add(segment)
            }
          }
        }
        modelScene.traverse(object => { if ((object as import('three').Mesh).isMesh) { object.castShadow = true; object.frustumCulled = false } })
        scene.add(modelScene)
        const canonical = (name: string) => name.split(':').at(-1)!.replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
        const targets = new Map<string, import('three').Object3D>()
        modelScene.traverse(object => { if (object.name) targets.set(canonical(object.name), object) })
        // Library GLBs and character GLBs may wrap the skeleton in differently oriented/scaled armature nodes (Blender exports a
        // 90° X turn, Mixamo FBX a 0.01 scale). Root-bone keys are local to that wrapper, so re-express them in the character's.
        let actionRoot: import('three').Bone | undefined
        action.scene.traverse(object => { if (!actionRoot && isBone(object) && !isBone(object.parent)) actionRoot = object })
        action.scene.updateMatrixWorld(true); modelScene.updateMatrixWorld(true)
        const characterRoot = actionRoot ? targets.get(canonical(actionRoot.name)) : undefined
        const rootFrame = actionRoot?.parent && characterRoot?.parent && !mannequin
          ? characterRoot.parent.matrixWorld.clone().invert().multiply(actionRoot.parent.matrixWorld) : null
        const rootTurn = rootFrame ? new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(rootFrame)) : null
        for (const track of clip.tracks) {
          const property = track.name.match(/\.(position|quaternion|scale)$/)?.[1]; if (!property) continue
          const sourceBone = track.name.slice(0, -(property.length + 1)), target = targets.get(canonical(sourceBone))
          if (!target) continue
          track.name = `${target.name}.${property}`
          if (!rootFrame || !rootTurn || target !== characterRoot) continue
          const values = track.values, point = new THREE.Vector3(), turn = new THREE.Quaternion()
          if (property === 'position') for (let i = 0; i < values.length; i += 3) { point.fromArray(values, i).applyMatrix4(rootFrame).toArray(values, i) }
          if (property === 'quaternion') for (let i = 0; i < values.length; i += 4) { turn.fromArray(values, i).premultiply(rootTurn).toArray(values, i) }
        }
        const mixer = new THREE.AnimationMixer(modelScene), running = mixer.clipAction(clip); running.play()
        const seconds = Math.min(2.5, clip.duration), start = Math.max(0, (clip.duration - seconds) / 2)
        // Frame the whole recorded motion, not only the first pose.
        const bounds = new THREE.Box3()
        for (let step = 0; step <= 8; step++) { mixer.setTime(start + seconds * step / 8); modelScene.updateMatrixWorld(true); bounds.union(new THREE.Box3().setFromObject(modelScene, true)) }
        const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3())
        const span = Math.max(size.x, size.y, size.z); if (!Number.isFinite(span) || span < 0.001) throw new Error('Character preview model has no visible geometry')
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(span * 6, span * 6), new THREE.ShadowMaterial({ opacity: 0.16 }))
        floor.rotation.x = -Math.PI / 2; floor.position.set(center.x, bounds.min.y, center.z); floor.receiveShadow = true; scene.add(floor)
        key.position.set(center.x + span * 0.8, bounds.max.y + span * 2, center.z + span * 1.2); key.target.position.copy(center); scene.add(key.target)
        Object.assign(key.shadow.camera, { left: -span * 2, right: span * 2, top: span * 2, bottom: -span * 2, near: span * 0.1, far: span * 8 }); key.shadow.camera.updateProjectionMatrix()
        const camera = new THREE.PerspectiveCamera(32, 1, Math.max(0.001, span / 1000), span * 100)
        const radius = span * 0.5 / Math.tan(THREE.MathUtils.degToRad(16)) * 1.08
        camera.position.copy(center).add(new THREE.Vector3(0.45, 0.22, 1).normalize().multiplyScalar(radius)); camera.lookAt(center)
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
  return <main style={{ width: 320, height: 320, background: PREVIEW_BACKGROUND }} />
}
