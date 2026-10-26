import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

export interface DetectedMod { id: string; version: string; file: string; loader: 'fabric' | 'forge' }
export interface BbsGameCapabilities {
  gameDir: string; corrected: boolean; bbs: DetectedMod | null; aaa: DetectedMod | null; addon: DetectedMod | null
  loader: 'forge-connector' | 'forge' | 'fabric' | 'unknown'; loaderVersion: string | null; issues: string[]; effectsCompatible: boolean
}

/** Eligibility is a metadata profile check, never proof of in-game playback.
 * Extend the Fabric-only profile only after the runtime checklist verifies another loader/version pair.
 */

/** Read metadata, never infer an enabled mod from its filename. Bounded ZIP reads also inspect nested dependencies. */
const SCAN = String.raw`import sys,os,json,zipfile,io,re
root=sys.argv[1]; rows=[]; errors=[]; total=0; loader_versions=set()
def inspect(source,label,depth=0):
 global total
 if depth>3: raise ValueError('nested jar depth')
 with zipfile.ZipFile(source) as z:
  if len(z.infolist())>10000: raise ValueError('too many entries')
  if len(set(z.namelist()))!=len(z.namelist()): raise ValueError('duplicate jar metadata paths')
  def read(name):
   global total
   info=z.getinfo(name)
   if info.file_size>8*1024*1024: raise ValueError('metadata or nested jar too large')
   total+=info.file_size
   if total>64*1024*1024: raise ValueError('scan budget exceeded')
   return z.read(info)
  if 'fabric.mod.json' in z.namelist():
   m=json.loads(read('fabric.mod.json'))
   rows.append(dict(id=m.get('id',''),version=str(m.get('version','')),file=label,loader='fabric'))
  if 'META-INF/mods.toml' in z.namelist():
   text=read('META-INF/mods.toml').decode('utf8')
   for block in text.split('[[mods]]')[1:]:
    ident=re.search(r'modId\s*=\s*["\']([^"\']+)',block); version=re.search(r'version\s*=\s*["\']([^"\']+)',block)
    if ident: rows.append(dict(id=ident.group(1),version=version.group(1) if version else '',file=label,loader='forge'))
  for name in z.namelist():
   if name.startswith('META-INF/jars/') and name.endswith('.jar'): inspect(io.BytesIO(read(name)),label+'!'+name,depth+1)
mods=os.path.join(root,'mods')
if os.path.isdir(mods):
 names=sorted(os.listdir(mods))
 if len(names)>1024: raise ValueError('too many mods')
 for name in names:
  filename=os.path.join(mods,name)
  if not name.lower().endswith('.jar') or os.path.islink(filename) or not os.path.isfile(filename): continue
  try: inspect(filename,name)
  except Exception: errors.append('Không đọc được metadata mod: '+name)
forge=os.path.isdir(os.path.join(root,'libraries','net','minecraftforge'))
fabric=os.path.isdir(os.path.join(root,'.fabric')) or os.path.isdir(os.path.join(root,'libraries','net','fabricmc'))
loader_library=os.path.join(root,'libraries','net','fabricmc','fabric-loader')
if os.path.isdir(loader_library): loader_versions.update(name for name in os.listdir(loader_library) if os.path.isdir(os.path.join(loader_library,name)))
versions=os.path.join(root,'versions')
if os.path.isdir(versions):
 for entry in sorted(os.listdir(versions))[:256]:
  filename=os.path.join(versions,entry,entry+'.json')
  if not os.path.isfile(filename) or os.path.getsize(filename)>2*1024*1024: continue
  try:
   manifest=json.load(open(filename,encoding='utf8'))
   names=[lib.get('name','') for lib in manifest.get('libraries',[]) if isinstance(lib,dict)]
   forge=forge or any(name.startswith('net.minecraftforge:forge:') or name.startswith('net.minecraftforge:fmlloader:') for name in names)
   fabric=fabric or any(name.startswith('net.fabricmc:fabric-loader:') for name in names)
   loader_versions.update(name.split(':')[2] for name in names if name.startswith('net.fabricmc:fabric-loader:') and len(name.split(':'))==3)
  except Exception: errors.append('Không đọc được metadata phiên bản game: '+entry)
print(json.dumps(dict(rows=rows,errors=errors,forge=forge,fabric=fabric,loaderVersions=sorted(loader_versions))))
`

