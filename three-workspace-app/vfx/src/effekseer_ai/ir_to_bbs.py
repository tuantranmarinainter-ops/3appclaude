"""Convert the portable EffectIR subset to BBS FS 2.7 Snowstorm schemes."""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any


TICKS_PER_SECOND = 20
TIME_QUANTUM = 1 / TICKS_PER_SECOND
ADD_BRIGHTNESS_BOOST = 2.0


def convert_effect_ir(effect_ir: dict[str, Any], allow_partial: bool = False) -> dict[str, Any]:
    """Return Snowstorm schemes and a per-property support report."""
    if (not isinstance(effect_ir, dict) or isinstance(effect_ir.get("schemaVersion"), bool)
            or effect_ir.get("schemaVersion") != 1):
        raise ValueError("EffectIR schemaVersion must be 1")
    fps = _number(effect_ir.get("fps", 60), "fps", minimum=0.000001)
    nodes = effect_ir.get("nodes")
    if not isinstance(nodes, list):
        raise ValueError("EffectIR nodes must be a list")
    seen_ids: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError("Every EffectIR node must be an object")
        node_id = str(node.get("id", ""))
        if not node_id or node_id in seen_ids:
            raise ValueError("Every EffectIR node needs a unique non-empty id")
        seen_ids.add(node_id)

    by_id = {str(node["id"]): node for node in nodes}
    report_nodes: list[dict[str, Any]] = []
    blockers: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    schemes: list[dict[str, Any]] = []

    for node in nodes:
        node_id = str(node["id"])
        node_path = str(node.get("path") or f"node/id/{node_id}")
        result = {"id": node_id, "path": node_path, "name": str(node.get("name", node_id)), "properties": []}
        report_nodes.append(result)
        render_type = _normal(node.get("renderType", "sprite"))
        if render_type in {"none", "group"}:
            result["status"] = "OK"
            result["properties"].append(_entry(node_path, "renderType", "OK", "Non-rendering group"))
            continue

        node_blockers: list[dict[str, Any]] = []
        node_warnings: list[dict[str, Any]] = []
        parent_id = node.get("parentId")
        parent = by_id.get(str(parent_id)) if parent_id is not None else None
        if parent and _normal(parent.get("renderType", "none")) not in {"none", "group"}:
            node_blockers.append(_entry(node_path, "parentId", "BLOCKED", "BBS FS has no per-particle sub-emitter hierarchy"))
        if render_type != "sprite":
            entry = _entry(node_path, "renderType", "BLOCKED", f"{render_type} has no supported Snowstorm billboard mapping")
            if render_type in {"ribbon", "track"}:
                entry["suggestedAlternative"] = "Replace with short-lived oriented sprite billboards; BBS TrailForm is an actor trail, not an Effekseer per-particle ribbon."
            node_blockers.append(entry)

        location = node.get("location", {})
        if not isinstance(location, dict):
            location = {}
            node_blockers.append(_entry(node_path, "location", "BLOCKED", "Location data must be an object"))
        try:
            location_position = _vector(location.get("position", [0, 0, 0]), "location.position")
            location_direction = _vector(location.get("direction", [0, 1, 0]), "location.direction")
            location_velocity = _vector(location.get("velocity", [0, 0, 0]), "location.velocity")
            location_acceleration = _vector(location.get("acceleration", [0, 0, 0]), "location.acceleration")
        except ValueError as error:
            node_blockers.append(_entry(node_path, "location", "BLOCKED", str(error)))
            location_position = [0.0, 0.0, 0.0]
            location_direction = [0.0, 1.0, 0.0]
            location_velocity = [0.0, 0.0, 0.0]
            location_acceleration = [0.0, 0.0, 0.0]
        try:
            node_size = _vector2(node.get("size", [1, 1]), "size")
        except ValueError as error:
            node_blockers.append(_entry(node_path, "size", "BLOCKED", str(error)))
            node_size = [1.0, 1.0]
        transformed, transform_warnings, transform_blockers = _apply_group_transforms(
            node, by_id, node_path,
            {"position": location_position, "direction": location_direction,
             "velocity": location_velocity, "acceleration": location_acceleration,
             "size": node_size},
        )
        location_position = transformed["position"]
        location_direction = transformed["direction"]
        location_velocity = transformed["velocity"]
        location_acceleration = transformed["acceleration"]
        node_size = transformed["size"]
        result["properties"].extend(entry for entry in transform_warnings if entry["status"] == "OK")
        node_warnings.extend(entry for entry in transform_warnings if entry["status"] != "OK")
        node_blockers.extend(transform_blockers)
        location_kind = _normal(location.get("type", "fixed"))
        if location_kind in {"nurbs", "viewoffset", "model"}:
            node_blockers.append(_entry(node_path, "location.type", "BLOCKED", f"Effekseer location {location_kind} is unsupported"))
        elif location_kind not in {"fixed", "pva", "easing", "fcurve"}:
            node_blockers.append(_entry(node_path, "location.type", "BLOCKED", f"Unknown location type {location_kind}"))
        elif location_kind in {"easing", "fcurve"}:
            node_warnings.append(_entry(node_path, "location.type", "APPROX", "Motion curve is sampled/approximated by the BBS parametric curve"))
        elif location_kind in {"fixed", "pva"}:
            result["properties"].append(_entry(node_path, "location.type", "OK", f"{location_kind} coordinates are represented by Snowstorm emitter and particle motion fields"))

        shape = _normal(location.get("shape", "point"))
        if shape in {"point", "sphere", "circle", "disc"}:
            shape_component = "minecraft:emitter_shape_point" if shape == "point" else (
                "minecraft:emitter_shape_sphere" if shape == "sphere" else "minecraft:emitter_shape_disc"
            )
            shape_level = "OK"
        elif shape == "line":
            shape_component = "minecraft:emitter_shape_box"
            shape_level = "APPROX"
            node_warnings.append(_entry(node_path, "location.shape", "APPROX", "Line emission is represented by a thin box"))
        elif shape == "model":
            node_blockers.append(_entry(node_path, "location.shape", "BLOCKED", "Model generation location is unsupported"))
            shape_component = "minecraft:emitter_shape_point"
            shape_level = "BLOCKED"
        else:
            node_blockers.append(_entry(node_path, "location.shape", "BLOCKED", f"Unknown generation shape {shape}"))
            shape_component = "minecraft:emitter_shape_point"
            shape_level = "BLOCKED"
        shape_radius = 1.0
        shape_extents = [0.01, 0.01, 0.5]
        if shape in {"sphere", "circle", "disc"}:
            try:
                shape_radius = _number(location.get("radius", 1), "location.radius", minimum=0)
            except ValueError as error:
                node_blockers.append(_entry(node_path, "location.radius", "BLOCKED", str(error)))
        elif shape == "line":
            try:
                shape_extents = _vector(location.get("extents", [0.01, 0.01, 0.5]), "location.extents")
            except ValueError as error:
                node_blockers.append(_entry(node_path, "location.extents", "BLOCKED", str(error)))
        if shape_level == "OK":
            result["properties"].append(_entry(node_path, "location.shape", "OK", f"Mapped to {shape_component}"))

        generation = node.get("generation", {})
        if not isinstance(generation, dict):
            generation = {}
            node_blockers.append(_entry(node_path, "generation", "BLOCKED", "Generation data must be an object"))
        infinite = bool(generation.get("infinite", node.get("loop", False)))
        max_generation = generation.get("maxGeneration", 1)
        gen_frames = generation.get("generationTime", 1)
        generation_valid = True
        try:
            if isinstance(max_generation, bool) or not isinstance(max_generation, int):
                raise ValueError("generation.maxGeneration must be an integer")
            gen_frames = _number(gen_frames, "generation.generationTime", minimum=0.000001)
            if max_generation <= 0:
                raise ValueError("generation.maxGeneration must be positive")
        except (TypeError, ValueError) as error:
            node_blockers.append(_entry(node_path, "generation", "BLOCKED", str(error)))
            max_generation = 1
            gen_frames = 1
        generation_seconds = _quantize(gen_frames / fps)
        emitter_lifetime = _quantize(max_generation * gen_frames / fps)
        generation_valid = not any(entry["property"] == "generation" for entry in node_blockers)
        if generation_valid:
            result["properties"].append(_entry(node_path, "generation.maxGeneration", "OK", f"Maximum particle count is {max_generation}"))
            result["properties"].append(_entry(node_path, "generation.generationTime", "OK", f"Source frames converted to {generation_seconds:g} seconds per 20-Hz tick interval"))
        if gen_frames < 3:
            node_warnings.append(_entry(node_path, "generation.generationTime", "WARNING", "Emission interval is shorter than 3 source frames and is quantized to 20 Hz"))
        offset_frames = generation.get("generationTimeOffset", 0)
        try:
            offset_value = _number(offset_frames, "generation.generationTimeOffset", minimum=0) / fps
            offset_seconds = 0 if offset_value == 0 else _quantize(offset_value)
        except ValueError as error:
            node_blockers.append(_entry(node_path, "generation.generationTimeOffset", "BLOCKED", str(error)))
            offset_seconds = 0
        if offset_seconds:
            node_warnings.append(_entry(node_path, "generation.generationTimeOffset", "APPROX", "Initial generation delay is reported; BBS activation timing needs in-game validation"))

        life = node.get("life", {})
        if not isinstance(life, dict):
            life = {"min": life, "max": life}
        life_max = life.get("max", 60)
        life_min = life.get("min", life_max)
        life_valid = True
        try:
            life_min = _number(life_min, "life.min", minimum=0.000001)
            life_max = _number(life_max, "life.max", minimum=life_min)
        except ValueError as error:
            node_blockers.append(_entry(node_path, "life", "BLOCKED", str(error)))
            life_max = fps
        life_min_seconds = _quantize(life_min / fps)
        life_seconds = _quantize(life_max / fps)
        lifetime_expression: float | str = life_seconds
        if life_min_seconds < life_seconds:
            lifetime_expression = f"math.random({life_min_seconds:g}, {life_seconds:g})"
        life_valid = not any(entry["property"] == "life" for entry in node_blockers)
        if life_valid:
            if life_min < life_max:
                detail = (
                    f"Random lifetime range preserved as {lifetime_expression}; endpoints are quantized to 1/20 second"
                    if life_min_seconds < life_seconds else
                    f"Random lifetime range collapsed to {life_seconds:g} seconds after 1/20-second quantization"
                )
                node_warnings.append(_entry(
                    node_path, "life", "APPROX", detail,
                ))
            else:
                raw_life_seconds = life_max / fps
                changed = abs(raw_life_seconds - life_seconds) > 1e-9
                status = "APPROX" if changed else "OK"
                entry = _entry(node_path, "life.max", status, f"Particle lifetime mapped to {life_seconds:g} seconds")
                if changed:
                    node_warnings.append(entry)
                else:
                    result["properties"].append(entry)
        if life_max < 3:
            node_warnings.append(_entry(node_path, "life", "WARNING", "Particle life is shorter than 3 source frames and is quantized to 20 Hz"))

        blend = _normal(node.get("blend", "blend"))
        if blend in {"sub", "mul", "multiply", "subtract"}:
            node_blockers.append(_entry(node_path, "blend", "BLOCKED", f"Blend mode {blend} is unsupported by BBS FS 2.7"))
        elif blend not in {"add", "additive", "blend", "alpha", "opacity", "opaque"}:
            node_blockers.append(_entry(node_path, "blend", "BLOCKED", f"Unknown blend mode {blend}"))
        material = "particles_opaque" if blend in {"opaque", "opacity"} else (
            "particles_alpha" if blend == "alpha" else "particles_blend"
        )
        if blend in {"add", "additive"}:
            result["properties"].append(_entry(node_path, "blend", "APPROX", "Additive blend uses alpha material and a recorded brightness boost"))
        elif not node_blockers:
            result["properties"].append(_entry(node_path, "blend", "OK", f"Mapped to {material}"))

        color = node.get("color", [1, 1, 1, 1])
        try:
            color = _color(color)
        except ValueError as error:
            node_blockers.append(_entry(node_path, "color", "BLOCKED", str(error)))
            color = [1.0, 1.0, 1.0, 1.0]
        if blend in {"add", "additive"}:
            boosted = [min(1.0, channel * ADD_BRIGHTNESS_BOOST) for channel in color[:3]] + [color[3]]
            color = boosted
            warning = _entry(node_path, "blend", "WARNING", "Effekseer Add falls back to alpha blending; highlights may look less additive")
            warning["fallback"] = {"material": "particles_blend", "brightnessBoost": ADD_BRIGHTNESS_BOOST, "outputColor": color}
            node_warnings.append(warning)
        if color[3] < 1:
            node_warnings.append(_entry(node_path, "color.alpha", "APPROX", "Snowstorm tint exports RGB; source alpha must be baked into the texture or is not preserved"))
        if not any(entry["property"] == "color" for entry in node_blockers):
            result["properties"].append(_entry(node_path, "color", "OK", "Solid RGBA is mapped to Snowstorm billboard tinting"))

        texture = str(node.get("texture", "textures/particle/particles"))
        try:
            texture_reference = _texture_ref(texture)
        except ValueError as error:
            node_blockers.append(_entry(node_path, "texture", "BLOCKED", str(error)))
            texture_reference = "assets:textures/particle/particles"
        if not node.get("texture"):
            node_warnings.append(_entry(node_path, "texture", "WARNING", "Default placeholder texture is used; package a licensed texture for final output"))
        else:
            result["properties"].append(_entry(node_path, "texture", "OK", f"Texture reference preserved as {texture_reference}"))
        if not any(entry["property"] == "size" for entry in node_blockers):
            result["properties"].append(_entry(node_path, "size", "OK", "Fixed billboard size mapped"))

        unsupported = node.get("unsupportedFeatures", [])
        if not isinstance(unsupported, list):
            node_blockers.append(_entry(node_path, "unsupportedFeatures", "BLOCKED", "unsupportedFeatures must be a list"))
            unsupported = []
        for feature in unsupported:
            node_blockers.append(_entry(node_path, str(feature), "BLOCKED", "Feature is outside the current BBS Snowstorm subset"))

        flipbook = node.get("flipbook")
        flipbook_data = None
        if flipbook is not None:
            if not isinstance(flipbook, dict):
                node_blockers.append(_entry(node_path, "flipbook", "BLOCKED", "flipbook must be an object"))
            else:
                try:
                    max_frame = flipbook.get("maxFrame", 1)
                    if isinstance(max_frame, bool) or not isinstance(max_frame, int) or max_frame < 1:
                        raise ValueError("flipbook.maxFrame must be a positive integer")
                    flipbook_data = {
                        "base_UV": _vector2(flipbook.get("baseUV", [0, 0]), "flipbook.baseUV"),
                        "size_UV": _vector2(flipbook.get("sizeUV", [1, 1]), "flipbook.sizeUV"),
                        "step_UV": _vector2(flipbook.get("stepUV", [1, 1]), "flipbook.stepUV"),
                        "frames_per_second": _number(flipbook.get("framesPerSecond", 1), "flipbook.framesPerSecond", minimum=0),
                        "max_frame": max_frame,
                        "loop": bool(flipbook.get("loop", True)),
                        "stretch_to_lifetime": bool(flipbook.get("stretchToLifetime", False)),
                    }
                except ValueError as error:
                    node_blockers.append(_entry(node_path, "flipbook", "BLOCKED", str(error)))

        if node_blockers:
            result["properties"].extend(node_blockers)
            result["status"] = "BLOCKED"
            blockers.extend(node_blockers)
            if not allow_partial:
                result["warnings"] = node_warnings
                warnings.extend(node_warnings)
                continue
        else:
            result["properties"].append(_entry(node_path, "renderType", "OK", "Sprite maps to particle_appearance_billboard"))
        result["properties"].extend(node_warnings)
        result["warnings"] = node_warnings
        warnings.extend(node_warnings)
        if node_blockers and allow_partial:
            continue

        components: dict[str, Any] = {
            "minecraft:particle_lifetime_expression": {"max_lifetime": lifetime_expression},
            "minecraft:particle_appearance_billboard": {
                "size": node_size,
                "facing_camera_mode": "lookat_xyz",
                "uv": {"texture_width": 1, "texture_height": 1, "uv": [0, 0], "uv_size": [1, 1]},
            },
            "minecraft:particle_appearance_tinting": {"color": _hex_color(color)},
        }
        components[shape_component] = {
            "offset": location_position,
            "direction": location_direction,
        }
        if shape in {"sphere", "circle", "disc"}:
            components[shape_component]["radius"] = shape_radius
        elif shape == "line":
            components[shape_component]["half_dimensions"] = shape_extents
        components["minecraft:emitter_rate_steady"] = {
            "spawn_rate": _quantize_rate(generation_seconds),
            "max_particles": max_generation,
        }
        if infinite:
            components["minecraft:emitter_lifetime_looping"] = {"active_time": 0, "sleep_time": 0}
        else:
            components["minecraft:emitter_lifetime_once"] = {"active_time": emitter_lifetime}
        if offset_seconds:
            components["minecraft:emitter_lifetime_expression"] = {
                "activation_expression": f"variable.emitter_age >= {offset_seconds:g}"
            }

        speed = math.sqrt(sum(value * value for value in location_velocity))
        if speed:
            components["minecraft:particle_initial_speed"] = speed
        if any(location_acceleration):
            components["minecraft:particle_motion_dynamic"] = {"linear_acceleration": location_acceleration}
        if node.get("lighting") is not None:
            components["minecraft:particle_appearance_lighting"] = {"enabled": bool(node["lighting"])}
        if flipbook_data is not None:
            components["minecraft:particle_appearance_billboard"]["uv"]["flipbook"] = flipbook_data
        identifier = f"vfx:{_slug(effect_ir.get('name', 'effect'))}_{_slug(node.get('name', node_id))}_{_slug(node_id)}"
        schemes.append({
            "id": node_id,
            "path": node_path,
            "json": {
                "format_version": "1.10.0",
                "particle_effect": {
                    "description": {
                        "identifier": identifier,
                        "basic_render_parameters": {"material": material, "texture": texture_reference},
                    },
                    "components": components,
                },
            },
        })
        result["status"] = "PARTIAL" if node_blockers else ("WARNING" if node_warnings else "OK")
        result["time"] = {
            "generationIntervalSeconds": generation_seconds,
            "emitterActiveSeconds": emitter_lifetime,
            "particleLifeSeconds": life_seconds,
            "generationOffsetSeconds": offset_seconds,
        }

    has_blockers = bool(blockers)
    status = "BLOCKED" if has_blockers and not allow_partial else ("PARTIAL" if has_blockers else "PASS")
    return {
        "schemaVersion": 1,
        "source": effect_ir.get("name"),
        "status": status,
        "allowPartial": allow_partial,
        "timeConversion": {
            "sourceFps": fps,
            "targetTicksPerSecond": TICKS_PER_SECOND,
            "quantumSeconds": TIME_QUANTUM,
            "rule": "sourceFrames / sourceFps, rounded to nearest 1/20 second",
        },
        "schemes": [] if has_blockers and not allow_partial else schemes,
        "nodes": report_nodes,
        "blocked": blockers,
        "warnings": warnings,
    }


