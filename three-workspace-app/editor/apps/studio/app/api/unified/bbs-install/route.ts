import { scanBbsGameCapabilities } from '../../../../src/bbsGameCapabilities'
import { listInstallRecords, listInstallWorlds } from '../../../../src/bbsInstall'
import { validateLocalRequest } from '../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  const gameDir = new URL(request.url).searchParams.get('gameDir') ?? ''
  try {
    const capabilities = await scanBbsGameCapabilities(gameDir)
    const [worlds, installs] = await Promise.all([listInstallWorlds(capabilities.gameDir), listInstallRecords(capabilities.gameDir)])
    return Response.json({ worlds, installs, capabilities }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Could not inspect the game folder' } }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
}
