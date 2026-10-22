"""The minimal effect-document lifecycle backed by Effekseer Core."""

from __future__ import annotations

import hashlib
import json
import math
import os
from dataclasses import dataclass
from tempfile import NamedTemporaryFile
from pathlib import Path
from shutil import copy2
from typing import Any
from uuid import uuid4

from .runtime import export_binary, load_core
from .settings import PANEL_LABELS, PANEL_ROOTS


@dataclass
class EffectSession:
    """A handle to the single Core document hosted by this Python process."""

    path: Path | None = None

    def __post_init__(self) -> None:
        self._nodes: dict[str, object] = {}
        self._node_ids_by_path: dict[str, str] = {}
        self._undo_path: Path | None = (
            self.path.with_suffix(self.path.suffix + ".bak")
            if self.path is not None and self.path.with_suffix(self.path.suffix + ".bak").is_file()
            else None
        )
        self._index_existing_nodes()

    @classmethod
    def new(cls) -> "EffectSession":
        load_core().New()
        return cls()

    @classmethod
    def open(cls, path: str | Path) -> "EffectSession":
        effect_path = Path(path).resolve()
        if not effect_path.is_file():
            raise FileNotFoundError(effect_path)
        if not load_core().LoadFrom(str(effect_path)):
            raise ValueError(f"Effekseer cannot open: {effect_path}")
        return cls(effect_path)

    def save(self, path: str | Path | None = None) -> Path:
        effect_path = Path(path or self.path or "").resolve()
        if not str(effect_path):
            raise ValueError("A path is required for the first save")
        if effect_path.suffix.lower() != ".efkefc":
            raise ValueError("Effect files must use the .efkefc extension")
        effect_path.parent.mkdir(parents=True, exist_ok=True)
        if effect_path.is_file():
            backup = effect_path.with_suffix(effect_path.suffix + ".bak")
            copy2(effect_path, backup)
            self._undo_path = backup
        load_core().SaveTo(str(effect_path))
        self.path = effect_path
        return effect_path

    def edit_undo(self) -> Path:
        """Restore the most recent pre-save document backup exactly once."""
        if self.path is None or self._undo_path is None or not self._undo_path.is_file():
            raise ValueError("No saved edit is available to undo")
        copy2(self._undo_path, self.path)
        if not load_core().LoadFrom(str(self.path)):
            raise ValueError(f"Effekseer cannot reopen the backup: {self.path}")
        self._undo_path.unlink(missing_ok=True)
        self._undo_path = None
        self._index_existing_nodes()
        return self.path

    def summary(self) -> dict[str, int | str | None]:
        root = load_core().Root
        return {
            "path": str(self.path) if self.path else None,
            "root_children": int(root.Children.Count),
        }

    def add_node(self, parent_path: str = "node/root", name: str | None = None) -> str:
        """Add a Core node and return its AI-facing path."""
        parent = self._node(parent_path)
        node = parent.AddChild()
        if name is not None:
            node.Name.SetValue(name)
        self._index_existing_nodes()
        return self._path_for_node(node)

    def node_list(self) -> list[dict[str, int | str]]:
        """List every non-root node currently known to the session."""
        return [
            {
                "path": path,
                "id": self._stable_node_ref(path),
                "name": str(node.Name.Value),
                "children": int(node.Children.Count),
            }
            for path, node in self._nodes.items()
            if path != "node/root"
        ]

    def rename_node(self, node_path: str, name: str) -> None:
        """Rename a node through its Core string value."""
        node = self._node(node_path)
        if self._path_for_node(node) == "node/root":
            raise ValueError("The root node cannot be renamed")
        node.Name.SetValue(name)

    def remove_node(self, node_path: str) -> None:
        """Remove a node and its descendants from the current document."""
        node = self._node(node_path)
        if self._path_for_node(node) == "node/root":
            raise ValueError("The root node cannot be removed")
        if not node.Parent.RemoveChild(node):
            raise ValueError(f"Node is not attached: {node_path}")
        self._index_existing_nodes()

    def move_node(self, node_path: str, parent_path: str) -> str:
        """Move a node and return its new structural path."""
        node = self._node(node_path)
        if self._path_for_node(node) == "node/root":
            raise ValueError("The root node cannot be moved")
        parent = self._node(parent_path)
        if node == parent or node.HasNode(parent, True):
            raise ValueError("A node cannot be moved into itself or its descendant")
        if not node.Parent.RemoveChild(node):
            raise ValueError(f"Node is not attached: {node_path}")
        parent.AddChild(node)
        self._index_existing_nodes()
        return self._path_for_node(node)

    def property_get(self, property_path: str) -> Any:
        """Read a public Core member without invoking arbitrary methods."""
        target, member = self._property_parent(property_path)
        return self._as_python(getattr(target, member))

    def property_set(self, property_path: str, value: Any) -> None:
        """Write an editable Core value or a public writable property."""
        target, member = self._property_parent(property_path)
        if member == "Value":
            self._assign_value(target, value)
            return

        property_info = target.GetType().GetProperty(member)
        if property_info is None or not property_info.CanWrite:
            raise ValueError(f"Property is not writable: {property_path}")
        setattr(target, member, value)

    def property_list(self, node_path: str, max_depth: int = 6) -> list[str]:
        """Discover editable leaf paths without walking parent/tree references."""
        leaves: list[str] = []
        skipped = {"Children", "Parent", "EditorNodeId"}

        def walk(value: Any, path: str, depth: int) -> None:
            if value is None or isinstance(value, (bool, int, float, str)):
                leaves.append(path)
                return
            if depth == 0 or not hasattr(value, "GetType"):
                leaves.append(path)
                return
            value_type = value.GetType()
            if not (value_type.Namespace or "").startswith("Effekseer"):
                leaves.append(path)
                return
            for property_info in value_type.GetProperties():
                if (
                    not property_info.CanRead
                    or property_info.Name in skipped
                    or property_info.GetIndexParameters().Length != 0
                ):
                    continue
                try:
                    walk(getattr(value, property_info.Name), f"{path}/{property_info.Name}", depth - 1)
                except Exception:
                    continue

        walk(self._node(node_path), node_path, max_depth)
        return sorted(set(leaves))

    def settings_list(self, node_path: str) -> dict[str, dict[str, object]]:
        """Discover parameters grouped as they are in the editor's setting panels."""
        paths = self.property_list(node_path)
        return {
            panel: {
                "label": PANEL_LABELS[panel],
                "fields": [
                    path.removeprefix(f"{node_path}/{root}/")
                    for path in paths
                    if path.startswith(f"{node_path}/{root}/")
                ],
            }
            for panel, root in PANEL_ROOTS.items()
        }

    def settings_set(self, node_path: str, panel: str, values: dict[str, Any]) -> None:
        """Set a batch of panel-relative editable fields."""
        try:
            root = PANEL_ROOTS[panel]
        except KeyError as error:
            raise KeyError(f"Unknown settings panel: {panel}") from error
        changes: list[tuple[str, Any, Any]] = []
        seen: set[str] = set()
        for field, value in values.items():
            if field.startswith("/") or ".." in field.split("/"):
                raise ValueError(f"Invalid setting field: {field}")
            property_path = f"{node_path}/{root}/{field}"
            if property_path in seen:
                raise ValueError(f"Duplicate setting field: {field}")
            seen.add(property_path)
            previous = self.property_get(property_path)
            self._validate_json_value(value)
            changes.append((property_path, previous, value))
        applied: list[tuple[str, Any]] = []
        try:
            for property_path, previous, value in changes:
                applied.append((property_path, previous))
                self.property_set(property_path, value)
        except Exception:
            for property_path, previous in reversed(applied):
                try:
                    self.property_set(property_path, previous)
                except Exception:
                    pass
            raise

    def curve_keys(self, curve_path: str) -> list[dict[str, float | int]]:
        """Read a scalar curve as JSON-friendly keyframe data."""
        curve = self._object_at_path(curve_path)
        return [
            {
                "frame": int(key.Frame), "value": float(key.Value),
                "left": [float(key.LeftX), float(key.LeftY)],
                "right": [float(key.RightX), float(key.RightY)],
                "interpolation": int(key.InterpolationType),
            }
            for key in curve.Keys
        ]

    def curve_set_keys(self, curve_path: str, keys: list[dict[str, Any]]) -> None:
        """Validate a replacement curve completely before changing Core state."""
        curve = self._object_at_path(curve_path)
        normalized = self._validate_curve_keys(keys)
        replacements = [self._new_curve_key(curve, data) for data in normalized]
        previous = [self._curve_key_data(key) for key in curve.Keys]
        try:
            for key in list(curve.Keys):
                curve.RemoveKey(key)
            for key in replacements:
                curve.AddKey(key)
        except Exception:
            for key in list(curve.Keys):
                curve.RemoveKey(key)
            for data in previous:
                curve.AddKey(self._new_curve_key(curve, data))
            raise

    def _new_curve_key(self, curve: object, data: dict[str, float | int]) -> object:
        from System import Activator, Array, Enum, Int32, Object, Single

        value_type = curve.GetType().GetGenericArguments()[0]
        value = Single(float(data["value"])) if value_type.Name == "Single" else Int32(int(data["value"]))
        key_type = curve.GetType().Assembly.GetType("Effekseer.Data.Value.FCurveKey`1")
        key_type = key_type.MakeGenericType(value_type)
        key = Activator.CreateInstance(key_type, Array[Object]([Int32(int(data["frame"])), value]))
        if "left" in data:
            key.SetLeft(Single(float(data["left"][0])), Single(float(data["left"][1])))
        if "right" in data:
            key.SetRight(Single(float(data["right"][0])), Single(float(data["right"][1])))
        if "interpolation" in data:
            enum_type = key.GetType().Assembly.GetType("Effekseer.Data.Value.FCurveInterpolation")
            key.SetInterpolationType(Enum.ToObject(enum_type, int(data["interpolation"])))
        key.Commit()
        return key

    def import_image(self, source: str | Path, property_path: str | None = None) -> str:
        """Copy an image beside the effect and optionally bind its Core path."""
        relative_path = self._copy_resource(
            source, {".png", ".jpg", ".jpeg", ".tga", ".dds", ".bmp"}
        )
        if property_path:
            image_path = self._object_at_path(property_path)
            if hasattr(image_path, "SetAbsolutePath"):
                image_path.SetAbsolutePath(str(self.path.parent / relative_path))
            else:
                self.property_set(property_path, relative_path)
        return relative_path

    def import_model(self, source: str | Path, property_path: str) -> str:
        """Copy a model into ``resources/`` and bind it through Core's path API."""
        relative_path = self._copy_resource(source, {".fbx", ".efkmodel"})
        absolute_path = self.path.parent / Path(relative_path)
        model_path = self._object_at_path(property_path)
        if not hasattr(model_path, "SetAbsolutePath"):
            raise ValueError(f"Property is not an Effekseer model path: {property_path}")
        model_path.SetAbsolutePath(str(absolute_path))
        return relative_path

    def export(self, path: str | Path, magnification: float = 1.0) -> Path:
        """Export the current document as a runtime `.efk` file."""
        output = Path(path).resolve()
        if output.suffix.lower() != ".efk":
            raise ValueError("Runtime exports must use the .efk extension")
        export_binary(output, magnification)
        return output

    def _index_existing_nodes(self) -> None:
        root = load_core().Root
        previous = [
            (node, self._node_ids_by_path.get(path))
            for path, node in self._nodes.items()
            if hasattr(self, "_node_ids_by_path")
        ]
        self._nodes.clear()
        self._node_ids_by_path = {}

        def assign(path: str, node: object) -> None:
            stable_id = next(
                (known_id for known_node, known_id in previous
                 if known_id is not None and self._same_node(known_node, node)),
                None,
            )
            self._nodes[path] = node
            self._node_ids_by_path[path] = stable_id or str(uuid4())

        assign("node/root", root)

        def visit(parent: object, parent_path: str) -> None:
            for index in range(parent.Children.Count):
                child = parent.Children[index]
                child_path = f"{parent_path}/{index}"
                assign(child_path, child)
                visit(child, child_path)

        visit(root, "node/root")

    def _copy_resource(self, source: str | Path, extensions: set[str]) -> str:
        """Store an approved asset by content hash and atomically update its manifest."""
        if self.path is None:
            raise ValueError("Save the effect before importing project resources")
        source_path = Path(source).resolve()
        if not source_path.is_file():
            raise FileNotFoundError(source_path)
        if source_path.suffix.lower() not in extensions:
            raise ValueError(f"Unsupported resource type: {source_path.suffix}")
        digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
        resources = self.path.parent / "resources"
        resources.mkdir(exist_ok=True)
        relative_asset = f"resources/{digest}{source_path.suffix.lower()}"
        destination = self.path.parent / relative_asset
        if not destination.exists():
            copy2(source_path, destination)
        manifest_path = resources / "manifest.json"
        manifest: dict[str, Any] = {"schemaVersion": 1, "assets": []}
        if manifest_path.is_file():
            loaded = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not isinstance(loaded, dict) or loaded.get("schemaVersion") != 1 or not isinstance(loaded.get("assets"), list):
                raise ValueError(f"Invalid resource manifest: {manifest_path}")
            manifest = loaded
        asset = {"sha256": digest, "sourceName": source_path.name, "path": relative_asset}
        if asset not in manifest["assets"]:
            manifest["assets"].append(asset)
            self._atomic_json(manifest_path, manifest)
        return relative_asset

    def _atomic_json(self, path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary: Path | None = None
        try:
            with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as stream:
                temporary = Path(stream.name)
                json.dump(value, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def _node(self, node_path: str) -> object:
        if node_path.startswith("node/id/"):
            stable_id = node_path.removeprefix("node/id/")
            for path, known_id in self._node_ids_by_path.items():
                if known_id == stable_id:
                    return self._nodes[path]
            raise KeyError(f"Unknown stable node id: {stable_id}")
        try:
            return self._nodes[node_path]
        except KeyError as error:
            raise KeyError(f"Unknown node path: {node_path}") from error

    def _property_parent(self, property_path: str) -> tuple[object, str]:
        if not property_path.startswith("node/"):
            raise ValueError(f"Invalid property path: {property_path}")
        node_path = next(
            (path for path in sorted(self._node_reference_paths(), key=len, reverse=True)
             if property_path.startswith(f"{path}/")),
            None,
        )
        if node_path is None:
            raise KeyError(f"Unknown node in property path: {property_path}")
        members = property_path[len(node_path) + 1 :].split("/")
        if any(not member or member.startswith("_") for member in members):
            raise ValueError(f"Invalid property path: {property_path}")

        target = self._node(node_path)
        for member in members[:-1]:
            target = getattr(target, member)
        return target, members[-1]

    def _node_reference_paths(self) -> set[str]:
        return set(self._nodes) | {self._stable_node_ref(path) for path in self._nodes}

    def _stable_node_ref(self, path: str) -> str:
        return f"node/id/{self._node_ids_by_path[path]}"

    def _path_for_node(self, node: object) -> str:
        return next(path for path, known in self._nodes.items() if self._same_node(known, node))

    @staticmethod
    def _same_node(left: object, right: object) -> bool:
        if left is right:
            return True
        try:
            return bool(left.Equals(right))
        except Exception:
            return left == right

    @staticmethod
    def _validate_json_value(value: Any) -> None:
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("Setting values must be finite")
        if isinstance(value, dict):
            for child in value.values():
                EffectSession._validate_json_value(child)
        elif isinstance(value, list):
            for child in value:
                EffectSession._validate_json_value(child)
        elif not isinstance(value, (str, int, float, bool, type(None))):
            raise ValueError("Settings must contain JSON values")

    @staticmethod
    def _validate_curve_keys(keys: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not isinstance(keys, list):
            raise ValueError("Curve keys must be a list")
        normalized: list[dict[str, Any]] = []
        frames: set[int] = set()
        for data in keys:
            if not isinstance(data, dict) or "frame" not in data or "value" not in data:
                raise ValueError("Each curve key needs frame and value")
            frame = data["frame"]
            value = data["value"]
            if isinstance(frame, bool) or not isinstance(frame, int) or frame < 0:
                raise ValueError("Curve frames must be nonnegative integers")
            if frame in frames:
                raise ValueError(f"Duplicate curve frame: {frame}")
            frames.add(frame)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
                raise ValueError("Curve values must be finite numbers")
            item: dict[str, Any] = {"frame": frame, "value": value}
            for side in ("left", "right"):
                if side in data:
                    tangent = data[side]
                    if (not isinstance(tangent, (list, tuple)) or len(tangent) != 2
                            or any(isinstance(part, bool) or not isinstance(part, (int, float))
                                   or not math.isfinite(float(part)) for part in tangent)):
                        raise ValueError(f"Curve {side} tangent must contain two finite numbers")
                    item[side] = list(tangent)
            if "interpolation" in data:
                interpolation = data["interpolation"]
                if isinstance(interpolation, bool) or not isinstance(interpolation, int):
                    raise ValueError("Curve interpolation must be an integer")
                item["interpolation"] = interpolation
            normalized.append(item)
        return sorted(normalized, key=lambda item: item["frame"])

    @staticmethod
    def _curve_key_data(key: object) -> dict[str, Any]:
        return {
            "frame": int(key.Frame), "value": float(key.Value),
            "left": [float(key.LeftX), float(key.LeftY)],
            "right": [float(key.RightX), float(key.RightY)],
            "interpolation": int(key.InterpolationType),
        }

    def _object_at_path(self, property_path: str) -> object:
        target, member = self._property_parent(property_path)
        return getattr(target, member)

    def _assign_value(self, target: object, value: Any) -> None:
        """Write scalar values through nested Core editable-value wrappers."""
        if hasattr(target, "SetValue"):
            target.SetValue(value)
            return
        property_info = target.GetType().GetProperty("Value")
        if property_info is None or not property_info.CanWrite:
            raise ValueError(f"Value is not writable on {target.GetType().FullName}")
        try:
            target.Value = value
        except TypeError:
            self._assign_value(target.Value, value)

    def _as_python(self, value: Any) -> Any:
        if value is None or isinstance(value, (bool, int, float, str)):
            return value
        property_info = value.GetType().GetProperty("Value")
        if property_info is not None and property_info.CanRead:
            return self._as_python(value.Value)
        return str(value)
