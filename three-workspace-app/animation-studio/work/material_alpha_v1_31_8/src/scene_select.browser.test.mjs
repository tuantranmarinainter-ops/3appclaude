import { browserOptions } from './browser_test_options.mjs';
import { useClassicLayout } from './classic_test_layout.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { buildSceneShot } from './scene_shot_fixture.mjs';

const artifact = fileURLToPath(
  new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url),
);
const { chromium } = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
)('playwright');

test(
  'Cả cảnh S3: click select, per-character keys/undo, dimmed viewers, edited viewers keep playing, onion, stress',
  { skip: !existsSync(artifact), timeout: 300000 },
  async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(readFileSync(artifact));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch(browserOptions({ headless: true }));
    const errors = [];
    const report = {};
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => d.accept());
      await useClassicLayout(page);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__studio?.ready);
      await page.evaluate(
        async ({ src, args }) => {
          const { files } = await new Function('return ' + src)()(args);
          await window.__studio.shot.openFiles(files);
        },
        { src: buildSceneShot.toString(), args: { count: 3, aspect: 2, names: ['Gỗ Xưa', 'Đen', 'Xanh'] } },
      );
      const SS = (fn, arg) =>
        page.evaluate(new Function('arg', 'const SS=window.__studio.sceneShot,S=window.__studio;return (' + fn + ')(arg)'), arg);
      const settle = () => page.waitForFunction(() => !window.__studio.sceneShot.switching);
      const waitEditing = async (id) => {
        await page
          .waitForFunction(
            (x) => window.__studio.sceneShot.editing() === x && !window.__studio.sceneShot.switching,
            id,
            { timeout: 20000 },
          )
          .catch(async (e) => {
            throw Error(e.message + ' status=' + (await page.evaluate(() => document.getElementById('status')?.textContent)) + ' errors=' + errors.join('|'));
          });
        await page.waitForFunction((x) => window.__studio.sceneShot.editing() === x && !window.__studio.sceneShot.switching, id);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      };
      const edit = (arg) =>
        SS(
          `(a)=>{S.seek(a.t);const id=S.rig().records.find(r=>r.name==='mixamorig:'+a.bone).id;S.select(id);
           const e=document.getElementById('rz');e.value=String(a.deg);e.dispatchEvent(new Event('change',{bubbles:true}));
           document.getElementById('keyBtn').click();return SS.keysHash(SS.editing());}`,
          arg,
        );
      const bones = (id, t) =>
        SS(`(a)=>{SS.setTime(a.t);const s=SS.sample().find(x=>x.characterId===a.id);return s.bones}`, { id, t });
      const maxDiff = (a, b) => {
        let worst = 0;
        for (const k of Object.keys(a)) a[k].forEach((v, i) => (worst = Math.max(worst, Math.abs(v - b[k][i]))));
        return worst;
      };

      assert.equal(await SS('()=>SS.editing()'), 'char0');
      assert.equal(await page.locator('#sceneEditingLabel').textContent(), 'Đang sửa: Gỗ Xưa');
      assert.equal(await page.locator('#sceneCharacterList [data-character-id]').count(), 3);
      const A0 = await SS('()=>SS.keysHash("char0")');
      assert.deepEqual(await SS('()=>SS.edited()'), []);

      // 1) edit A at frame 30
      const h0 = await SS('()=>S.state.historyIndex');
      const A1 = await edit({ t: 1, bone: 'LeftArm', deg: 70 });
      const hEdit = await SS('()=>S.state.historyIndex');
      assert.notEqual(A1, A0);
      assert.deepEqual(await SS('()=>SS.edited()'), ['char0']);
      const aPose = await bones('char0', 1);

      // 2) click B in 3D (projected position of its spine bone), real mouse events
      // Screen position of a bone that is really clickable: the canvas (no DOM rig label on top) and the nearest hit is `id`.
      const where = (id) =>
        SS(
          `(id)=>{const e=SS.registry.get(id),root=e.editing?e.rig.root:e.viewer.root;root.updateMatrixWorld(true);
           const v=S.editorViews()[0],c=v.camera;c.updateMatrixWorld(true);const r=v.renderer.domElement.getBoundingClientRect();
           for(const n of ['Spine1','Spine2','Hips','Spine','Neck','LeftUpLeg','RightUpLeg','LeftArm','RightArm']){
             let p=null;root.traverse(o=>{if(o.isBone&&o.name==='mixamorig:'+n)p=o.getWorldPosition(S.rig().root.position.clone())});
             if(!p)continue;p.project(c);const x=r.left+(p.x+1)/2*r.width,y=r.top+(1-p.y)/2*r.height;
             const top=document.elementFromPoint(x,y),hits=SS.hitsAt(x,y).sort((a,b)=>a.distance-b.distance);
             if(top===v.renderer.domElement&&hits[0]&&hits[0].characterId===id)return {x,y,bone:n,hits};}
           return null}`,
          id,
        );
      const w1 = await where('char1');
      assert.ok(w1, 'a clickable point on char1');
      // an orbit drag must not switch
      await page.mouse.move(w1.x, w1.y);
      await page.mouse.down();
      await page.mouse.move(w1.x + 40, w1.y + 10, { steps: 5 });
      await page.mouse.up();
      assert.equal(await SS('()=>SS.editing()'), 'char0', 'drag does not switch');
      await page.waitForTimeout(1500); // orbit damping settles
      const w1b = await where('char1');
      assert.ok(w1b);
      const t0 = Date.now();
      await page.mouse.click(w1b.x, w1b.y);
      await waitEditing('char1');
      report.firstSwitchWallMs = Date.now() - t0;
      report.firstSwitchMs = await SS('()=>SS.lastSwitchMs');
      assert.equal(await SS('()=>SS.keysHash("char0")'), A1, 'A keys unchanged after switching away');
      const aAfter = await bones('char0', 1);
      report.viewerEditedPoseDiff = maxDiff(aPose, aAfter);
      assert.ok(report.viewerEditedPoseDiff < 1e-4, 'A viewer shows edited pose: ' + report.viewerEditedPoseDiff);
      assert.ok(await SS('()=>SS.stats().characters===3'));
      const look = await SS(`()=>{
        const opac=(root)=>{const o=[];root.traverse(m=>{if(m.isMesh&&m.material)for(const x of [].concat(m.material))o.push([x.opacity,x.transparent])});return o};
        const A=SS.registry.get('char0'),B=SS.registry.get('char1');
        return {A:opac(A.viewer.root),Avis:A.viewer.group.visible,Bvis:B.viewer.group.visible,B:opac(S.rig().root),
          label:document.getElementById('sceneEditingLabel').textContent,
          rows:[...document.querySelectorAll('#sceneCharacterList [data-character-id]')].map(r=>[r.dataset.characterId,r.classList.contains('active'),r.textContent])}}`);
      assert.ok(look.A.length && look.A.every(([o, t]) => o === 0.5 && t), 'A dimmed');
      assert.ok(look.B.length && look.B.every(([o]) => o === 1), 'editing rig normal');
      assert.equal(look.Avis, true);
      assert.equal(look.Bvis, false);
      assert.equal(look.label, 'Đang sửa: Đen');
      assert.deepEqual(look.rows, [['char0', false, 'Gỗ Xưa●'], ['char1', true, 'Đen'], ['char2', false, 'Xanh']]);
      // B was baked from its own GLB clip on first switch: its first key frame matches the viewer's F2 clip pose.
      // (editing B at t=0 equals B's hidden viewer at t=0)
      const bEdit0 = await bones('char1', 0);
      const bView0 = await SS(`()=>{const e=SS.registry.get('char1'),keep=[e.group,e.root];
        e.editing=false;e.group=e.viewer.group;e.root=e.viewer.root;e.viewer.group.visible=true;
        SS.setTime(0);const b=SS.sample().find(x=>x.characterId==='char1').bones;
        e.viewer.group.visible=false;e.editing=true;e.group=keep[0];e.root=keep[1];return b}`);
      report.bakedVsF2 = maxDiff(bEdit0, bView0);
      assert.ok(report.bakedVsF2 < 1e-3, 'baked B equals F2 clip: ' + report.bakedVsF2);

      // 3) edit B; A stays
      const B0 = await SS('()=>SS.keysHash("char1")');
      const B1 = await edit({ t: 0.5, bone: 'RightArm', deg: -60 });
      assert.notEqual(B1, B0);
      assert.deepEqual(await SS('()=>SS.edited()'), ['char0', 'char1']);
      assert.equal(await SS('()=>SS.keysHash("char0")'), A1);

      // 4) onion: only the editing character gets ghosts
      const onion = await SS(`()=>{const set=(id,v)=>{const e=document.getElementById(id);if(e.type==='checkbox')e.checked=v;else e.value=v;e.dispatchEvent(new Event('change'))};
        set('onionEnabled',true);set('onionBefore','2');set('onionAfter','2');set('onionStep','3');set('onionParts','bones');return 1}`);
      await page.waitForFunction(() => window.__studio.onion().samples.length > 0);
      const ghosts = await SS(`()=>{const o=S.onion();const viewerRoots=SS.registry.viewers().map(e=>e.viewer.group);
        let inViewer=0;o.group.traverse(x=>{for(let p=x;p;p=p.parent)if(viewerRoots.includes(p))inViewer++});
        return {samples:o.samples.length,slots:o.slots.length,inViewer,sameScene:o.group.parent===S.editorViews()[0].scene||!!o.group.parent}}`);
      assert.ok(ghosts.slots > 0 && ghosts.inViewer === 0, JSON.stringify(ghosts));
      await SS(`()=>{const e=document.getElementById('onionEnabled');e.checked=false;e.dispatchEvent(new Event('change'));return 1}`);

      // 5) back to A through the left list: edit intact, Ctrl+Z undoes only A's edit
      await page.locator('#sceneCharacterList [data-character-id=char0]').click();
      await waitEditing('char0');
      assert.equal(await SS('()=>SS.keysHash("char0")'), A1, 'A edit intact');
      assert.equal(await SS('()=>SS.keysHash("char1")'), B1);
      const bPose = await bones('char1', 0.5);
      await page.mouse.move(5, 5);
      for (let i = 0; i < 12 && (await SS('()=>S.state.historyIndex')) > h0; i++) await page.keyboard.press('Control+z');
      assert.equal(await SS('()=>S.state.historyIndex'), h0);
      assert.equal(await SS('()=>SS.keysHash("char0")'), A0, 'Ctrl+Z restored A baseline');
      assert.equal(await SS('()=>SS.keysHash("char1")'), B1, 'B untouched by A undo');
      assert.deepEqual(await SS('()=>SS.edited()'), ['char1']);
      assert.ok(maxDiff(bPose, await bones('char1', 0.5)) < 1e-6, 'B viewer pose unchanged');
      for (let i = 0; i < 12 && (await SS('()=>S.state.historyIndex')) < hEdit; i++) await page.keyboard.press('Control+Shift+z');
      assert.equal(await SS('()=>SS.keysHash("char0")'), A1, 'redo restores A edit');
      // B's own undo is independent: B still has its edit
      await SS('(()=>SS.select("char1"))');
      await waitEditing('char1');
      assert.equal(await SS('()=>SS.keysHash("char1")'), B1);
      assert.equal(await SS('()=>SS.keysHash("char0")'), A1);
      // 6) shotExport follows the editing character; then a click on its own body/widgets never switches
      const exp = await page.evaluate(async () => {
        const files = await window.__studio.shot.exportFiles();
        const r = JSON.parse(new TextDecoder().decode(files['result.json']));
        return r.edits.map((e) => e.characterId);
      });
      assert.deepEqual(exp, ['char1']);
      const own = await where('char1');
      assert.ok(own);
      await page.mouse.click(own.x, own.y);
      await page.waitForTimeout(200);
      assert.equal(await SS('()=>SS.editing()'), 'char1');
      // That click landed on the selected bone's gizmo and left an uncommitted pose (draft): a switch is now refused
      // (it used to discard it silently); discard it with Undo first.
      if (await SS('()=>S.state.draft')) {
        assert.match(await SS(`async()=>{try{await SS.select('char0');return ''}catch(e){return e.message}}`), /chưa ghi key/);
        await SS(`()=>document.getElementById('undoBtn').click()`);
      }
      assert.equal(await SS('()=>S.state.draft'), false);

      // 7) stress A -> B -> A, 10 times: A keys identical every time
      const hashes = [],
        times = [];
      await SS('()=>SS.select("char0")');
      await waitEditing('char0');
      for (let i = 0; i < 10; i++) {
        await SS('()=>SS.select("char1")');
        times.push(await SS('()=>SS.lastSwitchMs'));
        hashes.push(await SS('()=>SS.keysHash("char0")'));
        await SS('()=>SS.select("char0")');
        times.push(await SS('()=>SS.lastSwitchMs'));
        hashes.push(await SS('()=>SS.keysHash("char0")'));
        assert.equal(await SS('()=>SS.keysHash("char1")'), B1);
      }
      assert.ok(hashes.every((h) => h === A1), 'A hash stable: ' + hashes.join());
      report.switchMsMean = times.reduce((a, b) => a + b, 0) / times.length;
      report.switchMsMax = Math.max(...times);
      assert.deepEqual(await SS('()=>S.project().keys===undefined||SS.keysHash("char0")'), A1);
      // bridge dirty: edited characters keep the page dirty even when the editing one is at baseline
      assert.equal(await SS('()=>SS.anyEdited()'), true);
      assert.deepEqual(errors, []);
      console.log('S3 report', JSON.stringify(report));
    } finally {
      await browser.close();
      server.close();
    }
  },
);

