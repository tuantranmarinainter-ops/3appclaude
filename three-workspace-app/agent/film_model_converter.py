"""Offline Blender-backed conversion of one skinned model into BBS BOBJ."""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

try:
    from .film_worker import _sha256
except ImportError:
    from film_worker import _sha256


WORKER_ROOT = Path(__file__).resolve().parent / "film_worker"
BLENDER_SCRIPT = WORKER_ROOT / "blender" / "convert_model.py"
MAX_SOURCE_BYTES = 256 * 1024 * 1024
MAX_MODEL_BYTES = 512 * 1024 * 1024
SAFE_BONE = re.compile(r"[A-Za-z0-9_.-]{1,128}")
SAFE_HASH = re.compile(r"[a-f0-9]{64}")


class BlenderUnavailableError(RuntimeError):
    pass


def _blender_tool() -> Path:
    configured = os.environ.get("BBS_BLENDER_EXE")
    candidate = Path(configured) if configured else None
    if candidate is None:
        found = shutil.which("blender")
        if found:
            candidate = Path(found)
    if candidate is None and os.name == "nt":
        candidate = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Blender Foundation" / "blender.exe"
    if candidate is None or not candidate.is_file():
        raise BlenderUnavailableError("BBS model conversion requires Blender 4.2 or newer; set BBS_BLENDER_EXE or add blender to PATH")
    result = subprocess.run([str(candidate), "--version"], capture_output=True, text=True, timeout=15, check=False)
    match = re.search(r"Blender\s+(\d+)\.(\d+)\.(\d+)", result.stdout + result.stderr)
    if result.returncode or not match or tuple(map(int, match.groups())) < (4, 2, 0):
        raise BlenderUnavailableError("BBS model conversion requires Blender 4.2 or newer")
    return candidate.resolve(strict=True)


def _profile(value: object, source_hash: str, model_id: str, unit_meters: float, stage: Path) -> dict:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1 or value.get("sourceSha256") != source_hash or value.get("modelId") != model_id or value.get("metersPerUnit") != unit_meters:
        raise RuntimeError("Blender returned a profile that does not match the requested source")
    bones, actions, files = value.get("bones"), value.get("actions"), value.get("files")
    if not isinstance(bones, list) or not 1 <= len(bones) <= 512 or not isinstance(actions, list) or len(actions) > 512 or not isinstance(files, list) or not isinstance(value.get("textureRequired"), bool):
        raise RuntimeError("Blender returned invalid model profile dimensions")
    names: set[str] = set()
    source_names: set[str] = set()
    for bone in bones:
        if not isinstance(bone, dict) or not isinstance(bone.get("name"), str) or not SAFE_BONE.fullmatch(bone["name"]) or bone["name"] in names:
            raise RuntimeError("Blender returned invalid or duplicate BOBJ bone names")
        matrix = bone.get("bobjRestMatrixRowMajor")
        if not isinstance(matrix, list) or len(matrix) != 16 or any(
            isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in matrix
        ):
            raise RuntimeError("Blender returned an invalid BOBJ rest matrix")
        names.add(bone["name"])
        source_name = bone.get("sourceName", bone["name"])
        if not isinstance(source_name, str) or not source_name or source_name in source_names:
            raise RuntimeError("Blender returned invalid or duplicate source bone names")
        source_names.add(source_name)
    if any(bone.get("parent") is not None and bone.get("parent") not in names for bone in bones):
        raise RuntimeError("Blender returned a BOBJ profile with missing parent bones")
    if any(not isinstance(action, str) or not action for action in actions) or len(set(actions)) != len(actions):
        raise RuntimeError("Blender returned invalid or duplicate BOBJ action names")
    seen: set[str] = set()
    for file in files:
        if not isinstance(file, dict) or file.get("targetPath") not in {"model.bobj", "model.png"} or file["targetPath"] in seen or not isinstance(file.get("sha256"), str) or not SAFE_HASH.fullmatch(file["sha256"]):
            raise RuntimeError("Blender returned an invalid model file profile")
        seen.add(file["targetPath"])
        path = stage / file["targetPath"]
        if not path.is_file() or path.is_symlink() or path.stat().st_size <= 0 or path.stat().st_size > MAX_MODEL_BYTES or _sha256(path) != file["sha256"]:
            raise RuntimeError("Blender model output failed its size or hash check")
    if "model.bobj" not in seen or bool(value.get("textureRequired")) != ("model.png" in seen):
        raise RuntimeError("Blender model texture profile does not match its output files")
    return value


