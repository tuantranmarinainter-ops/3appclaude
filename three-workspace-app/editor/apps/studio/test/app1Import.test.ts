import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { validateProject } from '@bbs/animation-workspace-shared'
import { createHash } from 'node:crypto'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { stageAssetUpload } from '../src/unifiedAssetFiles'
import { attachApp1Manifest } from '../src/app1Manifest'
import { buildImportedAsset } from '../src/unifiedAssetFiles'
import { MotionPlayer, CharacterAnimator } from '../../../packages/builder/src/engine/objects/MotionPlayer'
import { mixamorigHips } from '../../../packages/builder/src/engine/rig/mixamorigBind'
import * as THREE from 'three'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const temp = mkdtempSync(path.join(tmpdir(), 'app1-import-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
test.after(() => rmSync(temp, { recursive: true, force: true }))
const fixture = path.join(editor, 'apps/studio/public/retarget/v9.12')
let bytes: Buffer, manifest: any
function generate() {
  if (bytes) return
  const out = path.join(temp, 'normalized')
  const run = spawnSync(process.execPath, ['--import', 'tsx', '../retarget/cli/normalize.ts', '--src', path.join(fixture, 'minecraft-actions.bobj'), '--armature', path.join(fixture, 'minecraft20-armature.bobj'), '--target', path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb'), '--out', out, '--action', '0'], { cwd: path.join(editor, 'packages/builder'), encoding: 'utf8', timeout: 120000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const files = readdirSync(out)
  bytes = readFileSync(path.join(out, files.find(x => x.endsWith('.glb'))!))
  manifest = JSON.parse(readFileSync(path.join(out, files.find(x => x.endsWith('.manifest.json'))!), 'utf8'))
}
async function upload(data: Buffer, name = 'app1.glb') {
  return stageAssetUpload(name, new ReadableStream({ start(c) { c.enqueue(data); c.close() } }))
}
test('App 1 import keeps Action UUIDs, manifest and rejects broken identity/hash before mutation', async () => {
  generate()
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'App1', scene: makeEmptyDraft('App1', 30, 180) } })
  const projectId = created.projectId, staged = await upload(bytes)
  const args = { files: [staged.id], format: 'glb', manifest }
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { ...args, manifest: { ...manifest, glbSha256: '0'.repeat(64) } } }), /SHA-256/)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { ...args, manifest: { ...manifest, actions: [] } } }), /actions/)
  const saved = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args })
  assert.deepEqual(saved.result.motionIds, manifest.actions.map((a: any) => a.uuid))
  const project = await readUnifiedProject(projectId)
  assert.equal(project.motions[manifest.actions[0].uuid]!.sourceFps, 30)
  assert.deepEqual((project.extensions.app1Manifests as any)[(saved.result.assetIds as string[])[0]!], manifest)
  const imported = buildImportedAsset({ ...staged, bytes }, 'glb', 1, [1,0,0,0,1,0,0,0,1])
  assert.throws(() => attachApp1Manifest(imported, bytes, { ...manifest, actions: [{ ...manifest.actions[0], glbAnimationIndex: 99 }] }), /ACTION_MISSING/)
  const target = await upload(readFileSync(path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')), 'target.glb')
  const model = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: project.revision, command: 'asset.import', args: { files: [target.id], format: 'glb' } })
  const character = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: model.revision, command: 'character.add', args: { assetId: (model.result.assetIds as string[])[0], skeletonId: (model.result.skeletonIds as string[])[0], name: 'Builtin' } })
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: character.revision, command: 'motion.place', args: { characterId: character.result.characterId, motionId: manifest.actions[0].uuid, frameStart: 0 } })
  const zero = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 0 } })
  const middle = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 15 } })
  assert.deepEqual(middle.result.issues, [])
  // C2: the browser MotionPlayer only uses GLTFLoader for `format=glb` URLs (App 1 Motions are GLB, not FBX).
  const placed = (await readUnifiedProject(projectId)).scene.content.timeline.animation.motionClips[0]!
  assert.match(placed.motion.url, /format=glb/)
  assert.notDeepEqual(middle.result.skeletonSamples, zero.result.skeletonSamples)

})
test('Every Action of one multi-Action App 1 GLB gets its own motionPath entry (all clips resolve, not only the first)', async () => {
  const out = path.join(temp, 'normalized-two')
  const run = spawnSync(process.execPath, ['--import', 'tsx', '../retarget/cli/normalize.ts', '--src', path.join(fixture, 'minecraft-actions.bobj'), '--armature', path.join(fixture, 'minecraft20-armature.bobj'), '--target', path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb'), '--out', out, '--action', '27,66'], { cwd: path.join(editor, 'packages/builder'), encoding: 'utf8', timeout: 120000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const files = readdirSync(out), two = readFileSync(path.join(out, files.find(x => x.endsWith('.glb'))!)), twoManifest = JSON.parse(readFileSync(path.join(out, files.find(x => x.endsWith('.manifest.json'))!), 'utf8'))
  assert.equal(twoManifest.actions.length, 2)
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Two actions', scene: makeEmptyDraft('Two actions', 30, 90) } })
  const projectId = created.projectId
  let revision = (await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [(await upload(two)).id], format: 'glb', manifest: twoManifest } })).revision
  const model = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'asset.import', args: { files: [(await upload(readFileSync(path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')), 'target.glb')).id], format: 'glb' } })
  revision = model.revision
  for (const action of twoManifest.actions) {
    const character = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'character.add', args: { assetId: (model.result.assetIds as string[])[0], skeletonId: (model.result.skeletonIds as string[])[0], name: action.name } })
    revision = (await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: character.revision, command: 'motion.place', args: { characterId: character.result.characterId, motionId: action.uuid, frameStart: 0 } })).revision
  }
  const project = await readUnifiedProject(projectId), paths = project.scene.content.asset.motionPath
  assert.deepEqual(paths.map((entry) => entry.id).sort(), twoManifest.actions.map((action: any) => action.uuid).sort())
  assert.equal(new Set(paths.map((entry) => entry.path)).size, 1, 'both Actions share the GLB URL')
  for (const clip of project.scene.content.timeline.animation.motionClips) assert.ok(paths.some((entry) => entry.id === clip.motion.assetId), clip.motion.name)
})
test('Repeated UUID/hash reuses Motion; changed hash rejects; other IDs stay v4', async () => {
  generate()
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Dedup', scene: makeEmptyDraft('Dedup', 30, 180) } })
  const projectId = created.projectId
  const first = await upload(bytes)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [first.id], format: 'glb', manifest } })
  const before = await readUnifiedProject(projectId), repeated = await upload(bytes)
  const again = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: before.revision, command: 'asset.import', args: { files: [repeated.id], format: 'glb', manifest } })
  assert.deepEqual(again.result.motionIds, manifest.actions.map((a: any) => a.uuid))
  const after = await readUnifiedProject(projectId)
  assert.deepEqual(after.motions, before.motions)
  const length = bytes.readUInt32LE(12), document = JSON.parse(bytes.subarray(20, 20 + length).toString())
  document.asset.generator = 'Different GLB content'
  const json = Buffer.from(JSON.stringify(document)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded)
  const changed = Buffer.concat([bytes.subarray(0, 12), Buffer.alloc(8), padded, bytes.subarray(20 + length)])
  changed.writeUInt32LE(changed.length, 8); changed.writeUInt32LE(padded.length, 12); changed.writeUInt32LE(0x4e4f534a, 16)
  const third = await upload(changed)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: after.revision, command: 'asset.import', args: { files: [third.id], format: 'glb', manifest: { ...manifest, glbSha256: createHash('sha256').update(changed).digest('hex') } } }), /different GLB SHA-256/)
  assert.deepEqual(await readUnifiedProject(projectId), after)
  assert.equal(validateProject(after), true)
  const v8 = manifest.actions[0].uuid
  assert.equal(validateProject({ ...after, projectId: v8 }), false)
  const skeletonId = Object.keys(after.skeletons)[0]!, clone = structuredClone(after)
  clone.skeletons[v8] = { ...clone.skeletons[skeletonId]!, id: v8 }; delete clone.skeletons[skeletonId]
  for (const motion of Object.values(clone.motions)) motion.skeletonId = v8
  assert.equal(validateProject(clone), false)
})
test('Mixamo alias binds unprefixed tracks to prefixed bones without mutating source', () => {
  const group = new THREE.Group(), hips = new THREE.Bone(); hips.name = 'Hips'; hips.position.y = 1; group.add(hips)
  group.animations = [new THREE.AnimationClip('walk', 1, [new THREE.VectorKeyframeTrack('Hips.position', [0,1], [0,1,0, 1,1,0])])]
  const target = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'mixamorigHips'; bone.position.y = 1; target.add(bone)
  const player = new MotionPlayer(); player.register('motion', group)
  const clip = player.getClipForDirectBind('motion', target)!
  const animator = new CharacterAnimator(target); animator.playAt('motion', clip, .5, false)
  assert.ok(bone.position.x > .4)
  assert.equal(group.animations[0]!.tracks[0]!.name, 'Hips.position')
  assert.equal(hips.name, 'Hips'); assert.equal(mixamorigHips(group), hips)
})

