import contextlib
import io
import os
import unittest
import uuid
from unittest.mock import Mock, patch
from . import unified_cli, unified_mcp
from .test_unified_mcp import request


class LayoutTests(unittest.TestCase):
    def test_cli_default_and_explicit_frame(self):
        for extra, expected in [([], {}), (["--frame", "12.5"], {"frame": 12.5})]:
            with self.subTest(extra=extra), patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), patch.object(unified_cli.sys, "argv", ["cli", "scene", "layout-read", "project", *extra]), patch.object(unified_cli, "open_session", return_value="cookie"), patch.object(unified_cli, "command", return_value={"ok": True}) as send, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(unified_cli.main(), 0)
                self.assertEqual(send.call_args.args[2:], ("scene.layout.read", "project", expected))

    def test_cli_rejects_nonfinite_frame(self):
        with patch.object(unified_cli.sys, "argv", ["cli", "scene", "layout-read", "project", "--frame", "nan"]), patch.object(unified_cli, "open_session", return_value="cookie"), patch.object(unified_cli, "command") as send, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(unified_cli.main(), 2)
            send.assert_not_called()

    def test_mcp_advertises_and_forwards_read_without_revision(self):
        listed=unified_mcp.handle_message(request("tools/list"))
        self.assertIn("scene.layout.read", listed["result"]["tools"][0]["inputSchema"]["properties"]["command"]["enum"])
        invoke=Mock(return_value={"ok": True, "revision": 7, "result": {"characters": [], "cameras": []}})
        response=unified_mcp.handle_message(request("tools/call", {"name": "bbs_unified_command", "arguments": {"command": "scene.layout.read", "projectId": str(uuid.uuid4()), "args": {"frame": 12}}}), invoke)
        self.assertEqual(invoke.call_args.args[0]["args"], {"frame": 12})
        self.assertEqual(response["result"]["structuredContent"]["revision"], 7)
