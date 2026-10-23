'use client'

import { useEffect, useRef, useState } from 'react'

export function ActionPreview({ uuid, animationIndex, characterUrl }: { uuid: string; animationIndex: number; characterUrl: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = host.current
    if (!element) return
    let disposed = false
    let frame = 0
    let renderer: import('three').WebGLRenderer | undefined
    let observer: ResizeObserver | undefined
    let cleanup: (() => void) | undefined
    let removePointerListeners: (() => void) | undefined
    setError('')
    void (async () => {
      try {
        const THREE = await import('three')
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
        const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js')
        if (disposed || !element) return
        const scene = new THREE.Scene()
        scene.background = new THREE.Color('#15191f')
        scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2))
        const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 5, 4); scene.add(key)
        const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000)
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        element.replaceChildren(renderer.domElement)
        // Built-in characters are Draco-compressed; Studio serves the decoder at /draco/.
        const draco = new DRACOLoader().setDecoderPath('/draco/')
        const loader = new GLTFLoader().setDRACOLoader(draco)
        const [character, action] = await Promise.all([
          loader.loadAsync(characterUrl),
          loader.loadAsync(`/api/library/animation/${encodeURIComponent(uuid)}`),
        ])
        draco.dispose()
        if (disposed) { renderer.dispose(); return }
        scene.add(character.scene)
        const bounds = new THREE.Box3().setFromObject(character.scene)
        const size = bounds.getSize(new THREE.Vector3())
        const center = bounds.getCenter(new THREE.Vector3())
        if (!Number.isFinite(size.length()) || size.length() < 0.0001) throw new Error('Action GLB has no previewable geometry')
        const span = Math.max(size.x, size.y, size.z)
        camera.position.set(center.x + span * 1.8, center.y + span * 0.7, center.z + span * 2.2)
        camera.lookAt(center)
        const target = center.clone(), spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target))
        const syncCamera = () => { camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical)); camera.lookAt(target) }
        let pointerX = 0, pointerY = 0, activeButton = -1
        const canvas = renderer.domElement; canvas.tabIndex = 0; canvas.style.cursor = 'grab'
        const onDown = (event: PointerEvent) => { activeButton = event.button; pointerX = event.clientX; pointerY = event.clientY; canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing' }
        const onMove = (event: PointerEvent) => { if (activeButton < 0) return; const dx = event.clientX - pointerX, dy = event.clientY - pointerY; pointerX = event.clientX; pointerY = event.clientY; if (activeButton === 0) { spherical.theta -= dx * 0.006; spherical.phi = Math.max(0.12, Math.min(Math.PI - 0.12, spherical.phi + dy * 0.006)) } else if (activeButton === 1) { const scale = spherical.radius * 0.0015; target.add(new THREE.Vector3(-dx * scale, dy * scale, 0).applyQuaternion(camera.quaternion)) }; syncCamera() }
        const onUp = () => { activeButton = -1; canvas.style.cursor = 'grab' }
        const onWheel = (event: WheelEvent) => { event.preventDefault(); spherical.radius = Math.max(span * 0.4, Math.min(span * 12, spherical.radius * Math.exp(event.deltaY * 0.001))); syncCamera() }
        canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp); canvas.addEventListener('wheel', onWheel, { passive: false })
        removePointerListeners = () => { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('wheel', onWheel) }
        camera.near = Math.max(0.001, span / 1000); camera.far = span * 100; camera.updateProjectionMatrix()
        const clip = action.animations[animationIndex]
        if (!clip) throw new Error('Action animation clip is missing from its GLB')
        const canonical = (name: string) => name.split(':').at(-1)!.replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
        const targets = new Map<string, string>()
        character.scene.traverse((object) => { if (object.name) targets.set(canonical(object.name), object.name) })
        for (const track of clip.tracks) {
          const property = track.name.match(/\.(position|quaternion|scale)$/)?.[1]
          if (!property) continue
          const sourceBone = track.name.slice(0, -(property.length + 1))
          const targetBone = targets.get(canonical(sourceBone))
          if (targetBone) track.name = `${targetBone}.${property}`
        }
        const mixer = new THREE.AnimationMixer(character.scene)
        mixer.clipAction(clip).play()
        const clock = new THREE.Clock()
        const resize = () => {
          const width = Math.max(1, element.clientWidth), height = Math.max(1, element.clientHeight)
          renderer?.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix()
        }
        observer = new ResizeObserver(resize); observer.observe(element); resize()
        const draw = () => { if (disposed) return; frame = requestAnimationFrame(draw); mixer.update(Math.min(clock.getDelta(), 0.05)); renderer?.render(scene, camera) }
        draw()
        cleanup = () => { mixer.stopAllAction(); scene.clear(); renderer?.dispose(); renderer?.domElement.remove() }
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)) }
    })()
    return () => { disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); removePointerListeners?.(); cleanup?.(); renderer?.dispose(); element.replaceChildren() }
  }, [animationIndex, characterUrl, uuid])
  return <div ref={host} aria-label="Animation preview" style={{ width: '100%', height: 230, background: '#15191f', display: 'grid', placeItems: 'center' }}>{error && <span role="status">{error}</span>}</div>
}
