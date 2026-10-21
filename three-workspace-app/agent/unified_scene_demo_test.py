import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from . import unified_cli


class ScenePlanCliTests(unittest.TestCase):
    def test_four_plan_commands_forward_exact_arguments_and_revision(self):
        payload = {"placements": [{"characterId": "A", "relativeTo": "B", "relation": "left", "distanceMeters": 1.5}]}
        with tempfile.TemporaryDirectory() as directory:
            plan = Path(directory) / "plan.json"
            plan.write_text(json.dumps(payload), encoding="utf-8")
            for action, command in [("layout-preview", "scene.layout.preview"), ("layout-apply", "scene.layout.apply"),
                                    ("framing-preview", "camera.framing.preview"), ("framing-apply", "camera.framing.apply")]:
                argv = ["cli", "scene", action, "project", str(plan)]
                revision = 7 if action.endswith("apply") else None
                if revision is not None:
                    argv += ["--expected-revision", str(revision)]
                with self.subTest(action=action), patch.dict(os.environ, {"BBS_APP_URL": "http://127.0.0.1:3002"}), \
                     patch.object(unified_cli.sys, "argv", argv), patch.object(unified_cli, "open_session", return_value="cookie"), \
                     patch.object(unified_cli, "command", return_value={"ok": True}) as send, contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(unified_cli.main(), 0)
                    self.assertEqual(send.call_args.args[2:], (command, "project", payload))
                    self.assertEqual(send.call_args.kwargs, {"expected_revision": revision})

    def test_apply_requires_explicit_nonnegative_revision_before_network(self):
        for command in ("scene.layout.apply", "camera.framing.apply"):
            for revision in (None, -1, True):
                with self.subTest(command=command, revision=revision), patch.object(unified_cli, "call") as call:
                    with self.assertRaises(ValueError):
                        unified_cli.command("http://127.0.0.1:3002", "cookie", command, "project", {}, expected_revision=revision)
                    call.assert_not_called()

    def test_plan_json_must_be_an_object(self):
        with tempfile.TemporaryDirectory() as directory:
            plan = Path(directory) / "bad.json"
            plan.write_text("[]", encoding="utf-8")
            with patch.object(unified_cli.sys, "argv", ["cli", "scene", "layout-preview", "project", str(plan)]), \
                 patch.object(unified_cli, "open_session", return_value="cookie"), patch.object(unified_cli, "command") as send, \
                 contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(unified_cli.main(), 2)
                send.assert_not_called()
