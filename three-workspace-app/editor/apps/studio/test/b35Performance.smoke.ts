import { checkTimelineClipboard } from './b36TimelineSmoke';
/** Disposable production-server browser acceptance; run after Studio build. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, type Request } from 'playwright';
import { makeEmptyDraft } from '@topview/3d-builder';
import { addLibraryCharacterToProject, placeLibraryActionForNode } from '../src/libraryCommands';
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore';
import { fixture } from './b35Fixtures';
import { createShotPackage, saveShotExport } from '../src/shotExchange';
import { jsonBytes, sha256, zipPackage } from '../src/shotPackage';
import { packLibraryGlb, unpackLibraryGlb } from '../src/libraryModels';
import { stageAssetUpload } from '../src/unifiedAssetFiles';
async function main() {
    const temp = mkdtempSync(path.join(tmpdir(), 'b35-performance-'));
    process.env.W01_LIBRARY = path.join(temp, 'library');
    process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects');
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let server: ReturnType<typeof spawn> | undefined;
    let log = '';
    try {
        const data = fixture(process.env.W01_LIBRARY, temp);
        const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'B34 performance synthetic', scene: makeEmptyDraft('Performance', 30, 180, { fov: 50, position: { x: 0, y: 2, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }) } });
        const added = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: created.revision, charId: data.den.charId });
        await placeLibraryActionForNode({ projectId: created.projectId, actionUuid: data.actionUuid, nodeId: added.nodeId! });
        if (process.env.B35_PERF_SCALE === '1') {
            const source = unpackLibraryGlb(Buffer.from((await import('../../../packages/retarget/src/bobjModel')).bobjModelToGlb((await import('../../../packages/retarget/src/bobjModel')).parseBobjModel(data.bobj)).bytes));
            const initial = await readUnifiedProject(created.projectId), extraAssets = 16 - Object.keys(initial.assets).length, extraMotions = 8 - Object.keys(initial.motions).length;
            for (let index = 0; index < extraAssets; index++) {
                const json = structuredClone(source.json);
                json.asset.generator = `Synthetic padded model ${index}`;
                if (index >= extraMotions)
                    delete json.animations;
                const bin = Buffer.alloc(Math.floor(42 * 1024 * 1024 / extraAssets / 4) * 4);
                Buffer.from(source.binary).copy(bin);
                json.buffers[0].byteLength = bin.length;
                const bytes = packLibraryGlb(json, bin);
                const upload = await stageAssetUpload(`synthetic-${index}.glb`, new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }));
                let latest = await readUnifiedProject(created.projectId);
                const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: latest.revision, command: 'asset.import', args: { files: [upload.id], format: 'auto' } });
                latest = await readUnifiedProject(created.projectId);
                await executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: latest.revision, command: 'character.add', args: { assetId: (imported.result.assetIds as string[])[0], skeletonId: (imported.result.skeletonIds as string[])[0], name: `Synthetic ${index}` } });
            }
            const latest = await readUnifiedProject(created.projectId);
            latest.extensions.b35PerformancePadding = { data: '' };
            const overhead = Buffer.byteLength(JSON.stringify(latest));
            latest.extensions.b35PerformancePadding = { data: 'x'.repeat(Math.max(0, 643000 - overhead)) };
            writeFileSync(path.join(process.env.BBS_UNIFIED_PROJECTS_DIR, created.projectId, 'project.json'), JSON.stringify(latest));
        }
        let project = await readUnifiedProject(created.projectId);
        await executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: project.revision, command: 'scene.apply', args: { operations: [{ type: 'node.rename', nodeId: added.nodeId, name: 'Performance renamed' }] } });
        project = await readUnifiedProject(created.projectId);
        const port = Number(process.env.B35_SMOKE_PORT ?? 32135), base = `http://127.0.0.1:${port}`;
        server = spawn(process.execPath, [path.resolve('apps/studio/node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: path.resolve('apps/studio'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        server.stdout!.on('data', x => log += x);
        server.stderr!.on('data', x => log += x);
        for (let i = 0;; i++) {
            try {
                if ((await fetch(base)).ok)
                    break;
            }
            catch { }
            if (i > 150 || server.exitCode !== null)
                throw Error(log.slice(-4000));
            await new Promise(r => setTimeout(r, 200));
        }
        const softwareGL = process.env.B35_PERF_SOFTWARE_GL === '1' || process.platform !== 'win32';
        browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? (process.platform === 'win32' ? undefined : '/usr/bin/chromium'),
            args: ['--no-sandbox', ...(softwareGL ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])] });
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const requests: string[] = [];
        const errors: string[] = [];
        const requestDetails = new Map<Request, {path:string; command?:string; nodeStart:number; responseMs?:number; browserEpoch?:number}>();
        page.on('request', r => {
            const pathname = new URL(r.url()).pathname + new URL(r.url()).search;
            requests.push(pathname);
            if (pathname.includes('/api/unified/commands') || pathname.startsWith('/api/unified/projects/') && !pathname.includes('/assets/')) {
                let command: string | undefined;
                try { command = r.postDataJSON()?.command; } catch { /* GET */ }
                requestDetails.set(r, {path:pathname, command, nodeStart:performance.now()});
            }
        });
        page.on('requestfinished', r => {
            const detail = requestDetails.get(r);
            if (detail) { const timing = r.timing(); detail.responseMs = timing.responseEnd; detail.browserEpoch = timing.startTime; }
        });
        page.on('pageerror', e => errors.push(e.message));
        await page.addInitScript(id => {
            const target = window as any;
            // tsx keeps function names through a helper; serialized browser callbacks need it too.
            target.__name = target.__name || ((fn: unknown) => fn);
            window.addEventListener('keydown', event => {
                if (!(event.ctrlKey && event.key.toLowerCase() === 'z' && !event.shiftKey)) return;
                target.__perfUndoStageEvals = [];
                target.__perfUndoDomStart = performance.now();
                target.__perfUndoDomEpoch = performance.timeOrigin + target.__perfUndoDomStart;
                const check = () => {
                    const state = target.__store?.getState();
                    const node = state?.doc?.content.nodes.find((n:any)=>n.id===id);
                    if (state?.ready && node && node.name !== 'Performance renamed') {
                        target.__perfUndoDocReady = performance.now();
                        requestAnimationFrame(()=>requestAnimationFrame(()=>target.__perfUndoDomEnd=performance.now()));
                    } else requestAnimationFrame(check);
                };
                requestAnimationFrame(check);
            }, {capture:true, once:false});
        }, added.nodeId);
        const openStart = performance.now();
        await page.goto(`${base}/?unified=${created.projectId}`);
        await page.waitForFunction(() => (window as any).__store?.getState().ready === true, null, { timeout: 60000 });
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const openMs = performance.now() - openStart;
        await page.waitForTimeout(1000);
        if (process.env.B35_PERF_TIMELINE_CHECK === '1') { await checkTimelineClipboard(page); return; }
        const summarize = (list: string[]) => ({ total: list.length, projectJsonLoads: list.filter(x => x.includes('/api/unified/projects/') && !x.includes('/assets/')).length, assetSourceLoads: list.filter(x => /\/assets\/.*\/source/.test(x)).length, unchangedModelLoads: list.filter(x => Object.values(project.assets).some(a => a.kind === 'model' && x.includes(encodeURIComponent(a.id))) && x.includes('/source')).length, libraryCharacters: list.filter(x => x.includes('/api/library?characters=1')).length, heightProfiles: list.filter(x => x.includes('/api/library?heightCharacter=')).length, paths: list });
        let start = requests.length;
        await page.waitForTimeout(17000);
        const idle = summarize(requests.slice(start));
        await page.evaluate(() => { (window as any).__perfStore = (window as any).__store; (window as any).__perfStage = (window as any).__stage; (window as any).__perfCharacters = new Map([...(window as any).__stage.characters].map(([id, ch]: any) => [id, ch.root])); });
        if (process.env.B35_PERF_STAGE_PROFILE === '1') await page.evaluate(() => {
            const target = window as any, stage = target.__stage, original = stage.evaluate;
            stage.evaluate = function(...args: any[]) {
                const started = performance.now();
                try { return original.apply(this, args); }
                finally { if (target.__perfUndoDomStart) target.__perfUndoStageEvals.push({startAfterKeydownMs:started-target.__perfUndoDomStart,elapsedMs:performance.now()-started}); }
            };
        });
        start = requests.length;
        const undoStart = performance.now();
        await page.keyboard.press('Control+z');
        await page.waitForFunction(({ id }) => { const s = (window as any).__store?.getState(); return s?.ready && s.doc?.content.nodes.find((n: any) => n.id === id)?.name !== 'Performance renamed'; }, { id: added.nodeId }, { timeout: 60000 });
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const undoMs = performance.now() - undoStart;
        await page.waitForFunction(() => Number.isFinite((window as any).__perfUndoDomEnd));
        const undoDom = await page.evaluate(()=>({elapsedMs:(window as any).__perfUndoDomEnd-(window as any).__perfUndoDomStart, docReadyMs:(window as any).__perfUndoDocReady-(window as any).__perfUndoDomStart, twoFramesMs:(window as any).__perfUndoDomEnd-(window as any).__perfUndoDocReady, stageEvals:(window as any).__perfUndoStageEvals, epoch:(window as any).__perfUndoDomEpoch}));
        await page.waitForTimeout(300);
        const undoHttpTimings = [...requestDetails.values()].filter(d=>d.nodeStart>=undoStart).map(d=>({path:d.path,command:d.command,nodeStartAfterAutomationMs:d.nodeStart-undoStart,browserStartAfterKeydownMs:d.browserEpoch===undefined?undefined:d.browserEpoch-undoDom.epoch,responseMs:d.responseMs}));
        const undo = { elapsedMs: undoMs, domKeydownToViewMs:undoDom.elapsedMs, domKeydownToDocReadyMs:undoDom.docReadyMs, postDocTwoFramesMs:undoDom.twoFramesMs, stageEvaluations:undoDom.stageEvals, httpTimings:undoHttpTimings, ...summarize(requests.slice(start)), ...await page.evaluate(() => ({ sameStore: (window as any).__perfStore === (window as any).__store, sameStage: (window as any).__perfStage === (window as any).__stage, sameModelInstances: [...(window as any).__perfCharacters].every(([id, root]: any) => (window as any).__stage.characters.get(id)?.root === root) })) };
        await page.goto(`${base}/library?unified=${created.projectId}`);
        await page.getByRole('link', { name: 'Quay lại cảnh App 2' }).waitFor();
        start = requests.length;
        const libraryReturnStart = performance.now();
        await page.getByRole('link', { name: 'Quay lại cảnh App 2' }).click();
        await page.waitForFunction(() => (window as any).__store?.getState().ready === true, null, { timeout: 60000 });
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const libraryReturn = { elapsedMs: performance.now() - libraryReturnStart, ...summarize(requests.slice(start)) };
        await page.evaluate(() => { (window as any).__perfStore = (window as any).__store; (window as any).__perfStage = (window as any).__stage; (window as any).__perfCharacters = new Map([...(window as any).__stage.characters].map(([id, ch]: any) => [id, ch.root])); });
        project = await readUnifiedProject(created.projectId);
        const built = await createShotPackage(project, { cameraNodeId: project.scene.content.nodes.find(n => n.type === 'camera')!.id, frameStart: project.scene.content.timeline.animation.motionClips[0]!.frameStart, frameEnd: project.scene.content.timeline.animation.motionClips[0]!.frameEnd, editableCharacterIds: [String(added.characterId)] });
        await saveShotExport(project, built);
        const character = built.shot.characters[0]!;
        const original = Buffer.from(built.files[character.glb]!);
        const { json, binary } = unpackLibraryGlb(original);
        const channel = json.animations[0].channels[0];
        const sampler = json.animations[0].samplers[channel.sampler];
        const accessor = json.accessors[sampler.output];
        const view = json.bufferViews[accessor.bufferView];
        const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
        const editedBinary = Buffer.from(binary);
        if (channel.target.path === 'rotation') {
            const values = Array.from({ length: 4 }, (_, i) => editedBinary.readFloatLE(offset + i * 4));
            values[0]! += 0.01;
            const norm = Math.hypot(...values);
            values.forEach((v, i) => editedBinary.writeFloatLE(v / norm, offset + i * 4));
        }
        else {
            editedBinary.writeFloatLE(editedBinary.readFloatLE(offset) + 0.01, offset);
        }
        const edited = packLibraryGlb(json, editedBinary), motionId = randomUUID(), hash = sha256(edited);
        assert.notEqual(hash, sha256(original));
        const manifest = JSON.parse(Buffer.from(built.files[character.manifest]!).toString());
        manifest.glbSha256 = hash;
        manifest.actions = [{ ...manifest.actions.find((a: any) => a.uuid === character.actionUuid), uuid: motionId, originalActionUuid: character.actionUuid, glbAnimationIndex: 0 }];
        const shotResult = { version: '1.0.0', shotId: built.shot.shotId, baseShotSha256: sha256(built.files['shot.json']!), edits: [{ characterId: character.characterId, originalActionUuid: character.actionUuid, newActionUuid: motionId, glb: 'edit.glb', manifest: 'edit.json', glbSha256: hash, placementKeys: [{ frame: 0, position: [0, 0, 0], yawDegrees: 0 }] }] };
        const zip = zipPackage({ 'result.json': jsonBytes(shotResult), 'edit.glb': edited, 'edit.json': jsonBytes(manifest) });
        let upload = process.env.B35_PERF_UPLOAD_HTTP === '1' ? { id: '' } : await stageAssetUpload('result.zip', new ReadableStream({ start(c) { c.enqueue(zip); c.close(); } }));
        await page.getByRole('button', { name: /^Animation$|^Hoạt họa$/ }).first().click();
        await page.waitForTimeout(1000);
        start = requests.length;
        const uploadStart = performance.now();
        if (process.env.B35_PERF_UPLOAD_HTTP === '1') {
            const uploadId = await page.evaluate(async (bytes) => { const response = await fetch('/api/unified/uploads', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent('result.zip') }, body: new Uint8Array(bytes) }); const result = await response.json(); if (!response.ok)
                throw Error(JSON.stringify(result)); return result.uploadId as string; }, Array.from(zip));
            upload = { id: uploadId };
        }
        const returnStart = performance.now();
        const imported = await page.evaluate(async ({ projectId, revision, file, shotId }) => { const response = await fetch('/api/unified/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), projectId, expectedRevision: revision, command: 'shot.result.import', args: { file, shotId } }) }); const result = await response.json(); if (!response.ok)
            throw Error(JSON.stringify(result)); window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } })); return result; }, { projectId: created.projectId, revision: project.revision, file: upload.id, shotId: built.shot.shotId });
        assert.ok(imported);
        await page.getByRole('button', { name: 'Dựng cảnh', exact: true }).click();
        await page.waitForFunction(() => (window as any).__store?.getState().ready === true && !!document.querySelector('.wb-unified-scene canvas'), null, { timeout: 60000 });
        await page.waitForFunction(id => JSON.stringify((window as any).__store?.getState().doc).includes(id) && !!(window as any).__stage?.motionPlayer?.getRaw?.(id, 0), motionId, { timeout: 60000 });
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const returnMs = performance.now() - returnStart;
        const uploadAndReturnMs = process.env.B35_PERF_UPLOAD_HTTP === '1' ? performance.now() - uploadStart : undefined;
        await page.waitForTimeout(300);
        assert.deepEqual(errors, []);
        const result = { phase: process.env.B35_PERF_PHASE ?? 'baseline', projectOpenMs: openMs, libraryReturn, fixture: { libraryPacks: process.env.B35_PERF_SCALE === '1' ? 300 : 1, projectBytes: Buffer.byteLength(JSON.stringify(project)), assetSourceBytes: Object.values(project.assets).reduce((sum, a) => sum + a.source.byteLength, 0), assets: Object.keys(project.assets).length, motions: Object.keys(project.motions).length, characters: Object.keys(project.characters).length }, idle, undo, workspaceReturn: { elapsedMs: returnMs, uploadAndReturnElapsedMs: uploadAndReturnMs, editedZipBytes: zip.byteLength, timingBoundary: 'elapsedMs: POST shot.result.import through loaded motion + 2 frames; optional uploadAndReturnElapsedMs: HTTP ZIP upload through same endpoint; ZIP generation/native editor export excluded', ...summarize(requests.slice(start)), ...await page.evaluate(() => ({ sameStore: (window as any).__perfStore === (window as any).__store, sameStage: (window as any).__perfStage === (window as any).__stage, sameModelInstances: [...(window as any).__perfCharacters].every(([id, root]: any) => (window as any).__stage.characters.get(id)?.root === root) })) }, errors, newMotionId: motionId, limits: `Synthetic ${process.env.B35_PERF_SCALE === '1' ? '643KB,16 assets with 42MiB unused BIN padding (byte-size stress, NOT equivalent geometry complexity)' : 'small fixture'}; genuine shot.result.import with changed animation sample and workspace switch; real Tap15 NOT_RUN` };
        if (process.env.B35_PERF_PHASE === 'after') {
            let offset = requests.length;
            await page.evaluate(() => window.dispatchEvent(new CustomEvent('bbs-library-character-profile-changed', { detail: { charId: 'unrelated-character' } })));
            await page.waitForTimeout(250);
            const unrelated = summarize(requests.slice(offset));
            offset = requests.length;
            const relevantResponse = page.waitForResponse(r => r.url().includes('/api/library?heightCharacter='));
            await page.evaluate(charId => window.dispatchEvent(new CustomEvent('bbs-library-character-profile-changed', { detail: { charId } })), data.den.charId);
            await relevantResponse;
            await page.waitForTimeout(100);
            const relevant = summarize(requests.slice(offset));
            Object.assign(result, { profileNotifications: { unrelated, relevant } });
            assert.equal(unrelated.heightProfiles, 0);
            assert.equal(relevant.heightProfiles, 1);
        }
        if (process.env.B35_PERF_DRAWER_CHECK === '1') {
            const preflights = () => [...requestDetails.values()].filter(item => item.command === 'film.preflight').length;
            const beforeOpen = preflights();
            const checked = page.waitForResponse(response => {
                try { return response.url().endsWith('/api/unified/commands') && response.request().postDataJSON()?.command === 'film.preflight'; }
                catch { return false; }
            });
            await Promise.all([checked, page.locator('.wb-unified-topbar .wb-host-primary').click()]);
            assert(preflights() > beforeOpen, 'opening export validates the current selection');
            await page.locator('.wb-drawer-export').getByRole('button', { name: /Close panel|Đóng bảng/ }).click();
            const beforeHiddenChange = preflights();
            const latest = await readUnifiedProject(created.projectId);
            await executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: latest.revision,
                command: 'scene.apply', args: { operations: [{ type: 'node.rename', nodeId: added.nodeId, name: 'Hidden preflight check' }] } });
            await page.evaluate(id => window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId: id } })), created.projectId);
            await page.waitForTimeout(750);
            assert.equal(preflights(), beforeHiddenChange, 'closed export panel does not validate unrelated edits');
            assert.deepEqual(errors, []);
            Object.assign(result, { exportDrawer: { openedPreflights: beforeHiddenChange - beforeOpen, hiddenEditPreflights: preflights() - beforeHiddenChange } });
            console.log(JSON.stringify({ exportDrawer: 'PASS', openedPreflights: beforeHiddenChange - beforeOpen, hiddenEditPreflights: preflights() - beforeHiddenChange }));
        }
        writeFileSync(process.env.B35_PERF_OUTPUT ?? path.join(tmpdir(), 'b35-performance.json'), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result));
        if (process.env.B35_PERF_ASSERT === '1') {
            assert.equal(idle.libraryCharacters, 0);
            assert.equal(idle.heightProfiles, 0);
            assert.equal(undo.sameStage, true);
            assert.equal(undo.sameModelInstances, true);
            assert.equal(undo.unchangedModelLoads, 0);
            assert.equal(result.workspaceReturn.unchangedModelLoads, 0);
            assert.equal(result.workspaceReturn.sameStage, true);
            assert(undo.elapsedMs < 300);
            assert(returnMs < 2000);
            if (process.env.B35_PERF_UPLOAD_HTTP === '1') assert(uploadAndReturnMs !== undefined && uploadAndReturnMs < 2000);
        }
    }
    finally {
        await browser?.close();
        if (process.env.B35_PERF_SERVER_LOG) writeFileSync(process.env.B35_PERF_SERVER_LOG, log);
        if (server) {
            server.kill('SIGTERM');
            await new Promise<void>(resolve => { if (server!.exitCode !== null || server!.signalCode !== null) resolve(); else server!.once('exit', () => resolve()); });
        }
        rmSync(temp, { recursive: true, force: true });
    }
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
