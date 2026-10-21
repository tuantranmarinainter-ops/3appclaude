"""App 3 reads and staged native animation edits over the authenticated local broker.

Run: python -m agent.app3_mcp. Commands never select an arbitrary editor session.
app3.context.get is cached heartbeat state; get_animation_context is a fresh queued read.
"""
from __future__ import annotations

import json
import math
import re
import sys
import uuid
from typing import Any, Callable

from .unified_cli import CliError, command, local_base, open_session
from .unified_mcp import PROTOCOL_VERSION, _valid_meta

READ_TOOLS = ("read_keyframes", "analyze_motion", "get_scene_context", "get_animation_context")
EDIT_TOOLS = ("retime_segment", "set_hold", "smooth_motion", "edit_keyframes", "edit_curves", "create_blocking", "set_pose", "insert_breakdown", "set_marker", "set_idea", "preview_patch", "apply_patch", "cancel_patch", "undo_animation")
COMMANDS = ("app3.session.list", "app3.context.get", "app3.command.submit", "app3.command.result")
TOOL = {
    "name": "bbs_app3_command",
    "description": "Read and stage edits in the open local App 3 editor. List sessions for a project, then pass its exact sessionId, epoch, characterId and serverInstance. Submit read_keyframes, analyze_motion, get_scene_context, get_animation_context or retime_segment, set_hold, smooth_motion, edit_keyframes, edit_curves, create_blocking, set_pose, insert_breakdown, set_marker, set_idea, preview_patch, apply_patch, cancel_patch, undo_animation using args.tool and args.parameters. Times are editor-local seconds, transform values use the context model-local units, rotation curve r is Euler XYZ degrees; no implicit world-space conversion. Shot duration and root transforms are protected. Edits require numeric expectedRevision and string args.expectedAnimationRevision; review staged patchId before apply_patch; poll app3.command.result with commandId and a fresh requestId. A submit retry must reuse its original requestId. context.get returns cached-heartbeat state; get_animation_context submits a fresh iframe read. Only these native animation edits are exposed; scene writes and exports are unavailable.",
    "inputSchema": {"type": "object", "properties": {
        "command": {"type": "string", "enum": list(COMMANDS)},
        "projectId": {"type": "string", "format": "uuid"},
        "args": {"type": "object"},
        "requestId": {"type": "string", "format": "uuid"},
        "expectedRevision": {"type": "integer", "minimum": 0},
    }, "required": ["command", "projectId", "args"], "additionalProperties": False},
}
SERVER_INFO = {"name": "bbs-app3-local", "version": "0.1.0"}


def identifier(value: Any) -> bool:
    try:
        return isinstance(value, str) and str(uuid.UUID(value)) == value.lower()
    except ValueError:
        return False


def validate(arguments: Any) -> dict:
    if not isinstance(arguments, dict) or set(arguments) - {"command", "projectId", "args", "requestId", "expectedRevision"}:
        raise ValueError("Invalid command envelope")
    if arguments.get("command") not in COMMANDS or not identifier(arguments.get("projectId")) or not isinstance(arguments.get("args"), dict):
        raise ValueError("Supported command, project UUID and args are required")
    if "requestId" in arguments and not identifier(arguments["requestId"]):
        raise ValueError("requestId must be a UUID")
    args = arguments["args"]
    name = arguments["command"]
    identity = {"sessionId", "epoch", "characterId", "serverInstance"}
    required = set() if name == "app3.session.list" else identity
    extra = {"tool", "parameters"} if name == "app3.command.submit" else {"commandId"} if name == "app3.command.result" else set()
    editing = name == "app3.command.submit" and args.get("tool") in EDIT_TOOLS
    if editing:
        extra.add("expectedAnimationRevision")
        if type(arguments.get("expectedRevision")) is not int or arguments["expectedRevision"] < 0 or not isinstance(args.get("expectedAnimationRevision"), str) or not args["expectedAnimationRevision"]:
            raise ValueError("Numeric project revision and string animation revision required")
    if "expectedRevision" in arguments and (type(arguments["expectedRevision"]) is not int or arguments["expectedRevision"] < 0):
        raise ValueError("Invalid project revision")
    if set(args) != required | extra or any(not identifier(args[key]) for key in required | ({"commandId"} if "commandId" in extra else set())):
        raise ValueError("Exact session/epoch/character/server identity is required")
    if name == "app3.command.submit":
        tool, params = args["tool"], args["parameters"]
        if editing:
            validate_edit(tool, params)
        elif tool not in READ_TOOLS or not isinstance(params, dict):
            raise ValueError("Unsupported read tool")
        allowed = set(params) if editing else ({"boneIds", "start", "end"} if tool == "read_keyframes" else {"boneIds", "start", "end", "samples"} if tool == "analyze_motion" else set())
        if set(params) - allowed:
            raise ValueError("Unknown read parameter")
        if "boneIds" in params and (not isinstance(params["boneIds"], list) or not 1 <= len(params["boneIds"]) <= 256 or any(not isinstance(x, str) or not 1 <= len(x) <= 200 for x in params["boneIds"])):
            raise ValueError("Invalid boneIds")
        for key in ("start", "end"):
            if key in params and (isinstance(params[key], bool) or not isinstance(params[key], (int, float)) or not math.isfinite(params[key]) or params[key] < 0):
                raise ValueError("Invalid time range")
        if "start" in params and "end" in params and params["end"] < params["start"]:
            raise ValueError("Invalid time range")
        if "samples" in params and (isinstance(params["samples"], bool) or not isinstance(params["samples"], int) or not 4 <= params["samples"] <= 600):
            raise ValueError("Invalid samples")
    if len(json.dumps(arguments, allow_nan=False).encode()) > 1024 * 1024:
        raise ValueError("Payload exceeds 1 MiB")
    return arguments


