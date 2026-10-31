/** Disposable production-server browser acceptance; run after Studio build. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { makeEmptyDraft } from '@topview/3d-builder';
import { addLibraryCharacterToProject, placeLibraryActionForNode } from '../src/libraryCommands';
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore';
import { fixture } from './b43Fixtures';
import { libraryCharacterModel, packLibraryGlb, unpackLibraryGlb } from '../src/libraryModels';
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
        await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: (await readUnifiedProject(created.projectId)).revision, charId: data.hero.charId });
        if (true) {
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
        process.env.W01_VFX_PREVIEWS = path.join(temp, 'vfx');
        mkdirSync(path.join(process.env.W01_VFX_PREVIEWS, 'aura01'), { recursive: true });
        writeFileSync(path.join(process.env.W01_VFX_PREVIEWS, 'aura01/sheet.json'), JSON.stringify({frames:1, columns:1,rows:1,fps:20,sizeMeters:1,pivot:[.5,0],blend:'add',loop:true}));
        writeFileSync(path.join(process.env.W01_VFX_PREVIEWS, 'aura01/sheet.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
        project.extensions.vfxCues = { cues: process.env.B43_NO_CUE === '1' ? [] : [{ id:'b43-cue', effect:'aura01', frameStart:0, frameEnd:179, position:{x:0,y:0,z:0},yaw:0,scale:1 }] };
        writeFileSync(path.join(process.env.BBS_UNIFIED_PROJECTS_DIR!, created.projectId, 'project.json'), JSON.stringify(project));
        await executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: project.revision, command: 'scene.apply', args: { operations: [{ type: 'node.rename', nodeId: added.nodeId, name: 'Performance renamed' }] } });
        project = await readUnifiedProject(created.projectId);
        const port = Number(process.env.B43_SMOKE_PORT ?? 32135), base = `http://127.0.0.1:${port}`;
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
        await page.addInitScript(() => { (window as any).__name = (fn: unknown) => fn; });
        const requests: Array<{url:string; time:number}> = [];
        page.on('request', request => { const url = new URL(request.url()); if(url.pathname.startsWith('/api/')) requests.push({url:url.pathname+url.search,time:performance.now()}); });
        const errors:string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const counts = (rows: typeof requests) => ({ characters: rows.filter(r=>r.url==='/api/library?characters=1').length, raw: rows.filter(r=>r.url.startsWith('/api/library?raw=')).length, charId: rows.filter(r=>r.url.startsWith('/api/library?charId=')).length, vfxList:rows.filter(r=>r.url==='/api/unified/vfx-previews').length, vfxImages:rows.filter(r=>r.url.startsWith('/api/unified/vfx-previews/')).length });
        const ready = async () => {
          await page.waitForFunction((expected) => (window as any).__store?.getState().ready === true && (window as any).__stage?.characters?.size >= expected, Object.keys(project.characters).length, {timeout:60000});
          await page.evaluate(() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        };
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
        let start = performance.now();
        await page.goto(`${base}/?unified=${created.projectId}`);
        await ready();
        const openMs = performance.now()-start;
        const profile = await cdp.send('Profiler.stop');
        const timings = await page.evaluate(() => performance.getEntriesByType('resource').map((entry: any) => ({name: entry.name, start: entry.startTime, duration: entry.duration, size: entry.transferSize})));
        writeFileSync('/tmp/b46-cpu-profile.json', JSON.stringify(profile.profile));
        writeFileSync('/tmp/b46-resource-timings.json', JSON.stringify(timings));
        await page.waitForTimeout(1200);
        const opened = {ms:openMs,...counts(requests)};
        let offset = requests.length;
        start = performance.now();
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        await page.waitForTimeout(1200);
        const focus = {ms:performance.now()-start,...counts(requests.slice(offset))};
        await page.goto(`${base}/library?unified=${created.projectId}`);
        await page.getByRole('link',{name:'Quay lại cảnh App 2'}).waitFor();
        offset=requests.length; start=performance.now();
        await page.getByRole('link',{name:'Quay lại cảnh App 2'}).click();
        await ready();
        const returnedMs=performance.now()-start;
        await page.waitForTimeout(1200);
        const returned={ms:returnedMs,...counts(requests.slice(offset))};
        const urls = await page.evaluate(()=>[...(window as any).__store.getState().doc.content.nodes].filter((n:any)=>n.metadata?.libraryCharacterId).map((n:any)=>n.metadata.libraryCharacterId));
        const model = urls[0];
        const modelInfo = await libraryCharacterModel(model);
        const modelUrl = `${base}/api/library?modelCharacter=${model}&fingerprint=${modelInfo.fingerprint}`;
        start=performance.now(); const first=await fetch(modelUrl);await first.arrayBuffer();const modelFirstMs=performance.now()-start;
        start=performance.now();const second=await fetch(modelUrl,{headers:{'If-None-Match':`"${modelInfo.fingerprint}"`}});await second.arrayBuffer();
        const result={phase:process.env.B43_PHASE,fixture:{packs:300,assets:Object.keys(project.assets).length,libraryCharacters:2,vfxCues:process.env.B43_NO_CUE==='1'?0:1},opened,focus,returned,model:{firstMs:modelFirstMs,secondMs:performance.now()-start,secondStatus:second.status},errors,requests};
        if(process.env.B43_PHASE === 'after') {
          assert.equal(opened.characters,1); assert.equal(returned.characters,1); assert.equal(focus.characters,0);
          assert.ok(opened.raw<=1 && opened.charId<=1);
          assert.equal(opened.vfxList,process.env.B43_NO_CUE==='1'?0:1);
          assert.equal(second.status,304); assert.deepEqual(errors,[]);
        }
        console.log(JSON.stringify(result));
        if(process.env.B43_OUTPUT)writeFileSync(process.env.B43_OUTPUT,JSON.stringify(result,null,2));
    } finally { await browser?.close(); server?.kill(); if(server && server.exitCode===null) await new Promise(resolve=>server!.once('exit',resolve)); rmSync(temp,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
