from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest

import effekseer_ai.session as session_module
from effekseer_ai.session import EffectSession


class Value:
    def __init__(self, value: str) -> None:
        self.Value = value

    def SetValue(self, value: str) -> None:
        self.Value = value


class Children:
    def __init__(self, owner: "Node") -> None:
        self.owner = owner
        self.items: list[Node] = []

    @property
    def Count(self) -> int:
        return len(self.items)

    def __getitem__(self, index: int) -> "Node":
        return self.items[index]


class Node:
    def __init__(self, name: str = "node") -> None:
        self.Name = Value(name)
        self.Children = Children(self)
        self.Parent: Node | None = None

    def AddChild(self, child: "Node | None" = None) -> "Node":
        result = child or Node()
        result.Parent = self
        self.Children.items.append(result)
        return result

    def RemoveChild(self, child: "Node") -> bool:
        self.Children.items.remove(child)
        child.Parent = None
        return True

    def HasNode(self, candidate: "Node", include_self: bool) -> bool:
        if include_self and candidate is self:
            return True
        return any(child is candidate or child.HasNode(candidate, True) for child in self.Children.items)


class FakeCore:
    def __init__(self) -> None:
        self.Root = Node("root")

    def SaveTo(self, path: str) -> None:
        Path(path).write_bytes(b"saved-new-state")

    def LoadFrom(self, path: str) -> bool:
        return Path(path).is_file()


def test_node_ids_survive_delete_and_move_between_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    core = FakeCore()
    monkeypatch.setattr(session_module, "load_core", lambda: core)
    session = EffectSession()
    first = session.add_node(name="first")
    second = session.add_node(name="second")
    second_id = next(row["id"] for row in session.node_list() if row["path"] == second)

    session.remove_node(first)
    assert session._node(second_id).Name.Value == "second"
    assert session._path_for_node(session._node(second_id)) == "node/root/0"

    left = session.add_node(name="left")
    right = session.add_node(name="right")
    child = session.add_node(left, "child")
    child_id = next(row["id"] for row in session.node_list() if row["path"] == child)
    new_path = session.move_node(child_id, right)
    assert new_path == f"{right}/0"
    assert session._node(child_id).Name.Value == "child"
    assert session._node_ids_by_path[new_path] == child_id.removeprefix("node/id/")


def test_settings_set_rolls_back_when_core_rejects_a_later_value() -> None:
    session = EffectSession.__new__(EffectSession)
    values = {"node/root/CommonValues/a": 1, "node/root/CommonValues/b": 2}

    def get(path: str) -> int:
        return values[path]

    def set_value(path: str, value: int) -> None:
        if value == 99:
            raise ValueError("mock Core rejected value")
        values[path] = value

    session.property_get = get  # type: ignore[method-assign]
    session.property_set = set_value  # type: ignore[method-assign]
    with pytest.raises(ValueError, match="mock Core"):
        session.settings_set("node/root", "basic", {"a": 10, "b": 99})
    assert values == {"node/root/CommonValues/a": 1, "node/root/CommonValues/b": 2}


def test_settings_set_validates_entire_batch_before_first_write() -> None:
    session = EffectSession.__new__(EffectSession)
    values = {"node/root/CommonValues/a": 1}
    writes: list[tuple[str, object]] = []
    session.property_get = lambda path: values[path]  # type: ignore[method-assign]

    def set_value(path: str, value: object) -> None:
        writes.append((path, value))

    session.property_set = set_value  # type: ignore[method-assign]
    with pytest.raises(ValueError, match="Invalid setting field"):
        session.settings_set("node/root", "basic", {"a": 2, "../escape": 3})
    assert writes == []


def test_curve_set_rejects_invalid_keys_without_touching_core() -> None:
    session = EffectSession.__new__(EffectSession)

    class Curve:
        Keys = [object()]

    curve = Curve()
    session._object_at_path = lambda _: curve  # type: ignore[method-assign]
    with pytest.raises(ValueError, match="Duplicate curve frame"):
        session.curve_set_keys("node/root/curve", [{"frame": 1, "value": 1}, {"frame": 1, "value": 2}])
    assert len(curve.Keys) == 1


