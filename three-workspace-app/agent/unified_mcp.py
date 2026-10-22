"""MCP stdio bridge to the local unified-project command broker."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
import sys
import uuid
from typing import Any, Callable

from .unified_cli import CliError, command, local_base, open_session, save_render_files, upload_file

PROTOCOL_VERSION = "2026-07-28"
SERVER_INFO = {"name": "bbs-unified-project", "title": "BBS Unified Project", "version": "0.1.0"}
SERVER_META = {"io.modelcontextprotocol/serverInfo": SERVER_INFO}
# shortcut: expose commands only after their shared broker implementation exists; add file handles and legacy protocols with their adapters.
SUPPORTED_COMMANDS = (
    "project.create", "project.inspect", "project.save", "scene.apply", "scene.layout.read", "scene.layout.preview", "scene.layout.apply", "camera.framing.preview", "camera.framing.apply", "scene.evaluate", "scene.render", "film.export", "shot.export", "shot.result.import", "job.get", "job.cancel",
    "character.add", "prop.add", "camera.shot.set", "camera.motion.add", "camera.motion.remove", "vfx.cue.list", "vfx.cue.add", "vfx.cue.update", "vfx.cue.remove", "audio.cue.list", "audio.cue.add", "audio.cue.update", "audio.cue.remove", "motion.edit", "motion.place", "library.place", "motion.binding.set", "history.undo", "history.redo", "retarget.session.set",
    "rig.inspect", "rig.normalization.plan", "rig.normalization.run", "animation.assignment.plan", "animation.assignment.run", "animation.assignment.commit",
)
TOOL = {
    "name": "bbs_unified_command",
    "title": "BBS unified project command",
    "description": "Run a supported command through the local Studio broker. scene.layout.read accepts an optional frame and returns compact read-only character placements, hip heights, placed clips, cameras and timeline bounds, without meshes or raw keys. scene.layout.preview/apply take args.placements: characterId and optional position{x,z}, or relativeTo/relation(left,right,front,behind)/distanceMeters, plus lookAt{characterId|cameraId|point{x,z}}. World axes left=-X, front=+Z; distances are horizontal centers in meters; feet are grounded and overlaps rejected. Preview returns transforms without writes; apply requires expectedRevision and creates one undo step. camera.framing.preview/apply take cameraId, characterIds (1-2), shot(wide/medium/close), angle(eye/high/low), optional frame/viewportAspect/fovYDegrees/follow; fit full skeleton bounds with decreasing headroom, preserving all selected subjects; apply requires expectedRevision. Writes share project revision and undo history. scene.render and film.export require outputDirectory.path to be an existing local folder; the MCP client passes only an opaque handle for scene.render and removes the path for film.export, shot.export also requires outputDirectory.path and saves a verified shot ZIP through job.get. shot.result.import takes args.file as an existing local ZIP path, args.shotId and expectedRevision; it stages the file before calling the broker. Then job.get saves verified artifacts into a new render-<jobId> or film-<jobId> subfolder after success. Poll job.get with a fresh requestId each time; retry an uncertain request with its original requestId. motion.edit stores a native Animation Studio 1.31.8 project and validated GLB derivative under exact revision/history; include characterId and derivativeBase64, with optional source motionId/clipId. Motion placement requires a Character with matching skeleton fingerprint/unit; root-motion/alignment/fades keep their existing capability limits. rig.inspect and rig.normalization.plan inspect verified imported assets and saved mappings; optional rootTranslationScale in [0.01, 20] calibrates preserved root travel (1 keeps source meters). rig.normalization.run requires expectedRevision and a ready planSha256, returning a cancellable staged job; save through CLI rig save. animation.assignment.plan preflights Motion/Character; animation.assignment.run requires expectedRevision and planSha256, and stages GLB/report. animation.assignment.commit takes jobId plus optional frameStart and atomically saves the derived Motion, timeline clip and Binding through shared history. Legacy V9.12 snapshots retain their existing behavior.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "command": {"type": "string", "enum": list(SUPPORTED_COMMANDS)},
            "args": {"type": "object", "description": "Arguments for the selected command; the broker validates its command-specific schema."},
            "projectId": {"type": "string", "format": "uuid"},
            "expectedRevision": {"type": "integer", "minimum": 0, "description": "Revision of the edited snapshot; required for mutations including motion.edit and motion.binding.set."},
            "requestId": {"type": "string", "format": "uuid", "description": "Optional UUIDv4 for broker idempotency; reuse the same value for retries."},
            "dryRun": {"type": "boolean"},
        },
        "required": ["command", "args"],
        "additionalProperties": False,
    },
}
LIBRARY_TOOLS = [
    {"name": "library.search", "description": "Search the local App 5 Action library by rig, category, tags or text.", "inputSchema": {"type": "object", "properties": {"rig": {"type": "string"}, "category": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}, "text": {"type": "string"}}, "additionalProperties": False}},
    {"name": "library.get", "description": "Get an Action and its immutable pack metadata by UUID.", "inputSchema": {"type": "object", "properties": {"actionUuid": {"type": "string", "format": "uuid"}}, "required": ["actionUuid"], "additionalProperties": False}},
    {"name": "library.characters", "description": "List registered App 5 characters.", "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "library.place", "description": "Import one library Action into an App 2 project and place it on a Character in one undoable command.", "inputSchema": {"type": "object", "properties": {"actionUuid": {"type": "string", "format": "uuid"}, "projectId": {"type": "string", "format": "uuid"}, "characterId": {"type": "string", "format": "uuid"}, "expectedRevision": {"type": "integer", "minimum": 0}}, "required": ["actionUuid", "projectId", "characterId", "expectedRevision"], "additionalProperties": False}},
]

def _library_call(name: str, args: Any) -> dict[str, Any]:
    if not isinstance(args, dict):
        raise ValueError("Library tool arguments must be an object")
    root = Path(os.environ.get("W01_LIBRARY", r"C:\w01-library" if os.name == "nt" else str(Path.home() / "w01-library"))).expanduser().resolve()
    index_file = root / "index.json"
    if not index_file.is_file():
        if name == "library.search":
            return {"items": [], "total": 0}
        if name == "library.characters":
            return {"characters": []}
        raise ValueError("Action library index is missing")
    index = json.loads(index_file.read_text(encoding="utf-8"))
    if name == "library.characters":
        return {"characters": index.get("characters", [])}
    if name == "library.search":
        rows = index.get("actions", [])
        tags = [str(x).casefold() for x in args.get("tags", [])]
        text = str(args.get("text", "")).casefold()
        rows = [row for row in rows if
                (not args.get("rig") or row.get("rig") == args["rig"])
                and (not args.get("category") or row.get("category") == args["category"])
                and all(tag in [str(x).casefold() for x in row.get("tags", [])] for tag in tags)
                and (not text or any(text in str(value).casefold() for value in [row.get("name", ""), row.get("rig", ""), row.get("category", ""), *row.get("tags", [])]))]
        return {"items": rows, "total": len(rows)}
    if name == "library.get":
        action_uuid = args.get("actionUuid")
        if not isinstance(action_uuid, str):
            raise ValueError("actionUuid is required")
        action = next((row for row in index.get("actions", []) if str(row.get("uuid", "")).casefold() == action_uuid.casefold()), None)
        if not action:
            raise ValueError("Action not found")
        pack_id = str(action.get("packId", ""))
        if not re.fullmatch(r"[a-f0-9]{16}", pack_id):
            raise ValueError("Invalid pack id in library index")
        pack_dir = (root / "packs" / pack_id).resolve()
        if root not in pack_dir.parents:
            raise ValueError("Invalid pack path")
        files = {name: (pack_dir / name).resolve() for name in ("meta.json", "anim.glb", "anim.manifest.json")}
        if any(pack_dir not in path.parents or not path.is_file() for path in files.values()):
            raise ValueError("Pack files must be regular files inside the pack directory")
        metadata = json.loads(files["meta.json"].read_text(encoding="utf-8"))
        return {"action": action, "pack": metadata, "glb": str(files["anim.glb"]), "manifest": str(files["anim.manifest.json"])}
    raise ValueError("Unknown library tool")

MCP_RENDER_DIRS: dict[str, tuple[str, Path, str]] = {}


def _error(request_id: Any, code: int, message: str, data: Any = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": request_id, "error": error}


def _result(request_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": {**result, "_meta": SERVER_META}}


def run_unified_command(arguments: dict[str, Any]) -> dict[str, Any]:
    base = local_base()
    cookie = open_session(base)
    name = arguments["command"]
    project_id = arguments.get("projectId")
    args = arguments["args"]
    if name in {"scene.render", "film.export", "shot.export"}:
        directory = args.get("outputDirectory")
        if not isinstance(project_id, str) or not isinstance(directory, dict) or set(directory) != {"path"} or not isinstance(directory["path"], str):
            raise ValueError(f"{name} requires outputDirectory.path")
        output_root = Path(directory["path"]).expanduser()
        if not output_root.is_dir():
            raise ValueError(f"{name} outputDirectory.path must be an existing local folder")
        render_args = {key: value for key, value in args.items() if key != "outputDirectory"}
        request_id = arguments.get("requestId") or str(uuid.uuid4())
        if name == "scene.render":
            render_args["outputDirectory"] = {"kind": "client-directory", "id": request_id}
        response = command(base, cookie, name, project_id, render_args, arguments.get("expectedRevision"),
                           request_id, arguments["dryRun"])
        job_id = response.get("result", {}).get("jobId")
        if isinstance(job_id, str) and not arguments["dryRun"]:
            MCP_RENDER_DIRS[job_id] = (project_id, output_root.resolve(), {"film.export": "film", "shot.export": "shot"}.get(name, "render"))
        return response

    if name == "shot.result.import":
        result_file = Path(args["file"]).expanduser()
        if not result_file.is_file() or result_file.suffix.lower() != ".zip":
            raise ValueError("shot.result.import requires an existing local ZIP file")
        args = {**args, "file": upload_file(base, cookie, result_file)["uploadId"]}
    response = command(
        base, cookie, arguments["command"], arguments.get("projectId"), args,
        arguments.get("expectedRevision"), arguments.get("requestId"), arguments["dryRun"],
    )
    if name == "job.get":
        job = response.get("result", {}).get("job")
        job_id = job.get("jobId") if isinstance(job, dict) else None
        target = MCP_RENDER_DIRS.get(job_id) if isinstance(job_id, str) else None
        if target and target[0] == project_id and isinstance(job, dict) and job.get("state") == "succeeded":
            response["result"]["savedFiles"] = save_render_files(base, cookie, project_id, job, target[1], target[2])
            MCP_RENDER_DIRS.pop(job_id, None)
        elif isinstance(job_id, str) and isinstance(job, dict) and job.get("state") in {"failed", "cancelled"}:
            MCP_RENDER_DIRS.pop(job_id, None)
    elif name == "job.cancel":
        job_id = args.get("jobId")
        if isinstance(job_id, str) and response.get("result", {}).get("state") == "cancelled":
            MCP_RENDER_DIRS.pop(job_id, None)
    return response


def _valid_meta(params: dict[str, Any]) -> tuple[str | None, dict[str, Any] | None]:
    meta = params.get("_meta")
    if not isinstance(meta, dict):
        return None, None
    version = meta.get("io.modelcontextprotocol/protocolVersion")
    capabilities = meta.get("io.modelcontextprotocol/clientCapabilities")
    if not isinstance(version, str) or not isinstance(capabilities, dict):
        return None, None
    client_info = meta.get("io.modelcontextprotocol/clientInfo")
    if client_info is not None and (not isinstance(client_info, dict) or not isinstance(client_info.get("name"), str) or not isinstance(client_info.get("version"), str)):
        return None, None
    return version, capabilities


def _tool_call(arguments: Any, invoke: Callable[[dict[str, Any]], dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(arguments, dict) or set(arguments) - {"command", "args", "projectId", "expectedRevision", "requestId", "dryRun"}:
        raise ValueError("Expected a BBS command object with no unknown fields")
    name = arguments.get("command")
    args = arguments.get("args")
    project_id = arguments.get("projectId")
    revision = arguments.get("expectedRevision")
    request_id = arguments.get("requestId")
    dry_run = arguments.get("dryRun", False)
    if name not in SUPPORTED_COMMANDS or not isinstance(args, dict):
        raise ValueError("Unsupported command or invalid args object")
    if name == "retarget.session.set":
        native_project = args.get("nativeProject")
        if not isinstance(native_project, dict) or len(json.dumps(native_project, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")) > 12 * 1024 * 1024:
            raise ValueError("retarget.session.set requires a JSON object no larger than 12 MiB")
    if name in {"scene.render", "film.export", "shot.export"}:
        output_directory = args.get("outputDirectory")
        if not isinstance(output_directory, dict) or set(output_directory) != {"path"} or not isinstance(output_directory["path"], str) or not output_directory["path"].strip():
            raise ValueError(f"{name} requires outputDirectory.path")
    if name == "shot.result.import":
        if not isinstance(args.get("file"), str) or not args["file"].strip() or not isinstance(args.get("shotId"), str):
            raise ValueError("shot.result.import requires args.file and args.shotId")
    if name == "project.create":
        if project_id is not None or revision is not None:
            raise ValueError("project.create does not accept projectId or expectedRevision")
    elif not isinstance(project_id, str) or not project_id:
        raise ValueError("projectId is required for this command")
    if revision is not None and (isinstance(revision, bool) or not isinstance(revision, int) or revision < 0):
        raise ValueError("expectedRevision must be a non-negative integer")
    if name in {'camera.framing.apply', 'scene.layout.apply', 'motion.binding.set', 'rig.normalization.run', 'animation.assignment.run', 'animation.assignment.commit', 'shot.result.import'} and revision is None:
        raise ValueError(f'{name} requires expectedRevision from the edited snapshot')
    if request_id is not None:
        try:
            parsed = uuid.UUID(request_id)
        except (AttributeError, TypeError, ValueError) as error:
            raise ValueError("requestId must be a UUIDv4") from error
        if parsed.version != 4 or str(parsed) != request_id:
            raise ValueError("requestId must be a canonical UUIDv4")
    if not isinstance(dry_run, bool):
        raise ValueError("dryRun must be a boolean")
    payload = {"command": name, "args": args, **({"projectId": project_id} if project_id is not None else {}),
               **({"expectedRevision": revision} if revision is not None else {}),
               **({"requestId": request_id} if request_id is not None else {}), "dryRun": dry_run}
    response = invoke(payload)
    return {
        "resultType": "complete",
        "content": [{"type": "text", "text": json.dumps(response, ensure_ascii=False)}],
        "structuredContent": response,
        "isError": False,
    }


def handle_message(message: Any, invoke: Callable[[dict[str, Any]], dict[str, Any]] = run_unified_command) -> dict[str, Any] | None:
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or not isinstance(message.get("method"), str):
        return _error(message.get("id") if isinstance(message, dict) else None, -32600, "Invalid JSON-RPC request")
    request_id = message.get("id")
    if request_id is None:
        return None
    if isinstance(request_id, bool) or not isinstance(request_id, (str, int)):
        return _error(None, -32600, "Request ID must be a string or integer")
    method = message["method"]
    params = message.get("params", {})
    if not isinstance(params, dict):
        return _error(request_id, -32602, "params must be an object")
    if method == "initialize":
        return _error(request_id, -32022, "This MCP server supports stateless protocol 2026-07-28 only", {"supported": [PROTOCOL_VERSION], "requested": params.get("protocolVersion")})
    version, _capabilities = _valid_meta(params)
    if version is None:
        return _error(request_id, -32602, "Required per-request MCP metadata is missing or invalid")
    if version != PROTOCOL_VERSION:
        return _error(request_id, -32022, "Unsupported MCP protocol version", {"supported": [PROTOCOL_VERSION], "requested": version})
    if method == "server/discover":
        return _result(request_id, {"resultType": "complete", "supportedVersions": [PROTOCOL_VERSION], "capabilities": {"tools": {}}, "instructions": "All project reads and writes go through the local Studio broker; mutations share its revision and undo history.", "ttlMs": 0, "cacheScope": "private"})
    if method == "tools/list":
        return _result(request_id, {"resultType": "complete", "tools": [TOOL, *LIBRARY_TOOLS], "ttlMs": 0, "cacheScope": "private"})
    if method == "ping":
        return _result(request_id, {"resultType": "complete"})
    if method != "tools/call":
        return _error(request_id, -32601, f"Method not found: {method}")
    tool_name = params.get("name")
    if tool_name in {tool["name"] for tool in LIBRARY_TOOLS}:
        try:
            arguments = params.get("arguments", {})
            if tool_name == "library.place":
                if not isinstance(arguments, dict):
                    raise ValueError("Library tool arguments must be an object")
                result = _tool_call({"command": "library.place", "args": {"actionUuid": arguments.get("actionUuid"), "characterId": arguments.get("characterId")}, "projectId": arguments.get("projectId"), "expectedRevision": arguments.get("expectedRevision")}, invoke)
                return _result(request_id, result)
            result = _library_call(tool_name, arguments)
            return _result(request_id, {"resultType": "complete", "structuredContent": result, "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}], "isError": False})
        except (OSError, ValueError, json.JSONDecodeError) as error:
            return _result(request_id, {"resultType": "complete", "content": [{"type": "text", "text": str(error)}], "isError": True})
    if tool_name != TOOL["name"]:
        return _error(request_id, -32602, f"Unknown tool: {params.get('name')}")
    try:
        return _result(request_id, _tool_call(params.get("arguments"), invoke))
    except (CliError, OSError, RuntimeError, ValueError) as error:
        details = {"code": error.code, "status": error.status} if isinstance(error, CliError) else None
        tool_error = {"resultType": "complete", "content": [{"type": "text", "text": str(error)}], "isError": True}
        if details:
            tool_error["structuredContent"] = {"error": str(error), **details}
        return _result(request_id, tool_error)


def serve() -> None:
    for line in sys.stdin.buffer:
        try:
            request = json.loads(line)
            response = handle_message(request)
        except (UnicodeDecodeError, json.JSONDecodeError):
            response = _error(None, -32700, "Parse error")
        if response is not None:
            # MCP stdio is UTF-8 regardless of the console code page (Windows defaults to cp1252).
            sys.stdout.buffer.write((json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
            sys.stdout.buffer.flush()


if __name__ == "__main__":
    serve()
