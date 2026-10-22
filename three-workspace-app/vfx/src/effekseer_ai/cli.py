"""Command-line operations for the portable EffekseerCore bridge."""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .session import EffectSession
from .effect_dump import write_effect_ir
from .preview import render_preview
from .bbs_package import build_bbs_package


def _emit(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, default=str))


def _open(path: str) -> EffectSession:
    return EffectSession.open(path)


def _new(args: argparse.Namespace) -> dict[str, Any]:
    session = EffectSession.new()
    session.save(args.path)
    return session.summary()


def _show(args: argparse.Namespace) -> dict[str, Any]:
    return _open(args.path).summary()


def _save(args: argparse.Namespace) -> dict[str, Any]:
    session = _open(args.source)
    session.save(args.destination)
    return session.summary()


def _edit_undo(args: argparse.Namespace) -> dict[str, str]:
    session = _open(args.effect)
    return {"path": str(session.edit_undo())}


def _effect_dump(args: argparse.Namespace) -> dict[str, str]:
    session = _open(args.effect)
    return {"path": str(write_effect_ir(session, args.output, args.name, args.fps))}


def _preview(args: argparse.Namespace) -> dict[str, Any]:
    effect_ir = json.loads(Path(args.effect_ir).read_text(encoding="utf-8"))
    timestamps = [float(part.strip()) for part in args.timestamps.split(",") if part.strip()]
    return render_preview(effect_ir, args.output_dir, timestamps, args.reference_dir, args.width, args.height)


def _bbs_package(args: argparse.Namespace) -> dict[str, Any]:
    effect_ir = json.loads(Path(args.effect_ir).read_text(encoding="utf-8"))
    options = {"alphaScale": args.add_alpha_scale, "coreExponent": args.add_core_exponent, "haloSize": args.add_halo_size, "haloAlpha": args.add_halo_alpha, "haloColorBoost": args.add_halo_color_boost}
    return build_bbs_package(effect_ir, args.output_zip, args.assets_root, args.allow_partial, options)


def _node_list(args: argparse.Namespace) -> list[dict[str, Any]]:
    return _open(args.effect).node_list()


def _node_add(args: argparse.Namespace) -> dict[str, str]:
    session = _open(args.effect)
    path = session.add_node(args.parent, args.name)
    session.save()
    return {"path": path}


def _node_rename(args: argparse.Namespace) -> dict[str, str]:
    session = _open(args.effect)
    session.rename_node(args.node_path, args.name)
    session.save()
    return {"path": args.node_path}


def _node_remove(args: argparse.Namespace) -> dict[str, str]:
    session = _open(args.effect)
    session.remove_node(args.node_path)
    session.save()
    return {"removed": args.node_path}


def _node_move(args: argparse.Namespace) -> dict[str, str]:
    session = _open(args.effect)
    path = session.move_node(args.node_path, args.parent_path)
    session.save()
    return {"path": path}


def _property_list(args: argparse.Namespace) -> list[str]:
    return _open(args.effect).property_list(args.node_path)


def _property_get(args: argparse.Namespace) -> Any:
    return _open(args.effect).property_get(args.property_path)


def _property_set(args: argparse.Namespace) -> dict[str, Any]:
    session = _open(args.effect)
    session.property_set(args.property_path, json.loads(args.value))
    session.save()
    return {"value": session.property_get(args.property_path)}


def _image_import(args: argparse.Namespace) -> dict[str, str]:
    session = _open(args.effect)
    path = session.import_image(args.source, args.property_path)
    session.save()
    return {"path": path}


def _export(args: argparse.Namespace) -> dict[str, str]:
    return {"path": str(_open(args.effect).export(args.path, args.magnification))}


def _settings_list(args: argparse.Namespace) -> dict[str, Any]:
    return _open(args.effect).settings_list(args.node_path)


def _settings_set(args: argparse.Namespace) -> dict[str, str]:
    session = _open(args.effect)
    session.settings_set(args.node_path, args.panel, json.loads(args.values))
    session.save()
    return {"panel": args.panel}


def _curve_list(args: argparse.Namespace) -> list[dict[str, float | int]]:
    return _open(args.effect).curve_keys(args.curve_path)