def validate_edit(tool, p):
    fields = {
        "retime_segment": {"markerId", "time"}, "set_hold": {"markerId", "duration"},
        "smooth_motion": {"boneIds", "start", "end", "method", "strength", "window", "channels"},
        "edit_keyframes": {"refs", "action", "targetTime"}, "edit_curves": {"boneId", "path", "axis", "times", "type", "side", "slope"},
        "create_blocking": {"markers", "idea"}, "set_pose": {"time", "transforms", "interpolation"},
        "insert_breakdown": {"time", "boneIds", "label", "fraction", "offsets"},
        "set_marker": {"markerId", "label", "locked", "kind"}, "set_idea": {"idea"},
        "preview_patch": {"patchId", "original"}, "apply_patch": {"patchId"}, "cancel_patch": {"patchId"}, "undo_animation": set(),
    }
    def require(ok):
        if not ok: raise ValueError("Invalid edit parameter")
    def text(v, n): return isinstance(v, str) and len(v) <= n
    def number(v, a, b): return type(v) in (float, int) and math.isfinite(v) and a <= v <= b
    def vector(v, n): return isinstance(v, list) and len(v) == n and all(type(x) in (int, float) and math.isfinite(x) for x in v)
    require(isinstance(p, dict) and not set(p) - fields[tool])
    if tool == "create_blocking":
        require(isinstance(p.get("markers"), list) and 2 <= len(p["markers"]) <= 128)
        for m in p["markers"]:
            require(isinstance(m, dict) and not set(m) - {"id", "time", "label", "kind", "locked"} and number(m.get("time"), 0, 300) and text(m.get("label"), 160))
            if "id" in m: require(text(m["id"], 80) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", m["id"]) is not None)
            if "kind" in m: require(m["kind"] in ("pose", "contact", "breakdown", "hold"))
            if "locked" in m: require(type(m["locked"]) is bool)
    if "idea" in p or tool == "set_idea": require(text(p.get("idea"), 4000))
    if tool in ("set_pose", "insert_breakdown"): require(number(p.get("time"), 0, 300))
    if tool == "set_pose":
        require(isinstance(p.get("transforms"), dict) and 1 <= len(p["transforms"]) <= 256)
        for bone, t in p["transforms"].items():
            require(text(bone, 200) and bool(bone) and isinstance(t, dict) and set(t) == {"p", "q", "s"} and vector(t["p"], 3) and vector(t["q"], 4) and vector(t["s"], 3) and math.hypot(*t["q"]) >= 1e-8)
        if "interpolation" in p: require(p["interpolation"] in ("step", "linear", "auto", "cubic", "smooth"))
    if tool == "insert_breakdown":
        require(isinstance(p.get("boneIds"), list) and 1 <= len(p["boneIds"]) <= 256 and all(text(x, 200) and x for x in p["boneIds"]))
        if "fraction" in p: require(number(p["fraction"], 0, 1))
        if "offsets" in p: require(isinstance(p["offsets"], dict) and all(k in p["boneIds"] and vector(v, 3) for k, v in p["offsets"].items()))
    if tool == "set_marker": require(text(p.get("markerId"), 80) and bool(p["markerId"]) and len(p) >= 2)
    if "label" in p: require(text(p["label"], 160))
    if "locked" in p: require(type(p["locked"]) is bool)
    if "kind" in p: require(p["kind"] in ("pose", "contact", "breakdown", "hold"))
    if tool in ("preview_patch", "apply_patch", "cancel_patch"): require(text(p.get("patchId"), 100) and bool(p["patchId"]))
    if tool in ("retime_segment", "set_hold"): require(text(p.get("markerId"), 80) and bool(p["markerId"]))
    if tool == "retime_segment": require(number(p.get("time"), 0, 300))
    if tool == "set_hold": require(number(p.get("duration"), 0, 30) and p["duration"] > 0)
    if tool == "smooth_motion":
        require(isinstance(p.get("boneIds"), list) and 1 <= len(p["boneIds"]) <= 256 and all(text(x, 200) and x for x in p["boneIds"]))
        require(number(p.get("start"), 0, 300) and number(p.get("end"), p["start"], 300) and p["end"] > p["start"])
        if "method" in p: require(p["method"] in ("filter", "auto", "cubic"))
        if "strength" in p: require(number(p["strength"], 0, 1))
        if "window" in p: require(type(p["window"]) is int and 1 <= p["window"] <= 12)
        if "channels" in p: require(isinstance(p["channels"], list) and 1 <= len(p["channels"]) <= 3 and all(isinstance(x, str) and x in ("p", "q", "s") for x in p["channels"]) and len(set(p["channels"])) == len(p["channels"]))
    if tool == "edit_keyframes":
        require(isinstance(p.get("refs"), list) and 1 <= len(p["refs"]) <= 1000 and p.get("action") in ("move", "copy", "delete"))
        for ref in p["refs"]: require(isinstance(ref, dict) and set(ref) == {"id", "time", "kind"} and text(ref["id"], 200) and bool(ref["id"]) and ref["kind"] == "keys" and number(ref["time"], 0, 300))
        if p["action"] != "delete" or "targetTime" in p: require(number(p.get("targetTime"), 0, 300))
    if tool == "edit_curves":
        require(text(p.get("boneId"), 200) and bool(p["boneId"]) and p.get("path") in ("p", "r", "s") and type(p.get("axis")) is int and p["axis"] in (0, 1, 2))
        require(isinstance(p.get("times"), list) and 1 <= len(p["times"]) <= 1000 and all(number(x, 0, 300) for x in p["times"]))
        if "side" in p: require(p["side"] in ("in", "out", "both"))
        if "type" in p: require(p["type"] in ("linear", "step", "auto", "smooth", "spline", "break", "unify"))
        if "slope" in p: require(type(p["slope"]) in (float, int) and math.isfinite(p["slope"]))
        require("slope" in p or "type" in p)
    if "original" in p: require(type(p["original"]) is bool)


def run_app3_command(arguments: dict) -> dict:
    arguments = validate(arguments)
    base = local_base()
    return command(base, open_session(base), arguments["command"], arguments["projectId"], arguments["args"], request_id=arguments.get("requestId"), **({"expected_revision": arguments["expectedRevision"]} if "expectedRevision" in arguments else {}))


def handle_message(message: Any, invoke: Callable[[dict], dict] = run_app3_command) -> dict | None:
    request_id = message.get("id") if isinstance(message, dict) else None
    def error(code, text):
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": text}}
    def result(value):
        return {"jsonrpc": "2.0", "id": request_id, "result": {**value, "_meta": {"io.modelcontextprotocol/serverInfo": SERVER_INFO}}}
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or not isinstance(message.get("method"), str):
        return error(-32600, "Invalid request")
    if request_id is None:
        return None
    if isinstance(request_id, bool) or not isinstance(request_id, (str, int)):
        return error(-32600, "Invalid request ID")
    params = message.get("params", {})
    if not isinstance(params, dict):
        return error(-32602, "params must be an object")
    version, _ = _valid_meta(params)
    if version != PROTOCOL_VERSION:
        return error(-32022, "Required stateless MCP protocol metadata: " + PROTOCOL_VERSION)
    method = message["method"]
    if method == "server/discover":
        return result({"resultType": "complete", "supportedVersions": [PROTOCOL_VERSION], "capabilities": {"tools": {}}, "ttlMs": 0, "cacheScope": "private"})
    if method == "tools/list":
        return result({"resultType": "complete", "tools": [TOOL], "ttlMs": 0, "cacheScope": "private"})
    if method == "ping":
        return result({"resultType": "complete"})
    if method != "tools/call":
        return error(-32601, "Unknown method")
    if params.get("name") != TOOL["name"]:
        return error(-32602, "Unknown tool")
    try:
        value = invoke(validate(params.get("arguments")))
        return result({"resultType": "complete", "content": [{"type": "text", "text": json.dumps(value, allow_nan=False)}], "structuredContent": value, "isError": False})
    except (ValueError, CliError, RuntimeError, OSError) as exc:
        return result({"resultType": "complete", "content": [{"type": "text", "text": str(exc)}], "isError": True})


def serve() -> None:
    for line in sys.stdin.buffer:
        try:
            response = handle_message(json.loads(line))
        except (ValueError, UnicodeDecodeError):
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        if response is not None:
            # MCP stdio is UTF-8 regardless of the console code page (Windows defaults to cp1252).
            sys.stdout.buffer.write((json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))
            sys.stdout.buffer.flush()


if __name__ == "__main__":
    serve()