def _basis(value: object) -> list[float]:
    if value is None:
        return [1, 0, 0, 0, 1, 0, 0, 0, 1]
    if not isinstance(value, (list, tuple)) or len(value) != 9 or any(
        isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) for item in value
    ):
        raise ValueError("BBS model basis must contain nine finite row-major values")
    rows = [value[index:index + 3] for index in (0, 3, 6)]
    if any(abs(sum(a * b for a, b in zip(rows[i], rows[j])) - (1 if i == j else 0)) > 1e-6 for i in range(3) for j in range(3)):
        raise ValueError("BBS model basis must be orthonormal")
    return [float(item) for item in value]


def convert_film_model(source: Path, output_dir: Path, unit_meters: float | None = None, basis_to_scene: list[float] | None = None) -> dict:
    source, output_dir = Path(source), Path(output_dir)
    if source.is_symlink() or output_dir.is_symlink():
        raise ValueError("BBS model conversion paths must not be symbolic links")
    try:
        source = source.resolve(strict=True)
        output_dir = output_dir.resolve(strict=True)
    except OSError as error:
        raise ValueError("BBS model source and output directory must exist") from error
    if not source.is_file() or source.stat().st_size <= 0 or source.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError("BBS model source must be a regular file up to 256 MiB")
    if not output_dir.is_dir():
        raise ValueError("BBS model output must be an existing local directory")
    suffix = source.suffix.lower()
    if suffix not in {".fbx", ".glb"}:
        raise ValueError("BBS model conversion supports FBX and GLB files")
    if suffix == ".fbx" and (not isinstance(unit_meters, (int, float)) or isinstance(unit_meters, bool) or not 0 < unit_meters < float("inf")):
        raise ValueError("FBX conversion requires a finite positive --unit-meters value")
    if suffix == ".glb" and unit_meters not in (None, 1):
        raise ValueError("GLB conversion uses meters and requires --unit-meters 1")
    unit_meters = 1.0 if unit_meters is None else float(unit_meters)
    basis_to_scene = _basis(basis_to_scene)

    source_hash = _sha256(source)
    model_id = f"unified/{source_hash[:16]}"
    final = output_dir / f"model-{source_hash[:12]}"
    if final.exists():
        raise ValueError(f"BBS model output already exists: {final.name}")
    blender = _blender_tool()
    stage = Path(tempfile.mkdtemp(prefix=".film-model-stage-", dir=output_dir))
    moved = False
    try:
        process = subprocess.run(
            [str(blender), "--background", "--factory-startup", "--python", str(BLENDER_SCRIPT), "--",
             "--source", str(source), "--output-dir", str(stage), "--unit-meters", str(unit_meters), "--model-id", model_id,
             "--basis", *map(str, basis_to_scene)],
            capture_output=True, text=True, timeout=600, check=False,
        )
        status_path = stage / "conversion-status.json"
        if not status_path.is_file():
            detail = (process.stderr or process.stdout).strip()[-2000:]
            raise RuntimeError("Blender did not return conversion status" + (f": {detail}" if detail else ""))
        status = json.loads(status_path.read_text(encoding="utf-8"))
        if process.returncode or not isinstance(status, dict) or status.get("ok") is not True:
            message = status.get("error") if isinstance(status, dict) else None
            raise RuntimeError(f"Blender BOBJ conversion failed: {message or (process.stderr or process.stdout).strip()[-2000:]}")
        profile = _profile(status.get("profile"), source_hash, model_id, float(unit_meters), stage)
        saved_profile = json.loads((stage / "profile.json").read_text(encoding="utf-8"))
        if saved_profile != profile:
            raise RuntimeError("Blender conversion profile file does not match its status")
        status_path.unlink()
        os.rename(stage, final)
        moved = True
        files = [{**item, "sourcePath": str(final / item["targetPath"])} for item in profile["files"]]
        return {
            "ok": True,
            "packageDirectory": str(final),
            "profilePath": str(final / "profile.json"),
            "modelId": model_id,
            "sourceSha256": source_hash,
            "bones": len(profile["bones"]),
            "actions": len(profile["actions"]),
            "textureRequired": profile["textureRequired"],
            "files": files,
        }
    finally:
        if not moved:
            shutil.rmtree(stage, ignore_errors=True)
