"""Offline bookkeeping for generated images and videos.

``generation record`` stores what was made from which render frames: it copies the output files into
``.topview-3d/generations/<id>/`` and writes ``generation.json`` (provider, prompt, the reference frames
with their sha256 and whether the scene changed since). It never opens a network connection, never
downloads anything, and its spec has no field for credentials: unknown keys are rejected.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.local_project import atomic_write_json, base_result, open_project
from topview_3d_cli.local_read import renders_show

FORMAT_NAME = "scene3d-generation"
GENERATION_ID = re.compile(r"^gen-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6}$")
PROVIDER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$")
KINDS = ("image", "video")
STATUSES = ("completed", "failed")
EXTENSIONS = {"image": {".png", ".jpg", ".jpeg", ".webp"}, "video": {".mp4", ".webm", ".mov"}}
SPEC_KEYS = {"kind", "provider", "model", "prompt", "references", "outputs", "status", "notes"}
SIGNED_URL = re.compile(r"X-Amz-|Signature=|[?&](?:token|key|sig|auth)[a-z_]*=", re.I)
MAX_REFERENCES = 8
MAX_OUTPUTS = 8
MAX_PROMPT = 4000


def _invalid(message: str, details: Any = None) -> LocalProjectError:
    return LocalProjectError("GENERATION_INVALID", message, details=details)


def _text(spec: dict[str, Any], key: str, limit: int, *, required: bool = False) -> str | None:
    value = spec.get(key)
    if value is None:
        if required:
            raise _invalid(f"{key} is required")
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise _invalid(f"{key} must be a non-empty string of at most {limit} characters")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _video_reference(raw_path: Any, index: int) -> dict[str, Any]:
    """A video exported from Studio. It lives outside .topview-3d, so only its fingerprint is kept and
    the scene is not checked: ``stale`` is unknown (None) and ``sceneChecked`` is false."""
    source = Path(str(raw_path)).expanduser() if isinstance(raw_path, str) and raw_path else None
    if source is None or source.suffix.lower() not in EXTENSIONS["video"]:
        raise _invalid(f"a video reference must be a file of {sorted(EXTENSIONS['video'])}", {"index": index})
    if not source.is_file() or source.stat().st_size == 0:
        raise _invalid(f"{source} is not a non-empty file", {"index": index})
    return {"kind": "video", "sourceName": source.name, "sizeBytes": source.stat().st_size,
            "sha256": _sha256(source), "sceneSequence": None, "stale": None, "sceneChecked": False}


def _references(directory: str, raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_REFERENCES:
        raise _invalid(f"references must list 1..{MAX_REFERENCES} render frames or exported videos")
    rows = []
    for index, item in enumerate(raw):
        if isinstance(item, dict) and set(item) == {"video"}:
            rows.append(_video_reference(item["video"], index))
            continue
        if (not isinstance(item, dict) or set(item) - {"runId", "frame"}
                or not isinstance(item.get("runId"), str)
                or (item.get("frame") is not None and (type(item["frame"]) is not int or item["frame"] < 0))):
            raise _invalid("each reference is {\"runId\": str, \"frame\"?: int} or {\"video\": path}", {"index": index})
        shown = renders_show(directory, item["runId"], frame=item.get("frame"))
        rows.append({
            "runId": shown["runId"], "kind": shown["kind"], "frame": shown["frame"], "sha256": shown["sha256"],
            "sceneSequence": shown["sceneSequence"], "stale": shown["stale"],
            "cameraNodeId": shown["cameraNodeId"],
        })
    return rows


def _outputs(kind: str, status: str, raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        raw = []
    if not isinstance(raw, list) or len(raw) > MAX_OUTPUTS:
        raise _invalid(f"outputs must be a list of at most {MAX_OUTPUTS} entries")
    if status == "completed" and not raw:
        raise _invalid("a completed generation needs at least one output")
    entries = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict) or len(item) != 1 or next(iter(item)) not in {"file", "url"}:
            raise _invalid("each output is exactly one of {\"file\": path} or {\"url\": address}", {"index": index})
        if "url" in item:
            url = item["url"]
            if (not isinstance(url, str) or not re.match(r"^https?://[^\s]{1,2040}$", url)
                    or "@" in url.split("/")[2]):
                raise _invalid("url must be a plain http(s) address", {"index": index})
            if SIGNED_URL.search(url):
                raise _invalid("this address carries a signature or token; download the file and record it as a "
                               "local file instead", {"index": index})
            entries.append({"url": url})
            continue
        source = Path(str(item["file"])).expanduser()
        if source.suffix.lower() not in EXTENSIONS[kind]:
            raise _invalid(f"a {kind} output must be one of {sorted(EXTENSIONS[kind])}", {"index": index})
        if not source.is_file() or source.stat().st_size == 0:
            raise _invalid(f"{source} is not a non-empty file", {"index": index})
        entries.append({"source": source.resolve()})
    return entries


def generation_record(directory: str, spec: dict[str, Any]) -> dict[str, Any]:
    unknown = sorted(set(spec) - SPEC_KEYS)
    if unknown:
        raise _invalid(f"unknown field(s) {unknown}; allowed: {sorted(SPEC_KEYS)}")
    kind = spec.get("kind")
    if kind not in KINDS:
        raise _invalid(f"kind must be one of {list(KINDS)}")
    status = spec.get("status", "completed")
    if status not in STATUSES:
        raise _invalid(f"status must be one of {list(STATUSES)}")
    provider = _text(spec, "provider", 64, required=True)
    if not PROVIDER.match(provider or ""):
        raise _invalid("provider is a short name such as the service or model family, not an address")
    prompt = _text(spec, "prompt", MAX_PROMPT, required=True)
    model = _text(spec, "model", 128)
    notes = _text(spec, "notes", 1000)
    project = open_project(directory)
    references = _references(directory, spec.get("references"))
    outputs = _outputs(kind, status, spec.get("outputs"))

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    generation_id = f"gen-{stamp}-{secrets.token_hex(3)}"
    root = project.paths.state / "generations"
    staging = root / f".tmp-{generation_id}"
    final = root / generation_id
    staging.mkdir(parents=True)
    try:
        stored = []
        for number, entry in enumerate(outputs, 1):
            if "url" in entry:
                stored.append(entry)
                continue
            source: Path = entry["source"]
            name = f"out-{number}{source.suffix.lower()}"
            shutil.copyfile(source, staging / name)
            stored.append({"file": name, "sourceName": source.name,
                           "sizeBytes": (staging / name).stat().st_size, "sha256": _sha256(staging / name)})
        record = {
            "format": FORMAT_NAME, "schemaVersion": 1, "id": generation_id,
            "createdAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "kind": kind, "status": status, "provider": provider, "model": model, "prompt": prompt,
            "notes": notes, "sceneSequence": project.store.scene_sequence,
            "references": references, "outputs": stored,
        }
        atomic_write_json(staging / "generation.json", record)
        os.replace(staging, final)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return {**base_result(project), "generation": _public(final, record)}


def _public(directory: Path, record: dict[str, Any]) -> dict[str, Any]:
    outputs = [{**item, "path": str(directory / item["file"])} if "file" in item else dict(item)
               for item in record.get("outputs") or []]
    return {**record, "outputs": outputs, "directory": str(directory),
            "stale": any(ref.get("stale") for ref in record.get("references") or [])}


def _read(directory: Path) -> dict[str, Any] | None:
    try:
        value = json.loads((directory / "generation.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) and value.get("format") == FORMAT_NAME else None


def _records(project_state: Path) -> list[tuple[Path, dict[str, Any]]]:
    root = project_state / "generations"
    rows = []
    for child in root.iterdir() if root.is_dir() else []:
        record = _read(child) if child.is_dir() and GENERATION_ID.match(child.name) else None
        if record:
            rows.append((child, record))
    rows.sort(key=lambda row: (str(row[1].get("createdAt") or ""), row[0].name))
    return rows


def _stale_now(project_sequence: int, record: dict[str, Any]) -> bool:
    return record.get("sceneSequence") != project_sequence


def generation_list(directory: str) -> dict[str, Any]:
    project = open_project(directory)
    sequence = project.store.scene_sequence
    rows = [{
        "id": record["id"], "createdAt": record.get("createdAt"), "kind": record.get("kind"),
        "status": record.get("status"), "provider": record.get("provider"), "model": record.get("model"),
        "references": len(record.get("references") or []), "outputs": len(record.get("outputs") or []),
        "sceneChangedSince": _stale_now(sequence, record),
    } for _, record in _records(project.paths.state)]
    return {**base_result(project), "count": len(rows), "generations": rows}


def generation_show(directory: str, generation_id: str | None = None) -> dict[str, Any]:
    project = open_project(directory)
    records = _records(project.paths.state)
    if generation_id is None:
        if not records:
            raise LocalProjectError("GENERATION_NOT_FOUND", "no generations recorded yet; run `generation record`")
        path, record = records[-1]
    else:
        path, record = next(((p, r) for p, r in records if r["id"] == generation_id), (None, None))
        if path is None:
            raise LocalProjectError("GENERATION_NOT_FOUND", f"no generation {generation_id!r}")
    for item in record.get("outputs") or []:
        if "file" not in item:
            continue
        file = (path / item["file"]).resolve()
        if file.parent != path.resolve() or not file.is_file() or _sha256(file) != item.get("sha256"):
            raise LocalProjectError("GENERATION_FILE_INVALID",
                                    f"{path.name}/{item['file']} is missing or no longer matches its sha256")
    shown = _public(path, record)
    shown["sceneChangedSince"] = _stale_now(project.store.scene_sequence, record)
    return {**base_result(project), "generation": shown}
