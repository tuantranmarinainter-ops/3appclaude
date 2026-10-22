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
        field_paths: dict[str, Any] = {}
        listed_paths: list[str] | None = None

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

        def discover(field: str, root: str, terms: tuple[str, ...], default: Any, size: int, active_mode: str | None = None) -> Any:
            """Read a Core value parent discovered from its public IsValueChanged leaf."""
            nonlocal listed_paths
            if listed_paths is None:
                try:
                    listed_paths = list(session.property_list(path))
                except (AttributeError, KeyError, ValueError, TypeError):
                    listed_paths = []
            matches: list[tuple[int, str, Any]] = []
            for leaf in listed_paths:
                normalized = leaf.lower().replace("\\", "/")
                if not normalized.startswith(f"{path.lower()}/{root.lower()}/"):
                    continue
                if not all(term.lower() in normalized for term in terms):
                    continue
                parent_path = leaf.rsplit("/", 1)[0] if leaf.endswith("/IsValueChangedFromDefault") else leaf
                terminal = parent_path.rsplit("/", 1)[-1].lower()
                priority = {"center": 0, "value": 1, "min": 2, "max": 3, "x": 4}.get(terminal, 8)
                try:
                    value = session.property_get(parent_path)
                except (AttributeError, KeyError, ValueError, TypeError):
                    continue
                mode_priority = 0 if active_mode and f"/{active_mode.lower()}/" in normalized else (1 if active_mode else 0)
                matches.append((mode_priority * 10 + priority, parent_path, value))
            if not matches:
                return default
            matches.sort(key=lambda item: (item[0], item[1]))
            if active_mode and active_mode.lower() == "pva":
                endpoints = [item for item in matches if item[1].rsplit("/", 1)[-1].lower() in {"min", "max"}]
                if len(endpoints) >= 2:
                    low = _components(endpoints[0][2], size)
                    high = _components(endpoints[1][2], size)
                    if low is not None and high is not None:
                        field_paths[field] = [endpoints[0][1], endpoints[1][1]]
                        return [(a + b) / 2 for a, b in zip(low, high)]
            parsed = _components(matches[0][2], size)
            if parsed is None and len(matches) > 1:
                second = _components(matches[1][2], size)
                if second is not None:
                    parsed = [(a + b) / 2 for a, b in zip(_components(matches[0][2], size) or [], second)]
            if parsed is None:
                return default
            field_paths[field] = matches[0][1]
            return parsed

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
        life_amplitude = get("life.amplitude", ("CommonValues/Life/Amplitude",), 0)
        if life_min is not None and life_max is None and life_amplitude:
            life_center = _num(life_min, 60)
            life_delta = abs(_num(life_amplitude, 0))
            life_min = life_center - life_delta
            life_max = life_center + life_delta
            field_paths["life.max"] = field_paths.get("life.min", "")
        if life_min is None and life_max is not None:
            life_min = life_max
        if life_max is None and life_min is not None:
            life_max = life_min
        location_type = get("location.type", ("LocationValues/Type",), "Fixed")
        rotation_type = get("rotation.type", ("RotationValues/Type", "RotationValues/Rotation/Type"), "Fixed")
        scale_type = get("scale.type", ("ScalingValues/Type", "ScalingValues/Scale/Type"), "Fixed")
        color_type = get("color.type", ("RendererCommonValues/AllColor/Type",), "Fixed")
        position = discover("location.position", "LocationValues", ("position",), [0, 0, 0], 3, str(location_type))
        velocity = discover("location.velocity", "LocationValues", ("velocity",), [0, 0, 0], 3, str(location_type))
        acceleration = discover("location.acceleration", "LocationValues", ("acceleration",), [0, 0, 0], 3, str(location_type))
        rotation = discover("rotation", "RotationValues", ("rotation",), [0, 0, 0], 3, str(rotation_type))
        scale = discover("scale", "ScalingValues", ("scale",), [1, 1], 3, str(scale_type))
        color = discover("color", "RendererCommonValues", ("allcolor",), [1, 1, 1, 1], 4, str(color_type))
        node: dict[str, Any] = {
            "id": stable_id, "path": path, "name": str(item.get("name", stable_id)), "parentId": parent_id,
            "renderType": render_type or "unsupported", "blend": blend,
            "generation": {"maxGeneration": _int(max_generation, 1), "infinite": bool(infinite), "generationTime": _num(generation_time, 1)},
            "life": {"min": _num(life_min, 60), "max": _num(life_max, 60)},
            "location": {"type": str(location_type).lower(), "position": position, "direction": [0, 1, 0], "velocity": velocity, "acceleration": acceleration},
            "rotation": rotation, "color": color, "size": scale[:2], "sourcePaths": field_paths,
        }
        if parent_id is not None:
            field_paths["parentId"] = parent
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


def _components(value: Any, size: int) -> list[float] | None:
    if isinstance(value, (list, tuple)):
        try:
            result = [float(item) for item in value]
            return result[:size] if len(result) >= size else None
        except (TypeError, ValueError):
            return None
    numbers = re.findall(r"[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?", str(value))
    if len(numbers) < size:
        return None
    return [float(item) for item in numbers[:size]]
