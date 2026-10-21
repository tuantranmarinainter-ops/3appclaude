"""Contract tests using temporary text/byte fixtures only; no game assets."""

import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from .shot_package import validate_result, validate_shot


ORIGINAL = "11111111-1111-4111-8111-111111111111"
DERIVATIVE = "22222222-2222-4222-8222-222222222222"
OTHER = "33333333-3333-4333-8333-333333333333"
GLB = b"shot-contract-fixture-v1\n"
EDITED_GLB = b"shot-contract-edited-v1\n"
REFERENCE_GLB = b"shot-contract-reference-v1\n"
ROOT = Path(__file__).resolve().parents[2]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def manifest(data, action):
    return {
        "version": "1.0.0", "glb": {"bytes": len(data), "mode": "animation-only"},
        "glbSha256": sha(data),
        "actions": [{"uuid": action, "name": "Walk", "durationSeconds": 2, "fps": 30,
                     "sourceActionIndex": 0, "glbAnimationIndex": 0}],
        "rootPolicy": {"mode": "skeletal", "translationScale": 1, "units": "meters"},
        "source": {"file": "fixture.glb", "sha256": sha(data)},
        "target": {"file": "fixture.glb", "sha256": sha(data)},
        "fingerprint": {"boneLengthsMeters": {"Spine": 0.1}, "hipsHeightMeters": 1},
    }


def shot_example():
    character = {
        "characterId": "hero", "glb": "characters/hero.glb",
        "manifest": "characters/hero.manifest.json", "glbSha256": sha(GLB),
        "actionUuid": ORIGINAL,
        "clip": {"sourceStartSeconds": 0, "sourceEndSeconds": 2, "speed": 1,
                 "loop": False, "reverse": False},
        "placement": {"position": [0, 0, 0], "yawDegrees": 0},
        "rootPolicy": "skeletal", "editable": True,
    }
    return {
        "version": "1.0.0", "shotId": "shot-001", "sceneId": "scene-001", "fps": 30,
        "frameRange": [0, 60],
        "camera": {"keys": [
            {"frame": 0, "position": [0, 2, 5], "lookAt": [0, 1, 0], "fovYDegrees": 45},
            {"frame": 60, "position": [2, 2, 5], "lookAt": [0, 1, 0], "fovYDegrees": 45},
        ]},
        "characters": [character, {**copy.deepcopy(character), "characterId": "observer", "editable": False}],
        "references": [{"file": "references/stage.glb", "sha256": sha(REFERENCE_GLB),
                        "transform": {"position": [0, 0, 0], "rotationDegrees": [0, 0, 0], "scale": [1, 1, 1]}}],
    }


def result_example(shot_bytes):
    return {
        "version": "1.0.0", "shotId": "shot-001", "baseShotSha256": sha(shot_bytes),
        "edits": [{"characterId": "hero", "originalActionUuid": ORIGINAL, "newActionUuid": DERIVATIVE,
                   "glb": "edits/hero.glb", "manifest": "edits/hero.manifest.json",
                   "glbSha256": sha(EDITED_GLB), "placementKeys": [
                       {"frame": 0, "position": [0, 0, 0], "yawDegrees": 0},
                       {"frame": 60, "position": [1, 0, 0], "yawDegrees": 45},
                   ]}],
    }


class ShotPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.shot_dir = Path(self.temp.name) / "shot"
        self.result_dir = Path(self.temp.name) / "result"
        self.shot = shot_example()
        write_json(self.shot_dir / "shot.json", self.shot)
        self.result = result_example((self.shot_dir / "shot.json").read_bytes())
        write_json(self.result_dir / "result.json", self.result)
        for directory, name, data, action in [
            (self.shot_dir, "characters", GLB, ORIGINAL),
            (self.result_dir, "edits", EDITED_GLB, DERIVATIVE),
        ]:
            (directory / name).mkdir()
            (directory / name / "hero.glb").write_bytes(data)
            write_json(directory / name / "hero.manifest.json", manifest(data, action))
        (self.shot_dir / "references").mkdir()
        (self.shot_dir / "references/stage.glb").write_bytes(REFERENCE_GLB)

    def check_issue(self, code, *, result=False):
        issues = (validate_result(self.result_dir, self.shot_dir) if result else validate_shot(self.shot_dir))
        self.assertIn(code, [issue["code"] for issue in issues], issues)
        for issue in issues:
            self.assertEqual(set(issue), {"code", "path", "message"})
            self.assertTrue(all(type(value) is str and value for value in issue.values()))

    def save_shot(self):
        write_json(self.shot_dir / "shot.json", self.shot)

    def save_result(self):
        write_json(self.result_dir / "result.json", self.result)

    def test_valid_shot(self):
        self.assertEqual(validate_shot(self.shot_dir), [])

    def test_valid_result(self):
        self.assertEqual(validate_result(self.result_dir, self.shot_dir), [])

    def test_supported_minor_and_patch(self):
        self.shot["version"] = "1.12.3"
        self.save_shot()
        self.assertEqual(validate_shot(self.shot_dir), [])

    def test_all_required_shot_fields(self):
        for key in list(self.shot):
            with self.subTest(key=key):
                value = self.shot.pop(key)
                self.save_shot()
                self.check_issue("MISSING_FIELD")
                self.shot[key] = value

    def test_all_required_character_and_nested_fields(self):
        character = self.shot["characters"][0]
        for obj in [character, character["clip"], character["placement"],
                    self.shot["camera"], self.shot["camera"]["keys"][0],
                    self.shot["references"][0], self.shot["references"][0]["transform"]]:
            for key in list(obj):
                with self.subTest(key=key, obj=obj):
                    value = obj.pop(key)
                    self.save_shot()
                    self.check_issue("MISSING_FIELD")
                    obj[key] = value

    def test_all_required_result_and_edit_fields(self):
        for obj in [self.result, self.result["edits"][0], self.result["edits"][0]["placementKeys"][0]]:
            for key in list(obj):
                with self.subTest(key=key):
                    value = obj.pop(key)
                    self.save_result()
                    self.check_issue("MISSING_FIELD", result=True)
                    obj[key] = value

    def test_wrong_types_do_not_crash(self):
        for value in [None, True, 3, "bad", [], {}]:
            for key in self.shot:
                if type(value) is type(self.shot[key]):
                    continue
                with self.subTest(key=key, value=value):
                    candidate = copy.deepcopy(self.shot)
                    candidate[key] = value
                    write_json(self.shot_dir / "shot.json", candidate)
                    self.check_issue("INVALID_TYPE")

    def test_wrong_result_types_do_not_crash(self):
        for key in self.result:
            with self.subTest(key=key):
                candidate = copy.deepcopy(self.result)
                candidate[key] = None
                write_json(self.result_dir / "result.json", candidate)
                self.check_issue("INVALID_TYPE", result=True)

    def test_wrong_nested_object_types(self):
        for key in ["characters", "references"]:
            self.shot[key] = [None, [], True]
            self.save_shot()
            self.check_issue("INVALID_TYPE")
        self.result["edits"] = [None, []]
        self.save_result()
        self.check_issue("INVALID_TYPE", result=True)

    def test_unsupported_versions(self):
        for version in ["2.0.0", "1.0", "v1.0.0", "1.01.0", "1.0.0-beta", "0.1.0"]:
            with self.subTest(version=version):
                self.shot["version"] = version
                self.save_shot()
                self.check_issue("UNSUPPORTED_VERSION")

    def test_result_version(self):
        self.result["version"] = "2.0.0"
        self.save_result()
        self.check_issue("UNSUPPORTED_VERSION", result=True)

    def test_invalid_fps(self):
        self.shot["fps"] = 24
        self.save_shot()
        self.check_issue("INVALID_FPS")

    def test_invalid_frame_ranges(self):
        for frames in [[2, 1], [-1, 30], [0], [0, 1, 2], [False, 30], [0, 2.5]]:
            with self.subTest(frames=frames):
                self.shot["frameRange"] = frames
                self.save_shot()
                self.check_issue("INVALID_FRAME_RANGE")

    def test_unsafe_paths(self):
        for value in ["/etc/passwd", "../escape.glb", "characters/../../escape.glb", "C:/escape.glb",
                      "C:escape.glb", "\\\\server\\share\\x.glb", "characters\\hero.glb", "bad\x00.glb"]:
            with self.subTest(value=value):
                self.shot["characters"][0]["glb"] = value
                self.save_shot()
                self.check_issue("UNSAFE_PATH")

    def test_reference_and_manifest_paths_are_checked(self):
        self.shot["references"][0]["file"] = "../outside.glb"
        self.shot["characters"][0]["manifest"] = "../outside.json"
        self.save_shot()
        issues = validate_shot(self.shot_dir)
        self.assertEqual(sum(issue["code"] == "UNSAFE_PATH" for issue in issues), 2)

    def test_symlink_cannot_escape_package(self):
        outside = Path(self.temp.name) / "outside.glb"
        outside.write_bytes(GLB)
        link = self.shot_dir / "characters/escape.glb"
        try:
            link.symlink_to(outside)
        except OSError as exc:
            self.skipTest(f"Symlinks unavailable: {exc}")
        self.shot["characters"][0]["glb"] = "characters/escape.glb"
        self.save_shot()
        self.check_issue("UNSAFE_PATH")

    def test_document_symlink_cannot_escape(self):
        (self.shot_dir / "shot.json").unlink()
        outside = Path(self.temp.name) / "outside.json"
        write_json(outside, self.shot)
        try:
            (self.shot_dir / "shot.json").symlink_to(outside)
        except OSError as exc:
            self.skipTest(f"Symlinks unavailable: {exc}")
        self.check_issue("UNSAFE_PATH")

    def test_missing_package_and_referenced_files(self):
        self.assertEqual(validate_shot(self.shot_dir / "absent")[0]["code"], "FILE_NOT_FOUND")
        (self.shot_dir / "characters/hero.glb").unlink()
        self.check_issue("FILE_NOT_FOUND")

    def test_missing_manifest(self):
        (self.shot_dir / "characters/hero.manifest.json").unlink()
        self.check_issue("FILE_NOT_FOUND")

    def test_invalid_json_and_non_object_documents(self):
        for text, code in [("{", "INVALID_JSON"), ("[]", "INVALID_TYPE"),
                           ('{"value":NaN}', "INVALID_JSON"), ('{"value":Infinity}', "INVALID_JSON")]:
            with self.subTest(text=text):
                (self.shot_dir / "shot.json").write_text(text)
                self.check_issue(code)

    def test_invalid_utf8_json(self):
        (self.shot_dir / "shot.json").write_bytes(b"\xff")
        self.check_issue("INVALID_JSON")

    def test_io_error_reported(self):
        with patch.object(Path, "read_text", side_effect=PermissionError("fixture read denied")):
            self.check_issue("IO_ERROR")

    def test_hash_io_error_reported(self):
        with patch("agent.shot_package.hashlib.file_digest", side_effect=OSError("fixture read failed")):
            self.check_issue("IO_ERROR")

    def test_hash_mismatch(self):
        (self.shot_dir / "characters/hero.glb").write_bytes(b"changed")
        self.check_issue("SHA256_MISMATCH")

    def test_invalid_hash_syntax(self):
        self.shot["characters"][0]["glbSha256"] = "not-a-hash"
        self.save_shot()
        self.check_issue("INVALID_SHA256")

    def test_reference_hash_mismatch(self):
        self.shot["references"][0]["sha256"] = "0" * 64
        self.save_shot()
        self.check_issue("SHA256_MISMATCH")

    def test_manifest_hash_mismatch(self):
        value = manifest(GLB, ORIGINAL)
        value["glbSha256"] = "0" * 64
        write_json(self.shot_dir / "characters/hero.manifest.json", value)
        self.check_issue("SHA256_MISMATCH")

    def test_action_absent_from_manifest(self):
        self.shot["characters"][0]["actionUuid"] = OTHER
        self.save_shot()
        self.check_issue("ACTION_NOT_IN_MANIFEST")

    def test_invalid_uuid(self):
        self.shot["characters"][0]["actionUuid"] = "not-a-uuid"
        self.save_shot()
        self.check_issue("INVALID_UUID")

    def test_manifest_fields_and_types(self):
        for value in [{}, {"version": 1, "glbSha256": None, "actions": {}},
                      {"version": "2.0.0", "glbSha256": "bad", "actions": [False, {"uuid": "bad"}]}]:
            with self.subTest(value=value):
                write_json(self.shot_dir / "characters/hero.manifest.json", value)
                self.assertTrue(validate_shot(self.shot_dir))

    def test_duplicate_manifest_action_uuid(self):
        value = manifest(GLB, ORIGINAL)
        value["actions"] *= 2
        write_json(self.shot_dir / "characters/hero.manifest.json", value)
        self.check_issue("DUPLICATE_ACTION_UUID")

    def test_no_editable_character(self):
        self.shot["characters"][0]["editable"] = False
        self.save_shot()
        self.check_issue("NO_EDITABLE_CHARACTER")

    def test_duplicate_character_id(self):
        self.shot["characters"][1]["characterId"] = "hero"
        self.save_shot()
        self.check_issue("DUPLICATE_CHARACTER_ID")

    def test_invalid_clip(self):
        for change in [{"speed": 0}, {"speed": -1}, {"sourceStartSeconds": -1},
                       {"sourceEndSeconds": -1}, {"sourceStartSeconds": 3}]:
            with self.subTest(change=change):
                self.shot["characters"][0]["clip"] = {**shot_example()["characters"][0]["clip"], **change}
                self.save_shot()
                self.check_issue("INVALID_CLIP")

    def test_boolean_is_not_number_or_integer(self):
        self.shot["fps"] = True
        self.shot["characters"][0]["clip"]["speed"] = True
        self.save_shot()
        self.check_issue("INVALID_TYPE")

    def test_invalid_vectors_and_empty_identifier(self):
        self.shot["characters"][0]["placement"]["position"] = [0, True, 0]
        self.shot["sceneId"] = " "
        self.save_shot()
        self.check_issue("INVALID_VALUE")

    def test_invalid_root_policy(self):
        self.shot["characters"][0]["rootPolicy"] = "trajectory"
        self.save_shot()
        self.check_issue("INVALID_ROOT_POLICY")

    def test_invalid_camera_keys(self):
        self.shot["camera"]["keys"][1]["frame"] = 0
        self.shot["camera"]["keys"][0]["fovYDegrees"] = 180
        self.save_shot()
        self.check_issue("KEYS_NOT_INCREASING")
        self.check_issue("INVALID_VALUE")

    def test_camera_frame_outside_shot(self):
        self.shot["camera"]["keys"][1]["frame"] = 61
        self.save_shot()
        self.check_issue("FRAME_OUT_OF_RANGE")

    def test_noop_result_is_valid(self):
        self.result["edits"] = []
        self.save_result()
        self.assertEqual(validate_result(self.result_dir, self.shot_dir), [])

    def test_base_hash_uses_exact_bytes(self):
        with (self.shot_dir / "shot.json").open("a") as stream:
            stream.write("\n")
        self.check_issue("SHA256_MISMATCH", result=True)

    def test_shot_id_mismatch(self):
        self.result["shotId"] = "other"
        self.save_result()
        self.check_issue("SHOT_ID_MISMATCH", result=True)

    def test_unknown_character(self):
        self.result["edits"][0]["characterId"] = "missing"
        self.save_result()
        self.check_issue("UNKNOWN_CHARACTER", result=True)

    def test_readonly_character(self):
        self.result["edits"][0]["characterId"] = "observer"
        self.save_result()
        self.check_issue("CHARACTER_NOT_EDITABLE", result=True)

    def test_original_action_mismatch(self):
        self.result["edits"][0]["originalActionUuid"] = OTHER
        self.save_result()
        self.check_issue("ORIGINAL_ACTION_MISMATCH", result=True)

    def test_derivative_must_have_new_uuid(self):
        self.result["edits"][0]["newActionUuid"] = ORIGINAL
        self.save_result()
        self.check_issue("ACTION_UUID_REUSED", result=True)

    def test_new_action_must_exist_in_manifest(self):
        self.result["edits"][0]["newActionUuid"] = OTHER
        self.save_result()
        self.check_issue("ACTION_NOT_IN_MANIFEST", result=True)

    def test_result_asset_hash_and_path(self):
        self.result["edits"][0]["glb"] = "../outside.glb"
        self.result["edits"][0]["glbSha256"] = "0" * 64
        self.save_result()
        self.check_issue("UNSAFE_PATH", result=True)

    def test_result_modified_glb_hash(self):
        (self.result_dir / "edits/hero.glb").write_bytes(b"tampered")
        self.check_issue("SHA256_MISMATCH", result=True)

    def test_duplicate_result_edits(self):
        self.result["edits"] *= 2
        self.save_result()
        self.check_issue("DUPLICATE_CHARACTER_ID", result=True)
        self.check_issue("DUPLICATE_ACTION_UUID", result=True)

    def test_placement_frame_outside_shot(self):
        for frame in [-1, 61]:
            with self.subTest(frame=frame):
                self.result["edits"][0]["placementKeys"][1]["frame"] = frame
                self.save_result()
                self.check_issue("FRAME_OUT_OF_RANGE", result=True)

    def test_placement_frames_must_increase(self):
        for frames in [[10, 10], [20, 10]]:
            with self.subTest(frames=frames):
                for key, frame in zip(self.result["edits"][0]["placementKeys"], frames):
                    key["frame"] = frame
                self.save_result()
                self.check_issue("KEYS_NOT_INCREASING", result=True)

    def test_empty_placement_keys_rejected(self):
        self.result["edits"][0]["placementKeys"] = []
        self.save_result()
        self.check_issue("INVALID_VALUE", result=True)

    def test_bad_base_shot_is_reported_without_crashing(self):
        for value in [{"characters": None}, {"characters": [None]}, {"characters": {"hero": {}}}]:
            with self.subTest(value=value):
                write_json(self.shot_dir / "shot.json", value)
                issues = validate_result(self.result_dir, self.shot_dir)
                self.assertTrue(any(issue["path"].startswith("shot/") for issue in issues))

    def test_missing_result_or_base(self):
        self.assertTrue(validate_result(self.result_dir / "missing", self.shot_dir))
        self.assertTrue(validate_result(self.result_dir, self.shot_dir / "missing"))

    def test_documented_examples_are_accepted_verbatim(self):
        text = (ROOT / "docs/SHOT-PACKAGE-CONTRACT.md").read_text(encoding="utf-8")
        examples = dict(re.findall(r"<!-- example:([^ ]+) -->\n```json\n(.*?)\n```", text, re.S))
        self.assertEqual(set(examples), {"shot/shot.json", "result/result.json",
                                       "shot/characters/hero.manifest.json", "result/edits/hero.manifest.json"})
        for name, value in examples.items():
            path = Path(self.temp.name) / name
            # Preserve the literal bytes, including the final LF stated by the contract.
            path.write_text(value + "\n", encoding="utf-8", newline="\n")
        self.assertEqual(validate_shot(self.shot_dir), [])
        self.assertEqual(validate_result(self.result_dir, self.shot_dir), [])

    def cli(self, *args):
        return subprocess.run([sys.executable, "-m", "agent.shot_package", *map(str, args)],
                              cwd=ROOT / "three-workspace-app", capture_output=True, text=True, timeout=15)

    def test_cli_valid_shot_and_result(self):
        for args in [("validate-shot", self.shot_dir),
                     ("validate-result", self.result_dir, "--shot", self.shot_dir)]:
            with self.subTest(args=args):
                run = self.cli(*args)
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertEqual(json.loads(run.stdout), [])

    def test_cli_invalid_package(self):
        self.shot["fps"] = 24
        self.save_shot()
        run = self.cli("validate-shot", self.shot_dir)
        self.assertEqual(run.returncode, 1, run.stderr)
        self.assertIn("INVALID_FPS", [issue["code"] for issue in json.loads(run.stdout)])

    def test_cli_invalid_result(self):
        self.result["edits"][0]["originalActionUuid"] = OTHER
        self.save_result()
        run = self.cli("validate-result", self.result_dir, "--shot", self.shot_dir)
        self.assertEqual(run.returncode, 1, run.stderr)
        self.assertIn("ORIGINAL_ACTION_MISMATCH", [issue["code"] for issue in json.loads(run.stdout)])

    def test_cli_usage_errors(self):
        for args in [(), ("unknown",), ("validate-shot",), ("validate-result", self.result_dir)]:
            with self.subTest(args=args):
                run = self.cli(*args)
                self.assertEqual(run.returncode, 2)
                self.assertIn("usage:", run.stderr)


if __name__ == "__main__":
    unittest.main()