async function shotFixture() {
  generate()
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Shot', scene: makeEmptyDraft('Shot', 30, 180, { fov: 50, position: { x: 0, y: 2, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }) } })
  const projectId=created.projectId
  let revision=0
  const send=async(command:string,args:Record<string,unknown>)=>{const result=await executeUnifiedCommand({requestId:randomUUID(),projectId,expectedRevision:revision,command,args});revision=result.revision;return result}
  const input=await upload(bytes)
  await send('asset.import',{files:[input.id],format:'glb',manifest})
  const target=await upload(readFileSync(path.join(editor,'../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')),'target.glb')
  const model=await send('asset.import',{files:[target.id],format:'glb'})
  const characters:string[]=[]
  for(const name of ['A','B']) {
    const character=await send('character.add',{assetId:(model.result.assetIds as string[])[0],skeletonId:(model.result.skeletonIds as string[])[0],name})
    const id=String(character.result.characterId);characters.push(id)
    await send('motion.place',{characterId:id,motionId:manifest.actions[0].uuid,frameStart:0})
  }
  const project=await readUnifiedProject(projectId),clip=project.scene.content.timeline.animation.motionClips[0]!
  return {projectId,project,characters,send,frameEnd:clip.frameEnd}
}
test('shot.export creates a two-character ZIP accepted by TS and Python validators', async () => {
  const {getUnifiedJob,readUnifiedJobFile}=await import('../src/unifiedJobs')
  const {unzipPackage,validateShot}=await import('../src/shotPackage')
  const fixture=await shotFixture()
  const result=await fixture.send('shot.export',{cameraNodeId:'camera_1',frameStart:0,frameEnd:fixture.frameEnd,editableCharacterIds:[fixture.characters[0]]})
  const job=await getUnifiedJob(String(result.result.jobId),fixture.projectId)
  const file=await readUnifiedJobFile(job.jobId,fixture.projectId,'0');assert.ok(file)
  const files=unzipPackage(file.bytes);assert.deepEqual(validateShot(files),[])
  const shot=JSON.parse(Buffer.from(files['shot.json']!).toString())
  assert.equal(shot.characters.length,2);assert.equal(shot.characters.filter((c:any)=>c.editable).length,1)
  assert.equal((await readUnifiedProject(fixture.projectId)).revision,fixture.project.revision)
  const folder=path.join(temp,'python-'+randomUUID());const fs=await import('node:fs')
  for(const [name,data] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(folder,name)),{recursive:true});fs.writeFileSync(path.join(folder,name),data)}
  const checked=spawnSync('python',['-m','agent.shot_package','validate-shot',folder],{cwd:path.join(editor,'..'),encoding:'utf8'})
  assert.equal(checked.status,0,checked.stdout+checked.stderr)
  const malformed={...files,'shot.json':Buffer.from(JSON.stringify({...shot,fps:24}))};assert.ok(validateShot(malformed).some(i=>i.code==='INVALID_FPS'))
  assert.throws(()=>unzipPackage(Buffer.from('broken zip')))
})

