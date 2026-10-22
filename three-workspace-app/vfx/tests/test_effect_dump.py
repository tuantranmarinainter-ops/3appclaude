from __future__ import annotations

import json
import os
from pathlib import Path

from effekseer_ai.effect_dump import dump_effect_ir, write_effect_ir
import pytest


class FakeSession:
    path = Path("spark.efkefc")

    def node_list(self):
        return [{"path": "node/root/0", "id": "node/id/sprite-id", "name": "Spark", "children": 0}]

    def property_list(self, path):
        return [f"{path}/LocationValues/Location/Fixed/Position/Center/IsValueChangedFromDefault",
                f"{path}/LocationValues/Location/PVA/Position/Min/IsValueChangedFromDefault",
                f"{path}/LocationValues/Location/PVA/Position/Max/IsValueChangedFromDefault",
                f"{path}/LocationValues/Velocity/PVA/Center/IsValueChangedFromDefault",
                f"{path}/LocationValues/Acceleration/PVA/Center/IsValueChangedFromDefault",
                f"{path}/RotationValues/Rotation/Fixed/Center/IsValueChangedFromDefault",
                f"{path}/RotationValues/Rotation/PVA/Center/IsValueChangedFromDefault",
                f"{path}/ScalingValues/Scale/Fixed/Center/IsValueChangedFromDefault",
                f"{path}/ScalingValues/Scale/PVA/Center/IsValueChangedFromDefault",
                f"{path}/RendererCommonValues/AllColor/Fixed/Center/IsValueChangedFromDefault",
                f"{path}/RendererCommonValues/AllColor/PVA/Center/IsValueChangedFromDefault"]

    def property_get(self, path):
        values = {
            "node/root/0/DrawingValues/Type": "Sprite",
            "node/root/0/RendererCommonValues/AlphaBlend": "Add",
            "node/root/0/RendererCommonValues/ColorTexture/RelativePath": "Texture/Particle01.png",
            "node/root/0/CommonValues/MaxGeneration/Value": 20,
            "node/root/0/CommonValues/Infinite/Value": True,
            "node/root/0/CommonValues/GenerationTime/Center": 3,
            "node/root/0/CommonValues/GenerationTime/Amplitude": 1,
            "node/root/0/CommonValues/Life/Min": 12,
            "node/root/0/CommonValues/Life/Max": 24,
            "node/root/0/LocationValues/Type": "PVA",
            "node/root/0/LocationValues/Location/Fixed/Position/Center": "(90, 90, 90)",
            "node/root/0/LocationValues/Location/PVA/Position/Min": "(2, 4, 6)",
            "node/root/0/LocationValues/Location/PVA/Position/Max": "(4, 6, 8)",
            "node/root/0/LocationValues/Velocity/PVA/Center": "(4, 5, 6)",
            "node/root/0/LocationValues/Acceleration/PVA/Center": "(7, 8, 9)",
            "node/root/0/RotationValues/Rotation/Fixed/Center": "(10, 11, 12)",
            "node/root/0/RotationValues/Rotation/PVA/Center": "(20, 21, 22)",
            "node/root/0/ScalingValues/Scale/Fixed/Center": "(2, 3, 4)",
            "node/root/0/ScalingValues/Scale/PVA/Center": "(5, 6, 7)",
            "node/root/0/RendererCommonValues/AllColor/Fixed/Center": "(0.1, 0.2, 0.3, 0.4)",
            "node/root/0/RendererCommonValues/AllColor/PVA/Center": "(0.4, 0.3, 0.2, 0.1)",
            "node/root/0/RotationValues/Type": "PVA",
            "node/root/0/ScalingValues/Type": "PVA",
            "node/root/0/RendererCommonValues/AllColor/Type": "PVA",
        }
        if path not in values:
            raise ValueError(path)
        return values[path]


def test_effect_dump_reads_core_enum_parent_paths_and_records_sources():
    result = dump_effect_ir(FakeSession(), fps=60)
    first = result["nodes"][0]
    assert first["renderType"] == "sprite"
    assert first["blend"] == "add"
    assert first["texture"] == "Texture/Particle01.png"
    assert first["generation"] == {"maxGeneration": 20, "infinite": True, "generationTime": 3, "generationTimeAmplitude": 1}
    assert first["life"] == {"min": 12, "max": 24}
    assert first["location"]["position"] == [3, 5, 7]
    assert first["location"]["velocity"] == [4, 5, 6]
    assert first["location"]["acceleration"] == [7, 8, 9]
    assert first["rotation"] == [20, 21, 22]
    assert first["size"] == [5, 6]
    assert first["color"] == [0.4, 0.3, 0.2, 0.1]
    assert first["sourcePaths"]["renderType"].endswith("DrawingValues/Type")
    assert first["sourcePaths"]["blend"].endswith("RendererCommonValues/AlphaBlend")


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
            render_blockers = [entry for entry in converted["blocked"] if entry.get("property") == "renderType"]
            assert render_blockers, stem
            assert any(expectation in str(entry.get("detail", "")).lower() for entry in render_blockers), stem
            node = next(node for node in effect_ir["nodes"] if node.get("renderType") == expectation)
            assert node["renderType"] == expectation and node["renderType"] != "unknown"