def _curve_set(args: argparse.Namespace) -> dict[str, str]:
    session = _open(args.effect)
    session.curve_set_keys(args.curve_path, json.loads(args.keys))
    session.save()
    return {"curve": args.curve_path}


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI parser without accessing an Effekseer installation."""
    parser = argparse.ArgumentParser(prog="effekseer-ai")
    commands = parser.add_subparsers(dest="command", required=True)

    def command(name: str, handler: Callable[[argparse.Namespace], Any]) -> argparse.ArgumentParser:
        subparser = commands.add_parser(name)
        subparser.set_defaults(handler=handler)
        return subparser

    command("new", _new).add_argument("path")
    command("open", _show).add_argument("path")
    save = command("save", _save)
    save.add_argument("source")
    save.add_argument("destination", nargs="?")
    undo = command("edit-undo", _edit_undo)
    undo.add_argument("effect")
    dump = command("effect-dump", _effect_dump)
    dump.add_argument("effect", help="Input .efkefc file")
    dump.add_argument("output", help="Destination EffectIR JSON file")
    dump.add_argument("--name")
    dump.add_argument("--fps", type=float, default=60)
    preview = command("preview", _preview)
    preview.add_argument("effect_ir", help="EffectIR JSON input")
    preview.add_argument("output_dir")
    preview.add_argument("--timestamps", default="0,0.25,0.5", help="Comma-separated timestamps in seconds")
    preview.add_argument("--reference-dir", help="Optional Effekseer reference PNG directory")
    preview.add_argument("--width", type=int, default=256)
    preview.add_argument("--height", type=int, default=256)

    package = command("bbs-package", _bbs_package)
    package.add_argument("effect_ir", help="EffectIR JSON input")
    package.add_argument("output_zip", help="Destination ZIP file")
    package.add_argument("--assets-root", default=".")
    package.add_argument("--allow-partial", action="store_true")
    package.add_argument("--add-alpha-scale", type=float, default=1.0)
    package.add_argument("--add-core-exponent", type=float, default=1.5)
    package.add_argument("--add-halo-size", type=float, default=1.9)
    package.add_argument("--add-halo-alpha", type=float, default=0.55)
    package.add_argument("--add-halo-color-boost", type=float, default=0.25)

    node_list = command("node-list", _node_list)
    node_list.add_argument("effect")
    node_add = command("node-add", _node_add)
    node_add.add_argument("effect")
    node_add.add_argument("--parent", default="node/root")
    node_add.add_argument("--name")
    node_rename = command("node-rename", _node_rename)
    node_rename.add_argument("effect")
    node_rename.add_argument("node_path")
    node_rename.add_argument("name")
    node_remove = command("node-remove", _node_remove)
    node_remove.add_argument("effect")
    node_remove.add_argument("node_path")
    node_move = command("node-move", _node_move)
    node_move.add_argument("effect")
    node_move.add_argument("node_path")
    node_move.add_argument("parent_path")

    property_list = command("property-list", _property_list)
    property_list.add_argument("effect")
    property_list.add_argument("node_path")
    property_get = command("property-get", _property_get)
    property_get.add_argument("effect")
    property_get.add_argument("property_path")
    property_set = command("property-set", _property_set)
    property_set.add_argument("effect")
    property_set.add_argument("property_path")
    property_set.add_argument("value", help="A JSON value")

    image_import = command("image-import", _image_import)
    image_import.add_argument("effect")
    image_import.add_argument("source")
    image_import.add_argument("--property-path")
    export = command("export", _export)
    export.add_argument("effect")
    export.add_argument("path")
    export.add_argument("--magnification", type=float, default=1.0)

    settings_list = command("settings-list", _settings_list)
    settings_list.add_argument("effect")
    settings_list.add_argument("node_path")
    settings_set = command("settings-set", _settings_set)
    settings_set.add_argument("effect")
    settings_set.add_argument("node_path")
    settings_set.add_argument("panel")
    settings_set.add_argument("values", help="A JSON object")
    curve_list = command("curve-list", _curve_list)
    curve_list.add_argument("effect")
    curve_list.add_argument("curve_path")
    curve_set = command("curve-set", _curve_set)
    curve_set.add_argument("effect")
    curve_set.add_argument("curve_path")
    curve_set.add_argument("keys", help="A JSON keyframe list")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = args.handler(args)
        _emit(result)
    except Exception as error:
        if args.command != "bbs-package":
            raise
        _emit({"status": "ERROR", "error": str(error)})
        return 2
    if args.command == "bbs-package" and result.get("status") == "BLOCKED":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
