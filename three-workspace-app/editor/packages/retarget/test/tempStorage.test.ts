import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupStaleSessions, createSession, directorySize, resolveWorkbenchTempRoot, retentionDays, SESSION_LOCK } from '../workbench/tempStorage.ts'

test('resolves the configurable root with native Windows drive semantics', () => {
  assert.equal(resolveWorkbenchTempRoot({ configured: 'S:\\Claude\\tmp', cwd: 'C:\\repo', platform: 'win32' }), 'S:\\Claude\\tmp\\w01-workbench')
  assert.equal(resolveWorkbenchTempRoot({ configured: '"S:\\Claude\\tmp"', cwd: 'C:\\repo', platform: 'win32' }), 'S:\\Claude\\tmp\\w01-workbench')
  assert.equal(resolveWorkbenchTempRoot({ configured: 'temp\\qa', cwd: 'C:\\repo', platform: 'win32' }), 'C:\\repo\\temp\\qa\\w01-workbench')
  assert.equal(resolveWorkbenchTempRoot({ tempDir: 'C:\\Users\\Artist\\AppData\\Local\\Temp', platform: 'win32' }), 'C:\\Users\\Artist\\AppData\\Local\\Temp\\w01-workbench')
})

test('validates the retention-day environment value', () => {
  assert.equal(retentionDays(undefined), 7)
  assert.equal(retentionDays('0'), 0)
  assert.equal(retentionDays('30'), 30)
  assert.throws(() => retentionDays('-1'), /0 to 3650/)
  assert.throws(() => retentionDays('1.5'), /0 to 3650/)
})

test('cleanup removes only expired sessions with stale PID locks', () => {
  const root = mkdtempSync(join(tmpdir(), 'w01-temp-storage-'))
  const now = Date.UTC(2026, 9, 24), old = new Date(now - 10 * 86400000), recent = new Date(now - 86400000)
  const session = (name: string, pid: number | null, date: Date) => {
    const dir = join(root, name); mkdirSync(dir); writeFileSync(join(dir, 'artifact.bin'), '1234')
    if (pid !== null) writeFileSync(join(dir, SESSION_LOCK), JSON.stringify({ pid }))
    utimesSync(dir, date, date); return dir
  }
  const dead = session('olddead-11111111', 11, old)
  const unlocked = session('oldfree-22222222', null, old)
  const live = session('oldlive-33333333', 33, old)
  const fresh = session('newdead-44444444', 44, recent)
  const unrelated = session('user-folder', null, old)
  try {
    const result = cleanupStaleSessions(root, { now, retentionDays: 7, isProcessRunning: (pid) => pid === 33 })
    assert.equal(result.removedSessions, 2)
    assert.ok(result.freedBytes >= 8)
    assert.equal(directorySize(dead), 0); assert.equal(directorySize(unlocked), 0)
    assert.ok(directorySize(live) > 0); assert.ok(directorySize(fresh) > 0); assert.ok(directorySize(unrelated) > 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('new sessions contain a PID lock and size nested files', () => {
  const root = mkdtempSync(join(tmpdir(), 'w01-temp-session-'))
  try {
    const session = createSession(root, Date.UTC(2026, 9, 24))
    const lock = JSON.parse(readFileSync(join(session, SESSION_LOCK), 'utf8'))
    assert.equal(lock.pid, process.pid)
    writeFileSync(join(session, 'runs', 'sample.bin'), Buffer.alloc(1536))
    assert.ok(directorySize(session) >= 1536)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
