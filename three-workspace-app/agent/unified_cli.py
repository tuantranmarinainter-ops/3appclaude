#!/usr/bin/env python3
"""Small Python client for the local unified-project broker (no third-party packages)."""

from __future__ import annotations

import argparse
import json
import hashlib
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

try:
    from .film_worker import run_film_worker
    from .film_model_converter import BlenderUnavailableError, convert_film_model
except ImportError:
    from film_worker import run_film_worker
    from film_model_converter import BlenderUnavailableError, convert_film_model


class CliError(Exception):
    def __init__(self, message: str, exit_code: int = 1, *, status: int | None = None, code: str | None = None, retryable: bool = False):
        super().__init__(message)
        self.exit_code = exit_code
        self.status = status
        self.code = code
        self.retryable = retryable


def exit_code_for(status: int, code: str | None = None) -> int:
    if status == 409 or code in {"REVISION_CONFLICT", "REQUEST_ID_CONFLICT"}:
        return 3
    if status in {400, 403, 413, 415} or code == "VALIDATION_FAILED":
        return 2
    if status in {401, 404, 422, 423, 503} or code in {
        "NOT_FOUND", "UNSUPPORTED_CAPABILITY", "ASSET_MISSING", "PROFILE_MISMATCH",
        "ROOT_MOTION_CONFLICT", "WRITER_BUSY", "TOOL_UNAVAILABLE",
    }:
        return 4
    return 1


def local_base() -> str:
    base = os.environ.get("BBS_APP_URL", "http://127.0.0.1:3002").rstrip("/")
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("BBS_APP_URL must point to localhost or a loopback IP")
    return base


def open_session(base: str) -> str:
    req = urllib.request.Request(f"{base}/api/unified/session", method="POST", headers={"Origin": base})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            cookie = response.headers.get("Set-Cookie", "").split(";", 1)[0]
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise CliError(f"HTTP {error.code}: {detail}", exit_code_for(error.code), status=error.code) from error
    if not cookie.startswith("bbs_unified_session="):
        raise RuntimeError("Local host did not issue a session cookie")
    return cookie


def call(base: str, cookie: str, route: str, method: str = "GET", body: dict | None = None, retried_session: bool = False) -> dict:
    headers = {"Cookie": cookie, "Origin": base}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{base}{route}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        if error.code == 401 and not retried_session:
            return call(base, open_session(base), route, method, body, retried_session=True)
        try:
            payload = json.loads(detail)
        except ValueError:
            payload = None
        error_object = payload.get("error") if isinstance(payload, dict) else None
        code = error_object.get("code") if isinstance(error_object, dict) else None
        retryable = error_object.get("retryable") is True if isinstance(error_object, dict) else False
        raise CliError(f"HTTP {error.code}: {detail}", exit_code_for(error.code, code), status=error.code, code=code, retryable=retryable) from error


def request_result(base: str, cookie: str, request_id: str) -> dict | None:
    try:
        return call(base, cookie, f"/api/unified/requests/{urllib.parse.quote(request_id, safe='')}")
    except CliError as error:
        if error.status == 404:
            return None
        raise


