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
        missing_core_fields: list[str] = []

        def get(field: str, candidates: tuple[str, ...], default: Any = None) -> Any:
            for suffix in candidates:
                property_path = f"{path}/{suffix}"
                try:
                    value = session.property_get(property_path)
                except (AttributeError, KeyError, ValueError, TypeError):
                    continue
                field_paths[field] = property_path
                return value
            if default is not None:
                missing_core_fields.append(field)
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

        def capture_mode(field: str, root: str, mode: str) -> dict[str, Any]:
            """Read every active Core value via property_get(parentPath).

            property_list exposes IsValueChangedFromDefault leaves, not values;
            the Core API returns the actual value only for the parent path.
            Keeping the full relative path preserves endpoints and random ranges
            even when this converter does not yet understand a particular curve.
            """
            nonlocal listed_paths
            if listed_paths is None:
                try:
                    listed_paths = list(session.property_list(path))
                except (AttributeError, KeyError, ValueError, TypeError):
                    listed_paths = []
            prefix = f"{path}/{root}/".lower()
            wanted = f"/{mode.lower()}/"
            values: dict[str, Any] = {}
            absolute: list[str] = []
            for leaf in listed_paths:
                normalized = leaf.replace("\\", "/")
                low = normalized.lower()
                if not low.startswith(prefix) or wanted not in low:
                    continue
                parent_path = normalized.rsplit("/", 1)[0] if low.endswith("/isvaluechangedfromdefault") else normalized
                relative = parent_path[len(path) + 1:]
                try:
                    value = session.property_get(parent_path)
                except (AttributeError, KeyError, ValueError, TypeError):
                    continue
                values[relative] = value
                absolute.append(parent_path)
            if values:
                field_paths[field] = absolute
            return values

        def read_axes(field: str, root: str, mode: str, prop: str, axes: str = "XYZ") -> dict[str, Any]:
            """Read concrete scalar leaves used by Vector/Color and random value types."""
            nonlocal listed_paths
            if listed_paths is None:
                try:
                    listed_paths = list(session.property_list(path))
                except (AttributeError, KeyError, ValueError, TypeError):
                    listed_paths = []
            out: dict[str, Any] = {}
            sources: list[str] = []
            for leaf in listed_paths:
                normalized = leaf.replace("\\", "/")
                low = normalized.lower()
                if not low.startswith(f"{path}/{root}/".lower()) or f"/{mode.lower()}/" not in low:
                    continue
                parts = low.split("/")
                if (prop and prop.lower() not in parts) or not low.endswith("/isvaluechangedfromdefault"):
                    continue
                axis = next((a for a in axes.lower() if a in parts), None)
                if axis is None:
                    continue
                parent_path = normalized.rsplit("/", 1)[0]
                try:
                    value = float(session.property_get(parent_path))
                except (AttributeError, KeyError, ValueError, TypeError):
                    continue
                parent_leaf = parent_path.rsplit("/", 1)[-1].lower()
                tail = "value" if parent_leaf in axes.lower() else parent_leaf
                axis_index = parts.index(axis)
                endpoint = parts[axis_index - 1] if axis_index > 0 and parts[axis_index - 1] in {"start", "end", "middle"} else "value"
                bucket = out.setdefault(endpoint, {}).setdefault(axis.upper(), {})
                bucket[tail] = value
                sources.append(parent_path)
            if sources:
                field_paths[field] = sources
            return out

        def read_scalar(field: str, root: str, mode: str, prop: str) -> dict[str, float]:
            nonlocal listed_paths
            if listed_paths is None:
                listed_paths = list(session.property_list(path))
            out: dict[str, float] = {}
            sources: list[str] = []
            for leaf in listed_paths:
                low = leaf.lower().replace("\\", "/")
                if not low.startswith(f"{path}/{root}/".lower()) or f"/{mode.lower()}/" not in low or not low.endswith("/isvaluechangedfromdefault"):
                    continue
                parts = low.split("/")
                if prop.lower() not in parts:
                    continue
                parent = leaf.replace("\\", "/").rsplit("/", 1)[0]
                key = parent.rsplit("/", 1)[-1].lower()
                if key not in {"center", "amplitude", "min", "max", "value"}:
                    continue
                try:
                    out[key] = float(session.property_get(parent))
                except (AttributeError, KeyError, ValueError, TypeError):
                    continue
                sources.append(parent)
            if sources:
                field_paths[field] = sources
            return out

        raw_render = get("renderType", ("DrawingValues/Type",), None)
        normalized_render = _key(raw_render)
        render_type = _RENDER_TYPES.get(normalized_render)
        unsupported = [] if render_type else [f"unmapped-core-render-type:{raw_render!s}"]
        raw_blend = get("blend", ("RendererCommonValues/AlphaBlend",), "Blend")
        blend = _BLENDS.get(_key(raw_blend))
        if blend is None:
            unsupported.append(f"unmapped-core-blend:{raw_blend!s}")
            blend = "unsupported"
        # Distortion and lit/custom shaders are a material choice, not a render type.
        raw_material = get("material", ("RendererCommonValues/Material",), "Default")
        material = _key(raw_material) or "default"
        if material != "default":
            unsupported.append(f"material:{raw_material!s}")
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
        # Effekseer 1.80.6 stores standard sprite/model tint at DrawingValues.ColorAll.
        # The old hidden Sprite.ColorAll_* fields are not RendererCommonValues.
        color_type = get("color.type", ("DrawingValues/ColorAll/Type", "DrawingValues/Sprite/ColorAll"), None)
        mode_values = {
            "location": capture_mode("location.values", "LocationValues", str(location_type)),
            "rotation": capture_mode("rotation.values", "RotationValues", str(rotation_type)),
            "scaling": capture_mode("scaling.values", "ScalingValues", str(scale_type)),
            "color": capture_mode("color.values", "DrawingValues/ColorAll", str(color_type)),
        }
        position = discover("location.position", "LocationValues", ("location",), [0, 0, 0], 3, str(location_type))
        velocity = discover("location.velocity", "LocationValues", ("velocity",), [0, 0, 0], 3, str(location_type))
        acceleration = discover("location.acceleration", "LocationValues", ("acceleration",), [0, 0, 0], 3, str(location_type))
        rotation = discover("rotation", "RotationValues", ("rotation",), [0, 0, 0], 3, str(rotation_type))
        scale = discover("scale", "ScalingValues", ("scale",), [1, 1], 3, str(scale_type))
        color = discover("color", "DrawingValues", ("colorall",), [1, 1, 1, 1], 4, str(color_type))
        # 1.80.6 models vectors as X/Y/Z scalar Value objects and random values
        # as Center/Amplitude (or Min/Max) leaves; parent vectors stringify to
        # object names, so read each numeric leaf explicitly.
        for spec, field, root, mode, prop, axes in (
            ("locationPosition", "location.position", "LocationValues", str(location_type), "Location" if _key(location_type) in {"fixed", "pva"} else "", "XYZ"),
            ("locationVelocity", "location.velocity", "LocationValues", str(location_type), "Velocity", "XYZ"),
            ("locationAcceleration", "location.acceleration", "LocationValues", str(location_type), "Acceleration", "XYZ"),
            ("rotation", "rotation", "RotationValues", str(rotation_type), "Rotation" if _key(rotation_type) in {"fixed", "pva"} else "", "XYZ"),
            ("rotationVelocity", "rotation.velocity", "RotationValues", str(rotation_type), "Velocity", "XYZ"),
            ("rotationAcceleration", "rotation.acceleration", "RotationValues", str(rotation_type), "Acceleration", "XYZ"),
            ("scale", "scale", "ScalingValues", str(scale_type), "Scale" if _key(scale_type) in {"fixed", "pva"} else "", "XYZ"),
            ("scaleVelocity", "scale.velocity", "ScalingValues", str(scale_type), "Velocity", "XYZ"),
            ("scaleAcceleration", "scale.acceleration", "ScalingValues", str(scale_type), "Acceleration", "XYZ"),
        ):
            components = read_axes(f"{field}.components", root, mode, prop, axes)
            if components:
                mode_values.setdefault("numericLeaves", {})[spec] = components
                ordered_axes = "XYZ"
                target = [0.0, 0.0, 0.0]
                center_values = components.get("value", components.get("start", {}))
                for index, axis in enumerate(ordered_axes):
                    values = center_values.get(axis, {})
                    if "center" in values:
                        target[index] = values["center"]
                    elif "value" in values:
                        target[index] = values["value"]
                    elif "min" in values and "max" in values:
                        target[index] = (values["min"] + values["max"]) / 2
                if spec == "locationPosition":
                    position = target
                elif spec == "locationVelocity":
                    velocity = target
                elif spec == "locationAcceleration":
                    acceleration = target
                elif spec == "rotation":
                    rotation = target
                elif spec == "scale":
                    scale = target
        color_components = read_axes("color.components", "DrawingValues/ColorAll", str(color_type), "", "RGBA")
        if color_components:
            mode_values.setdefault("numericLeaves", {})["color"] = color_components
            color_values = color_components.get("value", color_components.get("start", {}))
            color = [color_values.get(axis, {}).get("center", color_values.get(axis, {}).get("value", 1.0)) for axis in "RGBA"]
            color = [float(channel) / 255 if float(channel) > 1 else float(channel) for channel in color]
        if _key(scale_type) == "singlepva":
            for field, prop in (("singleScale", "Scale"), ("singleScaleVelocity", "Velocity"), ("singleScaleAcceleration", "Acceleration")):
                mode_values.setdefault("numericLeaves", {})[field] = read_scalar(f"scaling.{field}", "ScalingValues", "SinglePVA", prop)
        elif _key(scale_type) == "singleeasing":
            for field, endpoint in (("singleScaleStart", "Start"), ("singleScaleEnd", "End")):
                mode_values.setdefault("numericLeaves", {})[field] = read_scalar(f"scaling.{field}", "ScalingValues", "SingleEasing", endpoint)
        node: dict[str, Any] = {
            "id": stable_id, "path": path, "name": str(item.get("name", stable_id)), "parentId": parent_id,
            "renderType": render_type or "unsupported", "blend": blend, "material": material,
            "generation": {"maxGeneration": _int(max_generation, 1), "infinite": bool(infinite), "generationTime": _num(generation_time, 1)},
            "life": {"min": _num(life_min, 60), "max": _num(life_max, 60)},
            "location": {"type": str(location_type).lower(), "position": position, "direction": [0, 1, 0], "velocity": velocity, "acceleration": acceleration},
            "rotation": rotation, "color": color, "size": scale[:2], "sourcePaths": field_paths,
        }
        if parent_id is not None:
            field_paths["parentId"] = parent
        if texture:
            node["texture"] = str(texture).replace("\\", "/")
        # Never disguise a missing/unsupported active Core value as a plausible
        # zero, unit scale, or white tint. Preserve the source data above and
        # make conversion block when the active mode has no readable values.
        for label, values in mode_values.items():
            if not values:
                unsupported.append(f"missing-active-value:{label}:{location_type if label == 'location' else rotation_type if label == 'rotation' else scale_type if label == 'scaling' else color_type}")
        for field in missing_core_fields:
            unsupported.append(f"missing-core-property:{field}")
        node["valueModes"] = {
            "location": {"type": str(location_type).lower(), "values": mode_values["location"]},
            "rotation": {"type": str(rotation_type).lower(), "values": mode_values["rotation"]},
            "scaling": {"type": str(scale_type).lower(), "values": mode_values["scaling"]},
            "color": {"type": str(color_type).lower(), "values": mode_values["color"]},
            "numericLeaves": mode_values.get("numericLeaves", {}),
        }
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
