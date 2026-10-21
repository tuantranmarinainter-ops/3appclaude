"""G4 reproducible text scenario: all scene reads, edits and renders use the real stdio MCP server.

Prepare a Studio project containing two imported Characters, then run from three-workspace-app:
python -m agent.unified_scene_demo PROJECT_ID CHARACTER_A CHARACTER_B --output EXISTING_DIR
BBS_APP_URL selects the running local Studio. No project files are edited directly.
The bundled text is deliberately one demonstration, not a general natural-language parser.
"""
import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

from .unified_mcp import PROTOCOL_VERSION

DESCRIPTION = "Đặt A bên trái B cách 1.5 m, hai người nhìn nhau; máy quay trung cảnh từ góc cao."


class McpSession:
    def __init__(self):
        self.process = subprocess.Popen([sys.executable, "-m", "agent.unified_mcp"], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, text=True, encoding="utf-8",
                                        env={**os.environ, "PYTHONIOENCODING": "utf-8"})
        self.transcript = []
        self.sequence = 0

    def request(self, method, params):
        self.sequence += 1
        message = {"jsonrpc": "2.0", "id": self.sequence, "method": method, "params": {**params, "_meta": {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {"name": "g4-scene-demo", "version": "1.0"},
        }}}
        self.process.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("MCP server exited before returning a response")
        response = json.loads(line)
        self.transcript.append({"request": message, "response": response})
        if response.get("id") != self.sequence or "error" in response:
            raise RuntimeError(f"MCP protocol error: {response}")
        result = response["result"]
        if result.get("isError"):
            raise RuntimeError(f"MCP tool error: {result.get('content')}")
        return result

    def command(self, name, project_id, args, revision=None):
        arguments = {"command": name, "projectId": project_id, "args": args, "requestId": str(uuid.uuid4())}
        if revision is not None:
            arguments["expectedRevision"] = revision
        response = self.request("tools/call", {"name": "bbs_unified_command", "arguments": arguments})["structuredContent"]
        if not response.get("ok"):
            raise RuntimeError(f"Broker command failed: {response}")
        return response

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=5)


def render(mcp, project_id, camera_id, output, timeout=120):
    started = mcp.command("scene.render", project_id, {"frames": [0], "cameraNodeIds": [camera_id],
        "width": 640, "height": 360, "outputDirectory": {"path": str(output)}})
    job_id = started["result"]["jobId"]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = mcp.command("job.get", project_id, {"jobId": job_id})["result"]
        job = result["job"]
        if job["state"] == "succeeded":
            saved = result["savedFiles"]
            image = next(name for name in saved["files"] if name.endswith("frame-0.png"))
            return {"image": str(Path(saved["outputDirectory"]) / image), "jobId": job_id,
                    "sourceRevision": job["sourceRevision"], "blockedRequests": job["result"].get("blockedRequests", [])}
        if job["state"] in {"failed", "cancelled"}:
            raise RuntimeError(f"Render {job['state']}: {job.get('error')}")
        time.sleep(0.1)
    mcp.command("job.cancel", project_id, {"jobId": job_id})
    raise TimeoutError("Scene demo render exceeded its time budget")


def run_demo(mcp, project_id, actor_a, actor_b, camera_id, output):
    commands = mcp.request("tools/list", {})["tools"][0]["inputSchema"]["properties"]["command"]["enum"]
    for command in ("scene.layout.read", "scene.layout.preview", "scene.layout.apply", "camera.framing.preview", "camera.framing.apply", "scene.render"):
        if command not in commands:
            raise RuntimeError(f"MCP does not advertise {command}")
    initial = mcp.command("scene.layout.read", project_id, {"frame": 0})
    before = render(mcp, project_id, camera_id, output)
    # Explicit structured interpretation of DESCRIPTION; no hidden writes outside MCP.
    layout = {"placements": [
        {"characterId": actor_a, "relativeTo": actor_b, "relation": "left", "distanceMeters": 1.5, "lookAt": {"characterId": actor_b}},
        {"characterId": actor_b, "position": {"x": 0, "z": 0}, "lookAt": {"characterId": actor_a}},
    ]}
    preview = mcp.command("scene.layout.preview", project_id, layout)
    check = mcp.command("scene.layout.read", project_id, {"frame": 0})
    if check != {**initial, "requestId": check["requestId"]}:
        raise RuntimeError("Layout preview modified the scene")
    applied = mcp.command("scene.layout.apply", project_id, layout, preview["revision"])
    framing = {"cameraId": camera_id, "characterIds": [actor_a, actor_b], "shot": "medium", "angle": "high", "viewportAspect": 16 / 9}
    before_camera = mcp.command("scene.layout.read", project_id, {"frame": 0})
    camera_preview = mcp.command("camera.framing.preview", project_id, framing)
    after_camera = mcp.command("scene.layout.read", project_id, {"frame": 0})
    if after_camera != {**before_camera, "requestId": after_camera["requestId"]}:
        raise RuntimeError("Camera preview modified the scene")
    if camera_preview["revision"] != applied["revision"]:
        raise RuntimeError("Camera preview changed revision")
    camera_applied = mcp.command("camera.framing.apply", project_id, framing, camera_preview["revision"])
    final = mcp.command("scene.layout.read", project_id, {"frame": 0})
    a = next(c for c in final["result"]["characters"] if c["id"] == actor_a)
    b = next(c for c in final["result"]["characters"] if c["id"] == actor_b)
    position_error = math.hypot(a["position"]["x"] - b["position"]["x"] + 1.5, a["position"]["z"] - b["position"]["z"])
    yaw_error = max(abs(a["yawDegrees"] - 90), abs(b["yawDegrees"] + 90))
    if position_error > 0.01 or yaw_error > 1 or camera_applied["revision"] != initial["revision"] + 2:
        raise RuntimeError("Scene demo placement/revision checks failed")
    after = render(mcp, project_id, camera_id, output)
    return {"description": DESCRIPTION, "status": "PASS", "projectId": project_id, "before": before, "after": after,
            "positionErrorMeters": position_error, "yawErrorDegrees": yaw_error,
            "maxProjectedAbs": camera_preview["result"]["maxProjectedAbs"], "revisionDelta": final["revision"] - initial["revision"],
            "transcript": mcp.transcript}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project_id")
    parser.add_argument("actor_a")
    parser.add_argument("actor_b")
    parser.add_argument("--camera", default="camera_1")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.output.is_dir():
        parser.error("--output must be an existing directory")
    mcp = McpSession()
    try:
        report = run_demo(mcp, args.project_id, args.actor_a, args.actor_b, args.camera, args.output.resolve())
        report_file = args.output / "g4-report.json"
        report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"status": "PASS", "report": str(report_file.resolve())}))
    finally:
        mcp.close()


if __name__ == "__main__":
    main()