def upload_file(base: str, cookie: str, file_path: Path, retried_session: bool = False) -> dict:
    data = file_path.read_bytes()
    if not data or len(data) > 256 * 1024 * 1024:
        raise ValueError("Each asset file must be between 1 byte and 256 MiB")
    headers = {
        "Cookie": cookie,
        "Origin": base,
        "Content-Type": "application/octet-stream",
        "X-File-Name": urllib.parse.quote(file_path.name, safe=""),
    }
    req = urllib.request.Request(f"{base}/api/unified/uploads", data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        if error.code == 401 and not retried_session:
            return upload_file(base, open_session(base), file_path, retried_session=True)
        try:
            payload = json.loads(detail)
        except ValueError:
            payload = None
        error_object = payload.get("error") if isinstance(payload, dict) else None
        code = error_object.get("code") if isinstance(error_object, dict) else None
        raise CliError(f"HTTP {error.code}: {detail}", exit_code_for(error.code, code), status=error.code, code=code) from error


def download_file(base: str, cookie: str, route: str, max_bytes: int = 256 * 1024 * 1024, retried_session: bool = False) -> bytes:
    req = urllib.request.Request(f"{base}{route}", headers={"Cookie": cookie, "Origin": base})
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            data = response.read(max_bytes + 1)
            if len(data) > max_bytes:
                raise CliError("Render artifact exceeds the 256 MiB download limit", 4, status=413, code="VALIDATION_FAILED")
            return data
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        if error.code == 401 and not retried_session:
            return download_file(base, open_session(base), route, max_bytes, retried_session=True)
        raise CliError(f"HTTP {error.code}: {detail}", exit_code_for(error.code), status=error.code) from error


def save_render_files(base: str, cookie: str, project_id: str, job: dict, output_root: Path, prefix: str = "render") -> dict:
    if not output_root.is_dir():
        raise ValueError("Render output directory must already exist")
    job_id = job.get("jobId")
    try:
        parsed = uuid.UUID(job_id)
    except (AttributeError, TypeError, ValueError) as error:
        raise ValueError("Render job has an invalid ID") from error
    if parsed.version != 4 or str(parsed) != job_id:
        raise ValueError("Render job has an invalid ID")
    files = job.get("result", {}).get("files", [])
    if not isinstance(files, list) or not files or len(files) > 20:
        raise ValueError("Render job has an invalid file manifest")
    if prefix not in {"render", "film", "shot"}:
        raise ValueError("Unsupported job output prefix")
    destination = output_root.expanduser().resolve() / f"{prefix}-{job_id}"
    destination.mkdir(exist_ok=False)
    project_route = urllib.parse.quote(project_id, safe="")
    try:
        saved = []
        seen = set()
        for item in files:
            if not isinstance(item, dict):
                raise ValueError("Render job has an invalid file entry")
            file_id, name = item.get("id"), item.get("name")
            size = item.get("sizeBytes")
            expected_hash = item.get("sha256")
            if not isinstance(file_id, str) or not re.fullmatch(r"\d{1,2}", file_id) or not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", name) or name in seen:
                raise ValueError("Render job has an unsafe artifact name")
            if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= 256 * 1024 * 1024 or not isinstance(expected_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_hash):
                raise ValueError("Render job has invalid artifact metadata")
            seen.add(name)
            route = f"/api/unified/projects/{project_route}/jobs/{job_id}/files/{file_id}"
            data = download_file(base, cookie, route)
            if len(data) != size or hashlib.sha256(data).hexdigest() != expected_hash:
                raise ValueError(f"Render artifact failed integrity check: {name}")
            with tempfile.NamedTemporaryFile("wb", dir=destination, prefix=".render-", suffix=".tmp", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, destination / name)
            saved.append(name)
        return {"jobId": job_id, "sourceRevision": job.get("sourceRevision"), "outputDirectory": str(destination), "files": saved,
                "provenance": job.get("result", {}).get("provenance", {})}
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise


def render_scene_job(base: str, cookie: str, project_id: str, args: dict, output_root: Path,
                     request_id: str | None = None, expected_revision: int | None = None, dry_run: bool = False) -> dict:
    if not output_root.is_dir():
        raise ValueError("Render output directory must already exist")
    request_id = request_id or str(uuid.uuid4())
    result = command(base, cookie, "scene.render", project_id, {
        "frames": args["frames"], "cameraNodeIds": args["camera_node_ids"], "width": args["width"], "height": args["height"],
        "outputDirectory": {"kind": "client-directory", "id": request_id},
    }, expected_revision=expected_revision, request_id=request_id, dry_run=dry_run)
    job_id = result.get("result", {}).get("jobId")
    if dry_run or not isinstance(job_id, str):
        return result
    route = f"/api/unified/projects/{urllib.parse.quote(project_id, safe='')}/jobs/{job_id}"
    deadline = time.monotonic() + 600
    progress = -1
    try:
        while time.monotonic() < deadline:
            job = call(base, cookie, route).get("job", {})
            if not isinstance(job, dict):
                raise CliError("Local host returned an invalid render job", 1)
            value = job.get("progress")
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                bucket = int(value * 10)
                if bucket != progress:
                    print(f"Render {bucket * 10}%", file=sys.stderr)
                    progress = bucket
            state = job.get("state")
            if state in {"succeeded", "failed", "cancelled"}:
                if state != "succeeded":
                    failure = job.get("error", {})
                    raise CliError(failure.get("message", f"Render {state}"), 4, code=failure.get("code"))
                return save_render_files(base, cookie, project_id, job, output_root)
            time.sleep(0.5)
    except KeyboardInterrupt as error:
        try:
            command(base, cookie, "job.cancel", project_id, {"jobId": job_id})
        finally:
            raise CliError("Render cancelled", 4, code="CANCELLED") from error
    command(base, cookie, "job.cancel", project_id, {"jobId": job_id})
    raise CliError("Render timed out; cancellation was requested", 4, code="CANCELLED", retryable=True)


def export_project_film_job(base: str, cookie: str, project_id: str, args: dict, output_root: Path,
                            request_id: str | None = None, expected_revision: int | None = None, dry_run: bool = False) -> dict:
    if not output_root.is_dir():
        raise ValueError("Film output directory must already exist")
    result = command(base, cookie, "film.export", project_id, args, expected_revision, request_id, dry_run)
    job_id = result.get("result", {}).get("jobId")
    if dry_run or not isinstance(job_id, str):
        return result
    route = f"/api/unified/projects/{urllib.parse.quote(project_id, safe='')}/jobs/{job_id}"
    deadline = time.monotonic() + 900
    try:
        while time.monotonic() < deadline:
            job = call(base, cookie, route).get("job", {})
            if not isinstance(job, dict):
                raise CliError("Local host returned an invalid Film job", 1)
            state = job.get("state")
            if state in {"succeeded", "failed", "cancelled"}:
                if state != "succeeded":
                    failure = job.get("error", {})
                    raise CliError(failure.get("message", f"Film export {state}"), 4, code=failure.get("code"))
                return save_render_files(base, cookie, project_id, job, output_root, "film")
            time.sleep(0.5)
    except KeyboardInterrupt as error:
        try:
            command(base, cookie, "job.cancel", project_id, {"jobId": job_id})
        finally:
            raise CliError("Film export cancelled", 4, code="CANCELLED") from error
    command(base, cookie, "job.cancel", project_id, {"jobId": job_id})
    raise CliError("Film export timed out; cancellation was requested", 4, code="CANCELLED", retryable=True)


def export_shot_job(base: str, cookie: str, project_id: str, args: dict, output_root: Path,
                    expected_revision: int | None = None, request_id: str | None = None, dry_run: bool = False) -> dict:
    """Download the broker's completed shot artifact with size and SHA-256 checks."""
    if not output_root.is_dir():
        raise ValueError("Shot output directory must already exist")
    response = command(base, cookie, "shot.export", project_id, args, expected_revision, request_id, dry_run)
    job_id = response.get("result", {}).get("jobId")
    if dry_run or not isinstance(job_id, str):
        return response
    route = f"/api/unified/projects/{urllib.parse.quote(project_id, safe='')}/jobs/{job_id}"
    job = call(base, cookie, route).get("job", {})
    if not isinstance(job, dict) or job.get("state") != "succeeded":
        raise CliError("Shot export did not return a completed artifact", 4)
    return {**response, "savedFiles": save_render_files(base, cookie, project_id, job, output_root, "shot")}


def command(base: str, cookie: str, name: str, project_id: str | None = None, args: dict | None = None, expected_revision: int | None = None, request_id: str | None = None, dry_run: bool = False) -> dict:
    if name in {'motion.binding.set', 'rig.normalization.run', 'animation.assignment.run', 'animation.assignment.commit', 'shot.result.import'} and (isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0):
        raise ValueError(f'{name} requires the expected_revision of the edited snapshot')
    if request_id is not None and (str(uuid.UUID(request_id)) != request_id or uuid.UUID(request_id).version != 4):
        raise ValueError("request_id must be a canonical UUIDv4")
    envelope = {"requestId": request_id or str(uuid.uuid4()), "command": name, "args": args or {}}
    if dry_run:
        envelope["dryRun"] = True
    if project_id:
        envelope["projectId"] = project_id
        if expected_revision is not None:
            envelope["expectedRevision"] = expected_revision
        elif name != "scene.render":
            envelope["expectedRevision"] = call(base, cookie, f"/api/unified/projects/{urllib.parse.quote(project_id, safe='')}")["project"]["revision"]
    failure: Exception | None = None
    for attempt in range(3):
        try:
            result = call(base, cookie, "/api/unified/commands", "POST", envelope)
            if result.get("ok") is True:
                return result
            error_object = result.get("error") if isinstance(result, dict) else None
            code = error_object.get("code") if isinstance(error_object, dict) else None
            retryable = error_object.get("retryable") is True if isinstance(error_object, dict) else False
            failure = CliError(json.dumps(result, ensure_ascii=False), exit_code_for(500, code), code=code, retryable=retryable)
            if not retryable:
                raise failure
        except CliError as error:
            failure = error
            if not error.retryable:
                raise
        except OSError as error:
            failure = error

        try:
            committed = request_result(base, cookie, envelope["requestId"])
            if committed is not None:
                return committed
        except (OSError, CliError):
            pass
        if attempt < 2:
            time.sleep(0.2 * (attempt + 1))

    raise CliError(
        f"Command outcome is uncertain; query request-result {envelope['requestId']}. Last error: {failure}",
        failure.exit_code if isinstance(failure, CliError) else 1,
        status=failure.status if isinstance(failure, CliError) else None,
        code=failure.code if isinstance(failure, CliError) else None,
        retryable=True,
    )


def read_bounded_file(path: Path, max_bytes: int, error_message: str) -> bytes:
    if path.stat().st_size > max_bytes:
        raise ValueError(error_message)
    with path.open("rb") as stream:
        data = stream.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError(error_message)
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="Work with projects through the local BBS app host")
    sub = parser.add_subparsers(dest="action", required=True)
    rig = sub.add_parser("rig", help="inspect and normalize rigs through the shared host")
    rig_sub = rig.add_subparsers(dest="rig_action", required=True)
    rig_inspect = rig_sub.add_parser("inspect")
    rig_inspect.add_argument("project_id")
    rig_inspect.add_argument("asset_id")
    for operation in ("plan", "run"):
        item = rig_sub.add_parser(operation)
        item.add_argument("project_id")
        item.add_argument("source_asset_id")
        item.add_argument("target_asset_id")
        item.add_argument("mapping_id")
        item.add_argument("--action-index", type=int, default=0)
        item.add_argument("--fps", type=float, default=30)
        item.add_argument("--root-translation-scale", type=float, default=1)
        if operation == "run":
            item.add_argument("--plan-sha256", required=True)
            item.add_argument("--expected-revision", type=int, required=True)
    for operation in ("assignment-plan", "assignment-run"):
        item = rig_sub.add_parser(operation)
        item.add_argument("project_id")
        item.add_argument("motion_id")
        item.add_argument("character_id")
        item.add_argument("--fps", type=float, default=30)
        if operation == "assignment-run":
            item.add_argument("--plan-sha256", required=True)
            item.add_argument("--expected-revision", type=int, required=True)
    assignment_save = rig_sub.add_parser("assignment-save", help="commit a completed Assignment job and place it on the Character timeline")
    assignment_save.add_argument("project_id")
    assignment_save.add_argument("job_id")
    assignment_save.add_argument("--expected-revision", type=int, required=True)
    assignment_save.add_argument("--frame-start", type=int)
    rig_save = rig_sub.add_parser("save", help="import a completed normalization job with shared Undo/Redo")
    rig_save.add_argument("project_id")
    rig_save.add_argument("job_id")
    rig_save.add_argument("--expected-revision", type=int, required=True)
    inspect = sub.add_parser("inspect", help="show a project manifest")
    inspect.add_argument("project_id")
    create = sub.add_parser("create", help="create a project from a Topview DirectorDocument JSON file")
    create.add_argument("--name", required=True)
    create.add_argument("--scene", required=True, type=Path)
    create.add_argument("--fcurves", type=Path)
    import_project = sub.add_parser("import", help="import a validated unified-project manifest into a new project")
    import_project.add_argument("manifest", type=Path)
    import_legacy = sub.add_parser("import-topview", help="copy a legacy Topview project or draft into a new unified project")
    import_legacy.add_argument("kind", choices=("project", "draft"))
    import_legacy.add_argument("source_id")
    import_legacy.add_argument("--name")
    export = sub.add_parser("export", help="write a project manifest to a local JSON file")
    export.add_argument("project_id")
    export.add_argument("output", type=Path)
    request = sub.add_parser("request-result", help="recover a command result by request ID")
    request.add_argument("request_id")
    for action in ("undo", "redo"):
        item = sub.add_parser(action, help=f"{action} the latest project transaction")
        item.add_argument("project_id")
    replace = sub.add_parser("replace-scene", help="replace Scene with a Topview DirectorDocument JSON file")
    replace.add_argument("project_id")
    replace.add_argument("scene", type=Path)
    asset = sub.add_parser("asset", help="import assets into a unified project")
    asset_sub = asset.add_subparsers(dest="asset_action", required=True)
    asset_import = asset_sub.add_parser("import", help="import GLB v2, embedded glTF, FBX, PNG or JPEG assets")
    asset_import.add_argument("project_id")
    asset_import.add_argument("files", type=Path, nargs="+")
    asset_import.add_argument("--format", choices=("auto", "glb", "gltf", "fbx", "png", "jpg"), default="auto")
    asset_import.add_argument("--unit-meters", type=float, help="required for FBX; meters per source unit (for example 0.01 for cm)")
    asset_relink = asset_sub.add_parser("relink", help="restore a missing asset file by its content hash")
    asset_relink.add_argument("project_id")
    asset_relink.add_argument("asset_id")
    asset_relink.add_argument("file", type=Path)
    character = sub.add_parser("character", help="manage shared characters")
    character_sub = character.add_subparsers(dest="character_action", required=True)
    character_add = character_sub.add_parser("add", help="add a character from an imported model and skeleton profile")
    character_add.add_argument("project_id")
    character_add.add_argument("asset_id")
    character_add.add_argument("skeleton_id")
    character_add.add_argument("name")
    character_add.add_argument("--transform", type=Path, help="JSON object with position, rotation and scale XYZ")
    character_add.add_argument("--parent-node-id", help="existing Topview group node ID")
    prop = sub.add_parser("prop", help="place an imported model as a Scene prop")
    prop_sub = prop.add_subparsers(dest="prop_action", required=True)
    prop_add = prop_sub.add_parser("add", help="place a model asset without creating a Character binding")
    prop_add.add_argument("project_id")
    prop_add.add_argument("asset_id")
    prop_add.add_argument("name")
    prop_add.add_argument("--transform", type=Path, help="JSON object with position, rotation and scale XYZ")
    prop_add.add_argument("--parent-node-id", help="existing Topview group node ID")
    camera = sub.add_parser("camera", help="edit shared camera shots")
    camera_sub = camera.add_subparsers(dest="camera_action", required=True)
    shot = camera_sub.add_parser("shot", help="insert or update an editorial camera shot")
    shot.add_argument("project_id")
    shot.add_argument("sequence_id")
    shot.add_argument("shot_id")
    shot.add_argument("camera_node_id")
    shot.add_argument("start_frame", type=int)
    shot.add_argument("end_frame", type=int)
    motion = sub.add_parser("motion", help="place shared motion clips on a Character timeline")
    motion_sub = motion.add_subparsers(dest="motion_action", required=True)
    motion_place = motion_sub.add_parser("place", help="place a compatible imported FBX motion on the timeline")
    motion_place.add_argument("project_id")
    motion_place.add_argument("motion_id")
    motion_place.add_argument("character_id")
    motion_place.add_argument("--frame-start", type=int, default=0)
    motion_place.add_argument("--source-start", type=float, default=0)
    motion_place.add_argument("--source-length", type=float)
    motion_place.add_argument("--speed", type=float, default=1)
    motion_place.add_argument("--loop", action="store_true")
    motion_place.add_argument("--reverse", action="store_true")
    binding = motion_sub.add_parser("binding", help="edit a placed motion binding through shared history")
    binding_sub = binding.add_subparsers(dest="binding_action", required=True)
    binding_set = binding_sub.add_parser("set", help="replace a MotionBinding and optionally patch its timeline range/playback")
    binding_set.add_argument("project_id")
    binding_set.add_argument("binding", type=Path, help="complete MotionBinding JSON object")
    binding_set.add_argument("--expected-revision", type=int, required=True, help="revision of the snapshot used to prepare this binding")
    binding_set.add_argument("--clip-patch", type=Path, help="JSON object with frameStart, frameEnd and/or playback speed/loop")
    scene = sub.add_parser("scene", help="edit or evaluate a unified scene")
    scene_sub = scene.add_subparsers(dest="scene_action", required=True)
    layout_read = scene_sub.add_parser("layout-read", help="read compact character/camera layout facts without geometry or raw keys")
    layout_read.add_argument("project_id")
    layout_read.add_argument("--frame", type=float)
    scene_apply = scene_sub.add_parser("apply", help="apply Topview scene operations from a JSON array")
    scene_apply.add_argument("project_id")
    scene_apply.add_argument("operations", type=Path)
    evaluate = scene_sub.add_parser("evaluate", help="evaluate scene transforms and pose data at a frame")
    evaluate.add_argument("project_id")
    evaluate.add_argument("frame", type=float)
    evaluate.add_argument("--camera-node-id")
    evaluate.add_argument("--check", dest="checks", action="append", default=[])
    render = scene_sub.add_parser("render", help="render a local snapshot and save verified PNGs into a new subfolder")
    render.add_argument("project_id")
    render.add_argument("--frame", dest="frames", type=int, action="append", required=True)
    render.add_argument("--camera-node-id", dest="camera_node_ids", action="append", required=True)
    render.add_argument("--output-dir", type=Path, required=True, help="existing local folder; files are written to a new render-<jobId> subfolder")
    render.add_argument("--width", type=int, default=640)
    render.add_argument("--height", type=int, default=360)
    shot = sub.add_parser("shot", help="exchange shot ZIP packages with App 3")
    shot_sub = shot.add_subparsers(dest="shot_action", required=True)
    shot_export = shot_sub.add_parser("export")
    shot_export.add_argument("project_id")
    shot_export.add_argument("--camera-node-id", required=True)
    shot_export.add_argument("--start-frame", type=int, required=True)
    shot_export.add_argument("--end-frame", type=int, required=True)
    shot_export.add_argument("--editable-character-id", dest="editable_character_ids", action="append", required=True)
    shot_export.add_argument("--output-dir", type=Path, required=True)
    shot_export.add_argument("--expected-revision", type=int)
    shot_result = shot_sub.add_parser("import-result")
    shot_result.add_argument("project_id")
    shot_result.add_argument("file", type=Path)
    shot_result.add_argument("--shot-id", required=True)
    shot_result.add_argument("--expected-revision", type=int, required=True)
    film = sub.add_parser("film", help="export a local native BBS FS 2.4 Film package")
    film_sub = film.add_subparsers(dest="film_action", required=True)
    film_export = film_sub.add_parser("export", help="write a verified native Film package from a typed export manifest")
    film_export.add_argument("manifest", type=Path)
    film_export.add_argument("--output-dir", type=Path, required=True, help="existing local folder; a new folder named by filmName is created")
    film_project = film_sub.add_parser("project-export", help="export a Film from an immutable shared-project snapshot")
    film_project.add_argument("project_id")
    film_project.add_argument("--character-id", dest="character_ids", action="append", required=True)
    film_project.add_argument("--sequence-id", required=True)
    film_project.add_argument("--start-frame", type=int, required=True)
    film_project.add_argument("--end-frame", type=int, required=True)
    film_project.add_argument("--viewport-aspect", type=float, required=True)
    film_project.add_argument("--film-name", required=True)
    film_project.add_argument("--output-dir", type=Path, required=True, help="existing local folder; a new film-<jobId> subfolder is created")
    film_project.add_argument("--expected-revision", type=int)
    film_convert = film_sub.add_parser("convert-model", help="convert a skinned FBX or GLB into a BOBJ model profile")
    film_convert.add_argument("source", type=Path)
    film_convert.add_argument("--output-dir", type=Path, required=True, help="existing local folder; a new model-hash folder is created")
    film_convert.add_argument("--unit-meters", type=float, help="required for FBX; GLB already uses meters")
    film_convert.add_argument("--basis", type=float, nargs=9, default=[1, 0, 0, 0, 1, 0, 0, 0, 1], help="row-major source-to-scene orthonormal 3x3 matrix")
    retarget = sub.add_parser("retarget", help="manage native Retarget sessions")
    retarget_sub = retarget.add_subparsers(dest="retarget_action", required=True)
    session = retarget_sub.add_parser("session", help="save a validated V9.12 project snapshot")
    session_sub = session.add_subparsers(dest="session_action", required=True)
    session_set = session_sub.add_parser("set", help="store a V9.12 snapshot with a source Motion, target Character and mapping")
    session_set.add_argument("project_id")
    session_set.add_argument("source_motion_id")
    session_set.add_argument("target_character_id")
    session_set.add_argument("mapping_id")
    session_set.add_argument("native_project", type=Path)
    session_set.add_argument("--session-id", help="update an existing session UUID")
    args = parser.parse_args()

    if args.action == "film":
        if args.film_action == "project-export":
            try:
                base = local_base()
                result = export_project_film_job(base, open_session(base), args.project_id, {
                    "characterIds": args.character_ids, "sequenceId": args.sequence_id,
                    "range": {"startFrame": args.start_frame, "endFrame": args.end_frame},
                    "viewportAspect": args.viewport_aspect, "filmName": args.film_name,
                }, args.output_dir, expected_revision=args.expected_revision)
                print(json.dumps(result, ensure_ascii=False, indent=2))
                return 0
            except (ValueError, CliError, OSError) as error:
                print(str(error), file=sys.stderr)
                return error.exit_code if isinstance(error, CliError) else 2
        try:
            if args.film_action == "export":
                result = run_film_worker(args.manifest, args.output_dir)
            else:
                result = convert_film_model(args.source, args.output_dir, args.unit_meters, args.basis)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
        except ValueError as error:
            print(str(error), file=sys.stderr)
            return 2
        except BlenderUnavailableError as error:
            print(str(error), file=sys.stderr)
            return 4
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            print(str(error), file=sys.stderr)
            return 1

    try:
        base = local_base()
        cookie = open_session(base)
        if args.action == "shot":
            if args.shot_action == "export":
                result = export_shot_job(base, cookie, args.project_id, {
                    "cameraNodeId": args.camera_node_id, "frameStart": args.start_frame,
                    "frameEnd": args.end_frame, "editableCharacterIds": args.editable_character_ids,
                }, args.output_dir, expected_revision=args.expected_revision)
            else:
                if args.expected_revision < 0 or not args.file.is_file() or args.file.suffix.lower() != ".zip":
                    raise ValueError("Shot result requires an existing ZIP and non-negative expected revision")
                upload_id = upload_file(base, cookie, args.file)["uploadId"]
                result = command(base, cookie, "shot.result.import", args.project_id,
                                 {"file": upload_id, "shotId": args.shot_id}, expected_revision=args.expected_revision)
        elif args.action == "rig":
            if args.rig_action == "inspect":
                result = command(base, cookie, "rig.inspect", args.project_id, {"assetId": args.asset_id})
            elif args.rig_action == "save":
                if args.expected_revision < 0:
                    raise ValueError("expected_revision must be non-negative")
                result = command(base, cookie, "asset.import", args.project_id, {"normalizationJobId": args.job_id}, expected_revision=args.expected_revision)
            elif args.rig_action == "assignment-save":
                if args.expected_revision < 0 or args.frame_start is not None and args.frame_start < 0:
                    raise ValueError("Assignment save requires non-negative revision and frame start")
                payload = {"jobId": args.job_id}
                if args.frame_start is not None:
                    payload["frameStart"] = args.frame_start
                result = command(base, cookie, "animation.assignment.commit", args.project_id, payload, expected_revision=args.expected_revision)
            elif args.rig_action in {"assignment-plan", "assignment-run"}:
                if not math.isfinite(args.fps) or not 1 <= args.fps <= 240:
                    raise ValueError("FPS must be in [1, 240]")
                payload = {"motionId": args.motion_id, "characterId": args.character_id, "fps": args.fps}
                revision = None
                command_name = "animation.assignment.plan"
                if args.rig_action == "assignment-run":
                    if args.expected_revision < 0 or len(args.plan_sha256) != 64 or any(char not in "0123456789abcdef" for char in args.plan_sha256):
                        raise ValueError("Assignment run requires a SHA-256 plan hash and non-negative revision")
                    payload["planSha256"] = args.plan_sha256
                    revision = args.expected_revision
                    command_name = "animation.assignment.run"
                result = command(base, cookie, command_name, args.project_id, payload, expected_revision=revision)
            else:
                if args.action_index < 0 or not math.isfinite(args.fps) or not 1 <= args.fps <= 240 or not math.isfinite(args.root_translation_scale) or not 0.01 <= args.root_translation_scale <= 20:
                    raise ValueError("Action index must be non-negative, FPS in [1, 240], and root translation scale in [0.01, 20]")
                payload = {"sourceAssetId": args.source_asset_id, "targetAssetId": args.target_asset_id, "mappingId": args.mapping_id, "actionIndex": args.action_index, "fps": args.fps, "rootTranslationScale": args.root_translation_scale}
                revision = None
                if args.rig_action == "run":
                    if args.expected_revision < 0 or len(args.plan_sha256) != 64 or any(char not in "0123456789abcdef" for char in args.plan_sha256):
                        raise ValueError("Run requires a SHA-256 plan hash and non-negative revision")
                    payload["planSha256"] = args.plan_sha256
                    revision = args.expected_revision
                result = command(base, cookie, f"rig.normalization.{args.rig_action}", args.project_id, payload, expected_revision=revision)
        elif args.action == "inspect":
            result = call(base, cookie, f"/api/unified/projects/{urllib.parse.quote(args.project_id, safe='')}")["project"]
        elif args.action == "request-result":
            result = request_result(base, cookie, args.request_id)
            if result is None:
                raise CliError("No committed result for that request ID", 4, status=404, code="NOT_FOUND")
        elif args.action == "export":
            result = call(base, cookie, f"/api/unified/projects/{urllib.parse.quote(args.project_id, safe='')}")["project"]
            args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        elif args.action == "create":
            scene = json.loads(args.scene.read_text(encoding="utf-8"))
            fcurves = json.loads(args.fcurves.read_text(encoding="utf-8")) if args.fcurves else None
            result = command(base, cookie, "project.create", args={"name": args.name, "scene": scene, "fcurves": fcurves})
        elif args.action == "import":
            manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
            result = command(base, cookie, "project.import", args={"project": manifest})
        elif args.action == "import-topview":
            legacy_id = urllib.parse.quote(args.source_id, safe='')
            legacy_route = 'projects' if args.kind == 'project' else 'drafts'
            legacy = call(base, cookie, f"/api/{legacy_route}/{legacy_id}")
            extra = legacy.get("extra") if isinstance(legacy.get("extra"), dict) else {}
            name = args.name or extra.get("customDraftName") or f"Topview {args.kind} {args.source_id}"
            curves = None
            try:
                curves = call(base, cookie, f"/api/{legacy_route}/{legacy_id}/fcurves")
            except CliError as error:
                if not str(error).startswith("HTTP 404:"):
                    raise
            result = command(base, cookie, "project.create", args={"name": name, "scene": legacy, "fcurves": curves, "source": {"kind": args.kind, "id": args.source_id}})
        elif args.action == "asset":
            if args.asset_action == "relink":
                if not args.file.is_file():
                    raise ValueError(f"Asset file does not exist: {args.file}")
                upload_id = upload_file(base, cookie, args.file)["uploadId"]
                result = command(base, cookie, "asset.relink", args.project_id, {"assetId": args.asset_id, "file": upload_id})
            else:
                if len(args.files) > 32:
                    raise ValueError("At most 32 files can be imported in one command")
                if args.unit_meters is not None and (not math.isfinite(args.unit_meters) or args.unit_meters <= 0):
                    raise ValueError('unit_meters must be finite and positive')
                if (args.format == 'fbx' or args.format == 'auto' and any(file.suffix.lower() == '.fbx' for file in args.files)) and args.unit_meters is None:
                    raise ValueError('FBX import requires explicit --unit-meters')
                upload_ids = []
                total = 0
                for file_path in args.files:
                    if not file_path.is_file():
                        raise ValueError(f"Asset file does not exist: {file_path}")
                    total += file_path.stat().st_size
                    if total > 512 * 1024 * 1024:
                        raise ValueError("Combined import cannot exceed 512 MiB")
                    upload_ids.append(upload_file(base, cookie, file_path)["uploadId"])
                payload = {"files": upload_ids, "format": args.format}
                if args.unit_meters is not None:
                    payload['unitMeters'] = args.unit_meters
                result = command(base, cookie, "asset.import", args.project_id, payload)
        elif args.action == "character":
            payload = {"assetId": args.asset_id, "skeletonId": args.skeleton_id, "name": args.name}
            if args.transform:
                payload["transform"] = json.loads(args.transform.read_text(encoding="utf-8"))
            if args.parent_node_id:
                payload["parentNodeId"] = args.parent_node_id
            result = command(base, cookie, "character.add", args.project_id, payload)
        elif args.action == "prop":
            payload = {"assetId": args.asset_id, "name": args.name}
            if args.transform:
                payload["transform"] = json.loads(args.transform.read_text(encoding="utf-8"))
            if args.parent_node_id:
                payload["parentNodeId"] = args.parent_node_id
            result = command(base, cookie, "prop.add", args.project_id, payload)
        elif args.action == "camera":
            result = command(base, cookie, "camera.shot.set", args.project_id, {
                "sequenceId": args.sequence_id,
                "clip": {"id": args.shot_id, "cameraNodeId": args.camera_node_id, "sourceFrameStart": args.start_frame, "sourceFrameEnd": args.end_frame},
            })
        elif args.action == "motion" and args.motion_action == "binding":
            if args.expected_revision < 0:
                raise ValueError('expected_revision must be non-negative')
            binding = json.loads(read_bounded_file(args.binding, 1024 * 1024, "Binding JSON cannot exceed 1 MiB").decode("utf-8"))
            if not isinstance(binding, dict):
                raise ValueError("Binding JSON must contain an object")
            payload = {"binding": binding}
            if args.clip_patch:
                clip_patch = json.loads(read_bounded_file(args.clip_patch, 1024 * 1024, "Clip patch JSON cannot exceed 1 MiB").decode("utf-8"))
                if not isinstance(clip_patch, dict):
                    raise ValueError("Clip patch JSON must contain an object")
                payload["clipPatch"] = clip_patch
            result = command(base, cookie, "motion.binding.set", args.project_id, payload, expected_revision=args.expected_revision)
        elif args.action == "motion":
            if args.frame_start < 0 or not math.isfinite(args.source_start) or args.source_start < 0 or args.source_length is not None and (not math.isfinite(args.source_length) or args.source_length <= 0) or not math.isfinite(args.speed) or not 0.01 <= args.speed <= 16:
                raise ValueError("frame_start/source_start must be non-negative, source_length positive, and speed between 0.01 and 16")
            payload = {
                "motionId": args.motion_id, "characterId": args.character_id, "frameStart": args.frame_start,
                "sourceStartSeconds": args.source_start, "speed": args.speed, "loop": args.loop, "reverse": args.reverse,
            }
            if args.source_length is not None:
                payload["sourceLengthSeconds"] = args.source_length
            result = command(base, cookie, "motion.place", args.project_id, payload)
        elif args.action == "scene":
            if args.scene_action == "layout-read":
                if args.frame is not None and not math.isfinite(args.frame):
                    raise ValueError("Layout frame must be finite")
                result = command(base, cookie, "scene.layout.read", args.project_id, {"frame": args.frame} if args.frame is not None else {})
            elif args.scene_action == "apply":
                raw_operations = read_bounded_file(args.operations, 64 * 1024 * 1024, "Scene operation JSON cannot exceed 64 MiB")
                operations = json.loads(raw_operations.decode("utf-8"))
                if not isinstance(operations, list):
                    raise ValueError("Scene operations JSON must contain an array")
                result = command(base, cookie, "scene.apply", args.project_id, {"operations": operations})
            elif args.scene_action == "evaluate":
                result = command(base, cookie, "scene.evaluate", args.project_id, {
                    "frame": args.frame,
                    **({"cameraNodeId": args.camera_node_id} if args.camera_node_id else {}),
                    "checks": args.checks,
                })
            else:
                if not args.frames or len(set(args.frames)) != len(args.frames):
                    raise ValueError("Render frames must be non-empty and unique")
                if not 64 <= args.width <= 1024 or not 64 <= args.height <= 1024:
                    raise ValueError("Render dimensions must be between 64 and 1024")
                result = render_scene_job(base, cookie, args.project_id, {
                    "frames": args.frames, "camera_node_ids": args.camera_node_ids, "width": args.width, "height": args.height,
                }, args.output_dir)
        elif args.action == "retarget":
            native_bytes = read_bounded_file(args.native_project, 12 * 1024 * 1024, "V9.12 project JSON cannot exceed 12 MiB")
            native_project = json.loads(native_bytes.decode("utf-8"))
            if not isinstance(native_project, dict):
                raise ValueError("V9.12 project JSON must contain an object")
            payload = {
                "sourceMotionId": args.source_motion_id,
                "targetCharacterId": args.target_character_id,
                "mappingId": args.mapping_id,
                "nativeProject": native_project,
                **({"sessionId": args.session_id} if args.session_id else {}),
            }
            result = command(base, cookie, "retarget.session.set", args.project_id, payload)
        elif args.action in {"undo", "redo"}:
            result = command(base, cookie, f"history.{args.action}", args.project_id)
        else:
            scene = json.loads(args.scene.read_text(encoding="utf-8"))
            project = call(base, cookie, f"/api/unified/projects/{urllib.parse.quote(args.project_id, safe='')}")["project"]
            result = command(base, cookie, "scene.apply", args.project_id, {"operations": [{
                "type": "document.replace", "document": scene,
                "fcurves": project.get("extensions", {}).get("topview", {}).get("fcurves"),
            }]}, expected_revision=project["revision"])
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except CliError as error:
        print(str(error), file=sys.stderr)
        return error.exit_code
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    except (OSError, RuntimeError, urllib.error.URLError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
