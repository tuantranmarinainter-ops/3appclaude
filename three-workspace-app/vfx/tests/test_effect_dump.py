from __future__ import annotations

import json
from pathlib import Path

from effekseer_ai.effect_dump import dump_effect_ir, write_effect_ir


class FakeSession:
    path = Path("spark.efkefc")

    def node_list(self):
        return [
            {"path": "node/root/0", "id": "node/id/sprite-id", "name": "Spark", "children": 0},
            {"path": "node/root/1", "id": "node/id/other-id", "name": "Other", "children": 0},
        ]

    def property_list(self, node_path):
        return [
            f"{node_path}/RendererType/Value", f"{node_path}/Blend/Value",
            f"{node_path}/Generation/MaxGeneration/Value", f"{node_path}/Generation/GenerationTime/Value",
            f"{node_path}/LifeMax/Value", f"{node_path}/GenerationShape/Value",
        ]

    def property_get(self, path):
        key = path.rsplit("/", 2)[-2]
        if "other-id" in path and key == "RendererType":
            return "mesh-unknown"
        return {
            "RendererType": "sprite", "Blend": "add", "MaxGeneration": 20,
            "GenerationTime": 3, "LifeMax": 24, "GenerationShape": "sphere",
        }[key]


def test_effect_dump_uses_stable_ids_maps_known_fields_and_preserves_raw_properties():
    result = dump_effect_ir(FakeSession(), fps=60)
    assert result["schemaVersion"] == 1
    assert result["name"] == "spark"
    assert result["fps"] == 60
    first = result["nodes"][0]
    assert first["id"] == "sprite-id"
    assert first["parentId"] is None
    assert first["renderType"] == "sprite"
    assert first["blend"] == "add"
    assert first["generation"] == {"maxGeneration": 20, "generationTime": 3}
    assert first["life"] == {"max": 24}
    assert "RendererType/Value" in first["properties"]
    assert result["nodes"][1]["unsupportedFeatures"] == ["unmapped-core-render-type"]


def test_effect_dump_writes_versioned_json_atomically(tmp_path: Path):
    output = tmp_path / "subdir" / "spark.json"
    assert write_effect_ir(FakeSession(), output) == output
    serialized = json.loads(output.read_text(encoding="utf-8"))
    assert serialized["schemaVersion"] == 1
    assert not output.with_suffix(".json.tmp").exists()
