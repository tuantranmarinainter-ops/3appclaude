import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { aspectLabel, aspectPreset, charactersInRange, defaultExportCharacterIds } from '../app/workbench/components/film-export/utils.ts'
import { pickWorld, recentGameDirs, rememberGameDir, rememberWorld, type KeyValueStore } from '../src/gameFolderMemory.ts'
import { readFilmDat } from '../src/zipEntry.ts'
import { commandLineUsesGameDir } from '../src/bbsLocalDesktop.ts'

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } }
}

const shot = (clips: Array<{ node: string; start: number; end: number }>) => ({
  characters: { den: { id: 'den', name: 'Đen', nodeId: 'n-den' }, go: { id: 'go', name: 'Gỗ Xưa', nodeId: 'n-go' }, extra: { id: 'extra', name: 'Phụ', nodeId: 'n-extra' } },
  scene: { content: { timeline: { animation: { motionClips: clips.map((clip, index) => ({ id: `c${index}`, target: { nodeId: clip.node }, frameStart: clip.start, frameEnd: clip.end })) } } } },
} as unknown as UnifiedProject)

test('B49 aspect shows familiar ratios, never 1.7777', () => {
  assert.equal(aspectLabel(16 / 9), '16:9')
  assert.equal(aspectLabel(1.7777777777), '16:9')
  assert.equal(aspectLabel(9 / 16), '9:16')
  assert.equal(aspectLabel(2.39), '2.39:1')
  assert.equal(aspectLabel(1.5), '≈ 1,50:1')
  assert.equal(aspectPreset(1.5), undefined)
})

test('B48 ticks every character acting in the shot (Đen + Gỗ Xưa), not only the first', () => {
  const project = shot([{ node: 'n-den', start: 0, end: 80 }, { node: 'n-go', start: 40, end: 149 }, { node: 'n-extra', start: 300, end: 400 }])
  assert.deepEqual(charactersInRange(project, { startFrame: 0, endFrame: 149 }), ['den', 'go'])
  assert.deepEqual(defaultExportCharacterIds(project, { startFrame: 0, endFrame: 149 }), ['den', 'go'])
  assert.deepEqual(defaultExportCharacterIds(shot([]), { startFrame: 0, endFrame: 149 }), ['den', 'go', 'extra'], 'no clips: nobody is silently left out')
})

test('B29/B50 remembers game folders and the world per folder', () => {
  const store = memory()
  assert.deepEqual(recentGameDirs(store), [])
  rememberGameDir(store, 'S:\\Minecraft\\Forge')
  rememberGameDir(store, 'S:\\Minecraft\\Fabric')
  assert.deepEqual(rememberGameDir(store, 'S:\\Minecraft\\Forge\\'), ['S:\\Minecraft\\Forge\\', 'S:\\Minecraft\\Fabric'], 'same folder is not listed twice')
  const worlds = [{ name: 'PHANG 3' }, { name: 'Thế giới mới (1)' }]
  assert.equal(pickWorld(store, 'S:\\Minecraft\\Forge', worlds), 'PHANG 3', 'nothing remembered: first world')
  rememberWorld(store, 'S:\\Minecraft\\Forge', 'Thế giới mới (1)')
  assert.equal(pickWorld(store, 's:\\minecraft\\forge\\', worlds), 'Thế giới mới (1)', 'reload keeps the chosen world')
  assert.equal(pickWorld(store, 'S:\\Minecraft\\Forge', [{ name: 'PHANG 3' }]), 'PHANG 3', 'remembered world gone: fall back')
  assert.equal(pickWorld(store, 'S:\\Minecraft\\Fabric', worlds), 'PHANG 3', 'worlds are remembered per folder')
  const broken: KeyValueStore = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.deepEqual(rememberGameDir(broken, 'X'), ['X'], 'blocked storage never breaks the panel')
})

function zip(entries: Array<{ name: string; data: Buffer; deflate?: boolean }>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const body = entry.deflate ? deflateRawSync(entry.data) : entry.data
    const name = Buffer.from(entry.name)
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(entry.deflate ? 8 : 0, 8)
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(entry.deflate ? 8 : 0, 10)
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(entry.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, name, body); centrals.push(central, name)
    offset += 30 + name.length + body.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

test('B56 "Chỉ lưu file .dat" pulls films/<name>.dat out of the package', () => {
  const dat = Buffer.from('film-bytes'.repeat(50))
  const film = readFilmDat(zip([{ name: 'assets/models/den/model.bobj', data: Buffer.from('m') }, { name: 'films/Tap15-Shot01.dat', data: dat, deflate: true }]))
  assert.equal(film.name, 'Tap15-Shot01.dat')
  assert.deepEqual(film.data, dat)
  assert.throws(() => readFilmDat(zip([{ name: 'README.txt', data: Buffer.from('x') }])), /không có file \.dat/)
})

test('B33 recognises Minecraft launched from the game folder only', () => {
  const dir = 'S:\\Minecraft\\Minecraft Forge-1.20.1'
  assert.ok(commandLineUsesGameDir('"C:\\java\\javaw.exe" -Xmx4G --gameDir "S:\\Minecraft\\Minecraft Forge-1.20.1" --version forge', dir))
  assert.ok(commandLineUsesGameDir('javaw -Djava.library.path=S:\\Minecraft\\Minecraft Forge-1.20.1\\natives net.minecraft', dir))
  assert.ok(!commandLineUsesGameDir('javaw --gameDir "S:\\Minecraft\\Minecraft Forge-1.20.1-old"', dir), 'a sibling instance is not this game')
  assert.ok(!commandLineUsesGameDir('java -jar gradle.jar', dir))
})
