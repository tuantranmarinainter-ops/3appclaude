"""Build a reviewable Snowstorm resource-pack ZIP from EffectIR v1."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

from .ir_to_bbs import convert_effect_ir


def build_bbs_package(
    effect_ir: dict[str, Any], output_zip: str | Path, assets_root: str | Path,
    allow_partial: bool = False,
) -> dict[str, Any]:
    """Package schemes, licensed source textures, and conversion report atomically."""
    converted = convert_effect_ir(effect_ir, allow_partial)
    if converted["status"] == "BLOCKED":
        return {"status": "BLOCKED", "error": "Conversion has blocked nodes; pass allow_partial explicitly to package supported nodes", "conversion": converted}

    root = Path(assets_root).resolve()
    entries = effect_ir.get("assets", [])
    if not isinstance(entries, list):
        raise ValueError("EffectIR assets manifest must be a list")
    manifest: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise ValueError("Each assets manifest entry must contain a relative path")
        relative = _safe_relative(entry["path"])
        if relative in manifest:
            raise ValueError(f"Duplicate assets manifest path: {relative}")
        if not entry.get("license") or not entry.get("credit"):
            raise ValueError(f"Asset needs license and credit metadata: {relative}")
        source = _safe_source(root, entry.get("source", relative))
        if not source.is_file():
            raise FileNotFoundError(f"Manifest asset source is missing: {source}")
        manifest[relative] = {**entry, "path": relative, "source": str(source)}

    texture_files: dict[str, Path] = {}
    for scheme in converted["schemes"]:
        texture = scheme["json"]["particle_effect"]["description"]["basic_render_parameters"]["texture"]
        if texture == "assets:textures/particle/particles":
            continue
        if not texture.startswith("assets:"):
            raise ValueError(f"Converted texture is not an asset-root path: {texture}")
        relative = _safe_relative(texture.removeprefix("assets:"))
        metadata = manifest.get(relative)
        if metadata is None:
            raise ValueError(f"Texture is missing license/credit manifest metadata: {relative}")
        texture_files[relative] = Path(metadata["source"])

    out_path = Path(output_zip)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=out_path.parent, suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for scheme in converted["schemes"]:
                particle_id = _safe_id(str(scheme["id"]))
                archive.writestr(
                    f"config/bbs/assets/particles/{particle_id}.json",
                    json.dumps(scheme["json"], ensure_ascii=False, indent=2) + "\n",
                )
            for relative, source in sorted(texture_files.items()):
                archive.write(source, f"config/bbs/assets/{relative}")
            package_manifest = {
                "schemaVersion": 1,
                "format": "BBS FS 2.7 Snowstorm resource package",
                "assets": [
                    {key: value for key, value in metadata.items() if key != "source"}
                    for relative, metadata in sorted(manifest.items()) if relative in texture_files
                ],
            }
            archive.writestr("config/bbs/effekseer-ai-manifest.json", json.dumps(package_manifest, ensure_ascii=False, indent=2) + "\n")
            archive.writestr("config/bbs/effekseer-ai-report.json", json.dumps(converted, ensure_ascii=False, indent=2) + "\n")
            archive.writestr("CREDITS.md", _credits(package_manifest["assets"]))
            archive.writestr("README.txt", _usage_notes())
        os.replace(temporary, out_path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {"status": converted["status"], "path": str(out_path), "schemes": len(converted["schemes"]), "textures": len(texture_files), "conversion": converted}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="effekseer-ai bbs-package")
    parser.add_argument("effect_ir", help="EffectIR JSON input")
    parser.add_argument("output_zip", help="Destination ZIP file")
    parser.add_argument("--assets-root", default=".", help="Root directory containing manifest texture sources")
    parser.add_argument("--allow-partial", action="store_true", help="Package supported nodes while retaining conversion blockers")
    args = parser.parse_args(argv)
    try:
        effect_ir = json.loads(Path(args.effect_ir).read_text(encoding="utf-8"))
        result = build_bbs_package(effect_ir, args.output_zip, args.assets_root, args.allow_partial)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(json.dumps({"status": "ERROR", "error": str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result["status"] == "BLOCKED" else 0


def _safe_relative(value: str) -> str:
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    if (not normalized or path.is_absolute() or ":" in path.parts[0]
            or any(part in {"", ".", ".."} for part in path.parts)):
        raise ValueError(f"Unsafe package-relative path: {value}")
    return path.as_posix()


def _safe_source(root: Path, source: Any) -> Path:
    if not isinstance(source, str):
        raise ValueError("Asset source must be a relative path")
    relative = _safe_relative(source)
    resolved = (root / Path(*PurePosixPath(relative).parts)).resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"Asset source escapes assets root: {source}")
    return resolved


def _safe_id(value: str) -> str:
    filename = "".join(character if character.isalnum() or character in "-_" else "_" for character in value)
    if not filename or filename in {".", ".."}:
        raise ValueError(f"Unsafe particle ID: {value}")
    return filename


def _credits(assets: list[dict[str, Any]]) -> str:
    lines = ["# Credits and licenses", "", "This package includes the following external assets:", ""]
    if not assets:
        lines.append("No external textures were included.")
    for asset in assets:
        lines.append(f"- `{asset['path']}` — {asset['credit']} (license: {asset['license']})")
        if asset.get("url"):
            lines.append(f"  Source: {asset['url']}")
    return "\n".join(lines) + "\n"


def _usage_notes() -> str:
    return """BBS FS 2.7 Snowstorm package generated from EffectIR.

Install the contents under the resource pack root, preserving config/bbs/ paths.
Use a ParticleForm actor or bone attachment to place an effect on an entity.
After pausing playback, restart the ParticleForm/effect to reset one-shot
emitters; looping effects can resume according to their activation settings.

The included report records conversion approximations and blocked properties.
This package structure does not certify actual BBS FS runtime behavior.
"""
