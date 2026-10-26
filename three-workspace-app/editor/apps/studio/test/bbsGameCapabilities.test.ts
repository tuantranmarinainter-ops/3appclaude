import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm, rename, readFile } from 'node:fs/promises'
import os from 'node:os'
import { gzipSync, deflateSync } from 'node:zlib'
import path from 'node:path'
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js'
import { scanBbsGameCapabilities } from '../src/bbsGameCapabilities'
import { validateFilmEffectsDestination } from '../src/filmEffectsDestination'
import { planInstall, applyInstall } from '../src/bbsInstall'

const metadata = (id: string, version: string) => strToU8(JSON.stringify({ id, version }))
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aaa-scan-'))
  await mkdir(path.join(root, 'mods')); await mkdir(path.join(root, '.fabric'))
  await mkdir(path.join(root, 'versions/fabric'), { recursive: true })
  await writeFile(path.join(root, 'versions/fabric/fabric.json'), JSON.stringify({ libraries: [{ name: 'net.fabricmc:fabric-loader:0.19.5' }] }))
  await mkdir(path.join(root, 'saves', 'Test'), { recursive: true })
  await writeFile(path.join(root, 'saves', 'Test', 'level.dat'), 'fake level')
  return root
}
async function jar(root: string, filename: string, id: string, version: string, extra: Record<string, Uint8Array> = {}) {
  await writeFile(path.join(root, 'mods', filename), zipSync({ 'fabric.mod.json': metadata(id, version), ...extra }))
}
async function compatible(root: string) {
  await jar(root, 'unrelated-name.jar', 'bbs', '2.7-1.20.1')
  await jar(root, 'particles.jar', 'aaa_particles', '2.2.3')
  await jar(root, 'addon.jar', 'bbs-aaaddon', '2.0-1.20.1')
  await jar(root, 'api.jar', 'fabric-api', '0.92.6+1.20.1')
  await jar(root, 'architectury.jar', 'architectury', '9.2.14')
  await jar(root, 'config-api.jar', 'forgeconfigapiport', '8.0.0')
}
const policy = (gameDir: string) => ({ mode: 'include', target: { runtime: 'bbs-fs-2.7', aaaRendererAvailable: true, compatibleAddonConfirmed: true, gameDir } })

