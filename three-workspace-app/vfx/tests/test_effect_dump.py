from __future__ import annotations

import json
import os
from pathlib import Path

from effekseer_ai.effect_dump import dump_effect_ir, write_effect_ir
import pytest


class FakeSession:
    """Small fixture shaped from the public Effekseer 1.80.6 Core data classes."""
    path = Path("spark.efkefc")
    node = "node/root/0"

    def __init__(self):
        self.values = {
            f"{self.node}/DrawingValues/Type": "Sprite",
            f"{self.node}/DrawingValues/ColorAll/Type": "Fixed",
            f"{self.node}/DrawingValues/ColorAll/Fixed/R/Value": 26,
            f"{self.node}/DrawingValues/ColorAll/Fixed/G/Value": 51,
            f"{self.node}/DrawingValues/ColorAll/Fixed/B/Value": 77,
            f"{self.node}/DrawingValues/ColorAll/Fixed/A/Value": 102,
            f"{self.node}/RendererCommonValues/AlphaBlend": "Add",
            f"{self.node}/RendererCommonValues/ColorTexture/RelativePath": "Texture/Particle01.png",
            f"{self.node}/CommonValues/MaxGeneration/Value": 20,
            f"{self.node}/CommonValues/Infinite/Value": True,
            f"{self.node}/CommonValues/GenerationTime/Center": 3,
            f"{self.node}/CommonValues/GenerationTime/Amplitude": 1,
            f"{self.node}/CommonValues/Life/Min": 12,
            f"{self.node}/CommonValues/Life/Max": 24,
            f"{self.node}/LocationValues/Type": "PVA",
            f"{self.node}/RotationValues/Type": "PVA",
            f"{self.node}/ScalingValues/Type": "PVA",
        }
        for group, prop, centers in (
            ("LocationValues/PVA", "Location", (2, 4, 6)),
            ("LocationValues/PVA", "Velocity", (4, 5, 6)),
            ("LocationValues/PVA", "Acceleration", (7, 8, 9)),
            ("RotationValues/PVA", "Rotation", (20, 21, 22)),
            ("ScalingValues/PVA", "Scale", (5, 6, 7)),
        ):
            for axis, center in zip("XYZ", centers):
                self.values[f"{self.node}/{group}/{prop}/{axis}/Center"] = center
                if prop == "Location":
                    self.values[f"{self.node}/{group}/{prop}/{axis}/Amplitude"] = 1
        self.leaves = [f"{parent}/IsValueChangedFromDefault" for parent in self.values
                       if parent.startswith((f"{self.node}/LocationValues/", f"{self.node}/RotationValues/",
                                             f"{self.node}/ScalingValues/", f"{self.node}/DrawingValues/ColorAll/"))
                       and not parent.endswith("/Type")]

    def node_list(self):
        return [{"path": self.node, "id": "node/id/sprite-id", "name": "Spark", "children": 0}]

    def property_list(self, path):
        return self.leaves

    def property_get(self, path):
        if path not in self.values:
            raise ValueError(path)
        return self.values[path]


def test_effect_dump_reads_core_enum_parent_paths_and_records_sources():
    result = dump_effect_ir(FakeSession(), fps=60)
    first = result["nodes"][0]
    assert first["renderType"] == "sprite"
    assert first["blend"] == "add"
    assert first["texture"] == "Texture/Particle01.png"
    assert first["generation"] == {"maxGeneration": 20, "infinite": True, "generationTime": 3, "generationTimeAmplitude": 1}
    assert first["life"] == {"min": 12, "max": 24}
    assert first["location"]["position"] == [2, 4, 6]
    assert first["location"]["velocity"] == [4, 5, 6]
    assert first["location"]["acceleration"] == [7, 8, 9]
    assert first["rotation"] == [20, 21, 22]
    assert first["size"] == [5, 6]
    assert first["color"] == [26 / 255, 51 / 255, 77 / 255, 102 / 255]
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


