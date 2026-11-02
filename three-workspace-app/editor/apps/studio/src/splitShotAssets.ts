import { createHash } from 'node:crypto'
import { link, lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { BlobRef, UnifiedProject } from '@bbs/animation-workspace-shared'

/** Share immutable verified blobs with hard links. Never copies asset payloads or follows an escaping symlink. */
export async function linkSplitShotAssets(root: string, sourceId: string, project: UnifiedProject): Promise<{ assetBytes: number; sharedBlobCount: number }> {
  const sourceRoot = await realpath(path.join(root, sourceId)), destinationRoot = path.join(root, project.projectId)
  const refs = new Map<string, BlobRef>()
  // Converted GLB refs describe disposable materializations. Their canonical recipe JSON
  // is linked below like any other original; the split project regenerates its own cache.
  const virtualHashes = new Set(Object.keys(project.extensions?.libraryMotionConversions ?? {})
    .map((assetId) => project.assets[assetId as keyof typeof project.assets]?.source.sha256)
    .filter((hash): hash is string => typeof hash === 'string'))
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return
    const ref = value as BlobRef
    if (typeof ref.path === 'string' && typeof ref.sha256 === 'string' && typeof ref.byteLength === 'number') { if (!virtualHashes.has(ref.sha256)) refs.set(ref.path, ref); return }
    for (const child of Object.values(value)) visit(child)
  }
  visit(project)
  let assetBytes = 0
  for (const ref of refs.values()) {
    const source = await realpath(path.resolve(sourceRoot, ...ref.path.split('/')))
    const destination = path.resolve(destinationRoot, ...ref.path.split('/'))
    if (!source.startsWith(sourceRoot + path.sep) || !destination.startsWith(destinationRoot + path.sep)) throw new TypeError('Đường dẫn tài nguyên vượt khỏi dự án.')
    const bytes = await readFile(source)
    if (bytes.byteLength !== ref.byteLength || createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw new TypeError('Tài nguyên không khớp fingerprint.')
    await mkdir(path.dirname(destination), { recursive: true })
    const parent = await realpath(path.dirname(destination)), resolvedDestinationRoot = await realpath(destinationRoot)
    const resolvedRoot = await realpath(root)
    if (!resolvedDestinationRoot.startsWith(resolvedRoot + path.sep)) throw new TypeError('Thư mục dự án vượt khỏi kho dự án.')
    if (!parent.startsWith(resolvedDestinationRoot + path.sep)) throw new TypeError('Thư mục tài nguyên vượt khỏi dự án.')
    try { await link(source, destination) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const [left, right] = await Promise.all([stat(source), lstat(destination)])
      if (right.isSymbolicLink()) throw new TypeError('Tài nguyên đích là liên kết không an toàn.')
      if (left.dev !== right.dev || left.ino !== right.ino) throw new TypeError('Tài nguyên đích đã tồn tại khác nội dung.')
    }
    assetBytes += ref.byteLength
  }
  return { assetBytes, sharedBlobCount: refs.size }
}
