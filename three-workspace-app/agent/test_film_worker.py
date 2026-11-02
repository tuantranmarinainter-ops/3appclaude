"""Integration coverage for the pinned Java 17 BBS Film worker."""

from __future__ import annotations

import hashlib
import gzip
import json
import math
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path

from .film_worker import run_film_worker


WORKSPACE = Path(__file__).resolve().parents[2]
MODEL = WORKSPACE / "bbs-animation-MCP-reference/src/client/resources/assets/bbs/assets/models/emoticons/steve_simple/default_simple_plus.bobj"
MODEL_SHA256 = "2d644b5c0528faa3f9b55d66364000032904b8cabc3057b17ebf75a149928fc2"
JAVA_HOME = os.environ.get("BBS_JAVA_HOME") or os.environ.get("JAVA_HOME")
JAVA_AVAILABLE = bool(JAVA_HOME and (Path(JAVA_HOME) / "bin/javac.exe").is_file()) or shutil.which("javac")


@unittest.skipUnless(JAVA_AVAILABLE, "Set BBS_JAVA_HOME to a Java 17 JDK to run Film worker integration tests")
class NativeHeightFormTests(unittest.TestCase):
    def test_native_form_height_and_floor_read_back_without_changing_model_or_pose_units(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / "model.bobj"
            raw = b"arm_name height.mdl\narm_bone root 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1\no Body\nv 0 -1.993 0\nv 0 3.835 0\n"
            model.write_bytes(raw)
            factor = 3.6 / 5.828
            manifest = {"schemaVersion": 1, "targetVersion": "2.4", "projectId": "height-test", "sourceRevision": 0, "mode": "editable", "filmName": "height-test", "durationTicks": 1,
                "models": [{"id": "unified/height-test", "bones": ["root"], "actions": [], "textureRequired": False, "files": [{"sourcePath": str(model), "targetPath": "model.bobj", "sha256": hashlib.sha256(raw).hexdigest()}]}],
                "actors": [{"characterId": "actor", "name": "Actor", "modelId": "unified/height-test", "formScale": factor, "formOffsetY": 1.993 * factor, "transformSamples": [{"tick": tick, "x": 2 * tick, "y": 0, "z": 0, "pitch": 0, "yaw": 0} for tick in (0, 1)], "poseTracks": []}],
                "cameras": [{"id": "camera", "startTick": 0, "durationTicks": 1, "keyframes": [{"tick": tick, "x": 0, "y": 2, "z": 5, "pitch": 0, "yaw": 0, "roll": 0, "verticalFovDegrees": 60} for tick in (0, 1)]}]}
            second = {**manifest["actors"][0], "characterId": "actor-1.8", "name": "Actor 1.8", "formScale": 1.8 / 5.828, "formOffsetY": 1.993 * 1.8 / 5.828}
            manifest["actors"].append(second)
            spec = root / "manifest.json"
            spec.write_text(json.dumps(manifest), encoding="utf-8")
            output = root / "exports"
            output.mkdir()
            result = run_film_worker(spec, output)
            package = Path(result["packageDirectory"])
            report = json.loads((package / "export-report.json").read_text(encoding="utf-8"))
            transform = report["modelFormTransforms"][0]["transform"]
            self.assertTrue(report["nativeReadback"])
            self.assertEqual(len(transform["s"]), 3)
            for value in transform["s"]:
                self.assertAlmostEqual(value, factor, places=6)
            foot = -1.993 * transform["s"][1] + transform["t"][1]
            head = 3.835 * transform["s"][1] + transform["t"][1]
            self.assertAlmostEqual(foot, 0, places=6)
            self.assertAlmostEqual(head - foot, 3.6, places=6)
            small = report["modelFormTransforms"][1]["transform"]
            self.assertAlmostEqual(5.828 * small["s"][1], 1.8, places=6)
            self.assertAlmostEqual(-1.993 * small["s"][1] + small["t"][1], 0, places=6)
            self.assertEqual((package / "assets/models/unified/height-test/model.bobj").read_bytes(), raw)

    def camera_manifest(self):
        # Anchored dolly 3 m, pan 45 degrees, 50 -> 35 mm; hard cut to moving look-at.
        first, second = [], []
        for tick in range(150):
            u = tick / 149
            first.append({"tick": tick, "x": 107.63 + 3 * u, "y": -58.72, "z": 210.34,
                "yaw": 157.63 + 45 * u, "pitch": 6.65, "roll": -3 * u,
                "verticalFovDegrees": math.degrees(2 * math.atan(24 / (2 * (50 - 15 * u))))})
        for tick in range(10):
            dx, dy, dz = tick / 10 - 2, -1, 4
            second.append({"tick": tick, "x": 109.63, "y": -57.72, "z": 206.34,
                "yaw": math.degrees(math.atan2(dz, dx)) + 90,
                "pitch": -math.degrees(math.atan2(dy, math.hypot(dx, dz))), "roll": 0,
                "verticalFovDegrees": 60})
        return {"schemaVersion": 1, "targetVersion": "2.4", "projectId": "camera-test", "sourceRevision": 0,
            "mode": "playback", "filmName": "camera-test", "durationTicks": 160, "models": [],
            "actors": [{"characterId": "actor", "name": "Actor", "actorType": "male", "transformSamples": [
                {"tick": tick, "x": 107.63 + tick / 10, "y": -58.72, "z": 210.34, "pitch": 0, "yaw": 0} for tick in (0, 160)]}],
            "cameras": [{"id": "dolly-pan-zoom", "startTick": 0, "durationTicks": 150, "keyframes": first},
                {"id": "look-at", "startTick": 150, "durationTicks": 10, "keyframes": second}]}

    def test_moving_cameras_native_readback_has_no_placeholder_and_preserves_every_sample(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = root / "manifest.json"
            spec.write_text(json.dumps(self.camera_manifest()), encoding="utf-8")
            output = root / "exports"
            output.mkdir()
            result = run_film_worker(spec, output)
            report = json.loads((Path(result["packageDirectory"]) / "export-report.json").read_text())
            self.assertEqual(result["cameras"], 2)
            self.assertEqual(report["cameraReadback"]["valuesCompared"], 160 * 7)
            self.assertLessEqual(report["cameraReadback"]["maxAbsoluteError"], 1e-10)

    def test_overlapping_shots_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            document = self.camera_manifest()
            document["cameras"][1]["startTick"] = 149
            spec = root / "manifest.json"
            spec.write_text(json.dumps(document), encoding="utf-8")
            output = root / "exports"
            output.mkdir()
            with self.assertRaisesRegex(RuntimeError, "Camera clips overlap"):
                run_film_worker(spec, output)
            self.assertEqual(list(output.iterdir()), [])


@unittest.skipUnless(JAVA_AVAILABLE, "Set BBS_JAVA_HOME to a Java 17 JDK to run Film worker integration tests")
class FilmWorkerIntegrationTests(unittest.TestCase):
    def manifest(self, target_path: str = "model.bobj", *, valid_hash: bool = True) -> dict:
        raw = MODEL.read_bytes()
        bones = re.findall(r"^arm_bone\s+(\S+)", raw.decode("utf-8"), re.MULTILINE)
        digest = hashlib.sha256(raw).hexdigest()
        if not valid_hash:
            digest = "0" * 64
        return {
            "schemaVersion": 1,
            "targetVersion": "2.4",
            "projectId": "fixture-project",
            "sourceRevision": 7,
            "filmName": "film-worker-test",
            "mode": "editable",
            "durationTicks": 60,
            "models": [{
                "id": "unified/fixture_steve",
                "bones": bones,
                "actions": [],
                "textureRequired": False,
                "files": [{"sourcePath": str(MODEL), "targetPath": target_path, "sha256": digest}],
            }],
            "actors": [
                {
                    "characterId": "character-a",
                    "name": "Steve",
                    "modelId": "unified/fixture_steve",
                    "transformSamples": [
                        {"tick": 0, "x": 0, "y": 0, "z": 0, "pitch": 0, "yaw": 0},
                        {"tick": 60, "x": 1, "y": 0, "z": 0, "pitch": 0, "yaw": 90},
                    ],
                    "poseTracks": [{"boneName": "body", "keyframes": [
                        {"tick": 0, "t": [0, 0, 0], "s": [1, 1, 1], "r": [0, 0, 0], "r2": [0, 0, 0]},
                        {"tick": 30, "t": [0, 0, 0], "s": [1, 1, 1], "r": [0, 0.3, 0], "r2": [0, 0, 0]},
                        {"tick": 60, "t": [0, 0, 0], "s": [1, 1, 1], "r": [0, 0, 0], "r2": [0, 0, 0]},
                    ]}],
                },
                {
                    "characterId": "character-b",
                    "name": "Alex",
                    "actorType": "female",
                    "transformSamples": [
                        {"tick": 0, "x": 2, "y": 0, "z": 0, "pitch": 0, "yaw": 180},
                        {"tick": 60, "x": 2, "y": 0, "z": 1, "pitch": 0, "yaw": 180},
                    ],
                },
            ],
            "cameras": [{
                "id": "camera-main",
                "startTick": 0,
                "durationTicks": 60,
                "keyframes": [
                    {"tick": 0, "x": 0, "y": 2, "z": -4, "pitch": 0, "yaw": 0, "roll": 0, "verticalFovDegrees": 60},
                    {"tick": 60, "x": 1, "y": 2, "z": -4, "pitch": 0, "yaw": 5, "roll": 0, "verticalFovDegrees": 60},
                ],
            }],
        }

    def test_two_actor_film_writes_native_dat_assets_camera_and_editable_pose_track(self):
        self.assertTrue(MODEL.is_file(), "Pinned BBS model fixture is required")
        self.assertEqual(hashlib.sha256(MODEL.read_bytes()).hexdigest(), MODEL_SHA256, "Pinned BBS model fixture changed")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest = root / "manifest.json"
            output = root / "exports"
            output.mkdir()
            manifest.write_text(json.dumps(self.manifest()), encoding="utf-8")
            result = run_film_worker(manifest, output)
            package = Path(result["packageDirectory"])
            native = package / "films/film-worker-test.dat"
            exported = json.loads((package / "export-manifest.json").read_text(encoding="utf-8"))
            report = json.loads((package / "export-report.json").read_text(encoding="utf-8"))
            self.assertTrue(result["nativeReadback"])
            self.assertEqual((result["actors"], result["cameras"], result["sourceRevision"]), (2, 1, 7))
            self.assertTrue(native.is_file())
            self.assertEqual(native.read_bytes()[:2], b"\x1f\x8b")
            self.assertEqual(gzip.decompress(native.read_bytes())[:4], b"BBS1")
            self.assertEqual(exported["targetVersion"], "2.4")
            self.assertEqual(len(exported["actors"]), 2)
            self.assertEqual(len(exported["cameras"]), 1)
            self.assertEqual(exported["assets"][0]["files"][0]["path"], "assets/models/unified/fixture_steve/model.bobj")
            self.assertEqual(report["status"], "success")
            self.assertEqual(report["poseTracks"], 1)
            self.assertEqual(report["runtimeAcceptance"], "not-run")
            self.assertEqual((package / "assets/models/unified/fixture_steve/model.bobj").read_bytes(), MODEL.read_bytes())

    def test_aaa_effects_become_aaa_particle_replays(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest = root / "manifest.json"
            output = root / "exports"
            output.mkdir()
            document = self.manifest()
            document["aaaEffects"] = [{"label": "aura01", "effect": "effeks/samples/aura01.efkefc", "x": 1, "y": 0, "z": 2, "yaw": 0, "scale": 0.7, "startTick": 12, "endTick": 40},
                                      {"label": "toonhit", "effect": "effeks/samples/toonhit.efkefc", "x": 0, "y": 1, "z": 0, "yaw": 0, "scale": 0.1, "startTick": 20, "endTick": 60, "manual": True}]
            manifest.write_text(json.dumps(document), encoding="utf-8")
            package = Path(run_film_worker(manifest, output)["packageDirectory"])
            raw = gzip.decompress((package / "films/film-worker-test.dat").read_bytes())
            self.assertIn(b"bbs:aaa_particle", raw)
            self.assertIn(b"assets:effeks/samples/aura01.efkefc", raw)
            self.assertIn(b"VFX aura01", raw)
            self.assertIn(b"VFX toonhit", raw)
            bad = root / "bad.json"
            document["filmName"] = "film-worker-bad"
            document["aaaEffects"][0]["effect"] = "../escape.efkefc"
            bad.write_text(json.dumps(document), encoding="utf-8")
            with self.assertRaises(RuntimeError):
                run_film_worker(bad, output)
            self.assertFalse((output / "film-worker-bad").exists())

    def test_editable_original_rig_can_layer_body_pose_tracks_over_native_wing_action(self):
        actions = re.findall(r"^an\s+(.+)$", MODEL.read_text(encoding="utf-8"), re.MULTILINE)
        if not actions:
            self.skipTest("Pinned BOBJ fixture has no native action")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); output = root / "exports"; output.mkdir()
            document = self.manifest()
            document["models"][0]["actions"] = actions
            document["actors"][0]["animationKeyframes"] = [
                {"tick": 0, "animationName": actions[0], "slot": "idle", "actionTick": 0},
            ]
            manifest = root / "manifest.json"; manifest.write_text(json.dumps(document), encoding="utf-8")
            result = run_film_worker(manifest, output)
            self.assertTrue(result["nativeReadback"])
            report = json.loads((Path(result["packageDirectory"]) / "export-report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["poseTracks"], 1)

    def test_invalid_asset_hash_and_traversal_fail_without_leaving_package_data(self):
        too_large_revision = self.manifest()
        too_large_revision["sourceRevision"] = 9223372036854775808
        unordered_actions = self.manifest()
        unordered_actions["actors"][0]["animationKeyframes"] = [
            {"tick": 30, "animationName": "unused", "slot": "idle", "actionTick": 0},
            {"tick": 30, "animationName": "unused", "slot": "idle", "actionTick": 1},
        ]
        for document, message in (
            (self.manifest(valid_hash=False), "SHA-256 mismatch"),
            (self.manifest("../escape.bobj"), "Invalid or duplicate asset target path"),
            (too_large_revision, "sourceRevision"),
            (unordered_actions, "animation keyframes ticks must be strictly increasing"),
        ):
            with self.subTest(message=message), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                manifest = root / "manifest.json"
                output = root / "exports"
                output.mkdir()
                manifest.write_text(json.dumps(document), encoding="utf-8")
                with self.assertRaisesRegex(RuntimeError, message):
                    run_film_worker(manifest, output)
                self.assertEqual(list(output.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
