import { spawn } from 'node:child_process'
import path from 'node:path'

/** Local desktop helpers for the export panel. Studio only runs on the user's own machine (validateLocalRequest),
 * so these open native dialogs/windows there; every caller must still validate what comes back. */

// Absolute paths: PATH on some machines lacks System32 (seen on the user's Windows box).
const systemRoot = () => process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
const POWERSHELL = () => path.join(systemRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const EXPLORER = () => path.join(systemRoot(), 'explorer.exe')

function run(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { if (stdout.length < 1 << 20) stdout += chunk })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout }) })
  })
}

/** PowerShell receives user text only through environment variables, never interpolated into the script. */
function powershell(script: string, env: Record<string, string>, timeoutMs: number) {
  return new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    // -EncodedCommand: Windows argument quoting would otherwise strip the script's double quotes.
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn(POWERSHELL(), ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...env } })
    let stdout = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { if (stdout.length < 1 << 20) stdout += chunk })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout }) })
  })
}

const FOLDER_DIALOG = `[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner=New-Object System.Windows.Forms.Form -Property @{TopMost=$true;ShowInTaskbar=$false;WindowState='Minimized'}
$dialog=New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description='Chọn thư mục gốc của game Minecraft (thư mục có saves, mods, config)'
$dialog.ShowNewFolderButton=$false
if ($env:BBS_INITIAL_DIR -and (Test-Path -LiteralPath $env:BBS_INITIAL_DIR)) { $dialog.SelectedPath=$env:BBS_INITIAL_DIR }
if ($dialog.ShowDialog($owner) -eq 'OK') { Write-Output $dialog.SelectedPath }`

/** B50: native folder picker. Returns null when the user cancels. */
export async function chooseFolderNative(initial?: string): Promise<string | null> {
  if (process.platform !== 'win32') throw new Error('Hộp chọn thư mục chỉ có trên Windows; hãy dán đường dẫn thư mục game.')
  const { stdout } = await powershell(FOLDER_DIALOG, { BBS_INITIAL_DIR: typeof initial === 'string' ? initial : '' }, 10 * 60_000)
  const chosen = stdout.trim().split(/\r?\n/).pop()?.trim() ?? ''
  return chosen ? chosen : null
}

/** Open the OS file browser with the file selected. */
export async function revealPathNative(target: string): Promise<void> {
  if (process.platform === 'win32') { await run(EXPLORER(), [`/select,${target}`], 15_000); return }
  await run(process.platform === 'darwin' ? 'open' : 'xdg-open', process.platform === 'darwin' ? ['-R', target] : [path.dirname(target)], 15_000)
}

/** True when the command line refers to this game folder (launchers pass --gameDir or -Djava.library.path inside it). */
export function commandLineUsesGameDir(commandLine: string, gameDir: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const dir = normalize(path.resolve(gameDir))
  if (!dir) return false
  const text = normalize(commandLine).replace(/"/g, '')
  let index = text.indexOf(dir)
  while (index >= 0) {
    const next = text[index + dir.length]
    if (next === undefined || next === '/' || next === ' ' || next === ';') return true
    index = text.indexOf(dir, index + 1)
  }
  return false
}

const JAVA_PROCESSES = `[Console]::OutputEncoding=[Text.Encoding]::UTF8
Get-CimInstance Win32_Process -Filter "Name='java.exe' OR Name='javaw.exe'" | ForEach-Object { $_.CommandLine }`

/** B33: is Minecraft (java/javaw) running from this game folder? null = could not check. */
export async function isBbsGameRunning(gameDir: string): Promise<boolean | null> {
  try {
    const { code, stdout } = process.platform === 'win32'
      ? await powershell(JAVA_PROCESSES, {}, 20_000)
      : await run('ps', ['-eo', 'args='], 10_000)
    if (code !== 0) return null
    return stdout.split(/\r?\n/).some((line) => /java/i.test(line) && commandLineUsesGameDir(line, gameDir))
  } catch { return null }
}
