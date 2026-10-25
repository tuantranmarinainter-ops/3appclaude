"""Synthetic native-codec regression; no game directory or real project is accessed."""
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from .film_worker import BRIDGE_JAR, GSON_JAR, run_film_worker


@unittest.skipUnless(shutil.which('javac'), 'Java 17 JDK required')
class FilmWorldAnchorReadbackTests(unittest.TestCase):
    def test_signed_actor_camera_backdrop_and_native_model_readback(self):
        workspace = Path(__file__).resolve().parents[1]
        editor = workspace / 'editor'
        with tempfile.TemporaryDirectory(prefix='bbs-anchor-test-') as temporary:
            root = Path(temporary)
            (root / 'output').mkdir()
            model = root / 'model.bobj'
            # Native topology with a nonzero floor; the world translation must never enter bone space.
            model.write_text('arm_name synthetic\narm_bone Root 0 0 0 1 0 0 0 0 1 0 -1.25 0 0 1 0 0 0 0 1\nan idle\n', encoding='utf-8')
            actors = []
            for name in ('Minecraft20', 'Verity', 'Backdrop'):
                actors.append({'characterId': name, 'name': name, 'modelId': 'unified/synthetic',
                    'transformSamples': [dict(tick=t, x=10000+t/10, y=500+t/100, z=-8000-t/5, yaw=173+t/4, pitch=13) for t in (0,70,149)], 'poseTracks': []})
            manifest = dict(schemaVersion=1, targetVersion='2.4', projectId='synthetic', sourceRevision=0,
                filmName='anchor', mode='editable', durationTicks=149, actors=actors,
                models=[dict(id='unified/synthetic', bones=['Root'], actions=['idle'], textureRequired=False,
                    files=[dict(sourcePath=str(model),targetPath='model.bobj',sha256=hashlib.sha256(model.read_bytes()).hexdigest())])],
                cameras=[dict(id='shot',startTick=0,durationTicks=149,keyframes=[dict(tick=t,x=10003+t/10,y=505+t/100,z=-8007-t/5,yaw=171,pitch=-21,roll=8,verticalFovDegrees=60) for t in (0,70,149)])])
            source = root / 'source.json'; source.write_text(json.dumps(manifest), encoding='utf-8')
            # Exercise the actual TypeScript coordinate helper, loading local paths portably on Windows too.
            script = root / 'anchor.mjs'
            script.write_text("import fs from 'node:fs'; import {pathToFileURL} from 'node:url'; const {applyFilmWorldAnchor,resolveFilmWorldAnchor}=await import(pathToFileURL(process.argv[2]).href); const m=JSON.parse(fs.readFileSync(process.argv[3],'utf8')); applyFilmWorldAnchor(m,resolveFilmWorldAnchor({mode:'local-origin',destination:[-230,67.25,412]},[10000,500,-8000]));fs.writeFileSync(process.argv[4],JSON.stringify(m));", encoding='utf-8')
            target = root / 'manifest.json'
            subprocess.run(['node','--import',(editor/'packages/builder/node_modules/tsx/dist/loader.mjs').as_uri(),str(script),str(editor/'apps/studio/src/filmWorldAnchor.ts'),str(source),str(target)], cwd=editor/'packages/builder', check=True, capture_output=True, text=True)
            result = run_film_worker(target, root/'output')
            decoder = root/'Decode.java'
            decoder.write_text('import java.nio.file.*; import local.bbsmcp.data.BbsCodec; public class Decode { public static void main(String[] a)throws Exception { System.out.println(BbsCodec.toJson(BbsCodec.read(Files.readAllBytes(Path.of(a[0]))))); }}',encoding='utf-8')
            cp = os.pathsep.join(map(str,(BRIDGE_JAR,GSON_JAR)))
            subprocess.run(['javac','-cp',cp,str(decoder)],check=True,capture_output=True)
            decoded = json.loads(subprocess.check_output(['java','-cp',cp+os.pathsep+str(root),'Decode',str(Path(result['packageDirectory'])/'films/anchor.dat')],text=True))
            expected = json.loads(target.read_text(encoding='utf-8'))
            for actual, actor in zip(decoded['replays'],expected['actors']):
                for axis in ('x','y','z','yaw','pitch'):
                    for key, sample in zip(actual['keyframes'][axis]['keyframes'],actor['transformSamples']):
                        self.assertEqual(key['tick'],sample['tick'])
                        self.assertAlmostEqual(key['value'],sample[axis],places=7)
            camera = next(c for c in decoded['camera'] if c.get('title')=='shot')
            for axis in ('x','y','z','yaw','pitch','roll'):
                for key,sample in zip(camera[axis]['keyframes'],expected['cameras'][0]['keyframes']):
                    self.assertAlmostEqual(key['value'],sample[axis],places=7)
            # Source frames 0/70/149 at 30fps fall at ticks 0/46⅔/99⅓. Replay channels are linear.
            def interpolate(channel, tick):
                keys = channel['keyframes']
                for a,b in zip(keys,keys[1:]):
                    if a['tick'] <= tick <= b['tick']:
                        alpha = (tick-a['tick'])/(b['tick']-a['tick'])
                        return a['value']+(b['value']-a['value'])*alpha
                return keys[-1]['value']
            for frame in (0,70,149):
                tick = frame*20/30
                replay = decoded['replays'][0]['keyframes']
                self.assertAlmostEqual(interpolate(replay['x'],tick),-230+tick/10,places=7)
                self.assertAlmostEqual(interpolate(replay['y'],tick),67.25+tick/100,places=7)
                self.assertAlmostEqual(interpolate(replay['z'],tick),412-tick/5,places=7)
                yaw = interpolate(replay['yaw'],tick)
                expected_yaw = 173+tick/4
                # Compare orientation across +180 as a rotation, not a wrapped Euler number.
                self.assertAlmostEqual(math.cos(math.radians(yaw)),math.cos(math.radians(expected_yaw)),places=7)
                self.assertAlmostEqual(math.sin(math.radians(yaw)),math.sin(math.radians(expected_yaw)),places=7)
            self.assertEqual(model.read_bytes(),(Path(result['packageDirectory'])/'assets/models/unified/synthetic/model.bobj').read_bytes())
