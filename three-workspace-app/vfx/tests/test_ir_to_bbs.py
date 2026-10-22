from __future__ import annotations

import json
from pathlib import Path

import pytest

from effekseer_ai.ir_to_bbs import convert_effect_ir, convert_to_directory, main


FIXTURES = Path(__file__).parent / "fixtures" / "ir"


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def test_glow_ring_explosion_emits_snowstorm_billboards_and_add_warnings() -> None:
    result = convert_effect_ir(fixture("glow-ring-explosion"))
    assert result["status"] == "PASS"
    assert len(result["schemes"]) == 2
    ring = next(scheme["json"]["particle_effect"] for scheme in result["schemes"] if scheme["id"] == "ring")
    assert ring["description"]["basic_render_parameters"]["material"] == "particles_blend"
    assert ring["description"]["basic_render_parameters"]["texture"] == "assets:textures/vfx/glow-ring.png"
    assert ring["components"]["minecraft:emitter_shape_disc"]["offset"] == [0, 0, 0]
    assert ring["components"]["minecraft:emitter_rate_steady"]["spawn_rate"] == 20
    assert ring["components"]["minecraft:emitter_lifetime_once"]["active_time"] == 3
    warning = next(w for w in result["warnings"] if w["property"] == "blend")
    assert warning["status"] == "WARNING"
    assert warning["fallback"]["brightnessBoost"] == 2.0
    assert warning["fallback"]["outputColor"] == [0.5, 0.9, 1.0, 0.9]


def test_ice_sword_ribbon_is_blocked_with_sprite_replacement_suggestion() -> None:
    result = convert_effect_ir(fixture("ice-sword-trail"))
    assert result["status"] == "BLOCKED"
    assert result["schemes"] == []
    blocker = next(entry for entry in result["blocked"] if entry["property"] == "renderType")
    assert blocker["status"] == "BLOCKED"
    assert "short-lived oriented sprite" in blocker["suggestedAlternative"]


def test_looping_aura_has_steady_spawn_rate_and_looping_lifetime() -> None:
    result = convert_effect_ir(fixture("looping-aura"))
    assert result["status"] == "PASS"
    components = result["schemes"][0]["json"]["particle_effect"]["components"]
    assert components["minecraft:emitter_rate_steady"] == {"spawn_rate": 20, "max_particles": 60}
    assert components["minecraft:emitter_lifetime_looping"] == {"active_time": 0, "sleep_time": 0}
    assert "minecraft:emitter_lifetime_once" not in components
    assert result["timeConversion"]["quantumSeconds"] == 0.05


def test_blocked_nodes_prevent_all_output_without_allow_partial(tmp_path: Path) -> None:
    ice = fixture("ice-sword-trail")
    ice["nodes"].append({
        "id": "spark", "parentId": "root", "name": "spark", "renderType": "sprite",
        "blend": "blend", "generation": {"maxGeneration": 1, "generationTime": 3},
        "life": {"max": 12}, "location": {"type": "fixed", "shape": "point"},
    })
    result = convert_to_directory(ice, tmp_path)
    assert result["status"] == "BLOCKED"
    assert result["schemes"] == []
    assert not list(tmp_path.glob("*.json")) or [path.name for path in tmp_path.glob("*.json")] == ["report.json"]


def test_allow_partial_exports_supported_nodes_and_keeps_blockers(tmp_path: Path) -> None:
    ice = fixture("ice-sword-trail")
    ice["nodes"].append({
        "id": "spark", "parentId": "root", "name": "spark", "renderType": "sprite",
        "blend": "blend", "generation": {"maxGeneration": 1, "generationTime": 3},
        "life": {"max": 12}, "location": {"type": "fixed", "shape": "point"},
    })
    result = convert_to_directory(ice, tmp_path, allow_partial=True)
    assert result["status"] == "PARTIAL"
    assert [scheme["id"] for scheme in result["schemes"]] == ["spark"]
    assert result["blocked"]
    assert (tmp_path / "spark.json").is_file()
    assert json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))["status"] == "PARTIAL"


def test_invalid_ir_and_unsafe_texture_are_rejected() -> None:
    with pytest.raises(ValueError, match="schemaVersion"):
        convert_effect_ir({"schemaVersion": 2, "nodes": []})
    invalid = fixture("looping-aura")
    invalid["nodes"][1]["texture"] = "../../outside.png"
    result = convert_effect_ir(invalid)
    assert result["status"] == "BLOCKED"
    assert any(entry["property"] == "texture" for entry in result["blocked"])


def test_cli_returns_nonzero_for_blocked_effect_and_writes_report(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    input_path = tmp_path / "ice.json"
    output = tmp_path / "out"
    input_path.write_text(json.dumps(fixture("ice-sword-trail")), encoding="utf-8")
    code = main([str(input_path), str(output)])
    assert code == 1
    assert json.loads((output / "report.json").read_text(encoding="utf-8"))["status"] == "BLOCKED"
    assert json.loads(capsys.readouterr().out)["status"] == "BLOCKED"


def test_source_frames_are_quantized_to_twenty_hz() -> None:
    ir = fixture("glow-ring-explosion")
    ir["nodes"][1]["generation"]["generationTime"] = 6
    result = convert_effect_ir(ir)
    assert result["schemes"][0]["json"]["particle_effect"]["components"]["minecraft:emitter_rate_steady"]["spawn_rate"] == pytest.approx(10)
    assert result["schemes"][0]["json"]["particle_effect"]["components"]["minecraft:emitter_lifetime_once"]["active_time"] == 6


def test_invalid_shape_and_flipbook_are_reported_as_blocked_not_exceptions() -> None:
    ir = fixture("looping-aura")
    ir["nodes"][1]["location"]["radius"] = "wide"
    ir["nodes"][1]["flipbook"] = {"maxFrame": -3}
    result = convert_effect_ir(ir)
    assert result["status"] == "BLOCKED"
    assert {entry["property"] for entry in result["blocked"]} >= {"location.radius", "flipbook"}


def test_rerun_removes_only_previous_generated_schemes(tmp_path: Path) -> None:
    convert_to_directory(fixture("looping-aura"), tmp_path)
    assert (tmp_path / "aura.json").is_file()
    (tmp_path / "user-notes.json").write_text("{}", encoding="utf-8")

    convert_to_directory(fixture("ice-sword-trail"), tmp_path)

    assert not (tmp_path / "aura.json").exists()
    assert (tmp_path / "user-notes.json").is_file()
    assert json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))["status"] == "BLOCKED"

