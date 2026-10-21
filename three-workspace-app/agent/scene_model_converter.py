"""Convert a baked scene GLB to self-contained .blend and FBX using local Blender."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

MAX_BYTES = 512 * 1024 * 1024
SCRIPT = Path(__file__).with_name("scene_blender_export.py")

class BlenderUnavailableError(RuntimeError):
    pass


def validate_scene_glb(source: Path) -> str:
    if source.is_symlink() or not source.is_file() or not 20 <= source.stat().st_size <= MAX_BYTES:
        raise ValueError("Scene source must be a regular GLB file no larger than 512 MiB")
    data = source.read_bytes()
    magic, version, size, length, chunk = struct.unpack_from("<5I", data)
    if magic != 0x46546C67 or version != 2 or size != len(data) or chunk != 0x4E4F534A or length > len(data)-20:
        raise ValueError("Invalid GLB header or JSON chunk")
    try:
        document = json.loads(data[20:20+length])
    except (ValueError, UnicodeError) as error:
        raise ValueError("Invalid GLB JSON") from error
    if not isinstance(document, dict) or document.get("asset", {}).get("version") != "2.0" or not document.get("nodes") or not document.get("scenes"):
        raise ValueError("Scene GLB needs a scene and nodes")
    if any(buffer.get("uri") for buffer in document.get("buffers", [])) or any(image.get("uri") and not image["uri"].startswith("data:") for image in document.get("images", [])):
        raise ValueError("Scene GLB resources must be embedded")
    return hashlib.sha256(data).hexdigest()


def blender_command(executable: Path, source: Path, output: Path, fps: int) -> list[str]:
    if isinstance(fps, bool) or not isinstance(fps, int) or not 1 <= fps <= 240:
        raise ValueError("Scene FPS must be an integer in [1, 240]")
    return [str(executable), "--background", "--factory-startup", "--python-exit-code", "1", "--python", str(SCRIPT), "--", "--input", str(source), "--output", str(output), "--fps", str(fps)]


def blender_tool() -> Path:
    candidate = os.environ.get("BBS_BLENDER_EXE") or shutil.which("blender")
    if not candidate or not Path(candidate).is_file():
        raise BlenderUnavailableError("Scene conversion needs Blender 4.2+; set BBS_BLENDER_EXE or add blender to PATH")
    result = subprocess.run([candidate, "--version"], capture_output=True, text=True, timeout=15, check=False)
    import re
    match = re.search(r"Blender\s+(\d+)\.(\d+)", result.stdout + result.stderr)
    if result.returncode or not match or tuple(map(int, match.groups())) < (4, 2):
        raise BlenderUnavailableError("Scene conversion needs Blender 4.2+")
    return Path(candidate).resolve(strict=True)


def convert_scene(source: str | Path, output_dir: str | Path, fps: int = 30) -> dict:
    source = Path(source)
    digest = validate_scene_glb(source)
    source = source.resolve(strict=True)
    destination = Path(output_dir)
    if destination.exists() or destination.is_symlink():
        raise ValueError("Scene output directory must not already exist")
    executable = blender_tool()
    # Validate command arguments before creating output state.
    blender_command(executable, source, destination, fps)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".scene-export-", dir=destination.parent) as temp:
        stage = Path(temp)
        result = subprocess.run(blender_command(executable, source, stage, fps), capture_output=True, text=True, timeout=300, check=False)
        if result.returncode:
            raise RuntimeError("Blender scene export failed: " + (result.stderr or result.stdout)[-3000:])
        summary_path = stage / "summary.json"
        if summary_path.is_symlink() or not summary_path.is_file():
            raise RuntimeError("Blender scene summary is missing")
        summary = json.loads(summary_path.read_text())
        if summary.get("sourceSha256") != digest or summary.get("fps") != fps or not summary.get("objects"):
            raise RuntimeError("Blender summary does not match the source scene")
        files = []
        for name, header in [("scene.blend", b"BLENDER"), ("scene.fbx", b"Kaydara FBX Binary")]:
            file = stage / name
            if file.is_symlink() or not file.is_file() or not 1 <= file.stat().st_size <= MAX_BYTES:
                raise RuntimeError(f"Blender output missing or invalid: {name}")
            data = file.read_bytes()
            if not data.startswith(header):
                raise RuntimeError(f"Blender output has invalid magic: {name}")
            files.append({"name": name, "sizeBytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        report = {"version": 1, "sourceSha256": digest, "fps": fps, "scene": summary, "files": files}
        (stage / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        # Stage is private and no existing user directory is replaced.
        destination.mkdir(exist_ok=False)
        try:
            for name in ["scene.blend", "scene.fbx", "report.json"]:
                shutil.copyfile(stage / name, destination / name)
        except BaseException:
            shutil.rmtree(destination)
            raise
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--fps", type=int, default=30)
    args = parser.parse_args()
    try:
        report = convert_scene(args.input, args.output, args.fps)
    except BlenderUnavailableError as error:
        parser.exit(2, f"NOT_RUN: {error}\n")
    print(json.dumps(report))

if __name__ == "__main__":
    main()
