import { scanBbsGameCapabilities } from '../../../../src/bbsGameCapabilities'
import { isBbsGameRunning } from '../../../../src/bbsLocalDesktop'
import { listInstallRecords, listInstallWorlds } from '../../../../src/bbsInstall'
import { validateLocalRequest } from '../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  const gameDir = new URL(request.url).searchParams.get('gameDir') ?? ''
  try {
    const capabilities = await scanBbsGameCapabilities(gameDir)
    // B33: installing while BBS has the Film panel open has crashed the game; report it so the panel can warn.
    const [worlds, installs, gameRunning] = await Promise.all([listInstallWorlds(capabilities.gameDir), listInstallRecords(capabilities.gameDir), isBbsGameRunning(capabilities.gameDir)])
    return Response.json({ worlds, installs, capabilities, gameRunning }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Could not inspect the game folder' } }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
}
