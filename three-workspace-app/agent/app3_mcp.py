"""Read-only App 3 MCP over the authenticated local unified broker.

Run: python -m agent.app3_mcp. Commands never select an arbitrary editor session.
app3.context.get is cached heartbeat state; get_animation_context is a fresh queued read.
"""
from __future__ import annotations

import json
import math
import sys
import uuid
from typing import Any, Callable

from .unified_cli import CliError, command, local_base, open_session
from .unified_mcp import PROTOCOL_VERSION, _valid_meta

READ_TOOLS = ("read_keyframes", "analyze_motion", "get_scene_context", "get_animation_context")
COMMANDS = ("app3.session.list", "app3.context.get", "app3.command.submit", "app3.command.result")
TOOL = {
    "name": "bbs_app3_command",
    "description": "Read the open local App 3 editor. List sessions for a project, then pass its exact sessionId, epoch, characterId and serverInstance. Submit only read_keyframes, analyze_motion, get_scene_context or get_animation_context using args.tool and args.parameters; poll app3.command.result with commandId and a fresh requestId. A submit retry must reuse its original requestId. context.get returns cached-heartbeat state; get_animation_context submits a fresh iframe read. No animation/scene mutations or exports are exposed.",
    "inputSchema": {"type": "object", "properties": {
        "command": {"type": "string", "enum": list(COMMANDS)},
        "projectId": {"type": "string", "format": "uuid"},
        "args": {"type": "object"},
        "requestId": {"type": "string", "format": "uuid"},
    }, "required": ["command", "projectId", "args"], "additionalProperties": False},
}
SERVER_INFO = {"name": "bbs-app3-local", "version": "0.1.0"}


def identifier(value: Any) -> bool:
    try:
        return isinstance(value, str) and str(uuid.UUID(value)) == value.lower()
    except ValueError:
        return False


def validate(arguments: Any) -> dict:
    if not isinstance(arguments, dict) or set(arguments) - {"command", "projectId", "args", "requestId"}:
        raise ValueError("Invalid command envelope")
    if arguments.get("command") not in COMMANDS or not identifier(arguments.get("projectId")) or not isinstance(arguments.get("args"), dict):
        raise ValueError("Read-only command, project UUID and args are required")
    if "requestId" in arguments and not identifier(arguments["requestId"]):
        raise ValueError("requestId must be a UUID")
    args = arguments["args"]
    name = arguments["command"]
    identity = {"sessionId", "epoch", "characterId", "serverInstance"}
    required = set() if name == "app3.session.list" else identity
    extra = {"tool", "parameters"} if name == "app3.command.submit" else {"commandId"} if name == "app3.command.result" else set()
    if set(args) != required | extra or any(not identifier(args[key]) for key in required | ({"commandId"} if "commandId" in extra else set())):
        raise ValueError("Exact session/epoch/character/server identity is required")
    if name == "app3.command.submit":
        tool, params = args["tool"], args["parameters"]
        if tool not in READ_TOOLS or not isinstance(params, dict):
            raise ValueError("Unsupported read tool")
        allowed = {"boneIds", "start", "end"} if tool == "read_keyframes" else {"boneIds", "start", "end", "samples"} if tool == "analyze_motion" else set()
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


def run_app3_command(arguments: dict) -> dict:
    arguments = validate(arguments)
    base = local_base()
    return command(base, open_session(base), arguments["command"], arguments["projectId"], arguments["args"], request_id=arguments.get("requestId"))


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
            print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    serve()
