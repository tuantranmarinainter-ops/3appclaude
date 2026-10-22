import { listInstallRecords, listInstallWorlds } from '../../../../src/bbsInstall'
import { validateLocalRequest } from '../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  const gameDir = new URL(request.url).searchParams.get('gameDir') ?? ''
  try {
    const [worlds, installs] = await Promise.all([listInstallWorlds(gameDir), listInstallRecords(gameDir)])
    return Response.json({ worlds, installs }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Could not inspect the game folder' } }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
}
