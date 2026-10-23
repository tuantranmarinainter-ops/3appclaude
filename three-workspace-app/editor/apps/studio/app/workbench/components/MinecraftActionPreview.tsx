'use client'

import { useEffect, useRef, useState } from 'react'
import { AmbientLight, AxesHelper, BufferAttribute, BufferGeometry, DirectionalLight, GridHelper, LineBasicMaterial, LineSegments, Matrix4, MOUSE, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { evaluateBobjAction, parseBobjArmature, type BobjAction, type BobjArmature } from '@bbs/retarget'
import { useStudioLocale } from '../../../src/devtools/localePreference'

export function MinecraftActionPreview({ action }: { action: BobjAction }) {
  const vi = useStudioLocale() === 'vi'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeRef = useRef(0)
  const playingRef = useRef(false)
  const actionRef = useRef(action)
  const seekRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLOutputElement>(null)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  const duration = action.durationTicks / 20
  actionRef.current = action

  useEffect(() => {
    timeRef.current = 0
    playingRef.current = false
    setPlaying(false)
    if (seekRef.current) seekRef.current.value = '0'
    if (outputRef.current) outputRef.current.value = '0.00 s'
  }, [action])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let alive = true
    let frame = 0
    let previous = performance.now()
    let lastUIUpdate = 0
    let runtime: { renderer: WebGLRenderer; controls: OrbitControls; armature: BobjArmature; lines: LineSegments; positions: Float32Array } | null = null
    const abort = new AbortController()
    try {
      const renderer = new WebGLRenderer({ canvas, antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setClearColor(0x111419)
      const scene = new Scene()
      const camera = new PerspectiveCamera(38, 1, 0.01, 100)
      camera.position.set(3.4, 2.5, 6.5)
      camera.lookAt(0, 0.85, 0)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.target.set(0, 0.85, 0)
      controls.enableDamping = true
      controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN } // W01: left orbit, middle pan, wheel zoom
      scene.add(new AmbientLight(0xffffff, 1.6))
      const key = new DirectionalLight(0xffffff, 2.2)
      key.position.set(4, 7, 5)
      scene.add(key, new GridHelper(8, 24, 0x43505e, 0x26303a), new AxesHelper(0.45))
      const resize = () => {
        const rect = canvas.getBoundingClientRect()
        if (!rect.width || !rect.height || !alive) return
        renderer.setSize(rect.width, rect.height, false)
        camera.aspect = rect.width / rect.height
        camera.updateProjectionMatrix()
      }
      const observer = new ResizeObserver(resize)
      observer.observe(canvas)
      resize()
      void fetch('/retarget/v9.12/minecraft20-armature.bobj', { signal: abort.signal }).then((response) => {
        if (!response.ok) throw new Error(`Minecraft20 armature HTTP ${response.status}`)
        return response.text()
      }).then((text) => {
        if (!alive) return
        const armature = parseBobjArmature(text)
        const positions = new Float32Array(armature.bones.length * 6)
        const geometry = new BufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(positions, 3))
        const lines = new LineSegments(geometry, new LineBasicMaterial({ color: 0x73e4c1 }))
        scene.add(lines)
        runtime = { renderer, controls, armature, lines, positions }
      }).catch((loadError: unknown) => {
        if (alive && !abort.signal.aborted) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
      const draw = (now: number) => {
        if (!alive) return
        const delta = Math.min(0.1, (now - previous) / 1000)
        previous = now
        if (runtime) {
          const active = actionRef.current
          const seconds = active.durationTicks / 20
          if (playingRef.current && seconds > 0) timeRef.current = (timeRef.current + delta) % seconds
          const pose = evaluateBobjAction(runtime.armature, active, timeRef.current * 20)
          const matrix = new Matrix4()
          const start = new Vector3()
          const end = new Vector3()
          for (const [index, bone] of runtime.armature.bones.entries()) {
            matrix.fromArray([...pose[index]!.worldMatrix])
            start.setFromMatrixPosition(matrix)
            end.set(...bone.localTail).applyMatrix4(matrix)
            runtime.positions.set([...start.toArray(), ...end.toArray()], index * 6)
          }
          const position = runtime.lines.geometry.getAttribute('position') as BufferAttribute
          position.needsUpdate = true
          runtime.lines.geometry.computeBoundingSphere()
          if (now - lastUIUpdate > 100) {
            lastUIUpdate = now
            if (seekRef.current) seekRef.current.value = String(timeRef.current)
            if (outputRef.current) outputRef.current.value = `${timeRef.current.toFixed(2)} s`
          }
        }
        runtime?.controls.update()
        renderer.render(scene, camera)
        frame = requestAnimationFrame(draw)
      }
      frame = requestAnimationFrame(draw)
      return () => {
        alive = false
        abort.abort()
        cancelAnimationFrame(frame)
        observer.disconnect()
        controls.dispose()
        runtime?.lines.geometry.dispose()
        ;(runtime?.lines.material as LineBasicMaterial | undefined)?.dispose()
        renderer.dispose()
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [])

  return <section className="wb-bobj-preview" aria-label={vi ? 'Xem trước animation Minecraft20' : 'Minecraft20 action preview'}>
    <div className="wb-bobj-preview-canvas">
      <canvas ref={canvasRef} aria-label={vi ? 'Khung xương Minecraft20 đang chuyển động' : 'Animated Minecraft20 skeleton'} />
      <span>V9.12 BOBJ · Minecraft20</span>
    </div>
    <div className="wb-bobj-preview-controls">
      <button type="button" onClick={() => { playingRef.current = !playingRef.current; setPlaying(playingRef.current) }}>{playing ? (vi ? 'Tạm dừng' : 'Pause') : (vi ? 'Phát clip' : 'Play clip')}</button>
      <input ref={seekRef} type="range" min="0" max={Math.max(duration, 0.01)} step="0.01" defaultValue="0" aria-label={vi ? 'Thời gian animation Minecraft' : 'Minecraft action time'} onChange={(event) => {
        timeRef.current = Number(event.target.value)
        if (outputRef.current) outputRef.current.value = `${timeRef.current.toFixed(2)} s`
      }} />
      <output ref={outputRef}>0.00 s</output>
      <span>{duration.toFixed(2)} s · 20 ticks/s</span>
    </div>
    {error && <p className="wb-retarget-error" role="alert">{error}</p>}
  </section>
}