test('shot export keeps covered characters and synthesizes a manifest for an unmanifested native GLB', async () => {
  const { createShotPackage } = await import('../src/shotExchange')
  const { validateShot } = await import('../src/shotPackage')
  const fixture = await shotFixture()
  const project = structuredClone(fixture.project)
  const [editableCharacterId, omittedCharacterId] = fixture.characters
  const omitted = project.characters[omittedCharacterId]!
  const omittedClip = project.scene.content.timeline.animation.motionClips.find((clip) => clip.target.nodeId === omitted.nodeId)!
  project.scene.content.timeline.animation.motionClips = project.scene.content.timeline.animation.motionClips.filter((clip) => clip.id !== omittedClip.id)
  delete project.bindings[omittedClip.id]
  project.extensions.app1Manifests = {}
  const built = await createShotPackage(project, { cameraNodeId: 'camera_1', frameStart: 0, frameEnd: fixture.frameEnd, editableCharacterIds: [editableCharacterId] })
  assert.deepEqual(validateShot(built.files), [])
  assert.deepEqual(built.shot.characters.map((character) => character.characterId), [editableCharacterId])
  assert.equal(JSON.parse(Buffer.from(built.files['characters/' + editableCharacterId + '.manifest.json']!).toString()).actions.length, 1)
  await assert.rejects(createShotPackage(project, { cameraNodeId: 'camera_1', frameStart: 0, frameEnd: fixture.frameEnd, editableCharacterIds: [omittedCharacterId] }), /requires one MotionClip/)
})

