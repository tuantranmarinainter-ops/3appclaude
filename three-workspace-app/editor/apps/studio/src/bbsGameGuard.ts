import { isBbsGameRunning } from './bbsLocalDesktop'

export const GAME_RUNNING_MESSAGE = 'Minecraft đang chạy từ thư mục game này. Thoát game rồi mới xoá/gỡ file được.'

/** B64/B33: a 409 response while Minecraft runs from this folder, else null. `check` is injectable for tests. */
export async function gameRunningResponse(gameDir: string, check: (dir: string) => Promise<boolean | null> = isBbsGameRunning): Promise<Response | null> {
  if (await check(gameDir) !== true) return null
  return Response.json({ error: { message: GAME_RUNNING_MESSAGE }, gameRunning: true }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
}
