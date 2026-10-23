'use client'

import { useEffect, useRef, useState } from 'react'
import { AmbientLight, AxesHelper, BufferAttribute, BufferGeometry, DirectionalLight, Euler, GridHelper, LineBasicMaterial, LineSegments, LoadingManager, Matrix4, MOUSE, PerspectiveCamera, Quaternion, Scene, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { fbxSourceBones, sceneBasisMatrix } from '@topview/3d-builder/evaluate'
import { calibrationRuntime, createThreeRigAdapter, createUniversalRetargeter, isUniversalCalibrationV1, isUniversalReferencePoseV1, type RetargetRig, type UniversalCalibrationRuntime, type UniversalPoseReferenceV1 } from '@bbs/retarget'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { sendUnifiedCommand } from '../../../../src/unifiedApi'
import { boneLinePositions } from './previewUtils'

type Inspection = { graph: RetargetRig; profileBoneLinks: Array<{ profileBoneId: string; adapterNodeId: string | null; status: 'matched' | 'ambiguous' | 'missing' }> }

function quaternionDegrees(value: readonly [number, number, number, number]): [number, number, number] {
  const euler = new Euler().setFromQuaternion(new Quaternion(...value), 'XYZ')
  return [euler.x, euler.y, euler.z].map((angle) => angle * 180 / Math.PI) as [number, number, number]
}

async function loadRig(projectId: string, assetId: string, mediaType: string, signal: AbortSignal) {
  const url = `/api/unified/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/source`
  const response = await fetch(url, { cache: 'no-store', signal })
  if (!response.ok) throw new Error(`Asset preview fetch failed (${response.status})`)
  const bytes = await response.arrayBuffer()
  const manager = new LoadingManager()
  manager.setURLModifier((resource) => {
    if (resource.startsWith('data:')) return resource
    throw new TypeError('Preview requires embedded model resources; convert external resources locally first')
  })
  let group: ReturnType<FBXLoader['parse']> | null = null
  const nodeUUIDs = new Map<string, string>()
  if (mediaType === 'application/vnd.autodesk.fbx') {
    group = new FBXLoader(manager).parse(bytes, '')
    fbxSourceBones(group).forEach((bone, index) => nodeUUIDs.set(String(index), bone.uuid))
  } else if (['model/gltf-binary', 'model/gltf+json'].includes(mediaType)) {
    const result = await new GLTFLoader(manager).parseAsync(bytes, '')
    result.scene.animations = result.animations
    group = result.scene
    const associations = (result.parser as unknown as { associations: Map<{ uuid: string }, { nodes?: number }> }).associations
    for (const [node, association] of associations) if (Number.isInteger(association.nodes)) nodeUUIDs.set(String(association.nodes), node.uuid)
  }
  if (!group) throw new TypeError(`No normalization preview loader for ${mediaType}`)
  return { group, nodeUUIDs }
}

function basisFor(profile: UnifiedProject['skeletons'][keyof UnifiedProject['skeletons']]) {
  return sceneBasisMatrix(profile.basisToScene).multiply(new Matrix4().makeScale(profile.metersPerUnit, profile.metersPerUnit, profile.metersPerUnit)).toArray()
}

export function NormalizationPreview({ projectId, project, sourceAssetId, targetAssetId, mappingId, actionIndex, rootTranslationPolicy, rootTranslationScale, vi }: {
  projectId: string; project: UnifiedProject; sourceAssetId: string; targetAssetId: string; mappingId: string; actionIndex: number
  rootTranslationPolicy: 'preserve' | 'in-place'; rootTranslationScale: number; vi: boolean
}) {
  const mapping = project.mappings[mappingId]
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const captureCalibrationRef = useRef<(() => Promise<void>) | null>(null)
  const timeRef = useRef(0), playingRef = useRef(false)
  const [duration, setDuration] = useState(0), [time, setTime] = useState(0), [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [savingCalibration, setSavingCalibration] = useState(false), [calibrationMessage, setCalibrationMessage] = useState('')
  const [correctionTargetBoneId, setCorrectionTargetBoneId] = useState(mapping?.pairs[0]?.targetBoneId ?? '')
  const [correctionAngles, setCorrectionAngles] = useState<[number, number, number]>([0, 0, 0])
  const [corrections, setCorrections] = useState<Record<string, [number, number, number, number]>>({})
  const [alignmentAngles, setAlignmentAngles] = useState<[number, number, number]>([0, 0, 0])
  const [targetReferenceSelection, setTargetReferenceSelection] = useState('rest')
  const [targetReferenceActions, setTargetReferenceActions] = useState<Array<{ index: number; name: string; durationSeconds: number; ready: boolean }>>([])
  const correctionTargetRef = useRef(correctionTargetBoneId), correctionAnglesRef = useRef(correctionAngles), correctionsRef = useRef(corrections)
  const alignmentAnglesRef = useRef(alignmentAngles), targetReferenceSelectionRef = useRef(targetReferenceSelection)
  correctionTargetRef.current = correctionTargetBoneId; correctionAnglesRef.current = correctionAngles; correctionsRef.current = corrections
  alignmentAnglesRef.current = alignmentAngles; targetReferenceSelectionRef.current = targetReferenceSelection
  const projectRevisionRef = useRef(project.revision), localeRef = useRef(vi)
  projectRevisionRef.current = project.revision; localeRef.current = vi
  const sourceAsset = project.assets[sourceAssetId as keyof typeof project.assets]
  const targetAsset = project.assets[targetAssetId as keyof typeof project.assets]
  const sourceProfile = mapping ? project.skeletons[mapping.sourceProfileId] : undefined
  const targetProfile = mapping ? project.skeletons[mapping.targetProfileId] : undefined
  const mappingPairs = JSON.stringify(mapping?.pairs ?? [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !sourceAsset || !targetAsset || !sourceProfile || !targetProfile || !mapping ||
      mapping.sourceProfileId !== sourceProfile.id || mapping.targetProfileId !== targetProfile.id || !mapping.confirmed) return
    if (sourceProfile.provenance.sourceHash !== sourceAsset.source.sha256 || targetProfile.provenance.sourceHash !== targetAsset.source.sha256) {
      setError('Selected mapping profiles do not belong to the selected source and target assets')
      return
    }
    const abort = new AbortController()
    let live = true, frame = 0
    let renderer: WebGLRenderer | undefined, controls: OrbitControls | undefined
    let sourceAdapter: ReturnType<typeof createThreeRigAdapter> | undefined, targetAdapter: ReturnType<typeof createThreeRigAdapter> | undefined
    let sourceGeometry: BufferGeometry | undefined, targetGeometry: BufferGeometry | undefined
    let sourceMaterial: LineBasicMaterial | undefined, targetMaterial: LineBasicMaterial | undefined
    setLoading(true); setError(''); setDuration(0); setTime(0); setTargetReferenceActions([]); timeRef.current = 0; playingRef.current = false; setPlaying(false)
    void (async () => {
      const [sourceGroup, targetGroup, sourceResponse, targetResponse] = await Promise.all([
        loadRig(projectId, sourceAssetId, sourceAsset.source.mediaType, abort.signal),
        loadRig(projectId, targetAssetId, targetAsset.source.mediaType, abort.signal),
        sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, command: 'rig.inspect', args: { assetId: sourceAssetId, skeletonProfileId: sourceProfile.id } }),
        sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, command: 'rig.inspect', args: { assetId: targetAssetId, skeletonProfileId: targetProfile.id } }),
      ])
      if (!live) return
      const sourceInspection = sourceResponse.result as unknown as Inspection, targetInspection = targetResponse.result as unknown as Inspection
      const sourceBones = sourceProfile.bones, targetBones = targetProfile.bones
      const sourceUUIDs = sourceBones.map((bone) => sourceGroup.nodeUUIDs.get(bone.id)).filter((uuid): uuid is string => !!uuid)
      const targetUUIDs = targetBones.map((bone) => targetGroup.nodeUUIDs.get(bone.id)).filter((uuid): uuid is string => !!uuid)
      if (sourceUUIDs.length !== sourceBones.length || targetUUIDs.length !== targetBones.length) throw new Error('Selected skeleton profile no longer matches node identities in the imported asset')
      sourceAdapter = createThreeRigAdapter(sourceGroup.group, { fingerprint: sourceProfile.fingerprint, sourceToScene: basisFor(sourceProfile), jointUUIDs: sourceUUIDs })
      targetAdapter = createThreeRigAdapter(targetGroup.group, { fingerprint: targetProfile.fingerprint, sourceToScene: basisFor(targetProfile), jointUUIDs: targetUUIDs })
      if (live) setTargetReferenceActions(targetAdapter.actions.map(({ index, name, durationSeconds, ready }) => ({ index, name, durationSeconds, ready })))
      const sourceLinks = new Map(sourceInspection.profileBoneLinks.map((link) => [link.profileBoneId, link]))
      const targetLinks = new Map(targetInspection.profileBoneLinks.map((link) => [link.profileBoneId, link]))
      const pairs = mapping.pairs.filter((pair) => pair.enabled).map((pair) => {
        const source = sourceLinks.get(pair.sourceBoneId), target = targetLinks.get(pair.targetBoneId)
        if (source?.status !== 'matched' || !source.adapterNodeId || target?.status !== 'matched' || !target.adapterNodeId) throw new Error(`Mapping profile links are unresolved for role ${pair.role}`)
        const sourceBoneIds = (pair.sourceBoneIds ?? [pair.sourceBoneId]).map((id) => {
          const link = sourceLinks.get(id)
          if (link?.status !== 'matched' || !link.adapterNodeId) throw new Error(`Mapping source chain contains an unresolved profile bone for role ${pair.role}`)
          return link.adapterNodeId
        })
        return { sourceBoneId: source.adapterNodeId, sourceBoneIds, ...(pair.sourceBoneWeights ? { sourceBoneWeights: pair.sourceBoneWeights } : {}), ...(pair.chainComposition ? { chainComposition: pair.chainComposition } : {}), targetBoneId: target.adapterNodeId, enabled: true }
      })
      let calibration: UniversalCalibrationRuntime | undefined
      const calibrationResponse = await fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/mappings/${encodeURIComponent(mappingId)}/calibration`, { cache: 'no-store', signal: abort.signal })
      if (!calibrationResponse.ok) throw new Error(`Calibration fetch failed (${calibrationResponse.status})`)
      const savedCalibration: unknown = await calibrationResponse.json()
      if (savedCalibration && typeof savedCalibration === 'object' && (savedCalibration as { type?: unknown }).type === 'bbs.universal-calibration') {
        if (!isUniversalCalibrationV1(savedCalibration, sourceProfile.fingerprint, targetProfile.fingerprint) || !mapping.referencePose) throw new Error('Saved Universal calibration is invalid or missing its reference pose')
        if (live) {
          const nextCorrections = Object.fromEntries(savedCalibration.corrections.map((item) => [item.targetBoneId, [...item.rotation] as [number, number, number, number]]))
          setCorrections(nextCorrections)
          const selected = nextCorrections[correctionTargetRef.current]
          setCorrectionAngles(selected ? quaternionDegrees(selected) : [0, 0, 0])
          setAlignmentAngles(quaternionDegrees(savedCalibration.alignmentRotation))
        }
        const referenceResponse = await fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/mappings/${encodeURIComponent(mappingId)}/reference-pose`, { cache: 'no-store', signal: abort.signal })
        if (!referenceResponse.ok) throw new Error(`Reference pose fetch failed (${referenceResponse.status})`)
        const reference: unknown = await referenceResponse.json()
        if (!isUniversalReferencePoseV1(reference, sourceProfile.fingerprint, targetProfile.fingerprint,
          new Set(sourceProfile.bones.map((bone) => bone.id)), new Set(targetProfile.bones.map((bone) => bone.id)))) throw new Error('Saved reference pose does not match the selected skeleton profiles')
        if (live) setTargetReferenceSelection(reference.target.kind === 'action' ? String(reference.target.actionIndex) : 'rest')
        const mapPose = (pose: UniversalPoseReferenceV1, links: typeof sourceLinks, rig: RetargetRig) => {
          const result = pose.bones.map((bone) => {
            const link = links.get(bone.id)
            if (link?.status !== 'matched' || !link.adapterNodeId) throw new Error(`Reference pose identity is unresolved for ${bone.id}`)
            return { id: link.adapterNodeId, world: bone.world }
          })
          const resolved = new Set(result.map((bone) => bone.id))
          for (const bone of rig.bones) if (!resolved.has(bone.id)) result.push({ id: bone.id, world: bone.restWorld })
          return result
        }
        const base = calibrationRuntime(savedCalibration, reference, mapping.referencePose.sha256)
        calibration = { ...base, sourceReference: mapPose(reference.source, sourceLinks, sourceAdapter.rig), targetReference: mapPose(reference.target, targetLinks, targetAdapter.rig),
          corrections: base.corrections.map((item) => {
            const link = targetLinks.get(item.targetBoneId)
            if (link?.status !== 'matched' || !link.adapterNodeId) throw new Error(`Calibration correction identity is unresolved for ${item.targetBoneId}`)
            return { ...item, targetBoneId: link.adapterNodeId }
          }) }
      } else if (!savedCalibration || typeof savedCalibration !== 'object' || (savedCalibration as { type?: unknown }).type !== 'bbs.retarget-calibration') {
        throw new Error('Saved calibration format is unsupported')
      } else if (live) {
        setCorrections({}); setCorrectionAngles([0, 0, 0]); setAlignmentAngles([0, 0, 0]); setTargetReferenceSelection('rest')
      }
      const solver = createUniversalRetargeter(sourceAdapter.rig, targetAdapter.rig, pairs, rootTranslationScale, rootTranslationPolicy, calibration)
      const action = sourceAdapter.actions[actionIndex]
      if (!action || action.durationSeconds <= 0) throw new Error('Selected source Action has no previewable duration')

      captureCalibrationRef.current = async () => {
        setSavingCalibration(true); setCalibrationMessage('')
        try {
          const selectedCorrectionId = correctionTargetRef.current, selectedCorrectionAngles = correctionAnglesRef.current
          if (!selectedCorrectionId || selectedCorrectionAngles.some((angle) => !Number.isFinite(angle) || angle < -180 || angle > 180)) throw new RangeError('Role corrections must be finite angles in [-180, 180] degrees')
          const selectedAlignmentAngles = alignmentAnglesRef.current
          if (selectedAlignmentAngles.some((angle) => !Number.isFinite(angle) || angle < -180 || angle > 180)) throw new RangeError('Global alignment must use finite angles in [-180, 180] degrees')
          const sourceById = new Map(sourceAdapter!.sample(actionIndex, timeRef.current).map((bone) => [bone.id, bone.world]))
          const targetSelection = targetReferenceSelectionRef.current
          let targetReferenceKind: 'rest' | 'action' = 'rest', targetReferenceActionIndex: number | null = null, targetReferenceTime: number | null = null
          const targetById = new Map(targetAdapter!.rig.bones.map((bone) => [bone.id, bone.restWorld]))
          if (targetSelection !== 'rest') {
            const targetActionIndex = Number(targetSelection), targetAction = targetAdapter!.actions[targetActionIndex]
            if (!Number.isInteger(targetActionIndex) || !targetAction?.ready || targetAction.durationSeconds <= 0) throw new Error('Choose a previewable target reference Action or rest pose')
            targetReferenceKind = 'action'; targetReferenceActionIndex = targetActionIndex
            targetReferenceTime = Math.min(timeRef.current, targetAction.durationSeconds)
            targetAdapter!.sample(targetActionIndex, targetReferenceTime).forEach((bone) => targetById.set(bone.id, bone.world))
          }
          const capture = (bones: typeof sourceProfile.bones, links: typeof sourceLinks, worlds: Map<string, number[]>, label: string) => bones.map((bone) => {
            const adapterId = links.get(bone.id)?.adapterNodeId
            const world = adapterId ? worlds.get(adapterId) : undefined
            if (!world) throw new Error(`${label} reference cannot resolve profile bone ${bone.name} [${bone.id}]`)
            return { id: bone.id, world: [...world] }
          })
          const referencePose = {
            type: 'bbs.universal-reference-pose' as const, version: 1 as const, coordinateSpace: 'scene-meters-v1' as const,
            sourceFingerprint: sourceProfile.fingerprint, targetFingerprint: targetProfile.fingerprint,
            source: { kind: 'action' as const, actionIndex, timeSeconds: timeRef.current, bones: capture(sourceProfile.bones, sourceLinks, sourceById, 'Source') },
            target: { kind: targetReferenceKind, actionIndex: targetReferenceActionIndex, timeSeconds: targetReferenceTime, bones: capture(targetProfile.bones, targetLinks, targetById, 'Target') },
          }
          const alignment = new Quaternion().setFromEuler(new Euler(...selectedAlignmentAngles.map((angle) => angle * Math.PI / 180) as [number, number, number], 'XYZ')).normalize()
          const calibrationDraft = {
            type: 'bbs.universal-calibration' as const, version: 1 as const, engine: 'universal' as const, algorithmVersion: 'universal-1' as const,
            sourceFingerprint: sourceProfile.fingerprint, targetFingerprint: targetProfile.fingerprint, chainMode: 'world-average' as const,
            alignmentRotation: alignment.toArray() as [number, number, number, number],
            corrections: (() => {
              const next = { ...correctionsRef.current }
              const euler = new Euler(...selectedCorrectionAngles.map((angle) => angle * Math.PI / 180) as [number, number, number], 'XYZ')
              const rotation = new Quaternion().setFromEuler(euler).normalize()
              if (rotation.angleTo(new Quaternion()) < 1e-7) delete next[selectedCorrectionId]
              else next[selectedCorrectionId] = rotation.toArray() as [number, number, number, number]
              setCorrections(next)
              return Object.entries(next).map(([targetBoneId, value]) => ({ targetBoneId, rotation: value }))
            })(),
            rootTranslationPolicy, rootTranslationScale,
          }
          const result = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: projectRevisionRef.current, command: 'skeleton.mapping.set',
            args: { mapping: { id: mapping.id, sourceProfileId: mapping.sourceProfileId, targetProfileId: mapping.targetProfileId,
              sourceFingerprint: mapping.sourceFingerprint, targetFingerprint: mapping.targetFingerprint, pairs: mapping.pairs, ignored: mapping.ignored },
            calibration: calibrationDraft, referencePose } })
          setCalibrationMessage(localeRef.current ? `Đã lưu pose tham chiếu · revision ${result.revision}` : `Reference pose saved · revision ${result.revision}`)
          window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
        } catch (cause) { setCalibrationMessage(cause instanceof Error ? cause.message : String(cause)) }
        finally { setSavingCalibration(false) }
      }

      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0x111419)
      const scene = new Scene(), camera = new PerspectiveCamera(38, 1, 0.01, 100)
      camera.position.set(0, 1.3, 5.4); camera.lookAt(0, 0.9, 0)
      controls = new OrbitControls(camera, canvas); controls.target.set(0, 0.9, 0); controls.enableDamping = true
      controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN } // W01: left orbit, middle pan, wheel zoom
      scene.add(new AmbientLight(0xffffff, 1.6))
      const key = new DirectionalLight(0xffffff, 2); key.position.set(4, 7, 5); scene.add(key, new GridHelper(8, 24, 0x43505e, 0x26303a), new AxesHelper(0.35))
      sourceGeometry = new BufferGeometry(); targetGeometry = new BufferGeometry()
      sourceGeometry.setAttribute('position', new BufferAttribute(new Float32Array(Math.max(1, sourceAdapter.rig.bones.length - 1) * 6), 3))
      targetGeometry.setAttribute('position', new BufferAttribute(new Float32Array(Math.max(1, targetAdapter.rig.bones.length - 1) * 6), 3))
      sourceMaterial = new LineBasicMaterial({ color: 0x66c7ff }); targetMaterial = new LineBasicMaterial({ color: 0x73e4c1 })
      scene.add(new LineSegments(sourceGeometry, sourceMaterial), new LineSegments(targetGeometry, targetMaterial))
      const resize = () => { const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return; renderer!.setSize(rect.width, rect.height, false); camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix() }
      const observer = new ResizeObserver(resize); observer.observe(canvas); resize()
      setDuration(action.durationSeconds)
      let previous = performance.now(), lastUI = 0
      const updateLine = (geometry: BufferGeometry, values: Float32Array) => {
        const attribute = geometry.getAttribute('position') as BufferAttribute
        const targetValues = attribute.array as Float32Array
        targetValues.fill(0); targetValues.set(values.subarray(0, targetValues.length)); attribute.needsUpdate = true
        geometry.setDrawRange(0, values.length / 3)
      }
      const draw = (now: number) => {
        if (!live) return
        const delta = Math.min(0.1, (now - previous) / 1000); previous = now
        if (playingRef.current) { timeRef.current = timeRef.current + delta >= action.durationSeconds ? 0 : timeRef.current + delta }
        try {
          const sourcePose = sourceAdapter!.sample(actionIndex, timeRef.current)
          const targetPose = solver.evaluate(sourcePose)
          const sourceWorlds = new Map(sourcePose.map((bone) => [bone.id, bone.world]))
          const targetWorlds = new Map(targetPose.map((bone) => [bone.targetBoneId, bone.world]))
          updateLine(sourceGeometry!, boneLinePositions(sourceAdapter!.rig.bones, sourceWorlds, -1.25))
          updateLine(targetGeometry!, boneLinePositions(targetAdapter!.rig.bones, targetWorlds, 1.25))
        } catch (cause) { if (live) { setError(cause instanceof Error ? cause.message : String(cause)); playingRef.current = false; setPlaying(false) } }
        if (now - lastUI > 90) { lastUI = now; setTime(timeRef.current) }
        controls!.update(); renderer!.render(scene, camera); frame = requestAnimationFrame(draw)
      }
      frame = requestAnimationFrame(draw)
      setLoading(false)
      return () => observer.disconnect()
    })().then((cleanup) => { if (typeof cleanup === 'function') abort.signal.addEventListener('abort', cleanup, { once: true }) }).catch((cause: unknown) => {
      if (live && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      if (live) setLoading(false)
    })
    return () => {
      live = false; abort.abort(); cancelAnimationFrame(frame); playingRef.current = false
      captureCalibrationRef.current = null
      controls?.dispose(); renderer?.dispose(); sourceAdapter?.dispose(); targetAdapter?.dispose()
      sourceGeometry?.dispose(); targetGeometry?.dispose(); sourceMaterial?.dispose(); targetMaterial?.dispose()
    }
  }, [projectId, sourceAssetId, targetAssetId, mappingId, sourceAsset, targetAsset, sourceProfile, targetProfile, mapping, mappingPairs, actionIndex, rootTranslationPolicy, rootTranslationScale])

  return <section aria-label={vi ? 'Preview retarget' : 'Retarget preview'}>
    <p>{vi ? 'Xương nguồn (xanh dương) và Mixamo65 đích (xanh lục) dùng chung thời gian. Preview chỉ hiển thị skeleton.' : 'Source bones (blue) and target Mixamo65 (green) share the same time. Skeleton-only preview.'}</p>
    <canvas ref={canvasRef} aria-label={vi ? 'Khung preview xương nguồn và đích' : 'Source and target skeleton preview'} style={{ display: 'block', width: '100%', height: 300 }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button type="button" disabled={loading || !!error || !duration} onClick={() => { playingRef.current = !playingRef.current; setPlaying(playingRef.current) }}>{playing ? (vi ? 'Tạm dừng' : 'Pause') : (vi ? 'Phát' : 'Play')}</button>
      <input aria-label={vi ? 'Thời gian preview' : 'Preview time'} type="range" min={0} max={duration || 0} step={0.01} value={Math.min(time, duration)} disabled={loading || !duration} onChange={(event) => { const next = Number(event.target.value); timeRef.current = next; setTime(next) }} />
      <output>{time.toFixed(2)} / {duration.toFixed(2)} s</output>
    </div>
    <p>{vi ? 'Lưu frame nguồn hiện tại và pose tham chiếu đích (rest hoặc Action tại cùng thời gian, giới hạn theo độ dài Action). Chỉnh căn chỉnh chung và correction theo role.' : 'Save the current source frame and a target reference (rest or an Action at the shared time, clamped to its duration). Adjust global alignment and per-role corrections.'}</p>
    <label>{vi ? 'Pose tham chiếu đích' : 'Target reference pose'}<select aria-label={vi ? 'Pose tham chiếu đích' : 'Target reference pose'} value={targetReferenceSelection} disabled={loading || savingCalibration} onChange={(event) => setTargetReferenceSelection(event.target.value)}>
      <option value="rest">{vi ? 'Rest pose' : 'Rest pose'}</option>
      {targetReferenceActions.map((action) => <option key={action.index} value={action.index} disabled={!action.ready || action.durationSeconds <= 0}>{action.name || `Action ${action.index + 1}`}{!action.ready ? (vi ? ' · không hỗ trợ' : ' · unsupported') : ''}</option>)}
    </select></label>
    <fieldset disabled={loading || savingCalibration}>
      <legend>{vi ? 'Căn chỉnh trục chung (°)' : 'Global axis alignment (°)'}</legend>
      {(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis}>{axis}<input type="number" min={-180} max={180} step={1} value={alignmentAngles[index]} aria-label={`${vi ? 'Căn chỉnh' : 'Alignment'} ${axis} degrees`} onChange={(event) => {
        const value = event.currentTarget.valueAsNumber
        if (Number.isFinite(value)) setAlignmentAngles((current) => current.map((angle, i) => i === index ? value : angle) as [number, number, number])
      }} /></label>)}
      <button type="button" onClick={() => setAlignmentAngles([0, 0, 0])}>{vi ? 'Đặt lại căn chỉnh' : 'Reset alignment'}</button>
    </fieldset>
    <label>{vi ? 'Role hiệu chỉnh' : 'Correction role'}<select value={correctionTargetBoneId} disabled={loading || savingCalibration} onChange={(event) => {
      const id = event.target.value; setCorrectionTargetBoneId(id)
      const rotation = corrections[id]
      setCorrectionAngles(rotation ? quaternionDegrees(rotation) : [0, 0, 0])
    }}>{(mapping?.pairs ?? []).map((pair) => <option key={pair.targetBoneId} value={pair.targetBoneId}>{pair.role} · {targetProfile?.bones.find((bone) => bone.id === pair.targetBoneId)?.name ?? pair.targetBoneId}</option>)}</select></label>
    {(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis}>{vi ? `Correction ${axis} (°)` : `Correction ${axis} (°)`}<input type="number" min={-180} max={180} step={1} value={correctionAngles[index]} disabled={loading || savingCalibration}
      aria-label={`${vi ? 'Correction' : 'Correction'} ${axis} degrees`} onChange={(event) => {
        const value = event.currentTarget.valueAsNumber
        if (Number.isFinite(value)) setCorrectionAngles((current) => current.map((angle, i) => i === index ? value : angle) as [number, number, number])
      }} /></label>)}
    <button type="button" disabled={loading || savingCalibration} onClick={() => {
      setCorrections((current) => { const next = { ...current }; delete next[correctionTargetBoneId]; return next })
      setCorrectionAngles([0, 0, 0])
    }}>{vi ? 'Đặt lại correction role' : 'Reset role correction'}</button>
    <button type="button" disabled={loading || !!error || !duration || savingCalibration} onClick={() => void captureCalibrationRef.current?.()}>{savingCalibration ? (vi ? 'Đang lưu…' : 'Saving…') : (vi ? 'Lưu frame hiện tại làm pose tham chiếu' : 'Use current frame as reference pose')}</button>
    {calibrationMessage && <p role="status">{calibrationMessage}</p>}
    {loading && <p role="status">{vi ? 'Đang tải rig preview…' : 'Loading rig preview…'}</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
