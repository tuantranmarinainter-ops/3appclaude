import type * as THREE from 'three'

import { LIBRARY_ASSET_PREFIX } from '../../contract/assetKeyPrefixes'
import { markTemplateShared, releaseTemplateShared } from '../objects/templateShared'

const MAX_LIBRARY_TEMPLATES = 48

/** three 的 GPU 资源必须显式释放，仅从 Map 里移除引用不会回收显存。 */
export function disposeTemplateResources(root: THREE.Object3D): void {
  const resources = new Set<{ dispose: () => void }>()
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) resources.add(mesh.geometry)
    const material = mesh.material
    if (!material) return
    for (const item of Array.isArray(material) ? material : [material]) {
      resources.add(item)
      for (const value of Object.values(item)) {
        const texture = value as THREE.Texture | null
        if (texture?.isTexture) resources.add(texture)
      }
    }
  })
  for (const resource of resources) resource.dispose()
}

class LruMap<T> {
  private readonly map = new Map<string, T>()

  constructor(
    private readonly max: number,
    private readonly onEvict?: (value: T) => void,
  ) {}

  get(key: string): T | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: string, value: T): void {
    const previous = this.map.get(key)
    if (previous !== undefined) {
      this.map.delete(key)
      // 同一 URL 并发加载（同草稿放两个相同道具）会各下一份再先后写入，
      // 被覆盖的那份同样要走淘汰回收，否则它带着 templateShared 标记永远没人释放。
      if (previous !== value) this.onEvict?.(previous)
    }
    this.map.set(key, value)
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      const evicted = this.map.get(oldest)
      this.map.delete(oldest)
      // 不在此处 dispose：被淘汰的模板可能仍被活跃场景里的 clone 共享几何体。
      // 改为交回给场景销毁流程回收，见 releaseTemplateShared。
      if (evicted !== undefined) this.onEvict?.(evicted)
    }
  }
}

const ownership = new WeakMap<THREE.Object3D, { cached: boolean; users: number }>()

function retireTemplate(root: THREE.Object3D): void {
  const state = ownership.get(root)
  if (state) state.cached = false
  if (state?.users) return
  releaseTemplateShared(root)
  disposeTemplateResources(root)
}

/** Pin shared GPU resources for an AssetLoader's lifetime, including after LRU eviction. */
export function retainCachedTemplate(root: THREE.Object3D): boolean {
  const state = ownership.get(root)
  if (!state) return false
  state.users++
  return true
}

export function releaseCachedTemplate(root: THREE.Object3D): void {
  const state = ownership.get(root)
  if (!state) return
  state.users = Math.max(0, state.users - 1)
  if (!state.cached && state.users === 0) retireTemplate(root)
}

function ownTemplate(root: THREE.Object3D): void {
  const state = ownership.get(root)
  if (state) state.cached = true
  else ownership.set(root, { cached: true, users: 0 })
  markTemplateShared(root)
}

const libraryCharacters = new LruMap<THREE.Object3D>(MAX_LIBRARY_TEMPLATES, retireTemplate)
const libraryProps = new LruMap<THREE.Object3D>(MAX_LIBRARY_TEMPLATES, retireTemplate)

/**
 * 从资源 URL 或裸 key 还原官方素材库的 S3 key；用户私有素材返回 null，由调用方退回实例缓存。
 *
 * 后端 `CloudFrontService.generateSignedUrl` 用 `URLEncoder.encode(key)` 拼签名 URL，斜杠会被
 * 编码成 `%2F`（`https://cdn/3d-builder%2Flibrary%2Fprops%2Fx.glb?Signature=...`），所以
 * decodeURIComponent 这步是必需的，不只是容错。
 */
export function libraryAssetCacheKey(urlOrKey: string): string | null {
  const trimmed = urlOrKey.trim()
  if (!trimmed) return null
  // Studio project asset IDs are SHA-256 addresses; project identity and URL
  // signatures do not change the bytes. Mutable library models require a fingerprint.
  try {
    const url = new URL(trimmed, 'https://asset.invalid')
    const path = decodeURIComponent(url.pathname)
    const content = /\/assets\/sha256:([a-f0-9]{64})\/source$/.exec(path)
    if (content) return `sha256:${content[1]}:${url.searchParams.get('format') ?? 'source'}`
    const fingerprint = url.searchParams.get('fingerprint')
    const character = url.searchParams.get('modelCharacter')
    if (path === '/api/library' && character && fingerprint) return `character:${character}:${fingerprint}`
  } catch { /* Malformed or non-URL keys still use the existing library path rules. */ }
  let path = trimmed
  try {
    if (/^https?:\/\//i.test(trimmed)) path = new URL(trimmed).pathname
  } catch {
    path = trimmed.split('?')[0] ?? trimmed
  }
  // 用户上传的文件名可能带裸 %，decodeURIComponent 会抛；这条路径挡在每次模型加载前，不能崩。
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    decoded = path
  }
  const normalized = decoded.replace(/^\/+/, '').split('?')[0] ?? ''
  return normalized.startsWith(LIBRARY_ASSET_PREFIX) ? normalized : null
}

export function instanceCacheKey(url: string): string {
  // Studio library characters differ only by the query (?modelCharacter=<id>&fingerprint=); stripping it would share one model between them.
  if (url.startsWith('/api/library?modelCharacter=')) return url
  return url.split('?')[0] ?? url
}

export function lookupLibraryCharacter(url: string): THREE.Object3D | undefined {
  const key = libraryAssetCacheKey(url)
  return key ? libraryCharacters.get(key) : undefined
}

export function storeLibraryCharacter(url: string, scene: THREE.Object3D): boolean {
  const key = libraryAssetCacheKey(url)
  if (!key) return false
  ownTemplate(scene)
  libraryCharacters.set(key, scene)
  return true
}

export function lookupLibraryProp(url: string): THREE.Object3D | undefined {
  const key = libraryAssetCacheKey(url)
  return key ? libraryProps.get(key) : undefined
}

export function storeLibraryProp(url: string, scene: THREE.Object3D): boolean {
  const key = libraryAssetCacheKey(url)
  if (!key) return false
  ownTemplate(scene)
  libraryProps.set(key, scene)
  return true
}