test(
  'Cả cảnh S3 review fixes: pinned bridge identity, rest-pose re-entry, draft/read-only/Lab guards, saved baseline, rollback, click rules',
  { skip: !existsSync(artifact), timeout: 300000 },
  async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(readFileSync(artifact));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch(browserOptions({ headless: true }));
    const errors = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => d.accept());
      await useClassicLayout(page);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__studio?.ready);
      await page.evaluate(
        async ({ src, args }) => {
          const { files } = await new Function('return ' + src)()(args);
          await window.__studio.shot.openFiles(files);
        },
        { src: buildSceneShot.toString(), args: { count: 3, aspect: 2, names: ['A', 'B', 'C'] } },
      );
      const SS = (fn, arg) =>
        page.evaluate(new Function('arg', 'const SS=window.__studio.sceneShot,S=window.__studio;return (' + fn + ')(arg)'), arg);
      const rejects = (id) =>
        SS(`async(id)=>{try{await SS.select(id);return null}catch(e){return e.message}}`, id);
      const waitEditing = async (id) => {
        await page.waitForFunction(
          (x) => window.__studio.sceneShot.editing() === x && !window.__studio.sceneShot.switching,
          id,
          { timeout: 20000 },
        );
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      };
      const go = async (id) => {
        await SS('(id)=>SS.select(id)', id);
        await waitEditing(id);
      };
      const edit = (arg) =>
        SS(
          `(a)=>{S.seek(a.t);const id=S.rig().records.find(r=>r.name==='mixamorig:'+a.bone).id;S.select(id);
           const e=document.getElementById('rz');e.value=String(a.deg);e.dispatchEvent(new Event('change',{bubbles:true}));
           if(a.key)document.getElementById('keyBtn').click();return SS.keysHash(SS.editing())}`,
          arg,
        );
      const pin = () =>
        SS(`()=>{const p=SS.bridgePin();return JSON.stringify({id:p.characterId,act:p.actionUuid,sha:p.glbSha256,rig:p.rig,root:p.rootUuid,slot:p.slot,ar:p.activeRoot,
          firstRig:p.rigObject===SS.registry.get(p.characterId).rig&&S.shot.session!==null})}`);
      const ikSig = () =>
        SS(`()=>{const r=S.rig(),num=[];const push=(v)=>{if(Array.isArray(v))v.forEach(push);else if(v&&typeof v==='object'){if(typeof v.toArray==='function')push(v.toArray());else Object.keys(v).sort().forEach(k=>push(v[k]))}else if(typeof v==='number')num.push(v)};
          push(Object.keys(r.controls).sort().map(k=>r.controls[k].rest));
          r.chains.forEach(c=>{push(c.baseB);push(c.baseE);push(c.bendMemory)});return {n:num,w:r.warnings.length,c:Object.keys(r.controls).length}}`);
      const sigDiff = (a, b) => {
        assert.equal(a.n.length, b.n.length);
        assert.equal(a.c, b.c);
        return a.n.reduce((m, v, i) => Math.max(m, Math.abs(v - b.n[i])), 0);
      };

      // ---- 1) bridge pin is frozen at open; the session's editing character follows the switch
      const pin0 = await pin();
      assert.equal(JSON.parse(pin0).id, 'char0');
      assert.equal(JSON.parse(pin0).firstRig, true);
      const ikA0 = await ikSig();
      assert.ok(ikA0.n.length > 0 && ikA0.c > 0);
      const A0 = await SS('()=>SS.keysHash("char0")');

      // ---- 2) re-entry resets the rig: pose A at t=1, visit B (posed), return: IK rest/base equal to the first visit
      const A1 = await edit({ t: 1, bone: 'LeftArm', deg: 70, key: true });
      assert.notEqual(A1, A0);
      await go('char1');
      assert.equal(await pin(), pin0, 'bridge pin unchanged after switching to B');
      assert.equal(await SS('()=>S.shot.session.character.characterId'), 'char1', 'session follows editing (export)');
      const ikB0 = await ikSig();
      await edit({ t: 1, bone: 'RightArm', deg: -50, key: true });
      await go('char0');
      assert.equal(await pin(), pin0, 'bridge pin unchanged after returning to A');
      assert.equal(await SS('()=>S.shot.session.character.characterId'), 'char0');
      const ikA2 = await ikSig();
      // A's very first install ran before the scene scale hint existed (pole controls scale with it), so the reference for
      // "same as a first visit" is B (first visit through a switch) and A's own later visits.
      assert.equal(ikA2.w, ikA0.w, 'no duplicated rig warnings on re-install');
      await go('char1');
      const ikB2 = await ikSig();
      assert.ok(sigDiff(ikB0, ikB2) < 1e-6, 'B rest/base after B->A->B equals first visit: ' + sigDiff(ikB0, ikB2));
      assert.equal(ikB2.w, ikB0.w);
      assert.equal(await pin(), pin0);
      await go('char0');
      const ikA3 = await ikSig();
      assert.ok(sigDiff(ikA2, ikA3) < 1e-6, 'A rest/base identical on every later visit: ' + sigDiff(ikA2, ikA3));
      assert.equal(ikA3.w, ikA0.w);

      // ---- 3) uncommitted draft pose blocks a switch (list click too)
      await edit({ t: 0.5, bone: 'Spine', deg: 25, key: false });
      assert.equal(await SS('()=>S.state.draft'), true);
      assert.match(await rejects('char1'), /chưa ghi key/);
      await page.locator('#sceneCharacterList [data-character-id=char1]').click();
      await page.waitForTimeout(300);
      assert.equal(await SS('()=>SS.editing()'), 'char0');
      assert.match(await page.locator('#status').textContent(), /chưa ghi key/);
      await page.evaluate(() => document.getElementById('keyBtn').click());
      assert.equal(await SS('()=>S.state.draft'), false);

      // ---- 4) dirty vs edited: markSaved re-baselines "saved" only
      assert.equal(await SS('()=>SS.anyDirty()'), true);
      const edited = await SS('()=>SS.edited()');
      assert.deepEqual(edited, ['char0', 'char1']);
      assert.equal(await SS('()=>SS.markSaved()'), true);
      assert.equal(await SS('()=>SS.anyDirty()'), false, 'saved: not dirty (including the non-editing character)');
      assert.deepEqual(await SS('()=>SS.edited()'), edited, 'edited mark / export criterion unchanged by saving');
      assert.equal(await SS('()=>SS.anyEdited()'), true);
      await edit({ t: 0.25, bone: 'Neck', deg: 10, key: true });
      assert.deepEqual(await SS('()=>SS.dirty()'), ['char0']);
      await SS('()=>SS.markSaved()');
      assert.equal(await SS('()=>SS.anyDirty()'), false);
      await go('char2'); // first visit of C; nothing edited there
      assert.equal(await SS('()=>SS.anyDirty()'), false);
      await go('char0');

      // ---- 5) Motion Lab and "Dựng cảnh" (read-only) refuse the switch
      await SS(`()=>S.switchStudioMode('lab')`);
      assert.match(await rejects('char1'), /Animation Lab/);
      assert.equal(await SS('()=>SS.editing()'), 'char0');
      await SS(`()=>S.switchStudioMode('classic')`);
      await page.evaluate(() => document.getElementById('sceneStudioBtn').click());
      await page.waitForFunction(() => document.getElementById('sceneStudioBtn') && window.__studio.scene.context().ready !== false);
      const sceneMsg = await rejects('char1');
      await SS(`()=>S.scene.exit()`);
      assert.match(sceneMsg ?? '', /Dựng cảnh/);
      assert.equal(await SS('()=>SS.editing()'), 'char0');

      // ---- 6) partial failure: install() throws after mounting the retained rig -> previous character restored
      const before = await SS(`()=>({h:SS.keysHash('char0'),rig:S.rig()===SS.registry.get('char0').rig,hist:S.state.historyIndex,
        children:S.editorViews()[0].wrapper.children.length,edited:SS.edited()})`);
      await SS(`()=>{const e=SS.registry.get('char1');window.__armatures=e.rig.armatures;e.rig.armatures=null;return 1}`);
      const failed = await rejects('char1');
      assert.ok(failed, 'switch rejects when install throws');
      assert.equal(await SS('()=>SS.editing()'), 'char0');
      const after = await SS(`()=>({h:SS.keysHash('char0'),rig:S.rig()===SS.registry.get('char0').rig,hist:S.state.historyIndex,
        children:S.editorViews()[0].wrapper.children.length,edited:SS.edited(),
        b1:S.editorViews()[0].wrapper.children.includes(SS.registry.get('char1').rig.root),switching:SS.switching,
        viewer1:SS.registry.get('char1').viewer.group.visible,viewer0:SS.registry.get('char0').viewer.group.visible})`);
      assert.equal(after.h, before.h);
      assert.equal(after.rig, true, 'previous rig is the installed rig again');
      assert.equal(after.hist, before.hist);
      assert.equal(after.children, before.children, 'no leaked controls/rig in the view');
      assert.equal(after.b1, false);
      assert.equal(after.switching, false);
      assert.equal(after.viewer1, true);
      assert.equal(after.viewer0, false);
      assert.deepEqual(after.edited, before.edited);
      await SS(`()=>{SS.registry.get('char1').rig.armatures=window.__armatures;return 1}`);
      await go('char1'); // retained rig still usable
      assert.equal(await pin(), pin0);
      await go('char0');

      // ---- 7) click rules
      const where = (id) =>
        SS(
          `(id)=>{const e=SS.registry.get(id),root=e.editing?e.rig.root:e.viewer.root;root.updateMatrixWorld(true);
           const v=S.editorViews()[0],c=v.camera;c.updateMatrixWorld(true);const r=v.renderer.domElement.getBoundingClientRect();
           for(const n of ['Spine1','Spine2','Hips','Spine','Neck','LeftUpLeg','RightUpLeg','LeftArm','RightArm']){
             let p=null;root.traverse(o=>{if(o.isBone&&o.name==='mixamorig:'+n)p=o.getWorldPosition(S.rig().root.position.clone())});
             if(!p)continue;p.project(c);const x=r.left+(p.x+1)/2*r.width,y=r.top+(1-p.y)/2*r.height;
             const top=document.elementFromPoint(x,y),hits=SS.hitsAt(x,y).sort((a,b)=>a.distance-b.distance);
             if(top===v.renderer.domElement&&hits[0]&&hits[0].characterId===id)return {x,y,bone:n,d:hits[0].distance};}
           return null}`,
          id,
        );
      // (a) a click that selects a bone sphere over another character's mesh does not switch
      const w1 = await where('char1');
      assert.ok(w1);
      await SS(
        `(a)=>{const v=S.editorViews()[0],cam=v.camera;cam.updateMatrixWorld(true);
          const r=v.renderer.domElement.getBoundingClientRect(),V=cam.position.constructor;
          const dir=new V((a.x-r.left)/r.width*2-1,-((a.y-r.top)/r.height*2-1),0.5).unproject(cam).sub(cam.position).normalize();
          const n=v.nodes[0].clone();n.userData={boneId:S.rig().records[3].id};n.position.copy(cam.position).addScaledVector(dir,a.d-0.05);
          n.scale.setScalar(0.04);n.visible=true;v.nodes.push(n);window.__stub=n;window.__stubBone=n.userData.boneId;return 1}`,
        w1,
      );
      await page.mouse.click(w1.x, w1.y);
      await page.waitForTimeout(300);
      assert.equal(await SS('()=>SS.editing()'), 'char0', 'bone click over char1 does not switch');
      assert.equal(await SS('()=>S.state.selected===window.__stubBone'), true, 'the bone was selected');
      await SS(`()=>{const v=S.editorViews()[0];v.nodes.splice(v.nodes.indexOf(window.__stub),1);return 1}`);
      // (b) the editing character's hidden meshes still occlude (bones-only display)
      const w0 = await where('char0');
      assert.ok(w0);
      await SS(`()=>{window.__hid=[];S.rig().root.traverse(o=>{if(o.isMesh&&o.visible&&!o.userData.boneId){o.visible=false;window.__hid.push(o)}});return window.__hid.length}`);
      const hits = await SS('(a)=>SS.hitsAt(a.x,a.y)', w0);
      assert.ok(hits.some((h) => h.editing), 'hidden editing mesh still raycast: ' + JSON.stringify(hits));
      assert.equal(await SS('(a)=>SS.pickAt(a.x,a.y)', w0), null);
      await SS(`()=>{window.__hid.forEach(o=>{o.visible=true});return 1}`);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.close();
    }
  },
);

