import { spawnSync } from 'node:child_process'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function toolVersion(command: string, args: string[]): { available: boolean; version: string | null } {
  try {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 2500, windowsHide: true, stdio: 'pipe' })
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
    const version = output.split(/\r?\n/).find(Boolean)?.slice(0, 160) || null
    return { available: !result.error && result.status === 0 && Boolean(version), version: !result.error && result.status === 0 ? version : null }
  } catch {
    return { available: false, version: null }
  }
}

export async function GET(): Promise<Response> {
  const javaHome = process.env.BBS_JAVA_HOME?.trim() || process.env.JAVA_HOME?.trim()
  return Response.json({
    app: { name: 'BBS Animation Workspace', version: '0.1.0', mode: process.env.NODE_ENV ?? 'unknown' },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    tools: {
      python: toolVersion(process.platform === 'win32' ? 'python' : 'python3', ['--version']),
      blender: toolVersion(process.env.BBS_BLENDER_EXE?.trim() || 'blender', ['--version']),
      java: toolVersion(javaHome ? path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java', ['-version']),
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
