from __future__ import annotations

import json
import os
from pathlib import Path

from effekseer_ai.effect_dump import dump_effect_ir, write_effect_ir
from effekseer_ai.ir_to_bbs import BBS_BILLBOARD_SIDE, convert_effect_ir
import pytest

CORE_PATHS = Path(__file__).parent / "fixtures" / "core-paths"


class FakeSession:
    """Answers property_get from a real Effekseer 1.80.6 Core snapshot (tests/fixtures/core-paths)."""

    def __init__(self, sample: str = "Simple_Sprite_BillBoard") -> None:
        data = json.loads((CORE_PATHS / f"{sample}.core-paths.json").read_text(encoding="utf-8"))
        self.path = Path(f"{sample}.efkefc")
        self.nodes = data["nodes"]
        self.values = {f"{node['path']}/{key}": value for node in self.nodes for key, value in node["values"].items()}

    def node_list(self):
        return [{"path": node["path"], "id": f"node/id/{index}", "name": node["name"]} for index, node in enumerate(self.nodes)]

    def property_get(self, path):
        if path not in self.values:
            raise KeyError(path)
        return self.values[path]


def dump(sample: str) -> list[dict]:
    return dump_effect_ir(FakeSession(sample))["nodes"]


def test_real_core_paths_dump_without_missing_values():
    for sample in ("Simple_Sprite_BillBoard", "Simple_SpawnMethod1", "Laser01"):
        for node in dump(sample):
            assert not [item for item in node.get("unsupportedFeatures", []) if item.startswith("missing")], (sample, node["name"])


def test_billboard_sample_reads_easing_location_pva_scale_easing_color_and_generation():
    node = dump("Simple_Sprite_BillBoard")[0]
    assert (node["renderType"], node["blend"], node["orientation"]) == ("sprite", "add", "Billboard")
    assert node["generation"] == {"maxGeneration": 100, "infinite": False, "generationTime": pytest.approx(0.1)}
    leaves = node["valueModes"]["numericLeaves"]
    assert leaves["locationPosition"]["end"]["X"]["amplitude"] == 5.0
    assert set(leaves["color"]) == {"start", "end"} and set(leaves["color"]["start"]) == set("RGBA")
    assert set(leaves) >= {"scale", "scaleVelocity", "scaleAcceleration"}
    assert node["sourcePaths"]["generation.infinite"].endswith("CommonValues/MaxGeneration/Infinite/Value")


def test_single_easing_scale_and_custom_material_and_custom_quad_are_read():
    assert set(dump("Simple_SpawnMethod1")[0]["valueModes"]["numericLeaves"]) >= {"singleScaleStart", "singleScaleEnd"}
    assert all("material:File" in node["unsupportedFeatures"] for node in dump("Simple_Turbulence_Particles"))
    laser = dump("Laser01")[0]
    assert laser["spriteVertices"]["LL"] == [-0.5, 0.0] and laser["orientation"] == "YAxisFixed"


def test_real_dumps_convert_or_block_for_the_right_reason():
    billboard = convert_effect_ir({"schemaVersion": 1, "name": "bb", "fps": 60, "nodes": dump("Simple_Sprite_BillBoard")})
    assert billboard["status"] != "BLOCKED" and billboard["schemes"]
    core = next(scheme for scheme in billboard["schemes"]
                if not scheme["json"]["particle_effect"]["description"]["identifier"].endswith("_halo"))
    size = core["json"]["particle_effect"]["components"]["minecraft:particle_appearance_billboard"]["size"]
    assert all(isinstance(value, str) and f"{1 / BBS_BILLBOARD_SIDE:g}" in value for value in size), size
    laser = convert_effect_ir({"schemaVersion": 1, "name": "laser", "fps": 60, "nodes": dump("Laser01")}, allow_partial=True)
    assert [entry["property"] for entry in laser["blocked"]] == ["spriteVertices"]
    assert len(laser["schemes"]) >= 4


def test_unknown_core_enum_is_explicitly_unsupported_not_unknown():
    class Unknown(FakeSession):
        def property_get(self, path):
            if path.endswith("DrawingValues/Type"):
                return "UnlistedRenderer"
            return super().property_get(path)

    node = dump_effect_ir(Unknown())["nodes"][0]
    assert node["renderType"] == "unsupported"
    assert "unmapped-core-render-type:UnlistedRenderer" in node["unsupportedFeatures"]


def test_effect_dump_writes_versioned_json_atomically(tmp_path: Path):
    output = tmp_path / "subdir" / "spark.json"
    assert write_effect_ir(FakeSession(), output) == output
    serialized = json.loads(output.read_text(encoding="utf-8"))
    assert serialized["schemaVersion"] == 1
    assert not output.with_suffix(".json.tmp").exists()


@pytest.mark.integration
def test_official_core_samples_map_or_block_expected_renderers():
    import os
    from effekseer_ai.ir_to_bbs import convert_effect_ir
    from effekseer_ai.session import EffectSession

    dll = os.environ.get("EFFEKSEER_AI_BIN_DIR")
    samples = os.environ.get("EFFEKSEER_AI_SAMPLE_DIR")
    if not dll or not samples:
        pytest.skip("Set EFFEKSEER_AI_BIN_DIR and EFFEKSEER_AI_SAMPLE_DIR; official samples are not bundled")
    root = Path(samples)
    expected = {
        "Simple_Sprite_BillBoard": "export",
        "Simple_SpawnMethod1": "export",
        "Simple_Ribbon_Sword": "ribbon",
        "Simple_Ring_Shape1": "ring",
        "Simple_Distortion": "distortion",
    }
    for stem, expectation in expected.items():
        source = next(root.rglob(f"{stem}.efkefc"), None)
        assert source is not None, f"Missing official sample {stem}.efkefc"
        effect_ir = dump_effect_ir(EffectSession.open(source))
        converted = convert_effect_ir(effect_ir)
        if expectation == "export":
            assert converted["schemes"], stem
        else:
            assert converted["status"] == "BLOCKED", stem
            if expectation == "distortion":
                # Distortion is an Effekseer material (BackDistortion), not a render type.
                assert any(entry.get("property") == "material" and "distortion" in str(entry.get("detail", "")).lower() for entry in converted["blocked"]), stem
                assert any(node.get("material") == "backdistortion" for node in effect_ir["nodes"]), stem
                continue
            render_blockers = [entry for entry in converted["blocked"] if entry.get("property") == "renderType"]
            assert render_blockers, stem
            assert any(expectation in str(entry.get("detail", "")).lower() for entry in render_blockers), stem
            node = next(node for node in effect_ir["nodes"] if node.get("renderType") == expectation)
            assert node["renderType"] == expectation and node["renderType"] != "unknown"