export async function normalizeBbsGameDir(gameDir: string): Promise<{ gameDir: string; corrected: boolean }> {
  if (typeof gameDir !== 'string' || !gameDir.trim() || gameDir.includes('\0')) throw new TypeError('Nhập thư mục gốc game BBS FS.')
  const original = await realpath(path.resolve(gameDir.trim()))
  if (!(await stat(original)).isDirectory()) throw new TypeError('Thư mục game không hợp lệ.')
  let current = original
  for (let depth = 0; depth < 12; depth++) {
    try { if ((await stat(path.join(current, 'mods'))).isDirectory()) return { gameDir: current, corrected: current !== original } } catch { /* Search parent. */ }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  // Existing film-only installs may have no mods folder; do not guess a different instance.
  return { gameDir: original, corrected: false }
}

export async function scanBbsGameCapabilities(gameDir: string): Promise<BbsGameCapabilities> {
  const normalized = await normalizeBbsGameDir(gameDir)
  const scan = await new Promise<{ rows: DetectedMod[]; errors: string[]; forge: boolean; fabric: boolean; loaderVersions: string[] }>((resolve, reject) => {
    const child = spawn(process.env.BBS_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', SCAN, normalized.gameDir], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', error = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Quét mod quá thời gian.')) }, 15000)
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); if (output.length > 1024 * 1024) child.kill() })
    child.stderr.on('data', (chunk: Buffer) => { if (error.length < 4096) error += chunk.toString() })
    child.once('error', (cause) => { clearTimeout(timer); reject(cause) })
    child.once('close', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error('Không quét được mod game: ' + error.slice(-300))); else { try { resolve(JSON.parse(output)) } catch (cause) { reject(cause) } } })
  })
  const find = (ids: string[]) => scan.rows.find((mod) => ids.includes(mod.id)) ?? null
  const bbs = find(['bbs', 'bbs_mod']), aaa = find(['aaa_particles']), addon = find(['bbs-aaaddon'])
  const connector = !!find(['connector'])
  const forge = scan.forge || connector || !!find(['forge']) || scan.rows.some((mod) => mod.loader === 'forge')
  const loader = forge ? connector ? 'forge-connector' : 'forge' : scan.fabric || !!find(['fabricloader']) ? 'fabric' : 'unknown'
  const loaderVersion = scan.loaderVersions.length === 1 ? scan.loaderVersions[0]! : find(['fabricloader'])?.version ?? null
  const loaderMatch = loaderVersion?.match(/^(\d+)\.(\d+)\.(\d+)$/)
  const supportedLoader = !!loaderMatch && (Number(loaderMatch[1]) > 0 || Number(loaderMatch[2]) >= 15)
  const issues = [...scan.errors]
  if (loader === 'fabric' && !supportedLoader) issues.push('Cần xác định Fabric Loader phiên bản từ 0.15.0 trở lên qua metadata phiên bản game.')
  if (normalized.corrected) issues.push('Đã sửa đường dẫn về thư mục gốc game: ' + normalized.gameDir)
  if (!bbs || !/^2\.7(?:[.\-+]|$)/.test(bbs.version)) issues.push('Cần BBS FS 2.7 có metadata phiên bản hợp lệ.')
  if (!aaa) issues.push('Game chưa có AAA Particles — hiệu ứng sẽ không được kèm để tránh game sập.')
  if (!addon) issues.push('Game chưa có addon AAA tương thích — chặn xuất hiệu ứng để tránh game sập.')
  const conflict = forge && scan.rows.some((mod) => mod.loader === 'fabric' && ['forgeconfigapiport', 'forge_config_api_port'].includes(mod.id))
  if (conflict) issues.push('Forge xung đột forgeconfigapiport-fabric (kể cả jar gói kèm); game có thể không khởi động.')
  const unsupported = loader !== 'fabric'
  if (unsupported) issues.push(loader === 'forge-connector' ? 'AAA qua Forge + Connector chưa được xác minh; tạm chặn kèm hiệu ứng.' : 'Chưa xác định môi trường Fabric tương thích cho AAA.')
  const versions = ['2.7', '2.7-1.20.1'].includes(bbs?.version ?? '') && aaa?.version === '2.2.3' && ['2.0', '2.0-1.20.1'].includes(addon?.version ?? '')
  const api = find(['fabric-api', 'fabric']), architectury = find(['architectury']), configApi = find(['forgeconfigapiport', 'forge_config_api_port'])
  const dependencies = api?.loader === 'fabric' && architectury?.loader === 'fabric' && architectury.version === '9.2.14' && configApi?.loader === 'fabric' && configApi.version === '8.0.0'
  if (!dependencies) issues.push('Thiếu Fabric API, Architectury Fabric 9.2.14 hoặc Forge Config API Port Fabric 8.0.0 mà hồ sơ Fabric AAA cần.')
  const duplicates = [bbs, aaa, addon].some((mod) => mod && scan.rows.filter((row) => row.id === mod.id).length !== 1)
  if (duplicates) issues.push('Có nhiều bản mod trùng ID; cần giữ một bản tương thích.')
  const effectsCompatible = !!bbs && /^2\.7(?:[.\-+]|$)/.test(bbs.version) && !!aaa && !!addon && versions && supportedLoader && dependencies && !duplicates && !conflict && !unsupported && scan.errors.length === 0 && [bbs, aaa, addon].every((mod) => mod.loader === 'fabric')
  if (!versions && bbs && aaa && addon) issues.push('Chỉ hỗ trợ hồ sơ BBS 2.7 + AAA 2.2.3 + addon 2.0; phiên bản khác chưa xác minh.')
  return { ...normalized, bbs, aaa, addon, loader, loaderVersion, issues, effectsCompatible }
}

export async function assertBbsEffectsDestination(gameDir: string): Promise<BbsGameCapabilities> {
  const capabilities = await scanBbsGameCapabilities(gameDir)
  if (!capabilities.effectsCompatible) throw new TypeError(capabilities.issues.join(' '))
  return capabilities
}
