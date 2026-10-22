"""Export Effekseer Core 1.80.6 documents to the portable EffectIR subset."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


_RENDER_TYPES = {"sprite": "sprite", "ribbon": "ribbon", "track": "track", "ring": "ring", "model": "model", "proceduralmodel": "proceduralmodel", "distortion": "distortion"}
_BLENDS = {"blend": "blend", "opacity": "opacity", "add": "add", "sub": "sub", "mul": "mul"}


def dump_effect_ir(session: Any, name: str | None = None, fps: float = 60) -> dict[str, Any]:
    nodes = session.node_list()
    result: dict[str, Any] = {"schemaVersion": 1, "name": name or Path(str(session.path or "effect")).stem, "fps": fps, "nodes": []}
    for item in nodes:
        path = str(item["path"])
        stable_id = str(item["id"]).removeprefix("node/id/")
        parent = path.rsplit("/", 1)[0]
        parent_id = next((str(n["id"]).removeprefix("node/id/") for n in nodes if str(n["path"]) == parent), None)
        field_paths: dict[str, str] = {}

        def get(field: str, candidates: tuple[str, ...], default: Any = None) -> Any:
            for suffix in candidates:
                property_path = f"{path}/{suffix}"
                try:
                    value = session.property_get(property_path)
                except (AttributeError, KeyError, ValueError, TypeError):
                    continue
                field_paths[field] = property_path
                return value
            return default

        raw_render = get("renderType", ("DrawingValues/Type",), None)
        normalized_render = _key(raw_render)
        render_type = _RENDER_TYPES.get(normalized_render)
        unsupported = [] if render_type else [f"unmapped-core-render-type:{raw_render!s}"]
        raw_blend = get("blend", ("RendererCommonValues/AlphaBlend",), "Blend")
        blend = _BLENDS.get(_key(raw_blend))
        if blend is None:
            unsupported.append(f"unmapped-core-blend:{raw_blend!s}")
            blend = "unsupported"
        texture = get("texture", ("RendererCommonValues/ColorTexture/RelativePath",), None)
        max_generation = get("generation.maxGeneration", ("CommonValues/MaxGeneration/Value",), 1)
        infinite = get("generation.infinite", ("CommonValues/Infinite/Value",), False)
        generation_time = get("generation.generationTime", ("CommonValues/GenerationTime/Center", "CommonValues/GenerationTime/Value"), 1)
        generation_amp = get("generation.generationTimeAmplitude", ("CommonValues/GenerationTime/Amplitude",), 0)
        life_min = get("life.min", ("CommonValues/Life/Min", "CommonValues/Life/Center"), None)
        life_max = get("life.max", ("CommonValues/Life/Max", "CommonValues/Life/Value"), None)
        if life_min is None and life_max is not None:
            life_min = life_max
        if life_max is None and life_min is not None:
            life_max = life_min
        location_type = get("location.type", ("LocationValues/Type",), "Fixed")
        node: dict[str, Any] = {
            "id": stable_id, "path": path, "name": str(item.get("name", stable_id)), "parentId": parent_id,
            "renderType": render_type or "unsupported", "blend": blend,
            "generation": {"maxGeneration": _int(max_generation, 1), "infinite": bool(infinite), "generationTime": _num(generation_time, 1)},
            "life": {"min": _num(life_min, 60), "max": _num(life_max, 60)},
            "location": {"type": str(location_type).lower(), "position": [0, 0, 0], "direction": [0, 1, 0], "velocity": [0, 0, 0], "acceleration": [0, 0, 0]},
            "color": [1, 1, 1, 1], "size": [1, 1], "sourcePaths": field_paths,
        }
        if texture:
            node["texture"] = str(texture).replace("\\", "/")
        if unsupported:
            node["unsupportedFeatures"] = unsupported
        if generation_amp:
            node["generation"]["generationTimeAmplitude"] = _num(generation_amp, 0)
        result["nodes"].append(node)
    return result


def write_effect_ir(session: Any, output: str | Path, name: str | None = None, fps: float = 60) -> Path:
    data = dump_effect_ir(session, name=name, fps=fps)
    destination = Path(output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(destination)
    return destination


def _key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def _num(value: Any, default: float) -> float:
    try:
        number = float(value)
        return number if number == number and abs(number) != float("inf") else default
    except (TypeError, ValueError):
        return default


def _int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