for (const constant of [false,true]) test(`Result round trip (${constant ? 'constant' : 'dynamic'} placement) and layout preserve atomic history`, async () => {
  const {getUnifiedJob,readUnifiedJobFile}=await import('../src/unifiedJobs')
  const {unzipPackage,zipPackage,jsonBytes,sha256,validateResult}=await import('../src/shotPackage')
  const fixture=await shotFixture()
  const exported=await fixture.send('shot.export',{cameraNodeId:'camera_1',frameStart:0,frameEnd:fixture.frameEnd,editableCharacterIds:[fixture.characters[0]]})
  const job=await getUnifiedJob(String(exported.result.jobId),fixture.projectId),artifact=await readUnifiedJobFile(job.jobId,fixture.projectId,'0');assert.ok(artifact)
  const shotFiles=unzipPackage(artifact.bytes),shot=JSON.parse(Buffer.from(shotFiles['shot.json']!).toString()),character=shot.characters[0]
  const originalBytes=Buffer.from(shotFiles[character.glb]!),length=originalBytes.readUInt32LE(12),document=JSON.parse(originalBytes.subarray(20,20+length).toString())
  document.asset.generator='Round trip derivative'
  const json=Buffer.from(JSON.stringify(document)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded)
  const edited=Buffer.concat([originalBytes.subarray(0,12),Buffer.alloc(8),padded,originalBytes.subarray(20+length)])
  edited.writeUInt32LE(edited.length,8);edited.writeUInt32LE(padded.length,12);edited.writeUInt32LE(0x4e4f534a,16)
  const id=randomUUID(),newManifest={...manifest,glbSha256:sha256(edited),actions:[{...manifest.actions[0],uuid:id,originalActionUuid:character.actionUuid}]}
  const result={version:'1.0.0',shotId:shot.shotId,baseShotSha256:sha256(shotFiles['shot.json']!),edits:[{characterId:character.characterId,originalActionUuid:character.actionUuid,newActionUuid:id,glb:'edited.glb',manifest:'edited.manifest.json',glbSha256:sha256(edited),placementKeys:[{frame:0,position:[3,0,0],yawDegrees:45},{frame:fixture.frameEnd,position:[constant?3:4,0,0],yawDegrees:constant?45:90}]}]}
  const files={'result.json':jsonBytes(result),'edited.glb':edited,'edited.manifest.json':jsonBytes(newManifest)}
  assert.deepEqual(validateResult(files,shotFiles),[])
  const resultBytes=Buffer.from(zipPackage(files))
  const {saveShotDraft,readShotDraft}=await import('../src/shotDraft')
  const unchanged=await readUnifiedProject(fixture.projectId)
  const draft=await saveShotDraft(unchanged,shot.shotId,resultBytes)
  assert.equal(draft.sha256,sha256(resultBytes))
  assert.deepEqual(await readShotDraft(unchanged,shot.shotId),resultBytes)
  assert.deepEqual(await readUnifiedProject(fixture.projectId),unchanged,'saving a draft must not replace timeline clips')
  await assert.rejects(saveShotDraft(unchanged,shot.shotId,Buffer.from('broken zip')))
  assert.deepEqual(await readShotDraft(unchanged,shot.shotId),resultBytes,'failed save must preserve previous draft')
  await assert.rejects(readShotDraft({...unchanged,revision:unchanged.revision+1},shot.shotId),/stale/)
  const staged=await upload(resultBytes,'result.zip')
  const before=await readUnifiedProject(fixture.projectId)
  await assert.rejects(executeUnifiedCommand({requestId:randomUUID(),projectId:fixture.projectId,command:'shot.result.import',expectedRevision:before.revision-1,args:{file:staged.id,shotId:shot.shotId}}), (e:any)=>e.code==='REVISION_CONFLICT')
  const imported=await fixture.send('shot.result.import',{file:staged.id,shotId:shot.shotId})
  assert.deepEqual(imported.result.motionIds,[id])
  const after=await readUnifiedProject(fixture.projectId)
  assert.ok(after.motions[id]);assert.ok(after.motions[character.actionUuid])
  const binding=Object.values(after.bindings).find(b=>b.characterId===character.characterId)!
  assert.equal(binding.motionId,id);assert.equal(after.motions[id]!.derivedFrom,character.actionUuid)
  const evaluated=await executeUnifiedCommand({requestId:randomUUID(),projectId:fixture.projectId,command:'scene.evaluate',args:{frame:0}})
  const node=after.characters[character.characterId]!.nodeId
  assert.equal((evaluated.result.transforms as any)[node].position.x,3)
  const layoutArgs={frame:Math.floor(fixture.frameEnd/2),placements:[{characterId:character.characterId,position:{x:1,z:2},lookAt:{point:{x:2,z:2}}}]}
  if (constant) {
    const preview=await fixture.send('scene.layout.preview',layoutArgs)
    assert.deepEqual(await readUnifiedProject(fixture.projectId),after)
    const applied=await fixture.send('scene.layout.apply',layoutArgs)
    assert.equal(applied.revision,after.revision+1)
    const placed=await readUnifiedProject(fixture.projectId)
    const expected=(preview.result.placements as any[])[0].transform
    let maxPositionError=0,maxYawError=0
    for(const frame of [0,Math.floor(fixture.frameEnd/2),fixture.frameEnd]) {
      const read=await fixture.send('scene.evaluate',{frame})
      const actual=(read.result.transforms as any)[node]
      maxPositionError=Math.max(maxPositionError,Math.hypot(actual.position.x-expected.position.x,actual.position.y-expected.position.y,actual.position.z-expected.position.z))
      maxYawError=Math.max(maxYawError,Math.abs(actual.rotation.y-90))
      assert.ok(maxPositionError<=0.01)
      assert.ok(maxYawError<=1)
    }
    await fixture.send('history.undo',{})
    const undo=await readUnifiedProject(fixture.projectId)
    assert.deepEqual(undo.scene,after.scene);assert.deepEqual(undo.extensions,after.extensions)
    await fixture.send('history.redo',{})
    const redo=await readUnifiedProject(fixture.projectId)
    assert.deepEqual(redo.scene,placed.scene);assert.deepEqual(redo.extensions,placed.extensions)
    await fixture.send('history.undo',{})
    console.log(`G2b imported constant placement: maximum position error ${maxPositionError} m; maximum yaw error ${maxYawError} degrees at start/middle/end; Undo/Redo exact`)
  } else {
    await assert.rejects(fixture.send('scene.layout.apply',layoutArgs),/Dynamic placement/)
    assert.deepEqual(await readUnifiedProject(fixture.projectId),after)
    const frame=Math.floor(fixture.frameEnd/2)
    const reference=await fixture.send('scene.evaluate',{frame})
    const position=(reference.result.transforms as any)[node].position
    const readOnly=await fixture.send('scene.layout.preview',{frame,placements:[{characterId:fixture.characters[1],relativeTo:character.characterId,relation:'left',distanceMeters:2,lookAt:{characterId:character.characterId}}]})
    const transform=(readOnly.result.placements as any[])[0].transform
    assert.ok(Math.abs(transform.position.x-(position.x-2))<0.01)
    assert.ok(Math.abs(transform.rotation.y-90)<1)
    assert.deepEqual(await readUnifiedProject(fixture.projectId),after)
  }
  await fixture.send('history.undo',{})
  const undone=await readUnifiedProject(fixture.projectId)
  assert.deepEqual(undone.motions,before.motions);assert.deepEqual(undone.scene,before.scene);assert.deepEqual(undone.extensions,before.extensions)
  const bad={...files,'result.json':jsonBytes({...result,baseShotSha256:'0'.repeat(64)})}
  assert.ok(validateResult(bad,shotFiles).some(i=>i.code==='SHA256_MISMATCH'))
})
