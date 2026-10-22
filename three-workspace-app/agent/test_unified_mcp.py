import json
import unittest
import uuid
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

from . import unified_mcp


def request(method, params=None, request_id=1, version=unified_mcp.PROTOCOL_VERSION):
    return {
        "jsonrpc": "2.0", "id": request_id, "method": method,
        "params": {**(params or {}), "_meta": {
            "io.modelcontextprotocol/protocolVersion": version,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {"name": "test-client", "version": "1.0"},
        }},
    }


class ProtocolTests(unittest.TestCase):
    def test_discover_and_tools_list_advertise_the_supported_stateless_protocol(self):
        discovered = unified_mcp.handle_message(request("server/discover"))
        self.assertEqual(discovered["result"]["supportedVersions"], ["2026-07-28"])
        self.assertIn("io.modelcontextprotocol/serverInfo", discovered["result"]["_meta"])
        self.assertEqual((discovered["result"]["ttlMs"], discovered["result"]["cacheScope"]), (0, "private"))
        listed = unified_mcp.handle_message(request("tools/list"))
        self.assertEqual([tool["name"] for tool in listed["result"]["tools"]], ["bbs_unified_command", "library.search", "library.get", "library.characters"])
        self.assertEqual((listed["result"]["ttlMs"], listed["result"]["cacheScope"]), (0, "private"))
        commands = listed["result"]["tools"][0]["inputSchema"]["properties"]["command"]["enum"]
        self.assertIn("scene.apply", commands)
        self.assertIn("prop.add", commands)
        self.assertIn("retarget.session.set", commands)
        self.assertIn("motion.place", commands)
        self.assertIn("motion.binding.set", commands)
        self.assertIn("scene.render", commands)
        self.assertIn("film.export", commands)
        self.assertIn("job.get", commands)
        self.assertIn("job.cancel", commands)
        for name in ('rig.inspect', 'rig.normalization.plan', 'rig.normalization.run', 'animation.assignment.plan', 'animation.assignment.run', 'animation.assignment.commit'):
            self.assertIn(name, commands)
        self.assertNotIn("asset.import", commands)
        self.assertNotIn("retarget.bake", commands)

    def test_library_tools_search_get_and_list_characters_from_external_index(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            action = {"uuid": "action-uuid", "name": "Happy walk", "rig": "mixamo65", "category": "locomotion", "tags": ["walk", "happy"], "packId": "0123456789abcdef"}
            (root / "index.json").write_text(json.dumps({"actions": [action], "characters": [{"charId": "hero"}]}), encoding="utf-8")
            pack = root / "packs" / action["packId"]
            pack.mkdir(parents=True)
            (pack / "meta.json").write_text(json.dumps({"actions": [action]}), encoding="utf-8")
            (pack / "anim.glb").write_bytes(b"glb")
            (pack / "anim.manifest.json").write_text(json.dumps({"actions": []}), encoding="utf-8")
            with patch.dict("os.environ", {"W01_LIBRARY": directory}):
                self.assertEqual(unified_mcp._library_call("library.search", {"rig": "mixamo65", "tags": ["walk"]})["total"], 1)
                self.assertEqual(unified_mcp._library_call("library.characters", {})["characters"], [{"charId": "hero"}])
                self.assertEqual(unified_mcp._library_call("library.get", {"actionUuid": "action-uuid"})["action"], action)

    def test_requires_modern_metadata_and_reports_version_mismatch(self):
        missing = unified_mcp.handle_message({"jsonrpc": "2.0", "id": "a", "method": "tools/list", "params": {}})
        self.assertEqual(missing["error"]["code"], -32602)
        mismatch = unified_mcp.handle_message(request("tools/list", version="2025-11-25"))
        self.assertEqual(mismatch["error"]["code"], -32022)
        self.assertEqual(mismatch["error"]["data"]["supported"], ["2026-07-28"])
        legacy = unified_mcp.handle_message({"jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {"protocolVersion": "2025-11-25"}})
        self.assertEqual(legacy["error"]["code"], -32022)

    def test_command_tool_calls_shared_client_with_stable_request_id(self):
        request_id = str(uuid.uuid4())
        invoke = Mock(return_value={"ok": True, "revision": 4, "result": {"sceneSequence": 4}})
        response = unified_mcp.handle_message(request("tools/call", {
            "name": "bbs_unified_command",
            "arguments": {"command": "scene.apply", "projectId": str(uuid.uuid4()), "expectedRevision": 3,
                          "requestId": request_id, "dryRun": True, "args": {"operations": [
                              {"type": "node.clone", "nodeId": "actor-1", "delta": {"position": [1, 0, 0]}},
                              {"type": "node.reparent", "nodeId": "actor-1", "parentId": "group-1"},
                          ]}},
        }), invoke)
        payload = invoke.call_args.args[0]
        self.assertEqual(payload["requestId"], request_id)
        self.assertEqual(payload["expectedRevision"], 3)
        self.assertTrue(payload["dryRun"])
        self.assertEqual(payload["args"]["operations"][0]["type"], "node.clone")
        self.assertEqual(payload["args"]["operations"][1]["type"], "node.reparent")
        self.assertEqual(response["result"]["resultType"], "complete")
        self.assertEqual(response["result"]["structuredContent"]["revision"], 4)

    def test_invalid_tool_input_is_reported_as_tool_error_without_dispatch(self):
        invoke = Mock()
        response = unified_mcp.handle_message(request("tools/call", {
            "name": "bbs_unified_command",
            "arguments": {"command": "retarget.bake", "args": {}, "projectId": str(uuid.uuid4())},
        }), invoke)
        self.assertTrue(response["result"]["isError"])
        self.assertFalse(invoke.called)

    def test_scene_render_keeps_output_path_on_the_mcp_client(self):
        with tempfile.TemporaryDirectory() as directory:
            project_id = str(uuid.uuid4())
            job_id = str(uuid.uuid4())
            started = {"ok": True, "projectId": project_id, "revision": 2, "result": {"jobId": job_id}}
            with patch.object(unified_mcp, "local_base", return_value="http://127.0.0.1:3002"), \
                 patch.object(unified_mcp, "open_session", return_value="cookie"), \
                 patch.object(unified_mcp, "command", return_value=started) as render:
                response = unified_mcp.run_unified_command({
                    "command": "scene.render", "projectId": project_id, "args": {
                        "frames": [0], "cameraNodeIds": ["camera_1"], "width": 640, "height": 360,
                        "outputDirectory": {"path": directory},
                    }, "dryRun": False,
                })
            self.assertEqual(response, started)
            self.assertEqual(render.call_args.args[2:4], ("scene.render", project_id))
            payload = render.call_args.args[4]
            self.assertEqual({key: value for key, value in payload.items() if key != "outputDirectory"}, {
                "frames": [0], "cameraNodeIds": ["camera_1"], "width": 640, "height": 360,
            })
            self.assertEqual(payload["outputDirectory"]["kind"], "client-directory")
            self.assertNotIn(directory, json.dumps(payload))
            self.assertEqual(unified_mcp.MCP_RENDER_DIRS[job_id], (project_id, Path(directory).resolve(), "render"))
            unified_mcp.MCP_RENDER_DIRS.pop(job_id)

    def test_film_export_keeps_output_path_on_the_mcp_client(self):
        with tempfile.TemporaryDirectory() as directory:
            project_id, job_id = str(uuid.uuid4()), str(uuid.uuid4())
            started = {"ok": True, "projectId": project_id, "revision": 2, "result": {"jobId": job_id}}
            with patch.object(unified_mcp, "local_base", return_value="http://127.0.0.1:3002"), \
                 patch.object(unified_mcp, "open_session", return_value="cookie"), \
                 patch.object(unified_mcp, "command", return_value=started) as export:
                response = unified_mcp.run_unified_command({
                    "command": "film.export", "projectId": project_id, "args": {
                        "characterIds": ["actor"], "sequenceId": "sequence", "range": {"startFrame": 0, "endFrame": 29},
                        "viewportAspect": 16 / 9, "filmName": "test-film", "outputDirectory": {"path": directory},
                    }, "dryRun": False,
                })
            self.assertEqual(response, started)
            self.assertEqual(export.call_args.args[2:4], ("film.export", project_id))
            self.assertNotIn("outputDirectory", export.call_args.args[4])
            self.assertNotIn(directory, json.dumps(export.call_args.args[4]))
            self.assertEqual(unified_mcp.MCP_RENDER_DIRS[job_id], (project_id, Path(directory).resolve(), "film"))
            unified_mcp.MCP_RENDER_DIRS.pop(job_id)

    def test_job_get_saves_only_succeeded_mcp_render_files(self):
        project_id, job_id = str(uuid.uuid4()), str(uuid.uuid4())
        job = {"jobId": job_id, "state": "succeeded", "result": {"files": []}}
        response = {"ok": True, "projectId": project_id, "result": {"job": job}}
        unified_mcp.MCP_RENDER_DIRS[job_id] = (project_id, Path("/approved/render-output"), "film")
        try:
            with patch.object(unified_mcp, "local_base", return_value="http://127.0.0.1:3002"), \
                 patch.object(unified_mcp, "open_session", return_value="cookie"), \
                 patch.object(unified_mcp, "command", return_value=response), \
                 patch.object(unified_mcp, "save_render_files", return_value={"outputDirectory": "/approved/render-output"}) as save:
                result = unified_mcp.run_unified_command({
                    "command": "job.get", "projectId": project_id, "args": {"jobId": job_id}, "dryRun": False,
                })
            self.assertEqual(result["result"]["savedFiles"]["outputDirectory"], "/approved/render-output")
            save.assert_called_once()
            self.assertEqual(save.call_args.args[-1], "film")
        finally:
            unified_mcp.MCP_RENDER_DIRS.pop(job_id, None)

    def test_render_retry_keeps_the_same_broker_payload_after_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            arguments = {"command": "scene.render", "projectId": str(uuid.uuid4()),
                         "requestId": str(uuid.uuid4()), "expectedRevision": 2, "dryRun": False,
                         "args": {"frames": [0], "cameraNodeIds": ["camera_1"], "width": 64, "height": 64,
                                  "outputDirectory": {"path": directory}}}
            with patch.object(unified_mcp, "local_base", return_value="http://127.0.0.1:3002"), \
                 patch.object(unified_mcp, "open_session", return_value="cookie"), \
                 patch.object(unified_mcp, "command", return_value={"ok": True, "result": {}}) as render:
                unified_mcp.run_unified_command(arguments)
                unified_mcp.run_unified_command(arguments)
            self.assertEqual(render.call_args_list[0], render.call_args_list[1])

    def test_notifications_do_not_receive_responses(self):
        self.assertIsNone(unified_mcp.handle_message({"jsonrpc": "2.0", "method": "notifications/initialized"}))

    def test_transport_reuses_cli_broker_client_and_forwards_idempotency_fields(self):
        arguments = {"command": "history.undo", "projectId": str(uuid.uuid4()), "args": {}, "expectedRevision": 3,
                     "requestId": str(uuid.uuid4()), "dryRun": True}
        with patch("agent.unified_mcp.local_base", return_value="http://127.0.0.1:3002"), \
             patch("agent.unified_mcp.open_session", return_value="cookie"), \
             patch("agent.unified_mcp.command", return_value={"ok": True}) as broker:
            self.assertEqual(unified_mcp.run_unified_command(arguments), {"ok": True})
        self.assertEqual(broker.call_args.args[2:], ("history.undo", arguments["projectId"], {}, 3, arguments["requestId"], True))

    def test_retarget_session_command_is_forwarded_with_validated_json_snapshot(self):
        native_project = {"type": "mixamo-retarget-project", "version": 1}
        invoke = Mock(return_value={"ok": True, "revision": 5})
        response = unified_mcp.handle_message(request("tools/call", {
            "name": "bbs_unified_command",
            "arguments": {"command": "retarget.session.set", "projectId": str(uuid.uuid4()), "args": {
                "sourceMotionId": str(uuid.uuid4()), "targetCharacterId": str(uuid.uuid4()),
                "mappingId": str(uuid.uuid4()), "nativeProject": native_project,
            }},
        }), invoke)
        self.assertFalse(response["result"]["isError"])
        self.assertEqual(invoke.call_args.args[0]["command"], "retarget.session.set")
        self.assertEqual(invoke.call_args.args[0]["args"]["nativeProject"], native_project)

    def test_retarget_session_rejects_oversized_snapshot_before_dispatch(self):
        invoke = Mock()
        response = unified_mcp.handle_message(request("tools/call", {
            "name": "bbs_unified_command",
            "arguments": {"command": "retarget.session.set", "projectId": str(uuid.uuid4()), "args": {
                "nativeProject": {"payload": "x" * (12 * 1024 * 1024)},
            }},
        }), invoke)
        self.assertTrue(response["result"]["isError"])
        self.assertFalse(invoke.called)

    def test_prop_add_is_forwarded_through_the_shared_command_tool(self):
        project_id = str(uuid.uuid4())
        invoke = Mock(return_value={"ok": True, "revision": 2, "result": {"nodeId": "prop-1"}})
        response = unified_mcp.handle_message(request("tools/call", {
            "name": "bbs_unified_command",
            "arguments": {"command": "prop.add", "projectId": project_id, "args": {"assetId": f"sha256:{'a' * 64}", "name": "Table"}},
        }), invoke)
        self.assertFalse(response["result"]["isError"])
        self.assertEqual(invoke.call_args.args[0]["command"], "prop.add")
        self.assertEqual(invoke.call_args.args[0]["args"]["name"], "Table")

    def test_motion_binding_set_is_forwarded_through_the_shared_command_tool(self):
        payload = {"binding": {"clipId": "clip-1"}, "clipPatch": {"frameStart": 30, "playback": {"loop": True}}}
        invoke = Mock(return_value={"ok": True, "revision": 4})
        response = unified_mcp.handle_message(request('tools/call', {
            'name': 'bbs_unified_command', 'arguments': {'command': 'motion.binding.set', 'projectId': str(uuid.uuid4()), 'expectedRevision': 3, 'args': payload},
        }), invoke)
        self.assertFalse(response['result']['isError'])
        self.assertEqual(invoke.call_args.args[0]['args'], payload)
        self.assertEqual(invoke.call_args.args[0]['expectedRevision'], 3)
        invoke.reset_mock()
        rejected = unified_mcp.handle_message(request('tools/call', {
            'name': 'bbs_unified_command', 'arguments': {'command': 'motion.binding.set', 'projectId': str(uuid.uuid4()), 'args': payload},
        }), invoke)
        self.assertTrue(rejected['result']['isError'])
        invoke.assert_not_called()

    def test_motion_place_is_forwarded_through_the_shared_command_tool(self):
        project_id = str(uuid.uuid4())
        invoke = Mock(return_value={"ok": True, "revision": 3, "result": {"clipId": "clip-1"}})
        response = unified_mcp.handle_message(request("tools/call", {
            "name": "bbs_unified_command",
            "arguments": {"command": "motion.place", "projectId": project_id, "args": {
                "motionId": str(uuid.uuid4()), "characterId": str(uuid.uuid4()), "frameStart": 45,
                "sourceStartSeconds": 0.25, "sourceLengthSeconds": 0.75, "speed": 2, "loop": True, "reverse": True,
            }},
        }), invoke)
        self.assertFalse(response["result"]["isError"])
        self.assertEqual(invoke.call_args.args[0]["command"], "motion.place")
        self.assertEqual(invoke.call_args.args[0]["args"]["frameStart"], 45)
        self.assertEqual(invoke.call_args.args[0]["args"]["speed"], 2)
        self.assertIs(invoke.call_args.args[0]["args"]["loop"], True)
        self.assertEqual(invoke.call_args.args[0]["args"]["sourceStartSeconds"], 0.25)
        self.assertIs(invoke.call_args.args[0]["args"]["reverse"], True)

    def test_normalization_commands_forward_and_run_requires_explicit_revision(self):
        project_id = str(uuid.uuid4())
        for name in ('rig.inspect', 'rig.normalization.plan', 'animation.assignment.plan', 'rig.normalization.run', 'animation.assignment.run', 'animation.assignment.commit'):
            with self.subTest(name=name):
                invoke = Mock(return_value={'ok': True, 'result': {}})
                arguments = {'command': name, 'projectId': project_id, 'args': {'probe': 'host validates schema'}}
                if name in ('rig.normalization.plan', 'rig.normalization.run'):
                    arguments['args'] = {'rootTranslationScale': 1.25}
                if name in ('rig.normalization.run', 'animation.assignment.run', 'animation.assignment.commit'):
                    rejected = unified_mcp.handle_message(request('tools/call', {'name': 'bbs_unified_command', 'arguments': arguments}), invoke)
                    self.assertTrue(rejected['result']['isError'])
                    invoke.assert_not_called()
                    arguments['expectedRevision'] = 7
                response = unified_mcp.handle_message(request('tools/call', {'name': 'bbs_unified_command', 'arguments': arguments}), invoke)
                self.assertFalse(response['result']['isError'])
                self.assertEqual(invoke.call_args.args[0]['command'], name)
                self.assertEqual(invoke.call_args.args[0]['args'], arguments['args'])


if __name__ == "__main__":
    unittest.main()


class ShotExchangeTests(unittest.TestCase):
    def test_shot_commands_advertised_and_import_requires_revision(self):
        self.assertIn('shot.export', unified_mcp.SUPPORTED_COMMANDS)
        self.assertIn('shot.result.import', unified_mcp.SUPPORTED_COMMANDS)
        invoke = Mock(return_value={'ok': True})
        arguments = {'command':'shot.result.import', 'projectId':'project', 'args':{'file':'result.zip', 'shotId':'shot'}}
        with self.assertRaisesRegex(ValueError, 'expectedRevision'):
            unified_mcp._tool_call(arguments, invoke)
        invoke.assert_not_called()
        unified_mcp._tool_call({**arguments, 'expectedRevision':7}, invoke)
        self.assertEqual(invoke.call_args.args[0]['expectedRevision'], 7)

    def test_shot_export_strips_client_path_and_job_get_downloads(self):
        job_id = str(uuid.uuid4())
        with tempfile.TemporaryDirectory() as folder, patch('agent.unified_mcp.local_base', return_value='base'), \
             patch('agent.unified_mcp.open_session', return_value='cookie'), \
             patch('agent.unified_mcp.command', return_value={'result':{'jobId':job_id}}) as send, \
             patch('agent.unified_mcp.save_render_files', return_value={'files':['shot.zip']}) as save:
            arguments = {'command':'shot.export','projectId':'project','args':{'outputDirectory':{'path':folder},'cameraNodeId':'cam'},'dryRun':False}
            unified_mcp.run_unified_command(arguments)
            self.assertEqual(send.call_args.args[3:5], ('project', {'cameraNodeId':'cam'}))
            send.return_value = {'result':{'job':{'jobId':job_id,'state':'succeeded'}}}
            response = unified_mcp.run_unified_command({'command':'job.get','projectId':'project','args':{'jobId':job_id},'dryRun':False})
            self.assertEqual(response['result']['savedFiles']['files'], ['shot.zip'])
            self.assertEqual(save.call_args.args[-1], 'shot')
            self.assertNotIn(job_id, unified_mcp.MCP_RENDER_DIRS)

    def test_import_result_stages_zip_without_sending_local_path(self):
        with tempfile.TemporaryDirectory() as folder, patch('agent.unified_mcp.local_base', return_value='base'), \
             patch('agent.unified_mcp.open_session', return_value='cookie'), \
             patch('agent.unified_mcp.upload_file', return_value={'uploadId':'staged'}) as upload, \
             patch('agent.unified_mcp.command', return_value={'ok':True}) as send:
            file = Path(folder)/'result.zip'; file.write_bytes(b'zip')
            arguments = {'command':'shot.result.import','projectId':'project','args':{'file':str(file),'shotId':'shot'},'expectedRevision':7,'dryRun':False}
            unified_mcp.run_unified_command(arguments)
            upload.assert_called_once_with('base','cookie',file)
            self.assertEqual(send.call_args.args[4:6], ({'file':'staged','shotId':'shot'},7))
            self.assertEqual(arguments['args']['file'], str(file))
