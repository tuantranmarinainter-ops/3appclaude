import json
import subprocess
import sys
import unittest
import uuid
from unittest.mock import patch

from . import app3_mcp as m

META = {"io.modelcontextprotocol/protocolVersion": m.PROTOCOL_VERSION, "io.modelcontextprotocol/clientCapabilities": {}}

def payload(command="app3.command.submit"):
    identity = {k: str(uuid.uuid4()) for k in ("sessionId", "epoch", "characterId", "serverInstance")}
    args = {} if command == "app3.session.list" else identity
    if command == "app3.command.submit":
        args.update(tool="read_keyframes", parameters={"start": 0, "end": 1})
    if command == "app3.command.result":
        args["commandId"] = str(uuid.uuid4())
    return {"command": command, "projectId": str(uuid.uuid4()), "args": args, "requestId": str(uuid.uuid4())}

class App3MCPTests(unittest.TestCase):
    def test_all_four_commands_validate(self):
        for command in m.COMMANDS:
            self.assertEqual(m.validate(payload(command))["command"], command)

    def test_schema_only_advertises_read_tools(self):
        response = m.handle_message({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {"_meta": META}})
        tool = response["result"]["tools"][0]
        self.assertEqual(tool["inputSchema"]["properties"]["command"]["enum"], list(m.COMMANDS))
        self.assertNotIn("apply_patch", tool["description"])

    def test_rejects_mutations_and_receiver_operations(self):
        for name in ("app3.session.register", "app3.session.poll", "app3.session.result", "motion.edit"):
            value = payload(); value["command"] = name
            with self.assertRaises(ValueError): m.validate(value)
        for tool in ("apply_patch", "set_pose", "export_animation", "preview_scene_patch"):
            value = payload(); value["args"]["tool"] = tool
            with self.assertRaises(ValueError): m.validate(value)

    def test_rejects_bad_schema_and_ranges(self):
        cases = []
        for key, val in (("start", True), ("start", float("nan")), ("end", -1), ("boneIds", []), ("boneIds", [1]), ("samples", 601), ("unknown", 0)):
            v = payload(); v["args"]["parameters"][key] = val; cases.append(v)
        v = payload(); v["args"]["parameters"] = {"start": 2, "end": 1}; cases.append(v)
        v = payload(); del v["args"]["epoch"]; cases.append(v)
        v = payload(); v["receiverToken"] = "secret"; cases.append(v)
        for v in cases:
            with self.subTest(value=v), self.assertRaises(ValueError): m.validate(v)

    def test_authenticated_transport_preserves_request_identity(self):
        v = payload()
        with patch.object(m, "local_base", return_value="http://127.0.0.1:3013"), patch.object(m, "open_session", return_value="bbs_unified_session=opaque") as session, patch.object(m, "command", return_value={"ok": True}) as command:
            self.assertTrue(m.run_app3_command(v)["ok"])
            session.assert_called_once_with("http://127.0.0.1:3013")
            command.assert_called_once_with("http://127.0.0.1:3013", "bbs_unified_session=opaque", v["command"], v["projectId"], v["args"], request_id=v["requestId"])

    def test_metadata_and_errors(self):
        self.assertIn("error", m.handle_message({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}))
        self.assertIsNone(m.handle_message({"jsonrpc": "2.0", "method": "notifications/initialized"}))
        bad = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"_meta": META, "name": m.TOOL["name"], "arguments": payload()}}
        def fail(_): raise ValueError("APP3_OFFLINE")
        self.assertTrue(m.handle_message(bad, fail)["result"]["isError"])
        called = []
        self.assertFalse(m.handle_message(bad, lambda value: called.append(value) or {"ok": True})["result"]["isError"])
        self.assertEqual(len(called), 1)

    def test_stdio_roundtrip_and_parse_error(self):
        request = {"jsonrpc": "2.0", "id": 42, "method": "tools/list", "params": {"_meta": META}}
        process = subprocess.run([sys.executable, "-m", "agent.app3_mcp"], input=json.dumps(request) + "\n{bad\n", text=True, capture_output=True, check=True)
        lines = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual(lines[0]["id"], 42)
        self.assertEqual(lines[1]["error"]["code"], -32700)

if __name__ == "__main__": unittest.main()
