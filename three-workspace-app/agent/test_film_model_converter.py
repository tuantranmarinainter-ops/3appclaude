"""Integration and boundary tests for the local Blender-to-BOBJ converter."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from .film_model_converter import _profile, convert_film_model
from .film_worker import run_film_worker


BLENDER = os.environ.get("BBS_BLENDER_EXE") or shutil.which("blender") or r"C:\Program Files\Blender Foundation\blender.exe"
BLENDER_AVAILABLE = Path(BLENDER).is_file()
JAVA_HOME = os.environ.get("BBS_JAVA_HOME") or os.environ.get("JAVA_HOME")
JAVA_AVAILABLE = bool(JAVA_HOME and (Path(JAVA_HOME) / "bin/javac.exe").is_file()) or shutil.which("javac") is not None


class FilmModelConverterBoundaryTests(unittest.TestCase):
    def test_rejects_bad_input_before_launching_blender(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.obj"
            source.write_text("fixture", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "supports FBX and GLB"):
                convert_film_model(source, root)
            source = root / "source.fbx"
            source.write_bytes(b"fbx")
            with self.assertRaisesRegex(ValueError, "finite positive"):
                convert_film_model(source, root)
            source = root / "source.glb"
            source.write_bytes(b"glb")
            with self.assertRaisesRegex(ValueError, "uses meters"):
                convert_film_model(source, root, 2)

    def test_rejects_invalid_basis_before_launching_blender(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.glb"
            source.write_bytes(b"glb")
            for basis in ([1, 0, 0], [2, 0, 0, 0, 1, 0, 0, 0, 1], [float("nan")] + [0] * 8):
                with self.subTest(basis=basis), self.assertRaisesRegex(ValueError, "basis"):
                    convert_film_model(source, root, basis_to_scene=basis)

    def test_existing_hash_output_is_never_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.glb"
            source.write_bytes(b"fixture")
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            final = root / f"model-{digest[:12]}"
            final.mkdir()
            marker = final / "keep.txt"
            marker.write_text("keep", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "already exists"):
                convert_film_model(source, root)
            self.assertEqual(marker.read_text(encoding="utf-8"), "keep")

    def test_profile_rejects_output_hash_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            model = stage / "model.bobj"
            model.write_text("content", encoding="utf-8")
            profile = {
                "schemaVersion": 1,
                "modelId": "unified/0123456789abcdef",
                "sourceSha256": "a" * 64,
                "metersPerUnit": 1.0,
                "bones": [{"name": "root", "parent": None, "bobjRestMatrixRowMajor": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]}],
                "actions": [],
                "textureRequired": False,
                "files": [{"targetPath": "model.bobj", "sha256": "0" * 64}],
            }
            with self.assertRaisesRegex(RuntimeError, "size or hash check"):
                _profile(profile, "a" * 64, "unified/0123456789abcdef", 1.0, stage)

    def test_profile_requires_finite_bobj_rest_matrices(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            model = stage / "model.bobj"
            model.write_text("content", encoding="utf-8")
            digest = hashlib.sha256(model.read_bytes()).hexdigest()
            profile = {
                "schemaVersion": 1,
                "modelId": "unified/0123456789abcdef",
                "sourceSha256": "a" * 64,
                "metersPerUnit": 1.0,
                "bones": [{"name": "root", "parent": None, "bobjRestMatrixRowMajor": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]}],
                "actions": [],
                "textureRequired": False,
                "files": [{"targetPath": "model.bobj", "sha256": digest}],
            }
            self.assertEqual(_profile(profile, "a" * 64, "unified/0123456789abcdef", 1.0, stage), profile)
            for matrix in ([1] * 15, [float("nan")] + [0] * 15):
                invalid = json.loads(json.dumps(profile))
                invalid["bones"][0]["bobjRestMatrixRowMajor"] = matrix
                with self.subTest(matrix=matrix):
                    with self.assertRaisesRegex(RuntimeError, "rest matrix"):
                        _profile(invalid, "a" * 64, "unified/0123456789abcdef", 1.0, stage)


@unittest.skipUnless(BLENDER_AVAILABLE, "Blender 4.2+ is required for the FBX integration fixture")
class FilmModelConverterBlenderTests(unittest.TestCase):
    def assert_basis_geometry(self, base_bobj: Path, basis_bobj: Path, basis: list[float]):
        def vectors(path):
            lines = path.read_text(encoding="utf-8").splitlines()
            positions = [tuple(map(float, line.split()[1:4])) for line in lines if line.startswith("v ")]
            normals = [tuple(map(float, line.split()[1:4])) for line in lines if line.startswith("vn ")]
            faces = [[tuple(map(int, token.split("/"))) for token in line.split()[1:]] for line in lines if line.startswith("f ")]
            signs = []
            for face in faces:
                a, b, c = [positions[token[0] - 1] for token in face[:3]]
                u, v = tuple(b[i] - a[i] for i in range(3)), tuple(c[i] - a[i] for i in range(3))
                normal = normals[face[0][2] - 1]
                cross = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
                signs.append(sum(cross[i] * normal[i] for i in range(3)) > 0)
            return positions, normals, signs

        base_positions, base_normals, base_signs = vectors(base_bobj)
        basis_positions, basis_normals, basis_signs = vectors(basis_bobj)
        self.assertEqual((len(base_positions), len(base_normals), len(base_signs)), (len(basis_positions), len(basis_normals), len(basis_signs)))
        self.assertEqual(sorted(base_signs), sorted(basis_signs))
        for sources, actuals in ((base_positions, basis_positions), (base_normals, basis_normals)):
            expected = sorted(tuple(sum(basis[row * 3 + column] * source[column] for column in range(3)) for row in range(3)) for source in sources)
            for wanted, converted in zip(expected, sorted(actuals)):
                for actual, value in zip(converted, wanted):
                    self.assertAlmostEqual(actual, value, places=5)

    def test_rigged_animated_fbx_and_glb_convert_to_bobj_profile_and_texture(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "fixture.fbx"
            output = root / "output"
            output.mkdir()
            fixture_script = root / "make_fixture.py"
            fixture_script.write_text("\n".join((
                "import bpy, sys",
                "out = sys.argv[sys.argv.index('--') + 1]",
                "bpy.ops.object.select_all(action='SELECT')",
                "bpy.ops.object.delete(use_global=False)",
                "bpy.ops.object.armature_add()",
                "arm = bpy.context.object",
                "arm.name = 'Rig'",
                "arm.data.bones[0].name = 'root'",
                "bpy.ops.mesh.primitive_cube_add()",
                "mesh = bpy.context.object",
                "mesh.name = 'Body'",
                "mesh.parent = arm",
                "mesh.modifiers.new('Armature', 'ARMATURE').object = arm",
                "group = mesh.vertex_groups.new(name='root')",
                "group.add([v.index for v in mesh.data.vertices], 1.0, 'REPLACE')",
                "image = bpy.data.images.new('BodyTexture', width=2, height=2, alpha=True)",
                "image.pixels = [1.0, 0.5, 0.25, 1.0] * 4",
                "image.filepath_raw = out + '.jpg'",
                "image.file_format = 'JPEG'",
                "image.save()",
                "material = bpy.data.materials.new('BodyMaterial')",
                "material.use_nodes = True",
                "texture = material.node_tree.nodes.new('ShaderNodeTexImage')",
                "texture.image = image",
                "principled = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')",
                "material.node_tree.links.new(texture.outputs['Color'], principled.inputs['Base Color'])",
                "mesh.data.materials.append(material)",
                "action = bpy.data.actions.new('walk')",
                "arm.animation_data_create()",
                "arm.animation_data.action = action",
                "curve = action.fcurves.new('pose.bones[\\\"root\\\"].rotation_euler', index=2, action_group='root')",
                "curve.keyframe_points.insert(1, 0.0)",
                "curve.keyframe_points.insert(11, 0.5)",
                "curve.update()",
                "bpy.ops.object.select_all(action='DESELECT')",
                "arm.select_set(True)",
                "mesh.select_set(True)",
                "bpy.context.view_layer.objects.active = arm",
                "bpy.ops.export_scene.fbx(filepath=out, use_selection=True, object_types={'ARMATURE','MESH'}, add_leaf_bones=False, bake_anim=True, bake_anim_use_all_actions=True, path_mode='COPY', embed_textures=True)",
                "bpy.ops.object.select_all(action='DESELECT')",
                "arm.select_set(True)",
                "mesh.select_set(True)",
                "bpy.context.view_layer.objects.active = arm",
                "bpy.ops.export_scene.gltf(filepath=out[:-4] + '.glb', export_format='GLB', use_selection=True, export_animations=True)",
            )) + "\n", encoding="utf-8")
            created = subprocess.run([BLENDER, "--background", "--factory-startup", "--python", str(fixture_script), "--", str(source)], capture_output=True, text=True, timeout=180, check=False)
            self.assertEqual(created.returncode, 0, created.stderr[-2000:])
            self.assertTrue(source.is_file() and source.stat().st_size > 0)
            original = hashlib.sha256(source.read_bytes()).hexdigest()
            with patch.dict(os.environ, {"BBS_BLENDER_EXE": BLENDER}):
                result = convert_film_model(source, output, 1.0)
            package = Path(result["packageDirectory"])
            profile = json.loads(Path(result["profilePath"]).read_text(encoding="utf-8"))
            bobj = (package / "model.bobj").read_text(encoding="utf-8")
            self.assertIn("arm_bone root", bobj)
            for bone in profile["bones"]:
                self.assertEqual(len(bone["bobjRestMatrixRowMajor"]), 16)
                line = next(line for line in bobj.splitlines() if line.startswith(f"arm_bone {bone['name']} "))
                self.assertEqual(bone["bobjRestMatrixRowMajor"], list(map(float, line.split()[-16:])))
            self.assertTrue(profile["actions"])
            self.assertTrue(any(action.lower().endswith("walk") for action in profile["actions"]))
            self.assertTrue(profile["textureRequired"])
            self.assertTrue((package / "model.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertEqual(profile["sourceSha256"], original)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), original)
            basis = [1, 0, 0, 0, 0, 1, 0, -1, 0]
            basis_fbx_output = root / "basis-fbx-output"
            basis_fbx_output.mkdir()
            basis_fbx_result = convert_film_model(source, basis_fbx_output, 1.0, basis)
            basis_fbx_profile = json.loads(Path(basis_fbx_result["profilePath"]).read_text(encoding="utf-8"))
            self.assert_basis_geometry(package / "model.bobj", Path(basis_fbx_result["packageDirectory"]) / "model.bobj", basis)
            for bone in basis_fbx_profile["bones"]:
                original_rest = next(item for item in profile["bones"] if item["name"] == bone["name"])["bobjRestMatrixRowMajor"]
                expected = [
                    original_rest[column] if row == 0 else original_rest[8 + column] if row == 1 else -original_rest[4 + column] if row == 2 else original_rest[12 + column]
                    for row in range(4) for column in range(4)
                ]
                self.assertEqual(bone["bobjRestMatrixRowMajor"], expected)
            glb = root / "fixture.glb"
            self.assertTrue(glb.is_file() and glb.stat().st_size > 0)
            glb_hash = hashlib.sha256(glb.read_bytes()).hexdigest()
            glb_result = convert_film_model(glb, output)
            glb_package = Path(glb_result["packageDirectory"])
            glb_profile = json.loads(Path(glb_result["profilePath"]).read_text(encoding="utf-8"))
            self.assertTrue((glb_package / "model.bobj").is_file())
            glb_bobj = (glb_package / "model.bobj").read_text(encoding="utf-8")
            self.assertIn("o Body", glb_bobj)
            self.assertNotIn("o Icosphere", glb_bobj)
            self.assertTrue(glb_profile["actions"])
            self.assertTrue(glb_profile["textureRequired"])
            self.assertTrue((glb_package / "model.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertEqual(glb_profile["sourceSha256"], glb_hash)
            self.assertEqual(hashlib.sha256(glb.read_bytes()).hexdigest(), glb_hash)
            basis_output = root / "basis-output"
            basis_output.mkdir()
            basis_result = convert_film_model(glb, basis_output, basis_to_scene=basis)
            basis_profile = json.loads(Path(basis_result["profilePath"]).read_text(encoding="utf-8"))
            self.assert_basis_geometry(glb_package / "model.bobj", Path(basis_result["packageDirectory"]) / "model.bobj", basis)
            base_by_name = {bone["name"]: bone for bone in glb_profile["bones"]}
            for bone in basis_profile["bones"]:
                original = base_by_name[bone["name"]]["bobjRestMatrixRowMajor"]
                transformed = [
                    original[column] if row == 0 else original[8 + column] if row == 1 else -original[4 + column] if row == 2 else original[12 + column]
                    for row in range(4) for column in range(4)
                ]
                self.assertEqual(bone["bobjRestMatrixRowMajor"], transformed)
            self.assertEqual(sorted(path.name for path in output.iterdir()), sorted((package.name, glb_package.name)))
            self.assertEqual([path.name for path in basis_output.iterdir()], [Path(basis_result["packageDirectory"]).name])
            reflection = [-1, 0, 0, 0, 1, 0, 0, 0, 1]
            reflection_output = root / "reflection-output"
            reflection_output.mkdir()
            reflection_result = convert_film_model(glb, reflection_output, basis_to_scene=reflection)
            reflection_profile = json.loads(Path(reflection_result["profilePath"]).read_text(encoding="utf-8"))
            self.assert_basis_geometry(glb_package / "model.bobj", Path(reflection_result["packageDirectory"]) / "model.bobj", reflection)
            for bone in reflection_profile["bones"]:
                original_rest = next(item for item in glb_profile["bones"] if item["name"] == bone["name"])["bobjRestMatrixRowMajor"]
                self.assertEqual(bone["bobjRestMatrixRowMajor"], [-value for value in original_rest[:4]] + original_rest[4:])
            if JAVA_AVAILABLE:
                film_output = root / "film-output"
                film_output.mkdir()
                manifest = root / "film-manifest.json"
                manifest.write_text(json.dumps({
                    "schemaVersion": 1, "targetVersion": "2.4", "projectId": "converter-project", "sourceRevision": 0,
                    "filmName": "converted-model", "mode": "playback", "durationTicks": 1,
                    "models": [{"id": glb_result["modelId"], "bones": [bone["name"] for bone in glb_profile["bones"]],
                        "actions": glb_profile["actions"], "textureRequired": glb_profile["textureRequired"],
                        "files": [{"sourcePath": item["sourcePath"], "targetPath": item["targetPath"], "sha256": item["sha256"]} for item in glb_result["files"]]}],
                    "actors": [{"characterId": "converter-character", "name": "Converted", "modelId": glb_result["modelId"],
                        "transformSamples": [{"tick": 0, "x": 0, "y": 0, "z": 0, "pitch": 0, "yaw": 0}]}],
                    "cameras": [{"id": "camera-main", "startTick": 0, "durationTicks": 1, "keyframes": [
                        {"tick": 0, "x": 0, "y": 2, "z": -4, "pitch": 0, "yaw": 0, "roll": 0, "verticalFovDegrees": 60},
                        {"tick": 1, "x": 0, "y": 2, "z": -4, "pitch": 0, "yaw": 0, "roll": 0, "verticalFovDegrees": 60},
                    ]}],
                }), encoding="utf-8")
                exported = run_film_worker(manifest, film_output)
                film_package = Path(exported["packageDirectory"])
                model_folder = film_package / "assets/models" / glb_result["modelId"]
                self.assertTrue(exported["nativeReadback"])
                self.assertEqual((model_folder / "model.bobj").read_bytes(), (glb_package / "model.bobj").read_bytes())
                self.assertEqual((model_folder / "model.png").read_bytes(), (glb_package / "model.png").read_bytes())


if __name__ == "__main__":
    unittest.main()