def convert_to_directory(effect_ir: dict[str, Any], out_dir: str | Path, allow_partial: bool = False) -> dict[str, Any]:
    """Write each accepted node scheme and a complete report to a directory."""
    result = convert_effect_ir(effect_ir, allow_partial)
    output = Path(out_dir)
    output.mkdir(parents=True, exist_ok=True)
    previous_report = output / "report.json"
    if previous_report.is_file():
        try:
            previous = json.loads(previous_report.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            previous = {}
        old_schemes = previous.get("schemes", []) if isinstance(previous, dict) else []
        for old_scheme in old_schemes:
            filename = old_scheme.get("file") if isinstance(old_scheme, dict) else None
            if isinstance(filename, str) and Path(filename).name == filename and filename.endswith(".json"):
                stale = output / filename
                if stale.is_file():
                    stale.unlink()
    if result["status"] != "BLOCKED":
        for scheme in result["schemes"]:
            filename = f"{_slug(scheme['id'])}.json"
            _atomic_json(output / filename, scheme["json"])
            scheme["file"] = filename
    _atomic_json(output / "report.json", result)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="effekseer-ai ir-to-bbs")
    parser.add_argument("effect_ir", help="EffectIR JSON file")
    parser.add_argument("out", help="Output directory for Snowstorm schemes and report.json")
    parser.add_argument("--allow-partial", action="store_true", help="Export supported nodes while reporting blocked nodes")
    args = parser.parse_args(argv)
    try:
        effect_ir = json.loads(Path(args.effect_ir).read_text(encoding="utf-8"))
        result = convert_to_directory(effect_ir, args.out, args.allow_partial)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(json.dumps({"status": "ERROR", "error": str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result["status"] == "BLOCKED" else 0


def _entry(path: str, prop: str, status: str, detail: str) -> dict[str, str]:
    return {"path": path, "property": prop, "status": status, "detail": detail}


def _apply_group_transforms(
    node: dict[str, Any], by_id: dict[str, dict[str, Any]], path: str,
    vectors: dict[str, list[float]],
) -> tuple[dict[str, list[float]], list[dict[str, str]], list[dict[str, str]]]:
    chain: list[dict[str, Any]] = []
    blockers: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    parent_id = node.get("parentId")
    seen: set[str] = set()
    while parent_id is not None:
        stable_id = str(parent_id)
        if stable_id in seen:
            blockers.append(_entry(path, "parentId", "BLOCKED", "EffectIR parent graph contains a cycle"))
            return vectors, warnings, blockers
        seen.add(stable_id)
        parent = by_id.get(stable_id)
        if parent is None:
            blockers.append(_entry(path, "parentId", "BLOCKED", f"Unknown parent node ID: {stable_id}"))
            return vectors, warnings, blockers
        if _normal(parent.get("renderType", "none")) not in {"none", "group"}:
            break
        chain.append(parent)
        parent_id = parent.get("parentId")

    for parent in reversed(chain):
        transform = parent.get("transform", {})
        if not isinstance(transform, dict):
            blockers.append(_entry(path, "parent.transform", "BLOCKED", "Group transform must be an object"))
            continue
        try:
            translation = _vector(transform.get("position", [0, 0, 0]), "parent.transform.position")
            rotation = _vector(transform.get("rotationDegrees", [0, 0, 0]), "parent.transform.rotationDegrees")
            scale = _vector(transform.get("scale", [1, 1, 1]), "parent.transform.scale")
        except ValueError as error:
            blockers.append(_entry(path, "parent.transform", "BLOCKED", str(error)))
            continue
        vectors["position"] = [a + b for a, b in zip(_rotate(_scale(vectors["position"], scale), rotation), translation)]
        for field in ("velocity", "acceleration"):
            vectors[field] = _rotate(_scale(vectors[field], scale), rotation)
        vectors["direction"] = _rotate(vectors["direction"], rotation)
        vectors["size"] = [vectors["size"][0] * abs(scale[0]), vectors["size"][1] * abs(scale[1])]
        result = _entry(path, "parent.transform", "OK", "Static group position, rotation, and scale applied to child coordinates")
        warnings.append(result)
        if transform.get("animated"):
            warnings.append(_entry(path, "parent.transform.animated", "APPROX", "Only the group transform stored in EffectIR is applied; animation is not baked by this converter"))
        if any(abs(value) > 1e-9 for value in rotation):
            warnings.append(_entry(path, "parent.transform.rotationDegrees", "APPROX", "Group rotation affects offsets and motion vectors; billboard spin is not rotated"))
    return vectors, warnings, blockers


def _scale(vector: list[float], scale: list[float]) -> list[float]:
    return [value * factor for value, factor in zip(vector, scale)]


def _rotate(vector: list[float], degrees: list[float]) -> list[float]:
    x, y, z = vector
    rx, ry, rz = [math.radians(value) for value in degrees]
    y, z = y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)
    x, z = x * math.cos(ry) + z * math.sin(ry), -x * math.sin(ry) + z * math.cos(ry)
    x, y = x * math.cos(rz) - y * math.sin(rz), x * math.sin(rz) + y * math.cos(rz)
    return [x, y, z]


def _number(value: Any, label: str, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"{label} must be a finite number")
    number = float(value)
    if minimum is not None and number < minimum:
        raise ValueError(f"{label} must be at least {minimum}")
    return number


def _vector(value: Any, label: str) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"{label} must have three numbers")
    return [_number(part, label) for part in value]


def _vector2(value: Any, label: str) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) not in {2, 3}:
        raise ValueError(f"{label} must have two or three numbers")
    values = [_number(part, label, minimum=0) for part in value]
    return values[:2]