test('enabled metadata and known versions determine eligibility; child path is normalized', async () => {
  const root = await fixture()
  try {
    await compatible(root)
    const child = path.join(root, 'config', 'bbs', 'data', 'films'); await mkdir(child, { recursive: true })
    const scan = await scanBbsGameCapabilities(child)
    assert.equal(scan.gameDir, root); assert.equal(scan.corrected, true)
    assert.equal(scan.effectsCompatible, true); assert.equal(scan.bbs?.version, '2.7-1.20.1')
    assert.ok(scan.issues.some((issue) => issue.includes('Đã sửa')))
    await validateFilmEffectsDestination(policy(child))
    const versionFile = path.join(root, 'versions/fabric/fabric.json')
    await writeFile(versionFile, JSON.stringify({ libraries: [{ name: 'net.fabricmc:fabric-loader:0.14.25' }] }))
    assert.equal((await scanBbsGameCapabilities(root)).effectsCompatible, false)
    await writeFile(versionFile, JSON.stringify({ libraries: [{ name: 'net.fabricmc:fabric-loader:0.19.5' }] }))
    await rename(path.join(root, 'mods/config-api.jar'), path.join(root, 'mods/config-api.jar.off'))
    assert.equal((await scanBbsGameCapabilities(root)).effectsCompatible, false)
    await rename(path.join(root, 'mods/config-api.jar.off'), path.join(root, 'mods/config-api.jar'))
    await rename(path.join(root, 'mods/addon.jar'), path.join(root, 'mods/addon.jar.off'))
    await assert.rejects(validateFilmEffectsDestination(policy(root)), /addon AAA/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('filename claims, disabled mods, duplicate IDs and unknown versions never enable AAA', async () => {
  const root = await fixture()
  try {
    await compatible(root)
    await rename(path.join(root, 'mods/addon.jar'), path.join(root, 'mods/addon.jar.disabled'))
    await jar(root, 'bbs-aaaddon-2.0.jar', 'unrelated', '2.0')
    assert.equal((await scanBbsGameCapabilities(root)).addon, null)
    await jar(root, 'addon.jar', 'bbs-aaaddon', '99.0')
    assert.equal((await scanBbsGameCapabilities(root)).effectsCompatible, false)
    await jar(root, 'other.jar', 'bbs-aaaddon', '2.0')
    assert.ok((await scanBbsGameCapabilities(root)).issues.some((issue) => issue.includes('trùng ID')))
    await writeFile(path.join(root, 'mods', 'broken.jar'), 'not zip')
    assert.ok((await scanBbsGameCapabilities(root)).issues.some((issue) => issue.includes('metadata')))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Forge libraries and Connector plus nested Fabric config API report known startup conflict', async () => {
  const root = await fixture()
  try {
    await compatible(root)
    await jar(root, 'connector.jar', 'connector', '1.0.0-beta.46')
    // Forge launch libraries can live outside this instance. Connector alone must prevent Fabric eligibility.
    assert.equal((await scanBbsGameCapabilities(root)).loader, 'forge-connector')
    assert.equal((await scanBbsGameCapabilities(root)).effectsCompatible, false)
    await mkdir(path.join(root, 'libraries/net/minecraftforge/forge'), { recursive: true })
    const nested = zipSync({ 'fabric.mod.json': metadata('forgeconfigapiport', '8.0.0') })
    await jar(root, 'particles.jar', 'aaa_particles', '2.2.3', { 'META-INF/jars/config.jar': nested })
    const scan = await scanBbsGameCapabilities(root)
    assert.equal(scan.loader, 'forge-connector'); assert.equal(scan.effectsCompatible, false)
    assert.ok(scan.issues.some((issue) => issue.includes('xung đột')))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Forge metadata detects Forge AAA without claiming Fabric addon compatibility', async () => {
  const root = await fixture()
  try {
    await writeFile(path.join(root, 'mods/forge.jar'), zipSync({ 'META-INF/mods.toml': strToU8('[[mods]]\nmodId="aaa_particles"\nversion="2.2.3"\n') }))
    const scan = await scanBbsGameCapabilities(root)
    assert.equal(scan.aaa?.loader, 'forge'); assert.equal(scan.aaa?.version, '2.2.3'); assert.equal(scan.effectsCompatible, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('effect packages block missing addon at preview and rescan before apply without writing', async () => {
  const root = await fixture()
  try {
    const archive = path.join(root, 'effects.zip')
    await writeFile(archive, zipSync({ 'films/test.dat': strToU8('film'), 'assets/effeks/test/ring.efkefc': strToU8('fixture') }))
    await assert.rejects(planInstall(archive, root, 'Test'), /addon AAA/)
    await compatible(root)
    const plan = await planInstall(archive, root, 'Test')
    await rename(path.join(root, 'mods/addon.jar'), path.join(root, 'mods/addon.jar.off'))
    await assert.rejects(applyInstall(plan.planId), /addon AAA/)
    await assert.rejects(readFile(path.join(root, 'config/bbs/assets/effeks/test/ring.efkefc')))
    await writeFile(archive, zipSync({ 'films/test.dat': strToU8('film'), 'required-mods.json': strToU8(JSON.stringify({ includedEffectCount: 1 })) }))
    await assert.rejects(planInstall(archive, root, 'Test'), /addon AAA/)
    for (const bytes of [strToU8('fake film bbs:aaa_particle'), gzipSync('fake film bbs:aaa_particle'), deflateSync('fake film bbs:aaa_particle')]) {
      await writeFile(archive, zipSync({ 'films/test.dat': bytes }))
      await assert.rejects(planInstall(archive, root, 'Test'), /addon AAA/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('preflight blocks forged scoped acknowledgements against the actual missing-addon destination', async () => {
  const root = await fixture()
  const previous = process.env.BBS_UNIFIED_PROJECTS_DIR
  process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(root, 'projects')
  try {
    const { makeEmptyDraft } = await import('@topview/3d-builder')
    const { executeUnifiedCommand } = await import('../src/unifiedProjectStore')
    const { randomUUID } = await import('node:crypto')
    const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'AAA preflight', scene: makeEmptyDraft('AAA preflight', 30, 29) } })
    await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: created.revision,
      command: 'film.preflight', args: { effectsPolicy: policy(root) } }), /addon AAA/)
  } finally {
    if (previous === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR
    else process.env.BBS_UNIFIED_PROJECTS_DIR = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('GET exposes capabilities and corrected root without requiring an existing saved world', async () => {
  const root = await fixture()
  try {
    await compatible(root)
    await rm(path.join(root, 'saves'), { recursive: true })
    const child = path.join(root, 'config/bbs/data/films'); await mkdir(child, { recursive: true })
    const { GET } = await import('../app/api/unified/bbs-install/route')
    const { issueLocalSession } = await import('../src/unifiedSession')
    const session = issueLocalSession(new Request('http://localhost/api/unified/session'))
    const cookie = session.headers.get('Set-Cookie')!.split(';')[0]!
    const response = await GET(new Request(`http://localhost/api/unified/bbs-install?gameDir=${encodeURIComponent(child)}`, { headers: { cookie } }))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.capabilities.gameDir, root); assert.equal(body.capabilities.corrected, true)
    assert.equal(body.capabilities.effectsCompatible, true); assert.deepEqual(body.worlds, [])
    assert.equal((await GET(new Request('http://localhost/api/unified/bbs-install'))).status, 401)
  } finally { await rm(root, { recursive: true, force: true }) }
})
