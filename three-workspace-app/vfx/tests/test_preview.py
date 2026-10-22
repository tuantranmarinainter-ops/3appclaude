from __future__ import annotations

import json
from pathlib import Path

from effekseer_ai.cli import build_parser, main
from effekseer_ai.preview import _eval_molang, _random_values, _read_png, _render_schemes, _write_png, project_camera, render_preview
from effekseer_ai.ir_to_bbs import convert_effect_ir


FIXTURES = Path(__file__).parent / "fixtures" / "ir"


def effect(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def test_all_three_mvp_fixtures_render_timestamp_pngs_and_label_simulation(tmp_path: Path) -> None:
    for name in ("glow-ring-explosion", "ice-sword-trail", "looping-aura"):
        output = tmp_path / name
        report = render_preview(effect(name), output, [0, 0.25, 0.5], width=96, height=96)
        assert report["mode"] == "SIMULATION_ONLY"
        assert report["actualBbsRuntime"] == "NOT_RUN"
        assert any("quantized maximum endpoint" in note for note in report["simulationNotes"])
        assert any("halo behind the core" in note for note in report["simulationNotes"])
        assert len(report["timestamps"]) == 3
        for item in report["timestamps"]:
            path = output / item["simulationPng"]
            width, height, _ = _read_png(path)
            assert (width, height) == (96, 96)
            assert "NOT EFFEKSEER OR BBS FS RENDER" in item["simulationLabel"]
        assert json.loads((output / "preview-report.json").read_text(encoding="utf-8"))["mode"] == "SIMULATION_ONLY"
        if name == "ice-sword-trail":
            assert report["conversionStatus"] == "BLOCKED"


def test_synthetic_reference_png_creates_side_by_side_comparison(tmp_path: Path) -> None:
    source = tmp_path / "references"
    source.mkdir()
    reference_pixels = bytearray([255, 0, 0, 255] * 64 * 64)
    reference = source / "looping_aura_0p25s.png"
    _write_png(reference, 64, 64, reference_pixels)

    result = render_preview(effect("looping-aura"), tmp_path / "out", [0.25], source, 80, 80)

    entry = result["timestamps"][0]
    width, height, _ = _read_png(tmp_path / "out" / entry["comparisonPng"])
    assert (width, height) == (144, 80)
    assert entry["referencePng"] == str(reference)
    assert entry["referenceSource"] == "caller-supplied image; provenance is not verified"
    assert "provenance unverified" in entry["comparisonLabel"]


def test_add_halo_alpha_is_applied_once_in_preview() -> None:
    add_effect = {
        "schemaVersion": 1, "name": "single-add", "fps": 60,
        "nodes": [{"id": "glow", "name": "Glow", "renderType": "sprite", "blend": "add",
                   "texture": "textures/glow.png", "generation": {"maxGeneration": 1, "generationTime": 3},
                   "life": {"max": 60}, "location": {"type": "fixed", "shape": "point"},
                   "size": [1, 1], "color": [0.2, 0.2, 0.2, 1]}],
    }
    converted = convert_effect_ir(add_effect)
    halo = next(scheme for scheme in converted["schemes"] if scheme["addBlend"]["layer"] == "halo")
    pixels = _render_schemes([halo], 0, 64, 64)
    expected_red = round(115 * 0.55 + 20 * 0.45)
    assert pixels[(32 * 64 + 32) * 4] == expected_red


def test_cli_preview_command_is_exposed_and_works_with_three_timestamps(tmp_path: Path, capsys) -> None:
    command_action = next(action for action in build_parser()._actions if action.dest == "command")
    assert "preview" in command_action.choices
    input_path = tmp_path / "effect.json"
    input_path.write_text(json.dumps(effect("glow-ring-explosion")), encoding="utf-8")
    output = tmp_path / "preview"
    code = main(["preview", str(input_path), str(output), "--timestamps", "0,0.1,0.2", "--width", "64", "--height", "64"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 0
    assert payload["mode"] == "SIMULATION_ONLY"
    assert len(payload["timestamps"]) == 3


def test_preview_evaluates_stable_random_lerp_and_effekseer_frame_age() -> None:
    randoms = _random_values(7)
    expression = "math.lerp(0, 10, math.clamp(variable.particle_age / variable.particle_lifetime, 0, 1))"
    assert _eval_molang(expression, 1, 2, randoms) == 5
    # Effekseer PVA velocity is per 60-fps source frame.
    assert _eval_molang("1 * variable.particle_age * 60", 1, 2, randoms) == 60
    assert randoms == _random_values(7)


def test_viewer_camera_projection_is_fixed_perspective_and_angle_sensitive() -> None:
    center = project_camera((0, 0, 0), 512, 512)
    assert center == (256, 256)
    right = project_camera((1, 0, 0), 512, 512)
    assert right is not None and right[0] > 256
    turned = project_camera((1, 0, 0), 512, 512, {"angle_y": 90})
    assert turned is not None and turned[0] == 256 and turned[1] != 256
    assert project_camera((-100, 0, 0), 512, 512, {"distance": 15}) is None