def _color(value: Any) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) not in {3, 4}:
        raise ValueError("color must contain RGB or RGBA values")
    color = [_number(channel, "color", minimum=0) for channel in value]
    if any(channel > 1 for channel in color):
        raise ValueError("color channels must be in the 0..1 range")
    if len(color) == 3:
        color.append(1.0)
    return color


def _hex_color(color: list[float]) -> str:
    channels = [round(channel * 255) for channel in color[:3]]
    return "#" + "".join(f"{channel:02x}" for channel in channels)


def _quantize(seconds: float) -> float:
    return max(TIME_QUANTUM, round(seconds / TIME_QUANTUM) * TIME_QUANTUM)


def _quantize_rate(interval: float) -> float:
    return round(1 / max(interval, TIME_QUANTUM), 6)


def _normal(value: Any) -> str:
    return str(value).strip().lower().replace("_", "").replace(" ", "")


def _slug(value: Any) -> str:
    text = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value)).strip("_").lower()
    return text[:48] or "effect"


def _texture_ref(value: str) -> str:
    normalized = value.replace("\\", "/")
    path_part = normalized.removeprefix("assets:")
    if path_part.startswith("/") or ".." in Path(path_part).parts or not path_part:
        raise ValueError("Texture references must stay within the asset root")
    if normalized.startswith("assets:"):
        return normalized
    return f"assets:{normalized}"


def _atomic_json(path: Path, data: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


if __name__ == "__main__":
    raise SystemExit(main())
