'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimationMixer, AmbientLight, AxesHelper, Bone, BufferAttribute, BufferGeometry, DirectionalLight, GridHelper, Group, LineBasicMaterial, LineSegments, Matrix4, Mesh, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer, type AnimationClip } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { fbxSourceBones } from '@topview/3d-builder/evaluate'
import { bakeReverseRetargetFrames, createReverseRetargeter, defaultReverseRetargetSettings, retargetFramesToAnimationClip, type MixamoPoseBone, type Quat, type RetargetedBone, type ReverseRetargetSettings, type Vec3 } from '@bbs/retarget'
import type { SkeletonProfile } from '@bbs/animation-workspace-shared'
import { useStudioLocale } from '../../../src/devtools/localePreference'
import { loadUnifiedProject, sendUnifiedCommand, uploadUnifiedAsset } from '../../../src/unifiedApi'

const requiredMixamoBones = ['hips', 'spine2', 'head', 'leftarm', 'leftforearm', 'lefthand', 'rightarm', 'rightforearm', 'righthand', 'leftupleg', 'leftleg', 'leftfoot', 'rightupleg', 'rightleg', 'rightfoot']

interface RigBone { object: Bone; parent: Bone | null; restWorldPosition: Vec3; restWorldQuaternion: Quat }
interface Runtime {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  controls: OrbitControls
  sourceStage: Group
  targetStage: Group
  targetLine: LineSegments
  targetPositions: Float32Array
  sourceLine: LineSegments
  sourcePositions: Float32Array
  sourceLinks: Array<{ parent: Bone; child: Bone }>
  targetBones: ReturnType<typeof createReverseRetargeter>['armature']['bones']
  armatureText: string
  solver: ReturnType<typeof createReverseRetargeter> | null
  mixer: AnimationMixer | null
  model: Group | null
  bones: RigBone[]
  clips: AnimationClip[]
}

export interface ActiveRetargetMapping {
  id: string
  sourceHashes: string[]
  sourceMetersPerUnit: number
  targetFamily: SkeletonProfile['family']
  sourceBonesByRole: Readonly<Record<string, string>>
  confirmed: boolean
  targetCompatible: boolean
}

export interface RetargetReferencePose {
  mappingId: string
  sourceHash: string
  sourceMetersPerUnit: number
  bones: Readonly<Record<string, Quat>>
}

function asVec3(value: number[]): Vec3 { return [value[0], value[1], value[2]] }
function asQuat(value: number[]): Quat { return [value[0], value[1], value[2], value[3]] }
function canonical(name: string): string { return name.split(':').pop()!.replace(/^mixamorig\d*/i, '').replace(/[|]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase() }

function releaseModel(model: Group | null) {
  model?.traverse((object) => {
    const mesh = object as Mesh
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of materials) {
      for (const value of Object.values(material)) if (value && typeof value === 'object' && 'isTexture' in value) (value as { dispose?: () => void }).dispose?.()
      material.dispose()
    }
  })
}

function mappingMatchesSource(mapping: ActiveRetargetMapping | null, sourceHash: string, sourceUnit: 'cm' | 'm'): mapping is ActiveRetargetMapping {
  return !!mapping && mapping.confirmed && mapping.targetFamily === 'minecraft20' && mapping.targetCompatible &&
    mapping.sourceHashes.includes(sourceHash) && Math.abs(mapping.sourceMetersPerUnit - (sourceUnit === 'cm' ? 0.01 : 1)) < 1e-9
}

function referencePoseMatchesSource(reference: RetargetReferencePose | null, mapping: ActiveRetargetMapping | null, sourceHash: string, sourceUnit: 'cm' | 'm'): reference is RetargetReferencePose {
  return !!reference && mappingMatchesSource(mapping, sourceHash, sourceUnit) && reference.mappingId === mapping.id && reference.sourceHash === sourceHash &&
    Math.abs(reference.sourceMetersPerUnit - mapping.sourceMetersPerUnit) < 1e-9
}

function createPreviewSolver(text: string, mapping: ActiveRetargetMapping | null, reference: RetargetReferencePose | null, sourceHash: string, sourceUnit: 'cm' | 'm') {
  const useMapping = mappingMatchesSource(mapping, sourceHash, sourceUnit)
  const useReference = referencePoseMatchesSource(reference, mapping, sourceHash, sourceUnit)
  return createReverseRetargeter(text, useMapping ? mapping.sourceBonesByRole : undefined, useReference ? reference.bones : undefined)
}

