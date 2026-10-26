import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from .unified_cli import CliError, command, exit_code_for, export_project_film_job, local_base, main, render_scene_job, save_render_files, upload_file


class LocalBaseTests(unittest.TestCase):
    def test_split_and_episode_commands_forward_exact_revision_and_selection(self):
        cases = [
            (["split-shots", "p1", "--expected-revision", "7", "--shot-id", "shot-2", "--episode-name", "Tập 15", "--dry-run"], "project.splitShots", {"shotIds": ["shot-2"], "episodeName": "Tập 15"}, True),
            (["episode-export", "p1", "--expected-revision", "7", "--name", "tap15"], "episode.export", {"name": "tap15"}, False),
        ]
        for argv, name, payload, dry_run in cases:
            with self.subTest(name=name), patch("agent.unified_cli.sys.argv", ["unified_cli.py", *argv]), patch("agent.unified_cli.open_session", return_value="cookie"), patch("agent.unified_cli.command", return_value={"ok": True}) as send, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(), 0)
                self.assertEqual(send.call_args.args[2:], (name, "p1", payload, 7, None, dry_run))

    def test_rig_commands_forward_shared_payloads_and_exact_revision(self):
        common = {"sourceAssetId": "source", "targetAssetId": "target", "mappingId": "mapping", "actionIndex": 2, "fps": 24.0, "rootTranslationScale": 1.0}
        cases = [
            (["rig", "inspect", "p1", "source"], "rig.inspect", {"assetId": "source"}, {}),
            (["rig", "plan", "p1", "source", "target", "mapping", "--action-index", "2", "--fps", "24"], "rig.normalization.plan", common, {"expected_revision": None}),
            (["rig", "run", "p1", "source", "target", "mapping", "--action-index", "2", "--fps", "24", "--root-translation-scale", "1.5", "--plan-sha256", "a" * 64, "--expected-revision", "7"], "rig.normalization.run", {**common, "rootTranslationScale": 1.5, "planSha256": "a" * 64}, {"expected_revision": 7}),
            (["rig", "save", "p1", "job1", "--expected-revision", "7"], "asset.import", {"normalizationJobId": "job1"}, {"expected_revision": 7}),
            (["rig", "assignment-plan", "p1", "motion", "character", "--fps", "24"], "animation.assignment.plan", {"motionId": "motion", "characterId": "character", "fps": 24.0}, {"expected_revision": None}),
            (["rig", "assignment-run", "p1", "motion", "character", "--fps", "24", "--plan-sha256", "b" * 64, "--expected-revision", "8"], "animation.assignment.run", {"motionId": "motion", "characterId": "character", "fps": 24.0, "planSha256": "b" * 64}, {"expected_revision": 8}),
            (["rig", "assignment-save", "p1", "job2", "--expected-revision", "9", "--frame-start", "12"], "animation.assignment.commit", {"jobId": "job2", "frameStart": 12}, {"expected_revision": 9}),
        ]
        for argv, name, payload, keywords in cases:
            with self.subTest(argv=argv), patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                 patch("agent.unified_cli.sys.argv", ["unified_cli.py", *argv]), \
                 patch("agent.unified_cli.open_session", return_value="cookie"), \
                 patch("agent.unified_cli.command", return_value={"ok": True}) as send, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(), 0)
                self.assertEqual(send.call_args.args[2:], (name, "p1", payload))
                self.assertEqual(send.call_args.kwargs, keywords)

    def test_rig_cli_rejects_invalid_root_translation_calibration(self):
        for scale in ("0", "20.1", "nan"):
            with self.subTest(scale=scale), patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                 patch("agent.unified_cli.sys.argv", ["unified_cli.py", "rig", "plan", "p1", "source", "target", "mapping", "--root-translation-scale", scale]), \
                 patch("agent.unified_cli.open_session", return_value="cookie"), patch("agent.unified_cli.command") as send, \
                 contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(), 2)
                send.assert_not_called()

    def test_accepts_loopback_hosts(self):
        for value in ("http://127.0.0.1:3002", "http://localhost:3002", "http://[::1]:3002/"):
            with self.subTest(value=value), patch.dict(os.environ, {"BBS_APP_URL": value}):
                self.assertEqual(local_base(), value.rstrip("/"))

    def test_rejects_nonlocal_or_ambiguous_urls(self):
        values = (
            "https://example.com",
            "http://user@localhost:3002",
            "http://localhost:3002/api",
            "http://localhost:3002/?token=secret",
            "file://localhost",
        )
        for value in values:
            with self.subTest(value=value), patch.dict(os.environ, {"BBS_APP_URL": value}):
                with self.assertRaises(ValueError):
                    local_base()


