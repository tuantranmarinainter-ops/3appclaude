import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { loadAsset, type AssetFormat } from '../cli/loadAsset.ts'

const stamp = (path: string) => {
  const stat = statSync(path, { bigint: true })
  return [path, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
}
type Asset = { bytes: Buffer; scene: Awaited<ReturnType<typeof loadAsset>> }

/** Server-only skeleton templates; pending parses are shared, request hierarchies are private. */
export class ParsedAssetCache {
  private entries = new Map<string, { version: string; asset: Asset; bytes: number }>()
  private pending = new Map<string, Promise<Asset>>()
  private bytes = 0

  constructor(private maxEntries: number, private maxBytes: number, private parse = loadAsset) {}

  async load(path: string, format: AssetFormat, armaturePath?: string): Promise<Asset> {
    path = resolve(path)
    armaturePath = armaturePath ? resolve(armaturePath) : undefined
    const id = JSON.stringify([path, format, armaturePath])
    const previous = this.entries.get(id)
    let version = [stamp(path), ...(armaturePath ? [stamp(armaturePath)] : [])].join('|')
    // External glTF buffers affect the parsed skeleton even when the JSON is unchanged.
    const bytes = format === 'gltf' ? readFileSync(path) : undefined
    if (bytes) {
      const json = JSON.parse(bytes.toString('utf8'))
      for (const buffer of json.buffers ?? []) {
        if (typeof buffer.uri !== 'string' || buffer.uri.startsWith('data:')) continue
        const uri = decodeURIComponent(buffer.uri), dependency = resolve(dirname(path), uri)
        const inside = relative(dirname(path), dependency)
        if (isAbsolute(uri) || !inside || inside.startsWith('..') || isAbsolute(inside)) throw new TypeError(`glTF buffer ${buffer.uri} is outside the glTF folder`)
        version += '|' + stamp(dependency)
      }
    }
    if (previous?.version === version) {
      this.entries.delete(id); this.entries.set(id, previous)
      return this.copy(previous.asset)
    }
    if (previous) { this.entries.delete(id); this.bytes -= previous.bytes }
    const key = JSON.stringify([id, version])
    let pending = this.pending.get(key)
    if (!pending) {
      pending = (async () => {
        const input = bytes ?? readFileSync(path)
        const scene = await this.parse(input, format, { skeletonOnly: true, resourceDir: dirname(path),
          ...(armaturePath ? { bobjArmature: readFileSync(armaturePath) } : {}) })
        const asset = { bytes: input, scene }
        let size = input.byteLength
        scene.traverse((node) => {
          size += 1024 + node.name.length * 2 + JSON.stringify(node.userData).length * 2
          for (const clip of node.animations) {
            size += 256 + clip.name.length * 2
            for (const track of clip.tracks) size += 256 + track.name.length * 2 + track.times.byteLength + track.values.byteLength
          }
        })
        // An obsolete parse may finish after a newer version; only the newest pending load can be retained.
        if (this.pending.get(key) === pending && this.latest.get(id) === key && size <= this.maxBytes && this.maxEntries > 0) {
          this.entries.set(id, { version, asset, bytes: size }); this.bytes += size
          while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
            const oldest = this.entries.keys().next().value!
            this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest)
          }
        }
        return asset
      })()
      this.latest.set(id, key)
      this.pending.set(key, pending)
    }
    try { return this.copy(await pending) } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key)
      if (this.latest.get(id) === key) this.latest.delete(id)
    }
  }

  private latest = new Map<string, string>()

  private copy(asset: Asset): Asset {
    // pruneToMappedRig replaces this array and clones quaternion tracks before editing; adapters clone their own tracks.
    const scene = asset.scene.clone(true)
    scene.animations = [...asset.scene.animations]
    return { bytes: asset.bytes, scene }
  }
}
