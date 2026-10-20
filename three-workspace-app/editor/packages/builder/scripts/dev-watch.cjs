const { spawn, execFileSync } = require('child_process')
const path = require('path')
const chokidar = require('chokidar')

const root = path.join(__dirname, '..')
const finalize = path.join(__dirname, 'finalize-dist.cjs')

function stopProcessTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', timeout: 15000 })
    } catch { /* already exited */ }
    return
  }
  try { process.kill(pid, 'SIGTERM') } catch { /* ignore */ }
}

// Windows 上 shell: true 起的 tsup 不随父进程退出；上次异常退出留下的 watcher 会继续抢写 dist。
function listRepoTsupWatcherPids() {
  if (process.platform !== 'win32') return []
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      "$tsups = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*topview-3d-builder*cli-default.js*--watch*' }); $parents = @{}; foreach ($p in $tsups) { $parents[[string]$p.ParentProcessId] = $true }; $pnpm = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*exec tsup --watch*' -and $parents.ContainsKey([string]$_.ProcessId) }); @($pnpm + $tsups | ForEach-Object { $_.ProcessId }) -join \"`n\""],
      { encoding: 'utf8', timeout: 20000 })
    return [...new Set(String(out).split(/\r?\n/).map((line) => Number(line.trim())).filter((pid) => pid > 0))]
  } catch {
    return []
  }
}

function reapOrphanTsupWatchers() {
  for (const pid of listRepoTsupWatcherPids()) stopProcessTree(pid)
}

let tsup = null
let restartTimer = null
let stopping = false

function startTsup() {
  reapOrphanTsupWatchers()
  const proc = spawn('pnpm', ['exec', 'tsup', '--watch'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  })
  tsup = proc
  proc.on('exit', (code) => {
    // 旧进程的 exit 晚于新进程的 spawn 到达。无条件清空会把新引用抹掉，
    // 之后的 restart 既 kill 不到旧进程也不再替换，watcher 会逐次堆积并争抢 dist。
    if (tsup === proc) tsup = null
    if (!stopping && code && code !== 0) {
      console.error(`[dev-watch] tsup exited with ${code}`)
    }
  })
}

function restartTsup() {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (tsup) {
      stopProcessTree(tsup.pid)
      try { tsup.kill('SIGTERM') } catch { /* tree kill already exited it */ }
      tsup = null
    }
    startTsup()
  }, 200)
}

function finalizeStyles() {
  spawn('node', [finalize, '--styles-only'], {
    cwd: root,
    stdio: 'inherit',
  })
}

startTsup()

chokidar
  .watch(path.join(root, 'src/styles'), { ignoreInitial: true })
  .on('all', (event, file) => {
    if (!file.endsWith('.css')) return
    console.log(`[dev-watch] styles ${event}: ${path.relative(root, file)}`)
    finalizeStyles()
  })

chokidar
  .watch(path.join(root, 'src'), {
    ignoreInitial: true,
    ignored: (file) => file.includes(`${path.sep}__tests__${path.sep}`) || file.includes(`${path.sep}styles${path.sep}`),
  })
  .on('add', (file) => {
    if (!/\.tsx?$/.test(file)) return
    console.log(`[dev-watch] add ${path.relative(root, file)}, restart tsup`)
    restartTsup()
  })
  .on('unlink', (file) => {
    if (!/\.tsx?$/.test(file)) return
    console.log(`[dev-watch] unlink ${path.relative(root, file)}, restart tsup`)
    restartTsup()
  })

function shutdown() {
  stopping = true
  if (restartTimer) clearTimeout(restartTimer)
  if (tsup) {
    stopProcessTree(tsup.pid)
    try { tsup.kill('SIGTERM') } catch { /* tree kill already exited it */ }
  }
  reapOrphanTsupWatchers()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
