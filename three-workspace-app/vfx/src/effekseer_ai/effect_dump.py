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
        missing: list[str] = []

        def read(relative: str) -> Any:
            """property_get on one Core path; enums are only readable on the parent path."""
            try:
                return session.property_get(f"{path}/{relative}")
            except (AttributeError, KeyError, ValueError, TypeError):
                return None

        def need(field: str, relative: str) -> Any:
            value = read(relative)
            if value is None:
                missing.append(field)
            else:
                field_paths[field] = f"{path}/{relative}"
            return value

        def ranged(field: str, relative: str) -> dict[str, float]:
            """FloatWithRandom: Center/Amplitude/Min/Max leaves."""
            out: dict[str, float] = {}
            for key in ("Center", "Amplitude", "Min", "Max"):
                value = read(f"{relative}/{key}")
                if value is not None:
                    out[key.lower()] = float(value)
            if "center" not in out and "min" not in out:
                missing.append(field)
            else:
                field_paths[field] = f"{path}/{relative}"
            return out

        def fixed(field: str, relative: str) -> dict[str, float]:
            value = read(f"{relative}/Value")
            if value is None:
                missing.append(field)
                return {}
            field_paths[field] = f"{path}/{relative}/Value"
            return {"value": float(value)}

        def vector(field: str, relative: str, axes: str = "XYZ", kind: str = "ranged") -> dict[str, dict[str, float]]:
            reader = ranged if kind == "ranged" else fixed
            return {axis: reader(f"{field}.{axis}", f"{relative}/{axis}") for axis in axes}

        raw_render = need("renderType", "DrawingValues/Type")
        render_type = _RENDER_TYPES.get(_key(raw_render))
        unsupported: list[str] = [] if render_type else [f"unmapped-core-render-type:{raw_render!s}"]
        orientation = read("DrawingValues/Sprite/Billboard") if render_type == "sprite" else None
        sprite_vertices = None
        if render_type == "sprite" and _key(read("DrawingValues/Sprite/Position")) not in {"default", ""}:
            # Custom quad corners (pivot/stretch), e.g. a laser anchored at its base.
            sprite_vertices = {corner: [read(f"DrawingValues/Sprite/Position_Fixed_{corner}/{axis}/Value") for axis in "XY"]
                               for corner in ("LL", "LR", "UL", "UR")}
        raw_blend = need("blend", "RendererCommonValues/AlphaBlend")
        blend = _BLENDS.get(_key(raw_blend))
        if blend is None:
            unsupported.append(f"unmapped-core-blend:{raw_blend!s}")
            blend = "unsupported"
        # Distortion and lit/custom shaders are a material choice, not a render type.
        raw_material = read("RendererCommonValues/Material") or "Default"
        material = _key(raw_material) or "default"
        if material != "default":
            unsupported.append(f"material:{raw_material!s}")
        attraction = read("LocationAbsValues/Type")
        if attraction is not None and _key(attraction) not in {"none", ""}:
            unsupported.append(f"attraction:{attraction!s}")
        texture = read("RendererCommonValues/ColorTexture/RelativePath")

        max_generation = need("generation.maxGeneration", "CommonValues/MaxGeneration/Value/Value")
        infinite = need("generation.infinite", "CommonValues/MaxGeneration/Infinite/Value")
        generation_time = ranged("generation.generationTime", "CommonValues/GenerationTime")
        generation_offset = ranged("generation.generationTimeOffset", "CommonValues/GenerationTimeOffset")
        life = ranged("life", "CommonValues/Life")
        life_center, life_amp = life.get("center", 60.0), abs(life.get("amplitude", 0.0))

        location_type = str(need("location.type", "LocationValues/Type"))
        rotation_type = str(need("rotation.type", "RotationValues/Type"))
        scale_type = str(need("scaling.type", "ScalingValues/Type"))
        color_type = str(need("color.type", "DrawingValues/Sprite/ColorAll")) if render_type == "sprite" else "Fixed"

        leaves: dict[str, Any] = {}
        location_mode = _key(location_type)
        if location_mode == "fixed":
            leaves["locationPosition"] = {"value": vector("location.position", "LocationValues/Fixed/Location", kind="fixed")}
        elif location_mode == "pva":
            for spec, part in (("locationPosition", "Location"), ("locationVelocity", "Velocity"), ("locationAcceleration", "Acceleration")):
                leaves[spec] = {"value": vector(f"location.{part.lower()}", f"LocationValues/PVA/{part}")}
        elif location_mode == "easing":
            leaves["locationPosition"] = {end: vector(f"location.{end}", f"LocationValues/Easing/{end.title()}") for end in ("start", "end")}
            if read("LocationValues/Easing/IsMiddleEnabled/Value"):
                unsupported.append("location:easing-middle-point")
        else:
            unsupported.append(f"location:{location_type}")

        rotation_mode = _key(rotation_type)
        if rotation_mode == "fixed":
            leaves["rotation"] = {"value": vector("rotation", "RotationValues/Fixed/Rotation", kind="fixed")}
        elif rotation_mode == "pva":
            for spec, part in (("rotation", "Rotation"), ("rotationVelocity", "Velocity"), ("rotationAcceleration", "Acceleration")):
                leaves[spec] = {"value": vector(f"rotation.{part.lower()}", f"RotationValues/PVA/{part}")}
        elif rotation_mode == "easing":
            leaves["rotation"] = {end: vector(f"rotation.{end}", f"RotationValues/Easing/{end.title()}") for end in ("start", "end")}
        else:
            unsupported.append(f"rotation:{rotation_type}")

        scale_mode = _key(scale_type)
        if scale_mode == "fixed":
            leaves["scale"] = {"value": vector("scale", "ScalingValues/Fixed/Scale", kind="fixed")}
        elif scale_mode == "pva":
            for spec, part in (("scale", "Scale"), ("scaleVelocity", "Velocity"), ("scaleAcceleration", "Acceleration")):
                leaves[spec] = {"value": vector(f"scale.{part.lower()}", f"ScalingValues/PVA/{part}")}
        elif scale_mode == "easing":
            leaves["scale"] = {end: vector(f"scale.{end}", f"ScalingValues/Easing/{end.title()}") for end in ("start", "end")}
        elif scale_mode == "singlepva":
            for spec, part in (("singleScale", "Scale"), ("singleScaleVelocity", "Velocity"), ("singleScaleAcceleration", "Acceleration")):
                leaves[spec] = ranged(f"scale.single.{part.lower()}", f"ScalingValues/SinglePVA/{part}")
        elif scale_mode == "singleeasing":
            leaves["singleScaleStart"] = ranged("scale.single.start", "ScalingValues/SingleEasing/Start")
            leaves["singleScaleEnd"] = ranged("scale.single.end", "ScalingValues/SingleEasing/End")
        else:
            unsupported.append(f"scaling:{scale_type}")

        color_mode = _key(color_type)
        if render_type != "sprite":
            pass
        elif color_mode == "fixed":
            leaves["color"] = {"value": vector("color", "DrawingValues/Sprite/ColorAll_Fixed", "RGBA", kind="fixed")}
        elif color_mode == "random":
            leaves["color"] = {"value": vector("color", "DrawingValues/Sprite/ColorAll_Random", "RGBA")}
        elif color_mode == "easing":
            leaves["color"] = {end: vector(f"color.{end}", f"DrawingValues/Sprite/ColorAll_Easing/{end.title()}", "RGBA") for end in ("start", "end")}
        else:
            unsupported.append(f"color:{color_type}")

        def center(axes: dict[str, dict[str, float]], order: str) -> list[float]:
            return [axes.get(axis, {}).get("center", axes.get(axis, {}).get("value", 0.0)) for axis in order]

        def first(spec: str) -> dict[str, dict[str, float]]:
            return next(iter(leaves.get(spec, {"value": {}}).values()), {})

        position = center(first("locationPosition"), "XYZ")
        velocity = center(leaves.get("locationVelocity", {}).get("value", {}), "XYZ")
        acceleration = center(leaves.get("locationAcceleration", {}).get("value", {}), "XYZ")
        rotation = center(first("rotation"), "XYZ")
        if "scale" in leaves:
            size = center(first("scale"), "XY")
        else:
            size = [leaves.get("singleScale", leaves.get("singleScaleStart", {})).get("center", 1.0)] * 2
        color = [channel / 255 for channel in center(first("color"), "RGBA")] if "color" in leaves else [1.0, 1.0, 1.0, 1.0]

        node: dict[str, Any] = {
            "id": stable_id, "path": path, "name": str(item.get("name", stable_id)), "parentId": parent_id,
            "renderType": render_type or "unsupported", "orientation": str(orientation) if orientation is not None else None,
            "blend": blend, "material": material,
            "generation": {"maxGeneration": _int(max_generation, 1), "infinite": bool(infinite),
                           "generationTime": generation_time.get("center", 1.0)},
            "life": {"min": max(1e-6, life_center - life_amp), "max": life_center + life_amp},
            "location": {"type": location_type.lower(), "position": position, "direction": [0, 1, 0], "velocity": velocity, "acceleration": acceleration},
            "rotation": rotation, "color": color, "size": size, "sourcePaths": field_paths,
            "valueModes": {
                "location": {"type": location_type.lower()}, "rotation": {"type": rotation_type.lower()},
                "scaling": {"type": scale_type.lower()}, "color": {"type": color_type.lower()},
                "numericLeaves": leaves,
            },
        }
        if sprite_vertices is not None:
            node["spriteVertices"] = sprite_vertices
        if parent_id is not None:
            field_paths["parentId"] = parent
        if texture:
            node["texture"] = str(texture).replace("\\", "/")
        if generation_time.get("amplitude"):
            node["generation"]["generationTimeAmplitude"] = generation_time["amplitude"]
        if generation_offset.get("center"):
            node["generation"]["generationTimeOffset"] = generation_offset["center"]
        # Never disguise an unreadable Core value as a plausible zero, unit scale or white tint.
        unsupported.extend(f"missing-core-property:{field}" for field in missing)
        if unsupported:
            node["unsupportedFeatures"] = unsupported
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
