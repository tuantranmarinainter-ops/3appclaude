"""Deterministic blocking demonstration for one fixed Vietnamese prompt.

The browser supplies a detached-rig pose plan, then reviews each candidate through
this NDJSON driver. Every animation operation uses the real app3_mcp stdio server.
This is a reproducible example, not a general text-to-motion model.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import signal
import queue
import threading
import sys
import time
import uuid

from .unified_mcp import PROTOCOL_VERSION

DESCRIPTION = "vẫy tay phải 2 lần rồi chống nạnh"


class McpSession:
    def __init__(self):
        self.process = subprocess.Popen([sys.executable, "-m", "agent.app3_mcp"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8",
            env={**os.environ, "PYTHONIOENCODING": "utf-8"})
        self.sequence = 0
        self.transcript = []
        self.responses = queue.Queue()
        def receive():
            for line in self.process.stdout:
                self.responses.put(line)
            self.responses.put(None)
        threading.Thread(target=receive, daemon=True).start()

    def command(self, command, project_id, args, revision=None):
        self.sequence += 1
        arguments = {"command": command, "projectId": project_id, "args": args, "requestId": str(uuid.uuid4())}
        if revision is not None:
            arguments["expectedRevision"] = revision
        message = {"jsonrpc": "2.0", "id": self.sequence, "method": "tools/call", "params": {
            "name": "bbs_app3_command", "arguments": arguments, "_meta": {
                "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
                "io.modelcontextprotocol/clientCapabilities": {}}}}
        self.process.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
        self.process.stdin.flush()
        try:
            line = self.responses.get(timeout=40)
        except queue.Empty as error:
            raise TimeoutError("MCP response deadline exceeded") from error
        if not line:
            raise RuntimeError("App3 MCP exited without response")
        response = json.loads(line)
        self.transcript.append({"request": message, "response": response})
        if response.get("id") != self.sequence or "error" in response:
            raise RuntimeError(f"MCP protocol failure: {response}")
        result = response["result"]
        if result.get("isError"):
            raise RuntimeError(f"MCP tool failure: {result}")
        body = result["structuredContent"]
        if not body.get("ok"):
            raise RuntimeError(f"Broker failure: {body}")
        return body["result"]

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)


def operations(plan):
    if plan.get("description") != DESCRIPTION or plan.get("duration") != 4:
        raise ValueError("Only the fixed four-second demonstration is supported")
    poses = plan["poses"]
    return [("create_blocking", {"idea": DESCRIPTION, "markers": [
        {"id": "start", "time": 0, "label": "Sẵn sàng"},
        {"id": "wave", "time": .5, "label": "Vẫy tay phải hai lần"},
        {"id": "hip", "time": 3.5, "label": "Chống nạnh"},
        {"id": "end", "time": 4, "label": "Giữ dáng"}]})] + [
        ("set_pose", {"time": pose["time"], "transforms": pose["transforms"], "interpolation": "linear"}) for pose in poses]


class Demo:
    def __init__(self, mcp, project_id, plan):
        self.mcp, self.project_id = mcp, project_id
        sessions = mcp.command("app3.session.list", project_id, {})["sessions"]
        if len(sessions) != 1:
            raise RuntimeError("The demo requires exactly one explicitly bound App3 session")
        self.identity = {key: sessions[0][key] for key in ("sessionId", "epoch", "characterId", "serverInstance")}
        self.operations = operations(plan)
        self.pending = None

    def tool(self, tool, parameters=None, project_revision=None, native_revision=None):
        args = {**self.identity, "tool": tool, "parameters": parameters or {}}
        if project_revision is not None:
            args["expectedAnimationRevision"] = native_revision or self.tool("get_animation_context")["value"]["revision"]
        ticket = self.mcp.command("app3.command.submit", self.project_id, args, project_revision)
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            result = self.mcp.command("app3.command.result", self.project_id, {**self.identity, "commandId": ticket["commandId"]})
            if result["status"] == "done":
                if not result["result"].get("ok"):
                    raise RuntimeError(f"Director failure: {result}")
                return result["result"]
            if result["status"] not in ("queued", "dispatched"):
                raise RuntimeError(f"Command expired: {result}")
            time.sleep(.075)
        raise TimeoutError("App3 command deadline exceeded")

    def action(self, message):
        action = message["action"]
        revision = message.get("projectRevision")
        if action == "stage":
            tool, params = self.operations[message["index"]]
            self.pending = self.tool(tool, params, revision)["value"]
            return self.pending
        if action in ("preview", "apply"):
            if not self.pending:
                raise RuntimeError("No staged candidate")
            params = {"patchId": self.pending["patchId"]}
            if action == "preview":
                params["original"] = message.get("original", False)
            return self.tool(action + "_patch", params, revision, self.pending["baseRevision"])
        if action == "read":
            return self.tool("read_keyframes", {"start": 0, "end": 4})
        raise ValueError("Unknown demo action")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project_id")
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--transcript", type=Path, required=True)
    args = parser.parse_args()
    mcp = McpSession()
    def terminate(_signum, _frame):
        mcp.process.terminate()
        raise SystemExit("Demo terminated")
    signal.signal(signal.SIGTERM, terminate)
    try:
        demo = Demo(mcp, args.project_id, json.loads(args.plan.read_text(encoding="utf-8")))
        print(json.dumps({"ready": True, "operations": len(demo.operations), "description": DESCRIPTION}), flush=True)
        for line in sys.stdin:
            try:
                print(json.dumps({"ok": True, "result": demo.action(json.loads(line))}), flush=True)
            except Exception as error:
                print(json.dumps({"ok": False, "error": str(error)}), flush=True)
    finally:
        mcp.close()
        args.transcript.write_text(json.dumps(mcp.transcript, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