test(
  'Cả cảnh S3 root-ring yield: a viewer inside the editing rig root ring is clickable, ring stroke and IK widgets keep priority',
  { skip: !existsSync(artifact), timeout: 300000 },
  async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(readFileSync(artifact));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch(browserOptions({ headless: true }));
    const errors = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => d.accept());
      await useClassicLayout(page);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__studio?.ready);
      await page.evaluate(
        async ({ src, args }) => {
          const { files } = await new Function('return ' + src)()(args);
          await window.__studio.shot.openFiles(files);
        },
        { src: buildSceneShot.toString(), args: { count: 2, aspect: 2, names: ['A', 'B'] } },
      );
      const SS = (fn, arg) =>
        page.evaluate(new Function('arg', 'const SS=window.__studio.sceneShot,S=window.__studio;return (' + fn + ')(arg)'), arg);
      const waitEditing = async (id) => {
        await page.waitForFunction(
          (x) => window.__studio.sceneShot.editing() === x && !window.__studio.sceneShot.switching,
          id,
          { timeout: 20000 },
        );
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      };
      const raf = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      assert.equal(await SS('()=>SS.editing()'), 'char0');
      // Put char1's viewer so that its spine bone projects onto screen point (kind 'ring': 0.75 of the root ring radius to
      // the right of the root centre, i.e. inside the filled hit area but away from the drawn stroke; kind 'at': a widget).
      const placeViewerAt = (arg) =>
        SS(
          `(a)=>{const v=S.editorViews()[0],c=v.camera,cv=v.renderer.domElement,r=cv.getBoundingClientRect(),V=c.position.constructor;
            c.updateMatrixWorld(true);v.scene.updateMatrixWorld(true);
            const e=SS.registry.get('char1'),g=e.viewer.group;g.updateMatrixWorld(true);
            let b=null;e.viewer.root.traverse(o=>{if(o.isBone&&o.name==='mixamorig:Spine1')b=o});
            const P=b.getWorldPosition(new V()),n=P.clone().project(c);
            let target;
            if(a.kind==='ring'){const w=v.widgets.find(d=>d.id==='root');const p0=w.shape.position.clone().project(c);
              const ex=new V(1,0,0).applyQuaternion(w.shape.quaternion).multiplyScalar(w.shape.scale.x).add(w.shape.position).project(c);
              const px=Math.hypot((ex.x-p0.x)*r.width/2,(ex.y-p0.y)*r.height/2);
              target={x:p0.x+(a.dx||0)*(ex.x-p0.x)*0.75,y:p0.y+(a.dy||0)*(ex.y-p0.y)*0.75};}
            else{const w=v.widgets.find(d=>d.id===a.id);const p=w.shape.position.clone().project(c);target={x:p.x,y:p.y}}
            const Q=new V(target.x,target.y,n.z).unproject(c);g.position.add(Q.sub(P));g.updateMatrixWorld(true);
            return {x:r.left+(target.x+1)/2*r.width,y:r.top+(1-target.y)/2*r.height}}`,
          arg,
        );
      const probe = (pt) =>
        SS(
          `(p)=>{const v=S.editorViews()[0],saved=v.rootPickYields;const ev={clientX:p.x,clientY:p.y};
            const hits=SS.hitsAt(p.x,p.y).sort((a,b)=>a.distance-b.distance);
            v.rootPickYields=null;const without=S.widgetPick(v,ev)?.id||null;v.rootPickYields=saved;
            const withHook=S.widgetPick(v,ev)?.id||null;
            return {without,withHook,nearest:hits[0]?.characterId||null,top:document.elementFromPoint(p.x,p.y)===v.renderer.domElement}}`,
          pt,
        );
      const rootSample = (angle) =>
        SS(
          `(a)=>{const v=S.editorViews()[0],c=v.camera,r=v.renderer.domElement.getBoundingClientRect(),V=c.position.constructor;
            const w=v.widgets.find(d=>d.id==='root');w.shape.updateWorldMatrix(true,false);
            const p=new V(Math.cos(a),0,Math.sin(a)).applyMatrix4(w.shape.matrixWorld).project(c);
            return {x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height}}`,
          angle,
        );

      // ---- 1) a viewer standing inside the root ring: the bug scenario, then the fix
      const selectHead = () => SS(`()=>{S.select(S.rig().records.find(r=>r.name==='mixamorig:Head').id);return 1}`);
      await selectHead();
      // The editor's own transform gizmo (selected object) is a control too and keeps priority: choose a spot clear of it.
      let spot = null,
        p1 = null;
      const tried = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [0.6, 0.6], [-0.6, 0.6]]) {
        await SS('()=>{const e=SS.registry.get("char1");e.viewer.group.position.set(...e.placement.position);return 1}');
        const pt = await placeViewerAt({ kind: 'ring', dx, dy });
        await raf();
        await page.mouse.move(pt.x - 3, pt.y);
        await page.mouse.move(pt.x, pt.y);
        const pr = await probe(pt);
        const gizmoAxis = await SS('()=>{const v=S.editorViews()[0];return v.gizmo?.axis||v.moveGizmo?.axis||null}');
        tried.push([dx, dy, Math.round(pt.x), Math.round(pt.y), pr, gizmoAxis]);
        if (pr.nearest === 'char1' && pr.without === 'root' && pr.top && !gizmoAxis) {
          spot = pt;
          p1 = pr;
          break;
        }
      }
      assert.ok(spot, 'a spot inside the root ring over a viewer body, clear of the gizmo ' + JSON.stringify(tried));
      assert.notEqual(p1.withHook, 'root', 'with the yield the root ring does not take the click: ' + JSON.stringify(p1));
      const hist0 = await SS('()=>S.state.historyIndex');
      const sel0 = await SS('()=>S.state.selected');
      await page.mouse.move(spot.x, spot.y);
      await page.mouse.down();
      assert.equal(await SS('()=>!!S.state.draft'), false, 'pointerdown on the yielded ring creates no draft');
      assert.equal(await SS('()=>S.state.selected'), sel0, 'pointerdown on the yielded ring selects nothing');
      await page.mouse.up();
      await waitEditing('char1').catch(async (e) => {
        throw Error(e.message + ' ' + JSON.stringify(await SS('()=>({ed:SS.editing(),sel:S.state.selected,draft:!!S.state.draft,status:document.getElementById("status")?.textContent,sw:SS.switching})')) + ' ' + JSON.stringify(spot) + errors.join('|'));
      });
      assert.equal(await SS('()=>!!S.state.draft'), false);
      assert.equal(await SS('()=>S.state.historyIndex'), hist0, 'no history entry created by the click');
      assert.deepEqual(await SS('()=>SS.edited()'), [], 'nothing was edited');
      await SS('()=>SS.select("char0")');
      await waitEditing('char0');
      await selectHead();

      // ---- 2) press+drag that starts on the ring stroke (with a viewer body under the stroke) still drags the root
      let strokePt = null;
      for (const dx of [1, -1, 0]) {
        for (const dy of [0, 1, -1]) {
          await SS('()=>{const e=SS.registry.get("char1");e.viewer.group.position.set(...e.placement.position);return 1}');
          await placeViewerAt({ kind: 'ring', dx: dx * 1.33, dy: dy * 1.33 }); // 0.75*1.33 = the stroke radius
          await raf();
          for (let k = 0; k < 24 && !strokePt; k++) {
            const pt = await rootSample((k / 24) * Math.PI * 2);
            const pr = await probe(pt);
            if (pr.nearest === 'char1' && pr.top && pr.withHook === 'root') strokePt = pt;
          }
          if (strokePt) break;
        }
        if (strokePt) break;
      }
      assert.ok(strokePt, 'a ring stroke point with a viewer body underneath');
      const rootBefore = await SS('()=>JSON.stringify(S.rig().root.position.toArray())');
      await page.mouse.move(strokePt.x, strokePt.y);
      await page.mouse.down();
      await page.mouse.move(strokePt.x + 30, strokePt.y + 12, { steps: 6 });
      assert.equal(await SS('()=>S.state.selected'), 'root', 'pointerdown on the ring stroke selects root as before');
      await page.mouse.up();
      assert.equal(await SS('()=>!!S.state.draft'), true, 'a drag on the ring stroke creates the draft as before');
      assert.equal(await SS('()=>SS.editing()'), 'char0', 'dragging the ring never switches');
      assert.notEqual(await SS('()=>JSON.stringify(S.rig().root.position.toArray())'), rootBefore, 'root moved by the drag');
      await SS('()=>document.getElementById("undoBtn").click()');
      assert.equal(await SS('()=>!!S.state.draft'), false);

      // ---- 3) an IK widget over a viewer keeps full priority
      const iks = await SS('()=>S.editorViews()[0].widgets.filter(d=>d.kind==="box"&&d.shape.visible).map(d=>d.id)');
      assert.ok(iks.length > 0, 'IK widgets visible');
      let ikDone = null;
      for (const id of iks) {
        await SS('()=>{const e=SS.registry.get("char1");e.viewer.group.position.set(...e.placement.position);return 1}');
        const pt = await placeViewerAt({ kind: 'at', id });
        await raf();
        const pr = await probe(pt);
        if (pr.nearest !== 'char1' || !pr.top) continue;
        assert.equal(pr.withHook, id, 'the IK widget wins the pick over the viewer body: ' + JSON.stringify(pr));
        await page.mouse.move(pt.x, pt.y);
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(300);
        assert.equal(await SS('()=>SS.editing()'), 'char0', 'clicking an IK widget over a viewer does not switch');
        assert.equal(await SS('()=>S.state.selected'), id, 'the IK widget got selected');
        ikDone = id;
        await SS('()=>document.getElementById("undoBtn").click()').catch(() => {});
        break;
      }
      assert.ok(ikDone, 'found an IK widget with a viewer body under it');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.close();
    }
  },
);

