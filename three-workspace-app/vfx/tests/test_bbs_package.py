from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from effekseer_ai.bbs_package import build_bbs_package


FIXTURE = Path(__file__).parent / "fixtures" / "ir" / "glow-ring-explosion.json"


def with_asset_manifest(root: Path) -> dict:
    effect = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assets = []
    for texture in ("textures/vfx/glow-ring.png", "textures/vfx/glow-burst.png"):
        source = root / texture
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b"synthetic-test-texture")
        assets.append({"path": texture, "source": texture, "license": "CC0-1.0", "credit": "Synthetic test fixture"})
    effect["assets"] = assets
    return effect


def test_package_contains_particles_textures_report_and_credits(tmp_path: Path) -> None:
    effect = with_asset_manifest(tmp_path)
    output = tmp_path / "build" / "glow.zip"
    result = build_bbs_package(effect, output, tmp_path)

    assert result["status"] == "PASS"
    assert result["schemes"] == 2
    assert result["textures"] == 2
    with zipfile.ZipFile(output) as archive:
        names = set(archive.namelist())
        assert "config/bbs/assets/particles/ring.json" in names
        assert "config/bbs/assets/particles/burst.json" in names
        assert "config/bbs/assets/textures/vfx/glow-ring.png" in names
        assert "config/bbs/effekseer-ai-manifest.json" in names
        assert "config/bbs/effekseer-ai-report.json" in names
        assert "CREDITS.md" in names
        assert "README.txt" in names
        credits = archive.read("CREDITS.md").decode()
        assert "CC0-1.0" in credits and "Synthetic test fixture" in credits
        assert "ParticleForm actor or bone" in archive.read("README.txt").decode()


def test_blocked_effect_does_not_create_package_without_allow_partial(tmp_path: Path) -> None:
    effect = json.loads((Path(__file__).parent / "fixtures" / "ir" / "ice-sword-trail.json").read_text(encoding="utf-8"))
    output = tmp_path / "ice.zip"
    result = build_bbs_package(effect, output, tmp_path)
    assert result["status"] == "BLOCKED"
    assert not output.exists()


def test_external_texture_requires_manifest_license_and_credit(tmp_path: Path) -> None:
    effect = with_asset_manifest(tmp_path)
    effect["assets"][0].pop("license")
    with pytest.raises(ValueError, match="license and credit"):
        build_bbs_package(effect, tmp_path / "bad.zip", tmp_path)


def test_manifest_paths_cannot_escape_root(tmp_path: Path) -> None:
    effect = with_asset_manifest(tmp_path)
    effect["assets"][0]["source"] = "../outside.png"
    with pytest.raises(ValueError, match="Unsafe package-relative path"):
        build_bbs_package(effect, tmp_path / "bad.zip", tmp_path)


def test_cli_bbs_package_command_runs_end_to_end(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    from effekseer_ai.cli import main

    effect = with_asset_manifest(tmp_path)
    input_path = tmp_path / "effect-ir.json"
    input_path.write_text(json.dumps(effect), encoding="utf-8")
    output = tmp_path / "cli.zip"
    code = main(["bbs-package", str(input_path), str(output), "--assets-root", str(tmp_path)])
    result = json.loads(capsys.readouterr().out)
    assert code == 0
    assert result["status"] == "PASS"
    assert output.is_file()
