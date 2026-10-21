"""Input/command tests always run; the real Blender roundtrip skips only when Blender is absent."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from .scene_model_converter import blender_command, convert_scene, validate_scene_glb, BlenderUnavailableError


def fixture_glb() -> bytes:
    # Triangle + perspective camera, animated over one second.
    positions = struct.pack('<9f', 0, 0, 0, 1, 0, 0, 0, 1, 0)
    times = struct.pack('<2f', 0, 1)
    motion = struct.pack('<6f', 0, 0, 0, 1, 0, 0)
    binary = positions + times + motion
    document = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0, 1]}],
        'nodes': [{'name': 'Mover', 'mesh': 0}, {'name': 'Camera', 'camera': 0, 'translation': [0, 2, 3]}],
        'cameras': [{'type': 'perspective', 'perspective': {'yfov': 0.8, 'znear': 0.1, 'zfar': 100}}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0}}]}],
        'buffers': [{'byteLength': len(binary)}],
        'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(positions)}, {'buffer': 0, 'byteOffset': len(positions), 'byteLength': len(times)}, {'buffer': 0, 'byteOffset': len(positions)+len(times), 'byteLength': len(motion)}],
        'accessors': [{'bufferView': 0, 'componentType': 5126, 'type': 'VEC3', 'count': 3, 'min': [0, 0, 0], 'max': [1, 1, 0]}, {'bufferView': 1, 'componentType': 5126, 'type': 'SCALAR', 'count': 2, 'min': [0], 'max': [1]}, {'bufferView': 2, 'componentType': 5126, 'type': 'VEC3', 'count': 2}],
        'animations': [{'name': 'Scene', 'samplers': [{'input': 1, 'output': 2, 'interpolation': 'LINEAR'}], 'channels': [{'sampler': 0, 'target': {'node': 0, 'path': 'translation'}}]}]}
    encoded = json.dumps(document).encode(); encoded += b' ' * (-len(encoded) % 4)
    binary += b'\0' * (-len(binary) % 4)
    return struct.pack('<5I', 0x46546C67, 2, 28+len(encoded)+len(binary), len(encoded), 0x4E4F534A)+encoded+struct.pack('<2I',len(binary),0x004E4942)+binary


class SceneConverterTests(unittest.TestCase):
    def test_command_keeps_paths_as_separate_arguments_and_enables_python_exit_code(self):
        command = blender_command(Path('/tools/Blender with spaces'), Path('/tmp/in $(touch bad).glb'), Path('/tmp/output folder'), 30)
        self.assertEqual(command[0], '/tools/Blender with spaces')
        self.assertIn('--background', command)
        self.assertIn('--factory-startup', command)
        self.assertEqual(command[command.index('--python-exit-code')+1], '1')
        self.assertEqual(command[command.index('--input')+1], '/tmp/in $(touch bad).glb')
        for fps in [0, 241, True, 29.97]:
            with self.assertRaises(ValueError):
                blender_command(Path('blender'), Path('a'), Path('b'), fps)

    def test_bad_or_external_inputs_do_not_start_blender(self):
        with tempfile.TemporaryDirectory() as temp, patch('agent.scene_model_converter.blender_tool') as tool:
            source = Path(temp)/'scene.glb'
            for data in [b'bad', b'BLENDER'+b'x'*30]:
                source.write_bytes(data)
                with self.assertRaises(ValueError):
                    convert_scene(source, Path(temp)/'out')
            original=fixture_glb(); length=struct.unpack_from('<I',original,12)[0]
            document=json.loads(original[20:20+length]);document['images']=[{'uri':'../private.png'}]
            encoded=json.dumps(document).encode();encoded+=b' '*(-len(encoded)%4)
            tail=original[20+length:]
            external=struct.pack('<5I',0x46546C67,2,20+len(encoded)+len(tail),len(encoded),0x4E4F534A)+encoded+tail
            source.write_bytes(external)
            with self.assertRaisesRegex(ValueError,'embedded'):
                convert_scene(source,Path(temp)/'out')
            tool.assert_not_called()
            self.assertFalse((Path(temp)/'out').exists())
            source.write_bytes(fixture_glb())
            self.assertEqual(validate_scene_glb(source), hashlib.sha256(source.read_bytes()).hexdigest())
            alias=Path(temp)/'alias.glb';alias.symlink_to(source)
            with self.assertRaises(ValueError):validate_scene_glb(alias)

    def test_existing_destination_and_unavailable_blender_preserve_user_files(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)/'scene.glb';source.write_bytes(fixture_glb())
            output = Path(temp)/'out';output.mkdir();(output/'keep').write_text('mine')
            with self.assertRaises(ValueError):convert_scene(source,output)
            self.assertEqual((output/'keep').read_text(),'mine')
            with patch('agent.scene_model_converter.blender_tool',side_effect=BlenderUnavailableError('missing')):
                with self.assertRaises(BlenderUnavailableError):convert_scene(source,Path(temp)/'new')
            self.assertFalse((Path(temp)/'new').exists())

    def test_failed_worker_does_not_publish_partial_files(self):
        with tempfile.TemporaryDirectory() as temp, patch('agent.scene_model_converter.blender_tool',return_value=Path('/tools/blender')), patch('agent.scene_model_converter.subprocess.run',return_value=subprocess.CompletedProcess([],1,'','conversion failed')):
            source=Path(temp)/'scene.glb';source.write_bytes(fixture_glb())
            with self.assertRaisesRegex(RuntimeError,'failed'):convert_scene(source,Path(temp)/'out')
            self.assertFalse((Path(temp)/'out').exists())
            self.assertEqual([p.name for p in Path(temp).iterdir()],['scene.glb'])

    @unittest.skipUnless(os.environ.get('BBS_BLENDER_EXE') or shutil.which('blender'),'NOT_RUN: Blender is not installed')
    def test_blender_roundtrip_preserves_mesh_camera_and_animation_in_blend_and_fbx(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'scene.glb';source.write_bytes(fixture_glb());output=Path(temp)/'out'
            report=convert_scene(source,output)
            self.assertEqual(report['scene']['objects']['MESH'],1)
            self.assertEqual(report['scene']['objects']['CAMERA'],1)
            self.assertGreaterEqual(report['scene']['frameEnd']-report['scene']['frameStart'],30)
            for file in report['files']:
                self.assertEqual(hashlib.sha256((output/file['name']).read_bytes()).hexdigest(),file['sha256'])
            verify=Path(temp)/'verify.py';measure=Path(temp)/'readback.json'
            verify.write_text('''import bpy,json,sys
from pathlib import Path
root=Path(sys.argv[sys.argv.index('--')+1]); result={}
for suffix in ['blend','fbx']:
 if suffix=='blend': bpy.ops.wm.open_mainfile(filepath=str(root/'scene.blend'))
 else:
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.fbx(filepath=str(root/'scene.fbx'))
 scene=bpy.context.scene;scene.render.fps=30
 obj=bpy.data.objects.get('Mover'); assert obj
 result[suffix]={'meshes':sum(o.type=='MESH' for o in scene.objects),'cameras':sum(o.type=='CAMERA' for o in scene.objects),'x':[]}
 start=round(min((a.frame_range[0] for a in bpy.data.actions),default=scene.frame_start))
 for frame in [start,start+10,start+20]:
  scene.frame_set(frame);result[suffix]['x'].append(obj.matrix_world.translation.x)
Path(sys.argv[-1]).write_text(json.dumps(result))
''')
            from .scene_model_converter import blender_tool
            result=subprocess.run([str(blender_tool()),'--background','--factory-startup','--python-exit-code','1','--python',str(verify),'--',str(output),str(measure)],capture_output=True,text=True,timeout=120)
            self.assertEqual(result.returncode,0,result.stderr+result.stdout)
            data=json.loads(measure.read_text())
            for kind in ['blend','fbx']:
                self.assertEqual(data[kind]['meshes'],1)
                self.assertEqual(data[kind]['cameras'],1)
                for actual,expected in zip(data[kind]['x'],[0,1/3,2/3]):self.assertAlmostEqual(actual,expected,delta=0.001)

if __name__ == '__main__':unittest.main()
