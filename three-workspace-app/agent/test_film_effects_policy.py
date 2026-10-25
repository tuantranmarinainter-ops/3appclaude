"""Synthetic native-codec effects regression. No user project or game is accessed."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from .film_worker import BRIDGE_JAR, GSON_JAR, run_film_worker


@unittest.skipUnless(shutil.which('javac'), 'Java 17 JDK required')
class FilmEffectsPolicyReadbackTests(unittest.TestCase):
    def test_omit_and_confirmed_include_keep_characters_and_camera(self):
        editor = Path(__file__).resolve().parents[1] / 'editor'
        with tempfile.TemporaryDirectory(prefix='bbs-effects-policy-') as temporary:
            root = Path(temporary)
            model = root / 'model.bobj'
            model.write_text('arm_name synthetic\narm_bone Root 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1\nan idle\n', encoding='utf-8')
            manifest = dict(schemaVersion=1, targetVersion='2.4', projectId='synthetic', sourceRevision=0,
                filmName='effects', mode='editable', durationTicks=20,
                models=[dict(id='unified/synthetic', bones=['Root'], actions=['idle'], textureRequired=False,
                    files=[dict(sourcePath=str(model), targetPath='model.bobj', sha256=hashlib.sha256(model.read_bytes()).hexdigest())])],
                actors=[dict(characterId='actor', name='Ordinary actor', modelId='unified/synthetic',
                    transformSamples=[dict(tick=t, x=t/10, y=1, z=3, yaw=15, pitch=0) for t in (0,20)], poseTracks=[])],
                cameras=[dict(id='shot', startTick=0, durationTicks=20,
                    keyframes=[dict(tick=t, x=4, y=5, z=6, yaw=0, pitch=-15, roll=0, verticalFovDegrees=60) for t in (0,20)])])
            source = root/'source.json'; source.write_text(json.dumps(manifest), encoding='utf-8')
            script = root/'policy.mjs'
            script.write_text("import fs from 'node:fs'; import {pathToFileURL} from 'node:url'; const {filmEffectsForExport,filmRequiredMods}=await import(pathToFileURL(process.argv[2]).href); const m=JSON.parse(fs.readFileSync(process.argv[3],'utf8')); const mode=process.argv[5]; const policy=mode==='include'?{mode,target:{runtime:'bbs-fs-2.7',aaaRendererAvailable:true,compatibleAddonConfirmed:true}}:undefined; const effects=await filmEffectsForExport(policy,async()=>[{label:'aura01',effect:'effeks/samples/aura01.efkefc',x:0,y:1,z:2,yaw:0,scale:1,startTick:0,endTick:20}]); if(effects.length)m.aaaEffects=effects; fs.writeFileSync(process.argv[4],JSON.stringify(m));fs.writeFileSync(process.argv[4]+'.mods',JSON.stringify(filmRequiredMods(effects.length)));", encoding='utf-8')
            decoder = root/'Decode.java'
            decoder.write_text('import java.nio.file.*; import local.bbsmcp.data.BbsCodec; public class Decode { public static void main(String[] a)throws Exception { System.out.println(BbsCodec.toJson(BbsCodec.read(Files.readAllBytes(Path.of(a[0]))))); }}', encoding='utf-8')
            cp = os.pathsep.join(map(str,(BRIDGE_JAR,GSON_JAR)))
            subprocess.run(['javac','-cp',cp,str(decoder)],check=True,capture_output=True)
            results = {}
            for mode in ('omit','include'):
                target=root/(mode+'.json'); output=root/mode; output.mkdir()
                subprocess.run(['node','--import',(editor/'packages/builder/node_modules/tsx/dist/loader.mjs').as_uri(),str(script),str(editor/'apps/studio/src/filmEffectsPolicy.ts'),str(source),str(target),mode],cwd=editor/'packages/builder',check=True,capture_output=True)
                package=Path(run_film_worker(target,output)['packageDirectory'])
                raw=subprocess.check_output(['java','-cp',cp+os.pathsep+str(root),'Decode',str(package/'films/effects.dat')],text=True)
                decoded=json.loads(raw); results[mode]=decoded
                self.assertEqual(len(decoded['replays']),1 if mode=='omit' else 2)
                self.assertEqual('bbs:aaa_particle' in raw,mode=='include')
                mods=json.loads(Path(str(target)+'.mods').read_text())
                self.assertEqual(len(mods['requiredMods']),1 if mode=='omit' else 2)
                self.assertEqual(mods['effectPlayback'],'OMITTED' if mode=='omit' else 'UNVERIFIED')
                self.assertEqual(model.read_bytes(),(package/'assets/models/unified/synthetic/model.bobj').read_bytes())
            self.assertEqual(results['omit']['replays'][0],results['include']['replays'][0])
            def stable(value):
                if isinstance(value, dict): return {key:stable(item) for key,item in value.items() if key != 'mcp_id'}
                if isinstance(value, list): return [stable(item) for item in value]
                return value
            self.assertEqual(stable(results['omit']['camera']),stable(results['include']['camera']))
            self.assertEqual(source.read_text(),json.dumps(manifest), 'source project derivative is unchanged')