test(
  'Cả cảnh S3 gizmo yield ("Ưu tiên chuyển"): a click inside the gizmo sphere over a neighbour switches; gizmo axis rings keep the drag; single mode unchanged',
  { skip: !existsSync(artifact), timeout: 300000 },
  async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(readFileSync(artifact));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch(browserOptions({ headless: true }));
    const errors = [];
    const report = {};
    try {
      const open = async (opts) => {
        const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('dialog', (d) => d.accept());
        await useClassicLayout(page);
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => window.__studio?.ready);
        await page.evaluate(
          async ({ src, args }) => {
            const { files } = await new Function('return ' + src)()(args);
            await window.__studio.shot.openFiles(files);
          },
          { src: buildSceneShot.toString(), args: opts },
        );
        const SS = (fn, arg) =>
          page.evaluate(new Function('arg', 'const SS=window.__studio.sceneShot,S=window.__studio;return (' + fn + ')(arg)'), arg);
        const raf = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        return { page, SS, raf };
      };
      // Find a screen point where the rotate gizmo's hover axis equals `want` ('XYZE' trackball sphere or one of 'X'|'Y'|'Z'|'E').
      const findAxisPoint = (SS, want, minR, maxR) =>
        SS(
          `(a)=>{const v=S.editorViews()[0],c=v.camera,r=v.renderer.domElement.getBoundingClientRect();c.updateMatrixWorld(true);
            v.scene.updateMatrixWorld(true);const g=v.gizmo,o=g.object,V=c.position.constructor;
            const p=o.getWorldPosition(new V()).project(c),cx=r.left+(p.x+1)/2*r.width,cy=r.top+(1-p.y)/2*r.height;
            const hit=(x,y)=>{g.pointerHover({x:(x-r.left)/r.width*2-1,y:-(y-r.top)/r.height*2+1,button:-1});return g.axis};
            const found=[];
            for(let rad=a.minR;rad<=a.maxR;rad+=2)for(let k=0;k<72;k++){const t=k/72*Math.PI*2,x=cx+Math.cos(t)*rad,y=cy+Math.sin(t)*rad;
              const top=document.elementFromPoint(x,y)===v.renderer.domElement;
              if(top&&hit(x,y)===a.want){found.push({x,y,rad,k});if(found.length>200)break}}
            g.axis=null;return {cx,cy,radius:v.gizmoRadius,found}}`,
          { want, minR, maxR },
        );
      // Move char1's viewer so that its Spine1 bone projects onto the screen point (x,y).
      const placeAt = (SS, pt) =>
        SS(
          `(a)=>{const v=S.editorViews()[0],c=v.camera,r=v.renderer.domElement.getBoundingClientRect(),V=c.position.constructor;
            c.updateMatrixWorld(true);v.scene.updateMatrixWorld(true);
            const e=SS.registry.get('char1'),g=e.viewer.group;g.position.set(...e.placement.position);g.updateMatrixWorld(true);
            let b=null;e.viewer.root.traverse(o=>{if(o.isBone&&o.name==='mixamorig:Spine1')b=o});
            const P=b.getWorldPosition(new V()),n=P.clone().project(c);
            const Q=new V((a.x-r.left)/r.width*2-1,-(a.y-r.top)/r.height*2+1,n.z).unproject(c);g.position.add(Q.sub(P));g.updateMatrixWorld(true);return 1}`,
          pt,
        );
      const bodyAt = (SS, pt) =>
        SS(`(p)=>{const hits=SS.hitsAt(p.x,p.y).sort((a,b)=>a.distance-b.distance);return hits[0]?.characterId||null}`, pt);

      // ---- scene mode, default selection `root`
      {
        const { page, SS, raf } = await open({ count: 2, aspect: 2, names: ['A', 'B'] });
        const waitEditing = async (id) => {
          await page.waitForFunction(
            (x) => window.__studio.sceneShot.editing() === x && !window.__studio.sceneShot.switching,
            id,
            { timeout: 20000 },
          );
          await raf();
        };
        assert.equal(await SS('()=>SS.editing()'), 'char0');
        assert.equal(await SS('()=>S.state.selected'), 'root', 'default selection is root');
        // 1) trackball sphere: choose a point in the XYZE area, put B's body there, click.
        const sph = await findAxisPoint(SS, 'XYZE', 4, 120);
        assert.ok(sph.found.length > 0, 'the XYZE trackball sphere exists on screen ' + JSON.stringify(sph));
        let spot = null;
        for (const f of sph.found) {
          await placeAt(SS, f);
          await raf();
          if ((await bodyAt(SS, f)) !== 'char1') continue;
          await page.mouse.move(f.x - 2, f.y);
          await page.mouse.move(f.x, f.y);
          const axis = await SS('()=>S.editorViews()[0].gizmo.axis');
          const widget = await SS('(p)=>S.widgetPick(S.editorViews()[0],{clientX:p.x,clientY:p.y})?.id||null', f);
          if (axis === 'XYZE' && !widget) {
            spot = f;
            break;
          }
        }
        assert.ok(spot, 'a viewer body inside the XYZE sphere under the pointer');
        const hist0 = await SS('()=>S.state.historyIndex');
        await page.mouse.down();
        assert.equal(await SS('()=>S.editorViews()[0].gizmo.dragging'), false, 'pointerdown over a neighbour does not start the gizmo drag');
        assert.equal(await SS('()=>!!S.state.draft'), false, 'no draft on pointerdown ' + JSON.stringify(await SS('()=>({sel:S.state.selected,en:S.editorViews()[0].gizmo.enabled,ax:S.editorViews()[0].gizmo.axis,mv:S.editorViews()[0].moveGizmo.axis,spot:0})')) + JSON.stringify(spot));
        assert.equal(await SS('()=>S.state.selected'), 'root', 'selection untouched');
        await page.mouse.up();
        await waitEditing('char1');
        assert.equal(await SS('()=>!!S.state.draft'), false, 'no draft after the switching click');
        assert.equal(await SS('()=>S.state.historyIndex'), hist0, 'no history entry');
        assert.deepEqual(await SS('()=>SS.edited()'), [], 'nothing edited');
        assert.equal(await SS('()=>S.editorViews()[0].gizmo.enabled&&S.editorViews()[0].moveGizmo.enabled'), true, 'gizmos re-enabled after the click');
        await SS('()=>SS.select("char0")');
        await waitEditing('char0');

        // 2) a real press+drag on the gizmo's X/Y/Z ring, even with a neighbour body under it, still rotates (draft, no switch)
        let ring = null;
        outer: for (const axis of ['X', 'Z', 'Y']) {
          const r = await findAxisPoint(SS, axis, 4, 120);
          for (const f of r.found) {
            await placeAt(SS, f);
            await raf();
            const widget = await SS('(p)=>S.widgetPick(S.editorViews()[0],{clientX:p.x,clientY:p.y})?.id||null', f);
            if (!widget && (await bodyAt(SS, f)) === 'char1') {
              ring = { axis, ...f };
              break outer;
            }
          }
        }
        assert.ok(ring, 'an X/Y/Z axis ring point (no rig widget) with a neighbour body under it');
        const rotBefore = await SS('()=>JSON.stringify(S.rig().root.quaternion.toArray())');
        await page.mouse.move(ring.x - 2, ring.y);
        await page.mouse.move(ring.x, ring.y);
        assert.equal(await SS('()=>S.editorViews()[0].gizmo.axis'), ring.axis, 'hovered axis is the ring');
        await page.mouse.down();
        await page.mouse.move(ring.x + 25, ring.y + 25, { steps: 8 });
        assert.equal(await SS('()=>S.editorViews()[0].gizmo.dragging'), true, 'ring drag started ' + JSON.stringify(ring) + JSON.stringify(await SS('()=>{const v=S.editorViews()[0];return {sel:S.state.selected,en:v.gizmo.enabled,ax:v.gizmo.axis,mv:v.moveGizmo.axis,draft:!!S.state.draft,mode:v.gizmo.mode,obj:!!v.gizmo.object}}')));
        await page.mouse.up();
        await page.waitForTimeout(250);
        assert.equal(await SS('()=>!!S.state.draft'), true, 'ring drag creates the draft as before');
        assert.equal(await SS('()=>SS.editing()'), 'char0', 'ring drag never switches');
        assert.notEqual(await SS('()=>JSON.stringify(S.rig().root.quaternion.toArray())'), rotBefore, 'root rotated by the ring drag');
        await SS('()=>document.getElementById("undoBtn").click()');
        assert.equal(await SS('()=>!!S.state.draft'), false);

        // 3) view ring 'E': on its drawn stroke the drag keeps working; off the stroke (but still on the thick picker) over a
        // neighbour body the click yields and switches.
        const eAt = (arg) =>
          SS(
            `(a)=>{const v=S.editorViews()[0],g=v.gizmo,c=v.camera,r=v.renderer.domElement.getBoundingClientRect(),V=c.position.constructor;
              c.updateMatrixWorld(true);v.scene.updateMatrixWorld(true);g.getHelper().updateMatrixWorld(true);
              const h=g._gizmo.gizmo.rotate.children.find(x=>x.name==='E'),R=h.geometry.parameters.radius||1;
              const px=(w)=>{const q=w.clone().project(c);return [r.left+(q.x+1)/2*r.width,r.top+(1-q.y)/2*r.height]};
              const ctr=px(g.object.getWorldPosition(new V()));
              const on=px(new V(Math.cos(a.t)*R,Math.sin(a.t)*R,0).applyMatrix4(h.matrixWorld));
              const d=Math.hypot(on[0]-ctr[0],on[1]-ctr[1])||1,ux=(on[0]-ctr[0])/d,uy=(on[1]-ctr[1])/d;
              const x=on[0]-ux*a.off,y=on[1]-uy*a.off;
              g.pointerHover({x:(x-r.left)/r.width*2-1,y:-(y-r.top)/r.height*2+1,button:-1});
              const axis=g.axis;g.axis=null;return {x,y,axis,ringPx:d}}`,
            arg,
          );
        const isTop = (p) => SS('(p)=>document.elementFromPoint(p.x,p.y)===S.editorViews()[0].renderer.domElement', p);
        const strokeCands = [],
          offCands = [];
        const eTries = [];
        for (const t of [0.3, 0.8, 1.2, 1.7, 2.2, 2.8, 3.4, 3.9, 4.4, 4.9, 5.4, 5.9]) {
          const on = await eAt({ t, off: 0 });
          eTries.push([t, on.axis, Math.round(on.ringPx)]);
          if (on.axis === 'E' && (await isTop(on))) strokeCands.push(on);
          for (const off of [10, 13, 16, 20, 25]) {
            const q = await eAt({ t, off });
            if (q.axis === 'E' && (await isTop(q))) offCands.push({ ...q, off });
          }
        }
        const usable = async (list) => {
          for (const c of list) {
            await placeAt(SS, c);
            await raf();
            const widget = await SS('(p)=>S.widgetPick(S.editorViews()[0],{clientX:p.x,clientY:p.y})?.id||null', c);
            if (!widget && (await bodyAt(SS, c)) === 'char1') return c;
          }
          return null;
        };
        const strokePt = await usable(strokeCands);
        assert.ok(strokePt, 'a point on the E ring stroke ' + JSON.stringify(eTries));
        // on the stroke, with a neighbour body underneath: old behaviour (drag starts, draft)
        await page.mouse.move(strokePt.x - 1, strokePt.y);
        await page.mouse.move(strokePt.x, strokePt.y);
        assert.equal(await SS('()=>S.editorViews()[0].gizmo.axis'), 'E');
        await page.mouse.down();
        await page.mouse.move(strokePt.x + 20, strokePt.y + 20, { steps: 8 });
        assert.equal(await SS('()=>S.editorViews()[0].gizmo.dragging'), true, 'E ring stroke keeps the drag');
        await page.mouse.up();
        await page.waitForTimeout(250);
        assert.equal(await SS('()=>!!S.state.draft'), true);
        assert.equal(await SS('()=>SS.editing()'), 'char0');
        await SS('()=>document.getElementById("undoBtn").click()');
        const offPt = await usable(offCands);
        report.eStroke = { eTries, offPt: offPt ? Math.round(offPt.off) : null };
        if (offPt) {
          await page.mouse.move(offPt.x - 1, offPt.y);
          await page.mouse.move(offPt.x, offPt.y);
          assert.equal(await SS('()=>S.editorViews()[0].gizmo.axis'), 'E');
          await page.mouse.down();
          assert.equal(await SS('()=>S.editorViews()[0].gizmo.dragging'), false, 'E ring away from its stroke yields');
          await page.mouse.up();
          await waitEditing('char1');
          assert.equal(await SS('()=>!!S.state.draft'), false);
        }
        assert.deepEqual(errors, []);
        await page.close();
      }

      // ---- outside scene mode: a normal single-character shot, gizmo sphere behaves as before
      {
        const { page, SS, raf } = await open({ count: 1, aspect: 2, names: ['Solo'], sceneMode: false });
        assert.equal(await SS('()=>SS.active'), false, 'not a scene shot');
        const sph = await findAxisPoint(SS, 'XYZE', 4, 120);
        assert.ok(sph.found.length > 0, 'trackball sphere present in single mode');
        const f = sph.found[Math.floor(sph.found.length / 2)];
        await page.mouse.move(f.x - 2, f.y);
        await page.mouse.move(f.x, f.y);
        assert.equal(await SS('()=>S.editorViews()[0].gizmo.axis'), 'XYZE');
        const rotBefore = await SS('()=>JSON.stringify(S.rig().root.quaternion.toArray())');
        await page.mouse.down();
        assert.equal(await SS('()=>S.editorViews()[0].gizmo.dragging'), true, 'single mode: pointerdown on the sphere starts the trackball');
        await page.mouse.move(f.x + 30, f.y + 20, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(250);
        assert.equal(await SS('()=>!!S.state.draft'), true, 'single mode: trackball drag creates the draft as before');
        assert.notEqual(await SS('()=>JSON.stringify(S.rig().root.quaternion.toArray())'), rotBefore, 'single mode: root rotated');
        void raf;
        assert.deepEqual(errors, []);
        await page.close();
      }
      console.log('S3 gizmo report', JSON.stringify(report));
    } finally {
      await browser.close();
      server.close();
    }
  },
);
