import { applyFilmCleanup, listCleanupFilms, planFilmCleanup } from '../../../../../src/bbsFilmCleanup'
import { isBbsGameRunning } from '../../../../../src/bbsLocalDesktop'
import { canonicalGameDir } from '../../../../../src/bbsInstall'
import { validateLocalRequest } from '../../../../../src/unifiedSession'

export const runtime = 'nodejs'

/** B64: POST { action: 'list' | 'plan' | 'apply', gameDir, worldName, films?, token? }. Deleting needs the game closed (B33). */
export async function POST(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const body: unknown = await request.json()
    const args = body && typeof body === 'object' ? body as Record<string, unknown> : {}
    if (typeof args.gameDir !== 'string' || typeof args.worldName !== 'string') return Response.json({ error: { message: 'Game folder and world are required' } }, { status: 400, headers })
    const films = Array.isArray(args.films) && args.films.every((item) => typeof item === 'string') ? args.films as string[] : []
    const gameRunning = await isBbsGameRunning(await canonicalGameDir(args.gameDir))
    if (args.action === 'list') return Response.json({ ...await listCleanupFilms(args.gameDir, args.worldName), gameRunning }, { headers })
    if (args.action === 'plan') return Response.json({ plan: await planFilmCleanup(args.gameDir, args.worldName, films), gameRunning }, { headers })
    if (args.action === 'apply') {
      if (gameRunning) return Response.json({ error: { message: 'Minecraft đang chạy từ thư mục game này. Thoát game rồi dọn phim.' }, gameRunning }, { status: 409, headers })
      if (typeof args.token !== 'string') return Response.json({ error: { message: 'Hãy xem trước trước khi xoá' } }, { status: 400, headers })
      return Response.json({ result: await applyFilmCleanup(args.gameDir, args.worldName, films, args.token), gameRunning }, { headers })
    }
    return Response.json({ error: { message: 'Unknown action' } }, { status: 400, headers })
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 400
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Cleanup failed' } }, { status, headers })
  }
}
