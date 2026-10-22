"""Extract a conservative, versioned JSON snapshot from an open Core session."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def dump_effect_ir(session: Any, name: str | None = None, fps: float = 60) -> dict[str, Any]:
    """Serialize public Core properties into EffectIR without claiming unsupported mappings."""
    nodes = session.node_list()
    paths = {str(item["path"]): str(item["id"]) for item in nodes}
    output_nodes: list[dict[str, Any]] = []
    for item in nodes:
        node_path = str(item["path"])
        stable_ref = str(item["id"])
        leaves = session.property_list(stable_ref)
        raw: dict[str, Any] = {}
        values: dict[str, Any] = {}
        for property_path in leaves:
            try:
                value = session.property_get(property_path)
            except Exception:
                continue
            raw[property_path.removeprefix(f"{stable_ref}/")] = _json_value(value)
            terminal = property_path.rstrip("/").split("/")[-1]
            if terminal.lower() == "value":
                segments = property_path.rstrip("/").split("/")
                terminal = segments[-2] if len(segments) > 1 else terminal
            values[_key(terminal)] = _json_value(value)

        render_value = _pick(values, "renderType", "rendererType")
        if render_value is None:
            # Unknown Core renderer types must block conversion instead of being mislabeled as sprites.
            render_type = "unknown"
        else:
            render_type = str(render_value).lower()
        parent_path = node_path.rpartition("/")[0]
        parent_id = paths.get(parent_path)
        normalized = {
            "id": stable_ref.removeprefix("node/id/"),
            "path": stable_ref,
            "parentId": parent_id.removeprefix("node/id/") if parent_id else None,
            "name": str(item.get("name", stable_ref)),
            "renderType": render_type,
            "properties": raw,
            "unsupportedFeatures": [] if render_type in {"sprite", "none", "group", "ribbon", "track"}
            else ["unmapped-core-render-type"],
        }
        _copy_values(normalized, values)
        output_nodes.append(normalized)
    return {
        "schemaVersion": 1,
        "name": name or (Path(str(session.path)).stem if getattr(session, "path", None) else "effect"),
        "fps": fps,
        "nodes": output_nodes,
    }


def write_effect_ir(session: Any, output: str | Path, name: str | None = None, fps: float = 60) -> Path:
    destination = Path(output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_text(json.dumps(dump_effect_ir(session, name, fps), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(destination)
    return destination


def _copy_values(node: dict[str, Any], values: dict[str, Any]) -> None:
    aliases = {
        "blend": ("blend", "blendType"), "texture": ("texture", "texturePath"),
        "size": ("size", "sizeValue"), "color": ("color", "colorValue"),
        "lighting": ("lighting", "isLighting"),
    }
    for output, keys in aliases.items():
        value = _pick(values, *keys)
        if value is not None:
            node[output] = value

    generation = {key: values[key] for key in ("maxgeneration", "generationtime", "generationtimeoffset", "infinite") if key in values}
    if generation:
        node["generation"] = {
            {"maxgeneration": "maxGeneration", "generationtime": "generationTime",
             "generationtimeoffset": "generationTimeOffset", "infinite": "infinite"}[key]: value
            for key, value in generation.items()
        }
    life = {key: values[key] for key in ("life", "lifemin", "lifemax") if key in values}
    if life:
        node["life"] = {"min": life.get("lifemin", life.get("life")), "max": life.get("lifemax", life.get("life"))}
        node["life"] = {key: value for key, value in node["life"].items() if value is not None}
    location = {key: values[key] for key in ("locationtype", "generationshape", "position", "direction", "velocity", "acceleration") if key in values}
    if location:
        node["location"] = {
            {"locationtype": "type", "generationshape": "shape"}.get(key, key): value
            for key, value in location.items()
        }


def _pick(values: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        normalized = _key(key)
        if normalized in values:
            return values[normalized]
    return None


def _key(value: str) -> str:
    return "".join(character.lower() for character in value if character.isalnum())


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        return [_json_value(child) for child in value]
    return str(value)
