import { createHash } from 'node:crypto'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'three/addons/libs/fflate.module.js'

export interface Issue { code: string; path: string; message: string }
export type PackageFiles = Record<string, Uint8Array>
export interface ShotCharacter {
  characterId: string; glb: string; manifest: string; glbSha256: string; actionUuid: string
  clip: { sourceStartSeconds: number; sourceEndSeconds: number; speed: number; loop: boolean; reverse: boolean }
  placement: { position: number[]; yawDegrees: number }; rootPolicy: 'skeletal' | 'in-place'; editable: boolean
}
export interface Shot {
  version: string; shotId: string; sceneId: string; fps: number; frameRange: [number, number]
  camera: { keys: Array<{ frame: number; position: number[]; lookAt: number[]; fovYDegrees: number }> }
  characters: ShotCharacter[]; references: Array<{ file: string; sha256: string; transform: { position: number[]; rotationDegrees: number[]; scale: number[] } }>
}
export interface ShotEdit {
  characterId: string; originalActionUuid: string; newActionUuid: string; glb: string; manifest: string; glbSha256: string
  placementKeys: Array<{ frame: number; position: number[]; yawDegrees: number }>
}
export interface ShotResult { version: string; shotId: string; baseShotSha256: string; edits: ShotEdit[] }
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export const jsonBytes = (value: unknown) => strToU8(JSON.stringify(value, null, 2) + '\n')
export function safePackagePath(value: string): boolean {
  return !!value && !value.startsWith('/') && !/[\\:\x00]/.test(value) && !value.split('/').some(p => !p || p === '.' || p === '..')
}
export function unzipPackage(bytes: Uint8Array): PackageFiles {
  const names = new Set<string>(); let total = 0
  return unzipSync(bytes, { filter(file) {
    if (file.name.endsWith('/')) return false
    total += file.originalSize
    if (!safePackagePath(file.name) || names.has(file.name) || names.size >= 1024 || total > 256 * 1024 * 1024) throw new TypeError('Unsafe, duplicate or oversized ZIP entry')
    names.add(file.name); return true
  } })
}
export function zipPackage(files: PackageFiles): Uint8Array {
  if (Object.keys(files).some(name => !safePackagePath(name))) throw new TypeError('Unsafe package path')
  return zipSync(files, { level: 6 })
}
type Obj = Record<string, unknown>
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
class Validator {
  issues: Issue[] = []
  constructor(readonly files: PackageFiles) {}
  issue(code: string, path: string, message: string) { this.issues.push({ code, path, message }) }
  field(o: Obj, key: string, type: string, p: string): unknown {
    const v = o[key], where = `${p}.${key}`
    if (!(key in o)) this.issue('MISSING_FIELD', where, 'Required field is missing')
    else if (!(type === 'object' ? object(v) : type === 'array' ? Array.isArray(v) : type === 'number' ? finite(v) : type === 'integer' ? Number.isSafeInteger(v) : typeof v === type)) this.issue('INVALID_TYPE', where, `Expected ${type}`)
    else if (typeof v === 'string' && !v.trim()) this.issue('INVALID_VALUE', where, 'Expected non-empty string')
    else return v
  }
  version(o: Obj, p: string) { const v = this.field(o, 'version', 'string', p); if (typeof v === 'string' && !/^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(v)) this.issue('UNSUPPORTED_VERSION', p+'.version', 'Expected 1.x.y') }
  id(o: Obj, key: string, p: string) { const v = this.field(o,key,'string',p); if (typeof v === 'string' && !uuid.test(v)) this.issue('INVALID_UUID',`${p}.${key}`,'Expected canonical UUID'); return v }
  vector(o: Obj, key: string, p: string) { const v = this.field(o,key,'array',p); if (Array.isArray(v) && (v.length !== 3 || !v.every(finite))) this.issue('INVALID_VALUE',`${p}.${key}`,'Expected three finite numbers') }
  rows(o: Obj, key: string, p: string, nonempty = false): Array<[Obj,string]> {
    const v = this.field(o,key,'array',p); if (!Array.isArray(v)) return []
    if (nonempty && !v.length) this.issue('INVALID_VALUE',p+'.'+key,'Expected non-empty array')
    return v.flatMap((row, i) => { const path = `${p}.${key}[${i}]`; if (object(row)) return [[row,path] as [Obj,string]]; this.issue('INVALID_TYPE',path,'Expected object'); return [] })
  }
  file(o: Obj,key: string,p: string): Uint8Array | undefined {
    const name = this.field(o,key,'string',p); if (typeof name !== 'string') return
    if (!safePackagePath(name)) { this.issue('UNSAFE_PATH',p+'.'+key,'Path must stay in package'); return }
    if (!Object.hasOwn(this.files,name)) { this.issue('FILE_NOT_FOUND',p+'.'+key,'Referenced file missing'); return }
    return this.files[name]
  }
  hash(o: Obj,key: string,p: string,bytes?: Uint8Array) {
    const v = this.field(o,key,'string',p)
    if (typeof v !== 'string') return
    if (!/^[0-9a-f]{64}$/i.test(v)) this.issue('INVALID_SHA256',p+'.'+key,'Expected SHA-256 hex')
    else if (bytes && sha256(bytes) !== v.toLowerCase()) this.issue('SHA256_MISMATCH',p+'.'+key,'File SHA-256 differs')
  }
  json(bytes: Uint8Array | undefined,p: string): Obj | undefined {
    if (!bytes) return
    try { const value: unknown = JSON.parse(strFromU8(bytes)); if (object(value)) return value; this.issue('INVALID_TYPE',p,'Expected object') }
    catch { this.issue('INVALID_JSON',p,'Invalid JSON') }
  }
  asset(o: Obj,p: string,key: string) {
    const bytes=this.file(o,'glb',p); this.hash(o,'glbSha256',p,bytes); const id=this.id(o,key,p)
    const manifest=this.json(this.file(o,'manifest',p),p+'.manifest'); if (!manifest) return
    this.version(manifest,p+'.manifest'); this.hash(manifest,'glbSha256',p+'.manifest',bytes)
    const ids=new Set<unknown>()
    for (const [a,q] of this.rows(manifest,'actions',p+'.manifest',true)) { const value=this.id(a,'uuid',q); if (ids.has(value)) this.issue('DUPLICATE_ACTION_UUID',q+'.uuid','Duplicate Action UUID'); ids.add(value) }
    if (typeof id==='string'&&!ids.has(id)) this.issue('ACTION_NOT_IN_MANIFEST',p+'.'+key,'Action UUID absent from manifest')
  }
  keys(o: Obj,key: string,p: string,range?: number[],camera=false) {
    let previous=-1
    for (const [a,q] of this.rows(o,key,p,true)) {
      const frame=this.field(a,'frame','integer',q)
      if (typeof frame==='number') { if(frame<0||range&&(frame<range[0]!||frame>range[1]!)) this.issue('FRAME_OUT_OF_RANGE',q+'.frame','Frame outside shot'); if(frame<=previous)this.issue('KEYS_NOT_INCREASING',q+'.frame','Frames must increase'); previous=frame }
      this.vector(a,'position',q)
      if(camera) { this.vector(a,'lookAt',q); const fov=this.field(a,'fovYDegrees','number',q); if(typeof fov==='number'&&!(fov>0&&fov<180))this.issue('INVALID_VALUE',q+'.fovYDegrees','Invalid FOV') }
      else this.field(a,'yawDegrees','number',q)
    }
  }
  shot(): Obj | undefined {
    const s=this.json(this.file({file:'shot.json'},'file','shot.json'),'shot.json'); if(!s)return
    const p='shot.json';this.version(s,p);this.field(s,'shotId','string',p);this.field(s,'sceneId','string',p)
    const fps=this.field(s,'fps','integer',p);if(typeof fps==='number'&&fps!==30)this.issue('INVALID_FPS',p+'.fps','Expected 30 FPS')
    const range=this.field(s,'frameRange','array',p)
    const valid=Array.isArray(range)&&range.length===2&&range.every(Number.isSafeInteger)&&range[0]>=0&&range[1]>=range[0]
    if(Array.isArray(range)&&!valid)this.issue('INVALID_FRAME_RANGE',p+'.frameRange','Invalid frame range')
    const camera=this.field(s,'camera','object',p);if(object(camera))this.keys(camera,'keys',p+'.camera',valid?range as number[]:undefined,true)
    const ids=new Set<unknown>();let editable=false
    for(const [c,q] of this.rows(s,'characters',p)) {
      const id=this.field(c,'characterId','string',q);if(ids.has(id))this.issue('DUPLICATE_CHARACTER_ID',q+'.characterId','Duplicate character');ids.add(id)
      if(this.field(c,'editable','boolean',q)===true)editable=true
      this.asset(c,q,'actionUuid')
      const clip=this.field(c,'clip','object',q)
      if(object(clip)){const start=this.field(clip,'sourceStartSeconds','number',q+'.clip'),end=this.field(clip,'sourceEndSeconds','number',q+'.clip'),speed=this.field(clip,'speed','number',q+'.clip');this.field(clip,'loop','boolean',q+'.clip');this.field(clip,'reverse','boolean',q+'.clip');if(typeof start==='number'&&start<0||typeof end==='number'&&end<0||typeof start==='number'&&typeof end==='number'&&end<start||typeof speed==='number'&&speed<=0)this.issue('INVALID_CLIP',q+'.clip','Invalid source range or speed')}
      const placement=this.field(c,'placement','object',q);if(object(placement)){this.vector(placement,'position',q+'.placement');this.field(placement,'yawDegrees','number',q+'.placement')}
      const policy=this.field(c,'rootPolicy','string',q);if(typeof policy==='string'&&!['skeletal','in-place'].includes(policy))this.issue('INVALID_ROOT_POLICY',q+'.rootPolicy','Invalid root policy')
    }
    if(!editable)this.issue('NO_EDITABLE_CHARACTER',p+'.characters','No editable character')
    for(const [r,q] of this.rows(s,'references',p)){this.hash(r,'sha256',q,this.file(r,'file',q));const t=this.field(r,'transform','object',q);if(object(t))for(const key of ['position','rotationDegrees','scale'])this.vector(t,key,q+'.transform')}
    return s
  }
}
export function validateShot(files: PackageFiles): Issue[] { const v=new Validator(files);v.shot();return v.issues }
export function validateResult(files: PackageFiles, shotFiles: PackageFiles): Issue[] {
  const base=new Validator(shotFiles),s=base.shot(),v=new Validator(files)
  v.issues.push(...base.issues.map(i=>({...i,path:'shot/'+i.path})))
  const r=v.json(v.file({file:'result.json'},'file','result.json'),'result.json');if(!r)return v.issues
  const p='result.json';v.version(r,p);const shotId=v.field(r,'shotId','string',p);v.hash(r,'baseShotSha256',p,shotFiles['shot.json'])
  if(s&&typeof shotId==='string'&&shotId!==s.shotId)v.issue('SHOT_ID_MISMATCH',p+'.shotId','Wrong shot')
  const chars=Array.isArray(s?.characters)?s.characters.filter(object):[],seen=new Set<unknown>(),newIds=new Set<unknown>()
  for(const [e,q] of v.rows(r,'edits',p)) {
    const id=v.field(e,'characterId','string',q);if(seen.has(id))v.issue('DUPLICATE_CHARACTER_ID',q+'.characterId','Duplicate edit');seen.add(id)
    const c=chars.find(c=>c.characterId===id)
    if(!c)v.issue('UNKNOWN_CHARACTER',q+'.characterId','Character absent from shot');else if(c.editable!==true)v.issue('CHARACTER_NOT_EDITABLE',q+'.characterId','Read-only character')
    const original=v.id(e,'originalActionUuid',q);if(c&&original!==c.actionUuid)v.issue('ORIGINAL_ACTION_MISMATCH',q+'.originalActionUuid','Original Action differs')
    v.asset(e,q,'newActionUuid');if(chars.some(c=>c.actionUuid===e.newActionUuid))v.issue('ACTION_UUID_REUSED',q+'.newActionUuid','Derivative must have a new UUID')
    if(newIds.has(e.newActionUuid))v.issue('DUPLICATE_ACTION_UUID',q+'.newActionUuid','Duplicate derivative UUID');newIds.add(e.newActionUuid)
    v.keys(e,'placementKeys',q,Array.isArray(s?.frameRange)?s.frameRange as number[]:undefined)
  }
  return v.issues
}
export function readPackageJson<T>(files: PackageFiles,name: string): T { return JSON.parse(strFromU8(files[name]!)) as T }
