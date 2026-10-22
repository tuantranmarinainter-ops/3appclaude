'use client'

import { useEffect, useRef, useState } from 'react'

export function ActionPreview({ uuid, animationIndex }: { uuid: string; animationIndex: number }) {
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
    setError('')
    void (async () => {
      try {
        const THREE = await import('three')
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
        if (disposed || !element) return
        const scene = new THREE.Scene()
        scene.background = new THREE.Color('#15191f')
        scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2))
        const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 5, 4); scene.add(key)
        const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000)
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        element.replaceChildren(renderer.domElement)
        const loader = new GLTFLoader()
        const gltf = await loader.loadAsync(`/api/library/animation/${encodeURIComponent(uuid)}`)
        if (disposed) { renderer.dispose(); return }
        scene.add(gltf.scene)
        const bounds = new THREE.Box3().setFromObject(gltf.scene)
        const size = bounds.getSize(new THREE.Vector3())
        const center = bounds.getCenter(new THREE.Vector3())
        if (!Number.isFinite(size.length()) || size.length() < 0.0001) throw new Error('Action GLB has no previewable geometry')
        const span = Math.max(size.x, size.y, size.z)
        camera.position.set(center.x + span * 1.8, center.y + span * 0.7, center.z + span * 2.2)
        camera.lookAt(center)
        camera.near = Math.max(0.001, span / 1000); camera.far = span * 100; camera.updateProjectionMatrix()
        const clip = gltf.animations[animationIndex]
        if (!clip) throw new Error('Action animation clip is missing from its GLB')
        const mixer = new THREE.AnimationMixer(gltf.scene)
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
    return () => { disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); cleanup?.(); renderer?.dispose(); element.replaceChildren() }
  }, [animationIndex, uuid])
  return <div ref={host} aria-label="Animation preview" style={{ width: '100%', height: 230, background: '#15191f', display: 'grid', placeItems: 'center' }}>{error && <span role="status">{error}</span>}</div>
}