def test_curve_set_rolls_back_if_core_fails_while_adding_keys() -> None:
    session = EffectSession.__new__(EffectSession)

    class Key:
        def __init__(self, frame: int, value: float) -> None:
            self.Frame = frame
            self.Value = value
            self.LeftX = self.LeftY = self.RightX = self.RightY = 0.0
            self.InterpolationType = 0

    class Curve:
        def __init__(self) -> None:
            self.Keys = [Key(0, 5)]

        def RemoveKey(self, key: Key) -> None:
            self.Keys.remove(key)

        def AddKey(self, key: Key) -> None:
            if key.Frame == 2:
                raise RuntimeError("mock Core failed")
            self.Keys.append(key)

    curve = Curve()
    session._object_at_path = lambda _: curve  # type: ignore[method-assign]
    session._new_curve_key = lambda _curve, data: Key(data["frame"], data["value"])  # type: ignore[method-assign]
    with pytest.raises(RuntimeError, match="mock Core"):
        session.curve_set_keys("node/root/curve", [{"frame": 1, "value": 10}, {"frame": 2, "value": 20}])
    assert [(key.Frame, key.Value) for key in curve.Keys] == [(0, 5)]


def test_import_image_uses_hash_paths_and_records_both_same_named_assets(tmp_path: Path) -> None:
    effect = tmp_path / "effect.efkefc"
    effect.touch()
    session = EffectSession.__new__(EffectSession)
    session.path = effect
    first = tmp_path / "one" / "spark.png"
    second = tmp_path / "two" / "spark.png"
    first.parent.mkdir()
    second.parent.mkdir()
    first.write_bytes(b"image-a")
    second.write_bytes(b"image-b")

    first_ref = session.import_image(first)
    second_ref = session.import_image(second)
    manifest = json.loads((tmp_path / "resources" / "manifest.json").read_text(encoding="utf-8"))
    assert first_ref != second_ref
    assert len(manifest["assets"]) == 2
    assert {asset["sha256"] for asset in manifest["assets"]} == {
        hashlib.sha256(b"image-a").hexdigest(), hashlib.sha256(b"image-b").hexdigest()
    }
    assert (tmp_path / first_ref).read_bytes() == b"image-a"
    assert (tmp_path / second_ref).read_bytes() == b"image-b"


def test_save_backup_supports_exactly_one_undo(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    core = FakeCore()
    monkeypatch.setattr(session_module, "load_core", lambda: core)
    path = tmp_path / "effect.efkefc"
    path.write_bytes(b"saved-old-state")
    session = EffectSession.__new__(EffectSession)
    session.path = path
    session._nodes = {}
    session._node_ids_by_path = {}
    session._undo_path = None

    session.save()
    assert path.read_bytes() == b"saved-new-state"
    assert path.with_suffix(".efkefc.bak").read_bytes() == b"saved-old-state"
    session.edit_undo()
    assert path.read_bytes() == b"saved-old-state"
    with pytest.raises(ValueError, match="No saved edit"):
        session.edit_undo()


@pytest.mark.integration
def test_effekseer_core_document_roundtrip_when_configured(tmp_path: Path) -> None:
    if not os.environ.get("EFFEKSEER_AI_BIN_DIR") or not os.environ.get("EFFEKSEER_AI_SAMPLE_DIR"):
        pytest.skip("Set both EFFEKSEER_AI_BIN_DIR and EFFEKSEER_AI_SAMPLE_DIR to run the Effekseer Core integration gate")
    from effekseer_ai.session import EffectSession

    path = tmp_path / "core-roundtrip.efkefc"
    created = EffectSession.new()
    created.add_node(name="V1Integration")
    created.save(path)
    reopened = EffectSession.open(path)
    assert any(node["name"] == "V1Integration" for node in reopened.node_list())