export function RetargetPreview({ projectId, calibrationSettings, activeMapping, sourceReferencePose, onCalibrationChange, active = true }: { projectId: string; calibrationSettings: ReverseRetargetSettings; activeMapping: ActiveRetargetMapping | null; sourceReferencePose: RetargetReferencePose | null; onCalibrationChange?: (settings: ReverseRetargetSettings) => void; active?: boolean }) {
  const vi = useStudioLocale() === 'vi'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runtimeRef = useRef<Runtime | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const loadGenerationRef = useRef(0)
  const timeRef = useRef(0)
  const playingRef = useRef(false)
  const activeRef = useRef(active)
  const settingsRef = useRef<ReverseRetargetSettings>({ ...calibrationSettings })
  const activeMappingRef = useRef(activeMapping)
  const referencePoseRef = useRef(sourceReferencePose)
  const sourceHashRef = useRef('')
  const sourceUnitRef = useRef<'cm' | 'm'>('cm')
  const [fileName, setFileName] = useState('')
  const [sourceHash, setSourceHash] = useState('')
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [sourceUnit, setSourceUnit] = useState<'cm' | 'm'>('cm')
  const [clipNames, setClipNames] = useState<string[]>([])
  const [clipIndex, setClipIndex] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [mappedBones, setMappedBones] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [mappingNotice, setMappingNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [baking, setBaking] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const [mirror, setMirror] = useState(false)
  const [rootMode, setRootMode] = useState<'inPlace' | 'follow'>('inPlace')
  const timeInputRef = useRef<HTMLInputElement>(null)
  const timeLabelRef = useRef<HTMLOutputElement>(null)
  const viewSettingsRef = useRef({ clipIndex, mirror, rootMode })
  activeRef.current = active
  viewSettingsRef.current = { clipIndex, mirror, rootMode }
  activeMappingRef.current = activeMapping
  referencePoseRef.current = sourceReferencePose
  sourceUnitRef.current = sourceUnit
  const mappingApplicable = mappingMatchesSource(activeMapping, sourceHash, sourceUnit)
  const referencePoseApplicable = referencePoseMatchesSource(sourceReferencePose, activeMapping, sourceHash, sourceUnit)
  const referencePoseNotice = sourceReferencePose
    ? referencePoseApplicable
      ? (vi ? 'Đang dùng reference pose từ session V9.12 khớp FBX và mapping.' : 'Using the V9.12 session reference pose for this matching FBX and mapping.')
      : (vi ? 'Reference pose của session chưa áp dụng: cần nạp đúng FBX, đơn vị và mapping đã liên kết.' : 'The session reference pose is inactive until its linked FBX, unit, and mapping are loaded.')
    : ''

  useEffect(() => {
    settingsRef.current = { ...calibrationSettings }
    setMirror(calibrationSettings.mirror)
    setRootMode(calibrationSettings.rootTravelMode)
  }, [calibrationSettings])

  useEffect(() => {
    if (!active) { playingRef.current = false; setPlaying(false) }
  }, [active])

  function setCalibrationSetting<K extends keyof ReverseRetargetSettings>(key: K, value: ReverseRetargetSettings[K]) {
    settingsRef.current = { ...settingsRef.current, [key]: value }
    onCalibrationChange?.({ ...settingsRef.current })
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let frame = 0
    let alive = true
    let runtime: Runtime | null = null
    const abort = new AbortController()
    try {
      const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setClearColor(0x111419)
      const scene = new Scene()
      const camera = new PerspectiveCamera(38, 1, 0.01, 1000)
      camera.position.set(3.4, 2.5, 6.5)
      camera.lookAt(0, 0.85, 0)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.target.set(0, 0.85, 0)
      controls.enableDamping = true
      scene.add(new AmbientLight(0xffffff, 1.6))
      const key = new DirectionalLight(0xffffff, 2.2)
      key.position.set(4, 7, 5)
      scene.add(key, new GridHelper(8, 24, 0x43505e, 0x26303a), new AxesHelper(0.45))
      const sourceStage = new Group()
      sourceStage.position.x = -1.05
      const targetStage = new Group()
      targetStage.position.x = 1.05
      scene.add(sourceStage, targetStage)

      runtime = { renderer, scene, camera, controls, sourceStage, targetStage, targetLine: new LineSegments(), targetPositions: new Float32Array(), sourceLine: new LineSegments(), sourcePositions: new Float32Array(), sourceLinks: [], targetBones: [], armatureText: '', solver: null, mixer: null, model: null, bones: [], clips: [] }
      runtimeRef.current = runtime
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
        if (!alive || !runtime) return
        runtime.armatureText = text
        const active = activeMappingRef.current
        const solver = createPreviewSolver(text, active, referencePoseRef.current, sourceHashRef.current, sourceUnitRef.current)
        const positions = new Float32Array(solver.armature.bones.length * 6)
        const geometry = new BufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(positions, 3))
        const line = new LineSegments(geometry, new LineBasicMaterial({ color: 0x73e4c1, linewidth: 2 }))
        runtime.solver = solver
        runtime.targetBones = solver.armature.bones
        runtime.targetPositions = positions
        runtime.targetLine = line
        runtime.targetStage.add(line)
        updateTarget(runtime, solver.armature.bones.map((bone) => ({ name: bone.name, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], worldMatrix: bone.restWorld } as RetargetedBone)))
      }).catch((error: unknown) => {
        if (alive && !abort.signal.aborted) setPreviewError(error instanceof Error ? error.message : String(error))
      })

      let previous = performance.now()
      let lastUIUpdate = 0
      let lastSolverError = ''
      const draw = (now: number) => {
        if (!alive || !runtime) return
        if (!activeRef.current) { frame = requestAnimationFrame(draw); return }
        const delta = Math.min(0.1, (now - previous) / 1000)
        previous = now
        if (runtime.mixer && runtime.clips.length) {
          const clip = runtime.clips[viewSettingsRef.current.clipIndex] ?? runtime.clips[0]
          if (activeRef.current && playingRef.current && clip.duration > 0) timeRef.current = (timeRef.current + delta) % clip.duration
          runtime.mixer.setTime(timeRef.current)
          runtime.model?.updateWorldMatrix(true, true)
          const sourceAttribute = runtime.sourceLine.geometry.getAttribute('position') as BufferAttribute
          runtime.sourceLinks.forEach(({ parent, child }, index) => {
            const start = parent.getWorldPosition(new Vector3())
            const end = child.getWorldPosition(new Vector3())
            sourceAttribute.setXYZ(index * 2, start.x, start.y, start.z)
            sourceAttribute.setXYZ(index * 2 + 1, end.x, end.y, end.z)
          })
          sourceAttribute.needsUpdate = true
          const pose: MixamoPoseBone[] = runtime.bones.map(({ object, restWorldPosition, restWorldQuaternion }) => ({
            name: object.name,
            restWorldPosition,
            restWorldQuaternion,
            worldPosition: asVec3(object.getWorldPosition(new Vector3()).toArray()),
            worldQuaternion: asQuat(object.getWorldQuaternion(new Quaternion()).toArray()),
          }))
          try {
            if (!runtime.solver) throw new Error('Minecraft20 solver chưa sẵn sàng.')
            const active = activeMappingRef.current
            const mappingMatches = mappingMatchesSource(active, sourceHashRef.current, sourceUnitRef.current)
            const settings = active && !mappingMatches ? defaultReverseRetargetSettings : settingsRef.current
            const view = active && !mappingMatches ? { ...viewSettingsRef.current, mirror: false, rootMode: 'inPlace' as const } : viewSettingsRef.current
            updateTarget(runtime, runtime.solver.evaluate(pose, { ...settings, mirror: view.mirror, rootTravelMode: view.rootMode }))
            if (lastSolverError) { lastSolverError = ''; setPreviewError('') }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (message !== lastSolverError) { lastSolverError = message; setPreviewError(message) }
          }
          if (now - lastUIUpdate > 100) {
            lastUIUpdate = now
            if (timeInputRef.current) timeInputRef.current.value = String(timeRef.current)
            if (timeLabelRef.current) timeLabelRef.current.value = `${timeRef.current.toFixed(2)} s`
          }
        }
        controls.update()
        renderer.render(scene, camera)
        frame = requestAnimationFrame(draw)
      }
      frame = requestAnimationFrame(draw)
      return () => {
        alive = false
        loadGenerationRef.current += 1
        abort.abort()
        cancelAnimationFrame(frame)
        observer.disconnect()
        controls.dispose()
        runtime?.mixer?.stopAllAction()
        releaseModel(runtime?.model ?? null)
        runtime?.targetLine.geometry.dispose()
        ;(runtime?.targetLine.material as LineBasicMaterial | undefined)?.dispose()
        runtime?.sourceLine.geometry.dispose()
        ;(runtime?.sourceLine.material as LineBasicMaterial | undefined)?.dispose()
        renderer.dispose()
        runtimeRef.current = null
      }
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (runtime?.armatureText) {
      try {
        runtime.solver = createPreviewSolver(runtime.armatureText, activeMapping, sourceReferencePose, sourceHash, sourceUnit)
        setPreviewError('')
      } catch (error) { setPreviewError(error instanceof Error ? error.message : String(error)) }
    }
    if (!activeMapping) setMappingNotice('')
    else if (!activeMapping.confirmed) setMappingNotice(vi ? 'Mapping nháp thiếu role bắt buộc nên chưa được áp dụng.' : 'This mapping draft is missing required roles and is not applied.')
    else if (activeMapping.targetFamily !== 'minecraft20') setMappingNotice(vi ? 'Preview V9.12 hiện chỉ chạy target Minecraft20.' : 'The V9.12 preview currently supports Minecraft20 targets only.')
    else if (!activeMapping.targetCompatible) setMappingNotice(vi ? 'Bone target không khớp hierarchy Minecraft20 V9.12 nên mapping chưa được áp dụng.' : 'Target bone assignments do not match the V9.12 Minecraft20 hierarchy; this mapping is not applied.')
    else if (!activeMapping.sourceHashes.includes(sourceHash)) setMappingNotice(vi ? 'Hãy nạp đúng FBX nguồn đã lưu trong mapping để áp dụng mapping và calibration.' : 'Load the exact source FBX saved by this mapping to apply its mapping and calibration.')
    else if (Math.abs(activeMapping.sourceMetersPerUnit - (sourceUnit === 'cm' ? 0.01 : 1)) >= 1e-9) setMappingNotice(vi ? 'Đơn vị FBX chưa khớp profile nguồn; hãy chọn đúng cm hoặc m.' : 'FBX unit does not match the source profile; select the matching cm or m unit.')
    else setMappingNotice(vi ? 'Đang áp dụng mapping/calibration cho armature preview V9.12; mesh và rest pose của profile đích chưa được nạp.' : 'Applying mapping/calibration to the V9.12 preview armature; target-profile mesh and rest pose are not loaded.')
  }, [activeMapping, sourceReferencePose, sourceHash, sourceUnit, vi])

  const calibrationDisabled = !fileName || !!activeMapping && !mappingApplicable

  function onScrub(value: number) {
    timeRef.current = value
    if (timeLabelRef.current) timeLabelRef.current.value = `${value.toFixed(2)} s`
  }

  async function loadFbx(file?: File, unit = sourceUnit) {
    if (!file) return
    const generation = ++loadGenerationRef.current
    setLoadError('')
    if (!file.name.toLowerCase().endsWith('.fbx')) { setLoadError(vi ? 'Workspace này chỉ nhận FBX Mixamo65.' : 'This workspace accepts Mixamo65 FBX files only.'); return }
    if (file.size > 250 * 1024 * 1024) { setLoadError(vi ? 'FBX vượt giới hạn 250 MB.' : 'FBX exceeds the 250 MB limit.'); return }
    try {
      const runtime = runtimeRef.current
      if (!runtime?.solver) throw new Error(vi ? 'Minecraft20 solver đang khởi tạo.' : 'Minecraft20 solver is still loading.')
      const bytes = await file.arrayBuffer()
      if (generation !== loadGenerationRef.current) return
      const model = new FBXLoader().parse(bytes, '')
      if (generation !== loadGenerationRef.current) { releaseModel(model); return }
      model.scale.multiplyScalar(unit === 'cm' ? 0.01 : 1)
      const clips = model.animations
      const firstClip = clips.findIndex((clip) => clip.duration > 0 && clip.tracks.length > 0)
      if (firstClip < 0) { releaseModel(model); throw new Error(vi ? 'FBX không có animation clip.' : 'FBX contains no animation clips.') }
      model.updateWorldMatrix(true, true)
      let bones: Bone[]
      try { bones = fbxSourceBones(model) }
      catch (error) { releaseModel(model); throw error }
      const names = new Set(bones.map((bone) => canonical(bone.name)))
      const mapped = requiredMixamoBones.filter((name) => names.has(name)).length
      if (mapped !== requiredMixamoBones.length) { releaseModel(model); throw new Error(vi ? `Rig không khớp Mixamo65: tìm thấy ${mapped}/15 xương nguồn cần cho 13 mapping.` : `Rig does not match Mixamo65: found ${mapped}/15 source bones required by the 13 mappings.`) }
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
      const hash = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')
      runtime.mixer?.stopAllAction()
      runtime.scene.remove(runtime.sourceLine)
      runtime.sourceLine.geometry.dispose()
      ;(runtime.sourceLine.material as LineBasicMaterial | undefined)?.dispose()
      releaseModel(runtime.model)
      if (runtime.model) runtime.sourceStage.remove(runtime.model)
      runtime.model = model
      runtime.clips = clips
      runtime.mixer = new AnimationMixer(model)
      runtime.mixer.clipAction(clips[firstClip]).play()
      runtime.sourceStage.add(model)
      model.updateWorldMatrix(true, true)
      runtime.bones = bones.map((object) => ({
        object,
        parent: nearestParentBone(object),
        restWorldPosition: asVec3(object.getWorldPosition(new Vector3()).toArray()),
        restWorldQuaternion: asQuat(object.getWorldQuaternion(new Quaternion()).toArray()),
      }))
      runtime.sourceLinks = runtime.bones.flatMap(({ object, parent }) => parent ? [{ parent, child: object }] : [])
      runtime.sourcePositions = new Float32Array(runtime.sourceLinks.length * 6)
      const sourceGeometry = new BufferGeometry()
      sourceGeometry.setAttribute('position', new BufferAttribute(runtime.sourcePositions, 3))
      runtime.sourceLine = new LineSegments(sourceGeometry, new LineBasicMaterial({ color: 0x9bbcff }))
      runtime.scene.add(runtime.sourceLine)
      timeRef.current = 0
      playingRef.current = false
      setPlaying(false)
      setSourceFile(file)
      sourceHashRef.current = hash
      setSourceHash(hash)
      setFileName(file.name)
      setClipNames(clips.map((clip, index) => clip.duration > 0 && clip.tracks.length > 0 ? clip.name || `Clip ${index + 1}` : ''))
      setClipIndex(firstClip)
      setDuration(clips[firstClip].duration)
      setMappedBones(13)
      setPreviewError('')
    } catch (error) {
      if (generation === loadGenerationRef.current) setLoadError(error instanceof Error ? error.message : String(error))
    }
  }

  async function saveSourceToProject() {
    if (!sourceFile || saving) return
    setSaving(true)
    setSaveError('')
    setSavedMessage('')
    try {
      const upload = await uploadUnifiedAsset(sourceFile)
      const latest = await loadUnifiedProject(projectId)
      const response = await sendUnifiedCommand({
        requestId: crypto.randomUUID(), projectId, expectedRevision: latest.project.revision,
        command: 'asset.import', args: { files: [upload.uploadId], format: 'fbx', unitMeters: sourceUnit === 'cm' ? 0.01 : 1 },
      })
      const motionIds = Array.isArray(response.result.motionIds) ? response.result.motionIds : []
      if (!motionIds.length) throw new Error(vi ? 'FBX đã nhập nhưng không tạo được Motion.' : 'FBX imported without a Motion clip.')
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
      const issues = Array.isArray(response.result.issues) ? response.result.issues.flatMap((issue) => issue && typeof issue === 'object' && 'message' in issue && typeof issue.message === 'string' ? [issue.message] : []) : []
      const limit = issues.length ? ` · ${issues.join(' ')}` : ''
      setSavedMessage(`${vi ? `Đã lưu ${motionIds.length} motion nguồn · revision ${response.revision}` : `Saved ${motionIds.length} source motion(s) · revision ${response.revision}`}${limit}`)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally { setSaving(false) }
  }

  function exportBakedClip() {
    const runtime = runtimeRef.current
    const clip = runtime?.clips[viewSettingsRef.current.clipIndex]
    if (baking) return
    if (!runtime?.mixer || !runtime.model || !runtime.solver || !clip || !clip.duration) {
      setSaveError(vi ? 'Preview chưa sẵn sàng để bake.' : 'The preview is not ready to bake yet.')
      return
    }
    setBaking(true)
    const previousTime = timeRef.current
    try {
      const fps = 30 as const
      const frames = bakeReverseRetargetFrames(runtime.solver, (timeSeconds) => {
        runtime.mixer!.setTime(Math.min(timeSeconds, Math.max(0, clip.duration - 1e-6)))
        runtime.model!.updateWorldMatrix(true, true)
        return runtime.bones.map(({ object, restWorldPosition, restWorldQuaternion }) => ({
          name: object.name, restWorldPosition, restWorldQuaternion,
          worldPosition: asVec3(object.getWorldPosition(new Vector3()).toArray()),
          worldQuaternion: asQuat(object.getWorldQuaternion(new Quaternion()).toArray()),
        }))
      }, { startFrame: 0, endFrame: Math.floor(clip.duration * fps), fps }, (() => {
        const active = activeMappingRef.current
        const matched = mappingMatchesSource(active, sourceHashRef.current, sourceUnitRef.current)
        const view = active && !matched ? { ...viewSettingsRef.current, mirror: false, rootMode: 'inPlace' as const } : viewSettingsRef.current
        return { ...(active && !matched ? defaultReverseRetargetSettings : settingsRef.current), mirror: view.mirror, rootTravelMode: view.rootMode }
      })())
      const baked = retargetFramesToAnimationClip(frames, clip.name || 'Retargeted motion')
      const url = URL.createObjectURL(new Blob([JSON.stringify(baked.toJSON(), null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${fileName.replace(/\.[^.]+$/, '') || 'retargeted-motion'}-${clip.name || 'clip'}.animation.json`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setSavedMessage(vi ? `Đã bake ${frames.length} frame ở 30 FPS và tải clip JSON.` : `Baked ${frames.length} frames at 30 FPS and downloaded the clip JSON.`)
      setSaveError('')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      runtime.mixer.setTime(previousTime)
      timeRef.current = previousTime
      setBaking(false)
    }
  }

  useEffect(() => {
    const runtime = runtimeRef.current
    const clip = runtime?.clips[clipIndex]
    if (!runtime?.mixer || !clip) return
    runtime.mixer.stopAllAction()
    runtime.mixer.clipAction(clip).play()
    timeRef.current = 0
    setDuration(clip.duration)
    if (timeInputRef.current) timeInputRef.current.value = '0'
    if (timeLabelRef.current) timeLabelRef.current.value = '0.00 s'
  }, [clipIndex, fileName])

  return (
    <section className="wb-retarget-preview" aria-label="FBX Mixamo to Minecraft20 preview">
      <div className="wb-retarget-preview-toolbar">
        <label className="wb-retarget-file">{fileName || (vi ? 'Chưa nạp FBX Mixamo65' : 'No Mixamo65 FBX loaded')}<input ref={fileRef} type="file" accept=".fbx,application/octet-stream" onChange={(event) => { void loadFbx(event.target.files?.[0]); event.target.value = '' }} /></label>
        <label className="wb-retarget-clip">{vi ? 'Đơn vị' : 'FBX unit'}<select value={sourceUnit} onChange={(event) => { const unit = event.target.value as 'cm' | 'm'; setSourceUnit(unit); if (sourceFile) void loadFbx(sourceFile, unit) }}><option value="cm">cm → m</option><option value="m">m</option></select></label>
        <label className="wb-retarget-clip">Clip<select value={clipIndex} onChange={(event) => setClipIndex(Number(event.target.value))} disabled={!clipNames.length}>{clipNames.map((name, index) => name ? <option key={`${name}-${index}`} value={index}>{name}</option> : null)}</select></label>
        <button type="button" disabled={!fileName} onClick={() => { playingRef.current = !playingRef.current; setPlaying(playingRef.current) }}>{playing ? (vi ? 'Tạm dừng' : 'Pause') : (vi ? 'Phát' : 'Play')}</button>
        <button type="button" disabled={!sourceFile || saving} onClick={() => void saveSourceToProject()}>{saving ? (vi ? 'Đang lưu…' : 'Saving…') : (vi ? 'Lưu motion nguồn vào project' : 'Save source motion to project')}</button>
        <button type="button" disabled={!sourceFile || saving || baking} onClick={exportBakedClip}>{baking ? (vi ? 'Đang bake…' : 'Baking…') : (vi ? 'Bake clip JSON · 30 FPS' : 'Bake clip JSON · 30 FPS')}</button>
        <span>{fileName ? `${mappedBones}/13 ${vi ? 'mapping' : 'mapped'} · ${duration.toFixed(2)} s` : (vi ? 'Chưa có source' : 'No source loaded')}</span>
      </div>
      <div className="wb-retarget-view">
        <canvas ref={canvasRef} aria-label="Preview rig Mixamo và Minecraft20" />
        <span className="wb-retarget-view-label wb-retarget-view-source">SOURCE · FBX</span>
        <span className="wb-retarget-view-label wb-retarget-view-target">TARGET · Minecraft20</span>
        {!fileName && <p className="wb-retarget-view-empty">{vi ? 'Nạp FBX Mixamo65 để xem animation được retarget trực tiếp.' : 'Load a Mixamo65 FBX to preview the retargeted animation.'}</p>}
        {previewError && <p className="wb-retarget-error wb-retarget-view-error" role="alert">{previewError}</p>}
        {mappingNotice && <p className="wb-retarget-preview-note" role="status">{mappingNotice}</p>}
        {referencePoseNotice && <p className="wb-retarget-preview-note" role="status">{referencePoseNotice}</p>}
      </div>
      <div className="wb-retarget-transport">
        <button type="button" disabled={!fileName} onClick={() => { timeRef.current = 0; if (timeInputRef.current) timeInputRef.current.value = '0' }}>{vi ? 'Về đầu' : 'To start'}</button>
        <input ref={timeInputRef} type="range" min="0" max={Math.max(duration, 0.01)} step="0.01" defaultValue="0" disabled={!fileName} aria-label="Thời gian clip" onChange={(event) => onScrub(Number(event.target.value))} />
        <output ref={timeLabelRef}>0.00 s</output>
        <label><input type="checkbox" checked={mirror} onChange={(event) => { setMirror(event.target.checked); setCalibrationSetting('mirror', event.target.checked) }} disabled={calibrationDisabled} /> Mirror</label>
        <label>Root<select value={rootMode} onChange={(event) => { const mode = event.target.value as 'inPlace' | 'follow'; setRootMode(mode); setCalibrationSetting('rootTravelMode', mode) }} disabled={calibrationDisabled}><option value="inPlace">In place</option><option value="follow">Follow</option></select></label>
      </div>
      <details className="wb-retarget-adjustments">
        <summary>{vi ? 'Hiệu chỉnh retarget' : 'Retarget adjustments'}</summary>
        <div className="wb-retarget-adjustment-grid">
          <label>{vi ? 'Cường độ' : 'Intensity'}<input type="range" min="0" max="200" value={Math.round(calibrationSettings.intensity * 100)} onChange={(event) => setCalibrationSetting('intensity', Number(event.target.value) / 100)} disabled={calibrationDisabled} /></label>
          <label>{vi ? 'Sải chân' : 'Stride'}<input type="range" min="0" max="200" value={Math.round(calibrationSettings.stride * 100)} onChange={(event) => setCalibrationSetting('stride', Number(event.target.value) / 100)} disabled={calibrationDisabled} /></label>
          <label>{vi ? 'Chuyển động dọc' : 'Vertical motion'}<input type="range" min="0" max="200" value={Math.round(calibrationSettings.vertical * 100)} onChange={(event) => setCalibrationSetting('vertical', Number(event.target.value) / 100)} disabled={calibrationDisabled} /></label>
          <label>{vi ? 'Độ rộng vai' : 'Shoulder width'}<input type="range" min="70" max="140" value={Math.round(calibrationSettings.shoulderWidth * 100)} onChange={(event) => setCalibrationSetting('shoulderWidth', Number(event.target.value) / 100)} disabled={calibrationDisabled} /></label>
          <label>{vi ? 'Bắp tay' : 'Upper arm'}<input type="range" min="70" max="140" value={Math.round(calibrationSettings.upperArm * 100)} onChange={(event) => setCalibrationSetting('upperArm', Number(event.target.value) / 100)} disabled={calibrationDisabled} /></label>
          <label>{vi ? 'Cẳng tay' : 'Forearm'}<input type="range" min="70" max="140" value={Math.round(calibrationSettings.forearm * 100)} onChange={(event) => setCalibrationSetting('forearm', Number(event.target.value) / 100)} disabled={calibrationDisabled} /></label>
          <label>{vi ? 'Chiều dài chân' : 'Leg length'}<input type="range" min="80" max="125" value={Math.round(calibrationSettings.legLength * 100)} onChange={(event) => setCalibrationSetting('legLength', Number(event.target.value) / 100)} disabled={calibrationDisabled} /></label>
          <label>{vi ? 'Khoảng cách tay' : 'Arm spacing'}<input type="range" min="-50" max="100" value={Math.round(calibrationSettings.armSpace * 100)} onChange={(event) => setCalibrationSetting('armSpace', Number(event.target.value) / 100)} disabled={calibrationDisabled} /></label>
          <label>{vi ? 'Áp dụng tỉ lệ cho' : 'Apply proportions to'}<select value={calibrationSettings.proportionSide} onChange={(event) => setCalibrationSetting('proportionSide', event.target.value as 'both' | 'left' | 'right')} disabled={calibrationDisabled}><option value="both">{vi ? 'Hai bên' : 'Both sides'}</option><option value="left">{vi ? 'Trái' : 'Left'}</option><option value="right">{vi ? 'Phải' : 'Right'}</option></select></label>
          <label>{vi ? 'Sải chân cho' : 'Stride side'}<select value={calibrationSettings.motionSide} onChange={(event) => setCalibrationSetting('motionSide', event.target.value as 'both' | 'left' | 'right')} disabled={calibrationDisabled}><option value="both">{vi ? 'Hai bên' : 'Both sides'}</option><option value="left">{vi ? 'Trái' : 'Left'}</option><option value="right">{vi ? 'Phải' : 'Right'}</option></select></label>
          <label><span>{vi ? 'Giữ root dọc' : 'Keep vertical root motion'}</span><input type="checkbox" checked={calibrationSettings.rootMotion} onChange={(event) => setCalibrationSetting('rootMotion', event.target.checked)} disabled={calibrationDisabled} /></label>
        </div>
      </details>
      {loadError && <p className="wb-retarget-error" role="alert">{loadError}</p>}
      {saveError && <p className="wb-retarget-error" role="alert">{saveError}</p>}
      {savedMessage && <p className="wb-retarget-saved" role="status">{savedMessage}</p>}
      <p className="wb-retarget-preview-note">{vi ? 'Lệnh lưu nhập FBX gốc thành Motion và Skeleton Profile trong project. Bake xuất AnimationClip JSON theo armature V9.12; clip chưa được lưu thành Motion trong project hoặc đặt vào timeline.' : 'Saving imports the original FBX as a Motion and Skeleton Profile. Bake exports an AnimationClip JSON for the V9.12 armature; it is not yet stored as a project Motion or placed on the timeline.'}</p>
    </section>
  )
}

function updateTarget(runtime: Runtime, pose: RetargetedBone[]) {
  const attribute = runtime.targetLine.geometry.getAttribute('position') as BufferAttribute
  const matrix = new Matrix4()
  const start = new Vector3()
  const end = new Vector3()
  for (const [index, bone] of runtime.targetBones.entries()) {
    matrix.fromArray([...pose[index].worldMatrix])
    start.setFromMatrixPosition(matrix)
    end.set(bone.localTail[0], bone.localTail[1], bone.localTail[2]).applyMatrix4(matrix)
    attribute.setXYZ(index * 2, start.x, start.y, start.z)
    attribute.setXYZ(index * 2 + 1, end.x, end.y, end.z)
  }
  attribute.needsUpdate = true
  runtime.targetLine.geometry.computeBoundingSphere()
}

function nearestParentBone(bone: Bone): Bone | null {
  let parent = bone.parent
  while (parent && !(parent instanceof Bone)) parent = parent.parent
  return parent instanceof Bone ? parent : null
}
