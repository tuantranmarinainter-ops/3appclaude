"""Compile and run the pinned offline BBS FS 2.4 Film writer."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


WORKER_ROOT = Path(__file__).resolve().parent / "film_worker"
BRIDGE_JAR = WORKER_ROOT / "vendor" / "bbs-animation-bridge-0.2.0-mc1.20.1.jar"
GSON_JAR = WORKER_ROOT / "vendor" / "gson-2.10.1.jar"
EXPECTED_HASHES = {
    BRIDGE_JAR: "8cd0167a3f255877273aabff8455a713dbd1a9d5f179e83bf3cc308b90342010",
    GSON_JAR: "4241c14a7727c34feea6507ec801318a3d4a90f070e4525681079fb94ee4c593",
}
JAVA_SOURCES = (
    WORKER_ROOT / "src/main/java/local/bbsmerged/DraftEditor.java",
    WORKER_ROOT / "src/main/java/local/bbsmerged/FilmExportWorker.java",
)
MAX_MANIFEST_BYTES = 64 * 1024 * 1024


def _java_tool(name: str) -> Path:
    home = os.environ.get("BBS_JAVA_HOME") or os.environ.get("JAVA_HOME")
    if home:
        executable = Path(home) / "bin" / f"{name}.exe"
        if not executable.is_file():
            raise RuntimeError(f"BBS_JAVA_HOME/JAVA_HOME does not contain bin/{name}.exe")
        return executable
    found = shutil.which(name)
    if not found:
        raise RuntimeError("BBS Film export requires a Java 17 JDK; set BBS_JAVA_HOME or add Java 17 to PATH")
    return Path(found)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _check_java17(java: Path) -> None:
    result = subprocess.run([str(java), "-version"], capture_output=True, text=True, timeout=15, check=False)
    version = result.stderr + result.stdout
    if result.returncode or not ('version "17.' in version or "openjdk 17" in version.lower()):
        raise RuntimeError("BBS Film export requires Java 17; the selected Java runtime is not Java 17")


def _check_javac17(javac: Path) -> None:
    result = subprocess.run([str(javac), "-version"], capture_output=True, text=True, timeout=15, check=False)
    version = result.stderr + result.stdout
    if result.returncode or not ("javac 17." in version or 'version "17.' in version):
        raise RuntimeError("BBS Film export requires a Java 17 compiler")


def run_film_worker(manifest: Path, output_dir: Path) -> dict:
    manifest = Path(manifest)
    output_dir = Path(output_dir)
    if manifest.is_symlink() or output_dir.is_symlink():
        raise ValueError("Film export paths must not be symbolic links")
    manifest = manifest.resolve(strict=True)
    output_dir = output_dir.resolve(strict=True)
    if not manifest.is_file() or manifest.stat().st_size > MAX_MANIFEST_BYTES:
        raise ValueError("Film export manifest must be a regular file up to 64 MiB")
    if not output_dir.is_dir() or output_dir.is_symlink():
        raise ValueError("Film export output must be an existing local directory")
    # Parse before invoking Java so malformed input fails without starting a worker.
    with manifest.open("r", encoding="utf-8") as stream:
        document = json.load(stream)
    if not isinstance(document, dict):
        raise ValueError("Film export manifest must contain an object")
    for path, expected in EXPECTED_HASHES.items():
        if not path.is_file() or _sha256(path) != expected:
            raise RuntimeError(f"Pinned Film worker dependency checksum mismatch: {path.name}")
    java = _java_tool("java")
    javac = _java_tool("javac")
    _check_java17(java)
    _check_javac17(javac)
    classpath = os.pathsep.join(map(str, (BRIDGE_JAR, GSON_JAR)))
    with tempfile.TemporaryDirectory(prefix="bbs-film-worker-") as temporary:
        classes = Path(temporary) / "classes"
        classes.mkdir()
        compiled = subprocess.run(
            [str(javac), "--release", "17", "-encoding", "UTF-8", "-cp", classpath,
             "-d", str(classes), *(str(source) for source in JAVA_SOURCES)],
            capture_output=True, text=True, timeout=120, check=False,
        )
        if compiled.returncode:
            raise RuntimeError("BBS Film worker compilation failed: " + (compiled.stderr.strip() or compiled.stdout.strip()))
        runtime_cp = os.pathsep.join((str(classes), str(BRIDGE_JAR), str(GSON_JAR)))
        result = subprocess.run(
            [str(java), "-cp", runtime_cp, "local.bbsmerged.FilmExportWorker", str(manifest), str(output_dir)],
            capture_output=True, text=True, timeout=600, check=False,
        )
        if result.returncode:
            raise RuntimeError("BBS Film export failed: " + (result.stderr.strip() or result.stdout.strip()))
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeError("BBS Film worker returned invalid JSON") from error
        if not isinstance(payload, dict) or payload.get("ok") is not True or payload.get("nativeReadback") is not True:
            raise RuntimeError("BBS Film worker did not confirm native read-back")
        return payload