def test_dump_reads_1806_scalar_leaf_paths_not_vector_parent_strings():
    class Core1806(FakeSession):
        def property_list(self, path):
            roots = ("LocationValues/PVA/Location", "LocationValues/PVA/Velocity",
                     "LocationValues/PVA/Acceleration", "ScalingValues/Easing/Start",
                     "ScalingValues/Easing/End", "RotationValues/Fixed/Rotation")
            vector_leaves = [f"{path}/{root}/{axis}/{part}/IsValueChangedFromDefault"
                             for root in roots for axis in ("X", "Y", "Z")
                             for part in ("Center", "Amplitude")]
            color_leaves = [f"{path}/DrawingValues/ColorAll/Fixed/{channel}/Value/IsValueChangedFromDefault"
                            for channel in "RGBA"]
            return vector_leaves + color_leaves

        def property_get(self, path):
            exact = {
                "node/root/0/LocationValues/Type": "PVA",
                "node/root/0/ScalingValues/Type": "Easing",
                "node/root/0/RotationValues/Type": "Fixed",
                "node/root/0/DrawingValues/ColorAll/Type": "Fixed",
            }
            if path in exact:
                return exact[path]
            if path.endswith("/IsValueChangedFromDefault"):
                raise ValueError(path)
            if path.endswith("/Center"):
                return 2.5
            if path.endswith("/Amplitude"):
                return 0.5
            if path.endswith("/Value") and "/DrawingValues/ColorAll/" in path:
                return 128.0
            if path.endswith(("/X", "/Y", "/Z", "/R", "/G", "/B", "/A")):
                return 3.0
            return super().property_get(path)

    node = dump_effect_ir(Core1806())["nodes"][0]
    leaves = node["valueModes"]["numericLeaves"]
    assert leaves["locationPosition"]["value"]["X"] == {"center": 2.5, "amplitude": 0.5}
    assert leaves["scale"]["start"]["X"] == {"center": 2.5, "amplitude": 0.5}
    assert any(path.endswith("ScalingValues/Easing/Start/X/Center")
               for path in node["sourcePaths"]["scale.components"])
    assert node["color"] == [128 / 255] * 4
    assert any(path.endswith("DrawingValues/ColorAll/Fixed/R/Value")
               for path in node["sourcePaths"]["color.components"])


@pytest.mark.parametrize("mode,paths", [
    ("Fixed", ("Fixed/R/Value", "Fixed/G/Value", "Fixed/B/Value", "Fixed/A/Value")),
    ("Random", ("Random/R/Center", "Random/R/Amplitude", "Random/G/Center", "Random/G/Amplitude",
                 "Random/B/Center", "Random/B/Amplitude", "Random/A/Center", "Random/A/Amplitude")),
    ("Easing", ("Easing/Start/R/Center", "Easing/Start/R/Amplitude", "Easing/End/R/Center",
                 "Easing/End/R/Amplitude", "Easing/Start/G/Center", "Easing/Start/G/Amplitude",
                 "Easing/End/G/Center", "Easing/End/G/Amplitude", "Easing/Start/B/Center",
                 "Easing/Start/B/Amplitude", "Easing/End/B/Center", "Easing/End/B/Amplitude",
                 "Easing/Start/A/Center", "Easing/Start/A/Amplitude", "Easing/End/A/Center",
                 "Easing/End/A/Amplitude")),
])
def test_color_all_uses_1806_drawing_values_standard_color_tree(mode, paths):
    class ColorMode(FakeSession):
        def __init__(self):
            super().__init__()
            self.values[f"{self.node}/DrawingValues/ColorAll/Type"] = mode
            for key in list(self.values):
                if "/DrawingValues/ColorAll/Fixed/" in key:
                    del self.values[key]
            for index, relative in enumerate(paths):
                parent = f"{self.node}/DrawingValues/ColorAll/{relative}"
                self.values[parent] = 40 + index
            self.leaves = [f"{parent}/IsValueChangedFromDefault" for parent in self.values
                           if "/DrawingValues/ColorAll/" in parent and not parent.endswith("/Type")]

    node = dump_effect_ir(ColorMode())['nodes'][0]
    assert node['valueModes']['color']['type'] == mode.lower()
    assert node['sourcePaths']['color.values']
    assert node['sourcePaths']['color.components']
    assert not any(path.startswith('missing-active-value:color') for path in node.get('unsupportedFeatures', []))


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