class ExitCodeTests(unittest.TestCase):
    def test_maps_contract_errors_to_agent_exit_codes(self):
        self.assertEqual(exit_code_for(409, "REVISION_CONFLICT"), 3)
        self.assertEqual(exit_code_for(400, "VALIDATION_FAILED"), 2)
        self.assertEqual(exit_code_for(403), 2)
        self.assertEqual(exit_code_for(401), 4)
        self.assertEqual(exit_code_for(422, "ASSET_MISSING"), 4)
        self.assertEqual(exit_code_for(500, "IO_FAILED"), 1)


class IdempotencyTests(unittest.TestCase):
    def test_render_retry_does_not_replace_the_snapshot_revision(self):
        request_id = "8c7f1431-8413-4fa5-bc7a-17df0316f10a"
        with tempfile.TemporaryDirectory() as directory, \
             patch("agent.unified_cli.call", return_value={"ok": True, "result": {}}) as send:
            for _ in range(2):
                render_scene_job("http://127.0.0.1:3002", "cookie", "p1", {
                    "frames": [0], "camera_node_ids": ["camera_1"], "width": 64, "height": 64,
                }, Path(directory), request_id=request_id, dry_run=True)
            self.assertEqual(send.call_count, 2)
            self.assertEqual(send.call_args_list[0], send.call_args_list[1])
            self.assertNotIn("expectedRevision", send.call_args.args[4])
            self.assertNotIn(directory, json.dumps(send.call_args.args[4]))

    def test_command_preserves_explicit_request_id_and_dry_run(self):
        request_id = "8c7f1431-8413-4fa5-bc7a-17df0316f10a"
        result = {"ok": True, "requestId": request_id, "projectId": "p", "revision": 0, "result": {}, "warnings": [], "changedIds": []}
        with patch("agent.unified_cli.call", return_value=result) as send:
            self.assertEqual(command("http://127.0.0.1:3002", "cookie", "project.create", args={}, request_id=request_id, dry_run=True), result)
        self.assertEqual(send.call_args.args[4]["requestId"], request_id)
        self.assertTrue(send.call_args.args[4]["dryRun"])

    def test_recovers_committed_result_after_network_timeout(self):
        result = {"ok": True, "requestId": "r", "projectId": "p", "revision": 0, "result": {}, "warnings": [], "changedIds": []}
        with patch("agent.unified_cli.call", side_effect=urllib.error.URLError("timeout")) as send, patch("agent.unified_cli.request_result", return_value=result) as lookup:
            self.assertEqual(command("http://127.0.0.1:3002", "cookie", "project.create"), result)
        request_id = send.call_args.args[4]["requestId"]
        self.assertEqual(lookup.call_args.args[2], request_id)

    def test_retries_busy_command_with_the_same_request_id(self):
        result = {"ok": True, "requestId": "r", "projectId": "p", "revision": 1, "result": {}, "warnings": [], "changedIds": []}
        busy = CliError("busy", 4, status=423, code="WRITER_BUSY", retryable=True)
        with patch("agent.unified_cli.call", side_effect=[{"project": {"revision": 0}}, busy, result]) as send, patch("agent.unified_cli.request_result", return_value=None), patch("agent.unified_cli.time.sleep"):
            self.assertEqual(command("http://127.0.0.1:3002", "cookie", "scene.apply", "p", {}), result)
        first_id = send.call_args_list[1].args[4]["requestId"]
        second_id = send.call_args_list[2].args[4]["requestId"]
        self.assertEqual(first_id, second_id)


class InspectOutputTests(unittest.TestCase):
    def test_inspect_prints_project_manifest_from_project_state_response(self):
        project = {"type": "three-workspace-project", "projectId": "p", "revision": 2}
        state = {"project": project, "history": {"canUndo": True, "canRedo": False}}
        output = io.StringIO()
        with patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
             patch("agent.unified_cli.sys.argv", ["unified_cli.py", "inspect", "p"]), \
             patch("agent.unified_cli.open_session", return_value="cookie"), \
             patch("agent.unified_cli.call", return_value=state), \
             contextlib.redirect_stdout(output):
            self.assertEqual(main(), 0)
        self.assertEqual(json.loads(output.getvalue()), project)


class AssetImportTests(unittest.TestCase):
    def test_upload_sends_raw_bytes_and_encoded_basename(self):
        with tempfile.TemporaryDirectory() as directory:
            asset = Path(directory) / "Rig Test.glb"
            asset.write_bytes(b"glTF")
            response = io.BytesIO(b'{"uploadId":"u1","sha256":"abc"}')
            with patch("agent.unified_cli.urllib.request.urlopen", return_value=response) as send:
                self.assertEqual(upload_file("http://127.0.0.1:3002", "cookie", asset)["uploadId"], "u1")
            request = send.call_args.args[0]
            self.assertEqual(request.data, b"glTF")
            self.assertEqual(request.get_header("Content-type"), "application/octet-stream")
            self.assertEqual(request.get_header("X-file-name"), "Rig%20Test.glb")

    def test_asset_import_command_uploads_files_then_uses_shared_broker(self):
        with tempfile.TemporaryDirectory() as directory:
            asset = Path(directory) / "rig.glb"
            asset.write_bytes(b"glTF")
            output = io.StringIO()
            result = {"ok": True, "requestId": "r1", "projectId": "p1", "revision": 1, "result": {}, "warnings": [], "changedIds": []}
            with patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                 patch("agent.unified_cli.sys.argv", ["unified_cli.py", "asset", "import", "p1", str(asset)]), \
                 patch("agent.unified_cli.open_session", return_value="cookie"), \
                 patch("agent.unified_cli.upload_file", return_value={"uploadId": "u1"}), \
                 patch("agent.unified_cli.command", return_value=result) as send, \
                 contextlib.redirect_stdout(output):
                self.assertEqual(main(), 0)
            self.assertEqual(send.call_args.args[2:4], ("asset.import", "p1"))
            self.assertEqual(send.call_args.args[4], {"files": ["u1"], "format": "auto"})
            self.assertEqual(json.loads(output.getvalue()), result)

    def test_scene_apply_reads_operations_array_and_uses_shared_broker(self):
        with tempfile.TemporaryDirectory() as directory:
            operations_file = Path(directory) / "operations.json"
            operations = [
                {"type": "node.transform.patch", "nodeId": "actor-1", "position": {"x": 1}},
                {"type": "node.clone", "nodeId": "actor-1", "delta": {"position": [1, 0, 0]}},
                {"type": "node.reparent", "nodeId": "actor-1", "parentId": "group-1"},
                {"type": "node.flags.set", "nodeId": "actor-1", "visible": False},
            ]
            operations_file.write_text(json.dumps(operations), encoding="utf-8")
            output = io.StringIO()
            result = {"ok": True, "requestId": "r1", "projectId": "p1", "revision": 3, "result": {}, "warnings": [], "changedIds": ["scene"]}
            with patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                 patch("agent.unified_cli.sys.argv", ["unified_cli.py", "scene", "apply", "p1", str(operations_file)]), \
                 patch("agent.unified_cli.open_session", return_value="cookie"), \
                 patch("agent.unified_cli.command", return_value=result) as send, \
                 contextlib.redirect_stdout(output):
                self.assertEqual(main(), 0)
            self.assertEqual(send.call_args.args[2:5], ("scene.apply", "p1", {"operations": operations}))
            self.assertEqual(json.loads(output.getvalue()), result)

    def test_scene_apply_rejects_non_array_and_oversized_operation_files(self):
        for content in (b"{}", b" " * (64 * 1024 * 1024 + 1)):
            with self.subTest(length=len(content)), tempfile.TemporaryDirectory() as directory:
                operations_file = Path(directory) / "operations.json"
                operations_file.write_bytes(content)
                with patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                     patch("agent.unified_cli.sys.argv", ["unified_cli.py", "scene", "apply", "p1", str(operations_file)]), \
                     patch("agent.unified_cli.open_session", return_value="cookie"), \
                     patch("agent.unified_cli.command") as send, \
                     contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(main(), 2)
                send.assert_not_called()

    def test_scene_render_passes_only_an_opaque_directory_handle_to_the_broker(self):
        with tempfile.TemporaryDirectory() as directory:
            output = io.StringIO()
            result = {"ok": True, "requestId": "r1", "projectId": "p1", "revision": 4, "result": {"jobId": "job"}}
            args = ["unified_cli.py", "scene", "render", "p1", "--frame", "0", "--camera-node-id", "camera_1", "--output-dir", directory]
            with patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                 patch("agent.unified_cli.sys.argv", args), \
                 patch("agent.unified_cli.open_session", return_value="cookie"), \
                 patch("agent.unified_cli.render_scene_job", return_value=result) as render, \
                 contextlib.redirect_stdout(output):
                self.assertEqual(main(), 0)
            self.assertEqual(render.call_args.args[2], "p1")
            self.assertEqual(render.call_args.args[3], {"frames": [0], "camera_node_ids": ["camera_1"], "width": 640, "height": 360})
            self.assertEqual(render.call_args.args[4], Path(directory))
            self.assertEqual(json.loads(output.getvalue()), result)

    def test_scene_render_files_are_confined_and_hash_verified(self):
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            data = b"verified render bytes"
            job_id = "9c0bb2d1-c0e3-42a5-a812-7e9a7b5c37a2"
            job = {"jobId": job_id, "sourceRevision": 4, "result": {"files": [{
                "id": "0", "name": "camera-0-frame-0.png", "sizeBytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            }], "provenance": {"sourceRevision": 4}}}
            with patch("agent.unified_cli.download_file", return_value=data) as download:
                result = save_render_files("http://127.0.0.1:3002", "cookie", "p1", job, Path(directory))
            output_dir = Path(result["outputDirectory"])
            self.assertEqual((output_dir / "camera-0-frame-0.png").read_bytes(), data)
            self.assertEqual(result["sourceRevision"], 4)
            self.assertIn("/files/0", download.call_args.args[2])

            unsafe = {**job, "jobId": "56c9ac71-1464-4fd1-9b40-3940de4af2c7", "result": {"files": [{**job["result"]["files"][0], "name": "../outside.png"}]}}
            download.reset_mock()
            with self.assertRaisesRegex(ValueError, "unsafe artifact name"):
                save_render_files("http://127.0.0.1:3002", "cookie", "p1", unsafe, Path(directory))
            download.assert_not_called()

    def test_scene_render_broker_payload_contains_no_local_output_path(self):
        with tempfile.TemporaryDirectory() as directory:
            job_id = "9c0bb2d1-c0e3-42a5-a812-7e9a7b5c37a2"
            with patch("agent.unified_cli.command", return_value={"result": {"jobId": job_id}}) as start, \
                 patch("agent.unified_cli.call", return_value={"job": {"jobId": job_id, "state": "succeeded", "progress": 1, "result": {}}}), \
                 patch("agent.unified_cli.save_render_files", return_value={"jobId": job_id}) as save, \
                 contextlib.redirect_stderr(io.StringIO()):
                result = render_scene_job("http://127.0.0.1:3002", "cookie", "p1", {
                    "frames": [0], "camera_node_ids": ["camera_1"], "width": 640, "height": 360,
                }, Path(directory), request_id="c5fa84a8-928a-4627-af13-219466f219b0", expected_revision=4)
            self.assertEqual(result, {"jobId": job_id})
            payload = start.call_args.args[4]
            self.assertEqual(payload["outputDirectory"]["kind"], "client-directory")
            self.assertNotIn(directory, json.dumps(payload))
            self.assertEqual(start.call_args.kwargs["expected_revision"], 4)
            save.assert_called_once()

    def test_film_export_cli_sends_project_samples_and_saves_verified_job_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            job_id = "9c0bb2d1-c0e3-42a5-a812-7e9a7b5c37a2"
            args = {"characterIds": ["actor"], "sequenceId": "sequence", "range": {"startFrame": 0, "endFrame": 29},
                    "viewportAspect": 16 / 9, "filmName": "test-film"}
            with patch("agent.unified_cli.command", return_value={"result": {"jobId": job_id}}) as start, \
                 patch("agent.unified_cli.call", return_value={"job": {"jobId": job_id, "state": "succeeded", "progress": 1, "result": {}}}), \
                 patch("agent.unified_cli.save_render_files", return_value={"jobId": job_id}) as save:
                result = export_project_film_job("http://127.0.0.1:3002", "cookie", "p1", args, Path(directory), expected_revision=4)
            self.assertEqual(result, {"jobId": job_id})
            self.assertEqual(start.call_args.args[2:5], ("film.export", "p1", args))
            self.assertEqual(start.call_args.args[5], 4)
            self.assertEqual(save.call_args.args[-1], "film")

    def test_film_project_export_command(self):
        with tempfile.TemporaryDirectory() as directory:
            output = io.StringIO()
            result = {"jobId": "job-1", "files": ["test-film.zip"]}
            with patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                 patch("agent.unified_cli.sys.argv", ["unified_cli.py", "film", "project-export", "p1", "--character-id", "actor", "--sequence-id", "seq", "--start-frame", "0", "--end-frame", "29", "--viewport-aspect", "1.7778", "--film-name", "test-film", "--output-dir", directory]), \
                 patch("agent.unified_cli.open_session", return_value="cookie"), \
                 patch("agent.unified_cli.export_project_film_job", return_value=result) as export, \
                 contextlib.redirect_stdout(output):
                self.assertEqual(main(), 0)
            self.assertEqual(export.call_args.args[2:4], ("p1", {
                "characterIds": ["actor"], "sequenceId": "seq", "range": {"startFrame": 0, "endFrame": 29},
                "viewportAspect": 1.7778, "filmName": "test-film",
            }))
            self.assertEqual(json.loads(output.getvalue()), result)

    def test_asset_relink_uploads_file_and_uses_shared_broker(self):
        with tempfile.TemporaryDirectory() as directory:
            asset = Path(directory) / "restored.glb"
            asset.write_bytes(b"glTF")
            output = io.StringIO()
            result = {"ok": True, "requestId": "r1", "projectId": "p1", "revision": 2, "result": {}, "warnings": [], "changedIds": []}
            with patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                 patch("agent.unified_cli.sys.argv", ["unified_cli.py", "asset", "relink", "p1", "sha256:abc", str(asset)]), \
                 patch("agent.unified_cli.open_session", return_value="cookie"), \
                 patch("agent.unified_cli.upload_file", return_value={"uploadId": "u1"}), \
                 patch("agent.unified_cli.command", return_value=result) as send, \
                 contextlib.redirect_stdout(output):
                self.assertEqual(main(), 0)
            self.assertEqual(send.call_args.args[2:5], ("asset.relink", "p1", {"assetId": "sha256:abc", "file": "u1"}))
            self.assertEqual(json.loads(output.getvalue()), result)

    def test_character_add_and_camera_shot_use_the_shared_broker(self):
        result = {"ok": True, "requestId": "r1", "projectId": "p1", "revision": 1, "result": {}, "warnings": [], "changedIds": []}
        cases = (
            (["character", "add", "p1", "sha256:abc", "profile-1", "Hero"], "character.add", {"assetId": "sha256:abc", "skeletonId": "profile-1", "name": "Hero"}),
            (["character", "add", "p1", "sha256:abc", "profile-1", "Hero", "--parent-node-id", "group-1"], "character.add", {"assetId": "sha256:abc", "skeletonId": "profile-1", "name": "Hero", "parentNodeId": "group-1"}),
            (["prop", "add", "p1", "sha256:abc", "Table"], "prop.add", {"assetId": "sha256:abc", "name": "Table"}),
            (["prop", "add", "p1", "sha256:abc", "Chair", "--parent-node-id", "group-1"], "prop.add", {"assetId": "sha256:abc", "name": "Chair", "parentNodeId": "group-1"}),
            (["camera", "shot", "p1", "sequence-1", "shot-1", "camera-1", "0", "29"], "camera.shot.set", {
                "sequenceId": "sequence-1", "clip": {"id": "shot-1", "cameraNodeId": "camera-1", "sourceFrameStart": 0, "sourceFrameEnd": 29},
            }),
            (["motion", "place", "p1", "motion-1", "character-1", "--frame-start", "45", "--source-start", "0.25", "--source-length", "0.75", "--speed", "2", "--loop", "--reverse"], "motion.place", {
                "motionId": "motion-1", "characterId": "character-1", "frameStart": 45, "sourceStartSeconds": 0.25, "sourceLengthSeconds": 0.75,
                "speed": 2.0, "loop": True, "reverse": True,
            }),
        )
        for argv, command_name, payload in cases:
            with self.subTest(command=command_name):
                output = io.StringIO()
                with patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                     patch("agent.unified_cli.sys.argv", ["unified_cli.py", *argv]), \
                     patch("agent.unified_cli.open_session", return_value="cookie"), \
                     patch("agent.unified_cli.command", return_value=result) as send, \
                     contextlib.redirect_stdout(output):
                    self.assertEqual(main(), 0)
                self.assertEqual(send.call_args.args[2:5], (command_name, "p1", payload))

    def test_character_and_prop_add_forward_transform_files(self):
        transform = {"position": {"x": 1, "y": 2, "z": 3}, "rotation": {"x": 0, "y": 90, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1}}
        result = {"ok": True, "requestId": "r1", "projectId": "p1", "revision": 1, "result": {}, "warnings": [], "changedIds": []}
        with tempfile.TemporaryDirectory() as directory:
            transform_file = Path(directory) / "transform.json"
            transform_file.write_text(json.dumps(transform), encoding="utf-8")
            cases = (
                (["character", "add", "p1", "sha256:abc", "profile-1", "Hero", "--transform", str(transform_file)], "character.add", {"assetId": "sha256:abc", "skeletonId": "profile-1", "name": "Hero", "transform": transform}),
                (["prop", "add", "p1", "sha256:abc", "Table", "--transform", str(transform_file)], "prop.add", {"assetId": "sha256:abc", "name": "Table", "transform": transform}),
            )
            for argv, command_name, payload in cases:
                with self.subTest(command=command_name):
                    output = io.StringIO()
                    with patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                         patch("agent.unified_cli.sys.argv", ["unified_cli.py", *argv]), \
                         patch("agent.unified_cli.open_session", return_value="cookie"), \
                         patch("agent.unified_cli.command", return_value=result) as send, \
                         contextlib.redirect_stdout(output):
                        self.assertEqual(main(), 0)
                    self.assertEqual(send.call_args.args[2:5], (command_name, "p1", payload))


class FbxAssetImportTests(unittest.TestCase):
    def test_fbx_import_requires_and_forwards_an_explicit_finite_unit(self):
        with tempfile.TemporaryDirectory() as directory:
            asset = Path(directory) / 'character.fbx'
            asset.write_bytes(b'FBX test')
            for options, expected in [([], 2), (['--unit-meters', 'nan'], 2), (['--unit-meters', '0'], 2), (['--unit-meters', '0.01'], 0)]:
                with self.subTest(options=options), \
                     patch('agent.unified_cli.sys.argv', ['unified_cli.py', 'asset', 'import', 'p1', str(asset), '--format', 'fbx', *options]), \
                     patch('agent.unified_cli.open_session', return_value='cookie'), \
                     patch('agent.unified_cli.upload_file', return_value={'uploadId': 'u1'}) as upload, \
                     patch('agent.unified_cli.command', return_value={'ok': True}) as send, \
                     contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(main(), expected)
                    if expected == 0:
                        self.assertEqual(send.call_args.args[4], {'files': ['u1'], 'format': 'fbx', 'unitMeters': 0.01})
                    else:
                        send.assert_not_called()
                        upload.assert_not_called()


class MotionBindingTests(unittest.TestCase):
    def test_binding_edit_requires_the_original_snapshot_revision(self):
        with patch('agent.unified_cli.call') as call:
            with self.assertRaisesRegex(ValueError, 'edited snapshot'):
                command('http://127.0.0.1:3002', 'cookie', 'motion.binding.set', 'p1', {})
            call.assert_not_called()
            call.return_value = {'ok': True}
            command('http://127.0.0.1:3002', 'cookie', 'motion.binding.set', 'p1', {}, expected_revision=7)
            self.assertEqual(call.call_args.args[4]['expectedRevision'], 7)
            self.assertEqual(call.call_count, 1)

    def test_binding_set_reads_bounded_objects_and_forwards_them(self):
        with tempfile.TemporaryDirectory() as directory:
            binding_file = Path(directory) / 'binding.json'
            patch_file = Path(directory) / 'patch.json'
            binding = {"clipId": "clip-1", "sourceStartSeconds": 0.25}
            clip_patch = {"frameStart": 30, "frameEnd": 59, "playback": {"speed": 2, "loop": True}}
            binding_file.write_text(json.dumps(binding), encoding='utf-8')
            patch_file.write_text(json.dumps(clip_patch), encoding='utf-8')
            with patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                 patch('agent.unified_cli.sys.argv', ['unified_cli.py', 'motion', 'binding', 'set', 'p1', str(binding_file), '--expected-revision', '7', '--clip-patch', str(patch_file)]), \
                 patch('agent.unified_cli.open_session', return_value='cookie'), \
                 patch('agent.unified_cli.command', return_value={"ok": True}) as send, \
                 contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(), 0)
                self.assertEqual(send.call_args.args[2:5], ('motion.binding.set', 'p1', {"binding": binding, "clipPatch": clip_patch}))
                self.assertEqual(send.call_args.kwargs['expected_revision'], 7)
                binding_file.write_text('[]', encoding='utf-8')
                send.reset_mock()
                self.assertEqual(main(), 2)
                send.assert_not_called()


class RetargetSessionTests(unittest.TestCase):
    def test_session_set_reads_v912_json_and_calls_shared_broker(self):
        with tempfile.TemporaryDirectory() as directory:
            project_file = Path(directory) / "retarget.json"
            native_project = {"type": "mixamo-retarget-project", "version": 1}
            project_file.write_text(json.dumps(native_project), encoding="utf-8")
            output = io.StringIO()
            result = {"ok": True, "requestId": "r1", "projectId": "p1", "revision": 2, "result": {}, "warnings": [], "changedIds": []}
            with patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                 patch("agent.unified_cli.sys.argv", ["unified_cli.py", "retarget", "session", "set", "p1", "motion-1", "character-1", "mapping-1", str(project_file), "--session-id", "session-1"]), \
                 patch("agent.unified_cli.open_session", return_value="cookie"), \
                 patch("agent.unified_cli.command", return_value=result) as send, \
                 contextlib.redirect_stdout(output):
                self.assertEqual(main(), 0)
            self.assertEqual(send.call_args.args[2:5], ("retarget.session.set", "p1", {
                "sourceMotionId": "motion-1", "targetCharacterId": "character-1", "mappingId": "mapping-1",
                "nativeProject": native_project, "sessionId": "session-1",
            }))
            self.assertEqual(json.loads(output.getvalue()), result)

    def test_session_set_rejects_oversized_or_non_object_json_before_dispatch(self):
        for content in (b" " * (12 * 1024 * 1024 + 1), b"[]"):
            with self.subTest(length=len(content)), tempfile.TemporaryDirectory() as directory:
                project_file = Path(directory) / "retarget.json"
                project_file.write_bytes(content)
                with patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                     patch("agent.unified_cli.sys.argv", ["unified_cli.py", "retarget", "session", "set", "p1", "motion-1", "character-1", "mapping-1", str(project_file)]), \
                     patch("agent.unified_cli.open_session", return_value="cookie"), \
                     patch("agent.unified_cli.command") as send, \
                     contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(main(), 2)
                send.assert_not_called()


class FilmExportCliTests(unittest.TestCase):
    def test_film_export_runs_offline_worker_without_opening_studio_session(self):
        result = {"ok": True, "packageDirectory": "C:/exports/test", "nativeReadback": True}
        output = io.StringIO()
        with patch("agent.unified_cli.sys.argv", ["unified_cli.py", "film", "export", "manifest.json", "--output-dir", "exports"]), \
             patch("agent.unified_cli.run_film_worker", return_value=result) as worker, \
             patch("agent.unified_cli.open_session") as session, \
             contextlib.redirect_stdout(output):
            self.assertEqual(main(), 0)
        worker.assert_called_once_with(Path("manifest.json"), Path("exports"))
        session.assert_not_called()
        self.assertEqual(json.loads(output.getvalue()), result)


class FilmModelConverterCliTests(unittest.TestCase):
    def test_convert_model_dispatches_local_source_units_and_output_directory(self):
        result = {"ok": True, "modelId": "unified/0123456789abcdef"}
        output = io.StringIO()
        with patch("agent.unified_cli.sys.argv", ["unified_cli.py", "film", "convert-model", "actor.fbx", "--unit-meters", "0.01", "--output-dir", "converted"]), \
             patch("agent.unified_cli.convert_film_model", return_value=result) as convert, \
             contextlib.redirect_stdout(output):
            self.assertEqual(main(), 0)
        convert.assert_called_once_with(Path("actor.fbx"), Path("converted"), 0.01, [1, 0, 0, 0, 1, 0, 0, 0, 1])
        self.assertEqual(json.loads(output.getvalue()), result)

    def test_convert_model_passes_source_basis_to_converter(self):
        basis = [1, 0, 0, 0, 0, 1, 0, -1, 0]
        with patch("agent.unified_cli.sys.argv", ["unified_cli.py", "film", "convert-model", "actor.glb", "--output-dir", "converted", "--basis", *map(str, basis)]), \
             patch("agent.unified_cli.convert_film_model", return_value={"ok": True}) as convert, \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(), 0)
        convert.assert_called_once_with(Path("actor.glb"), Path("converted"), None, basis)

    def test_missing_blender_maps_to_local_capability_exit_code(self):
        from .film_model_converter import BlenderUnavailableError
        with patch("agent.unified_cli.sys.argv", ["unified_cli.py", "film", "convert-model", "actor.glb", "--output-dir", "converted"]), \
             patch("agent.unified_cli.convert_film_model", side_effect=BlenderUnavailableError("Blender missing")), \
             contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(), 4)


if __name__ == "__main__":
    unittest.main()


class ShotExchangeTests(unittest.TestCase):
    def test_export_downloads_verified_shot_zip_and_retains_shot_identity(self):
        import hashlib
        from .unified_cli import export_shot_job
        data = b'example-shot-zip'
        job_id = '781b9abb-f2a5-40b3-a441-3d9674e1b74a'
        job = {'jobId': job_id, 'state': 'succeeded', 'result': {'files': [
            {'id': '0', 'name': 'shot.zip', 'sizeBytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}}
        response = {'result': {'jobId': job_id, 'shotId': 'saved-shot', 'baseShotSha256': 'a'*64}}
        with tempfile.TemporaryDirectory() as folder, patch('agent.unified_cli.command', return_value=response) as send, \
             patch('agent.unified_cli.call', return_value={'job': job}), patch('agent.unified_cli.download_file', return_value=data):
            result = export_shot_job('http://localhost:3002', 'cookie', 'project', {'cameraNodeId': 'camera'}, Path(folder), expected_revision=7)
            self.assertEqual(result['result']['shotId'], 'saved-shot')
            self.assertEqual((Path(result['savedFiles']['outputDirectory'])/'shot.zip').read_bytes(), data)
            self.assertEqual(send.call_args.args[2:6], ('shot.export', 'project', {'cameraNodeId': 'camera'}, 7))

    def test_shot_cli_export_and_import_forward_payload_and_revision(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)/'result.zip'; source.write_bytes(b'ZIP')
            for argv, expected in [
                (['export', 'project', '--camera-node-id', 'cam', '--start-frame', '3', '--end-frame', '15', '--editable-character-id', 'a', '--output-dir', folder, '--expected-revision', '7'], 'export'),
                (['import-result', 'project', str(source), '--shot-id', 'shot', '--expected-revision', '7'], 'import')]:
                with self.subTest(expected=expected), patch.dict(os.environ, {'BBS_APP_URL':'http://localhost:3002'}), \
                     patch('agent.unified_cli.sys.argv', ['cli', 'shot', *argv]), patch('agent.unified_cli.open_session', return_value='cookie'), \
                     patch('agent.unified_cli.export_shot_job', return_value={'ok':True}) as export, \
                     patch('agent.unified_cli.upload_file', return_value={'uploadId':'staged'}) as upload, \
                     patch('agent.unified_cli.command', return_value={'ok':True}) as send, contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(main(), 0)
                    if expected == 'export':
                        self.assertEqual(export.call_args.args[3], {'cameraNodeId':'cam', 'frameStart':3, 'frameEnd':15, 'editableCharacterIds':['a']})
                        self.assertEqual(export.call_args.kwargs, {'expected_revision':7})
                        upload.assert_not_called()
                    else:
                        upload.assert_called_once_with('http://localhost:3002', 'cookie', source)
                        self.assertEqual(send.call_args.args[2:], ('shot.result.import', 'project', {'file':'staged','shotId':'shot'}))
                        self.assertEqual(send.call_args.kwargs, {'expected_revision':7})

    def test_import_result_requires_exact_revision_before_network(self):
        with patch('agent.unified_cli.call') as network:
            for revision in (None, True, -1):
                with self.subTest(revision=revision), self.assertRaises(ValueError):
                    command('http://localhost:3002', 'cookie', 'shot.result.import', 'project', {}, expected_revision=revision)
            network.assert_not_called()
