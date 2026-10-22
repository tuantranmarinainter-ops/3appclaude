"""Stdio MCP server exposing the portable EffekseerCore bridge."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

from .session import EffectSession
from .bbs_package import build_bbs_package


class DocumentService:
    """Own the one Effekseer document loaded by an MCP server process."""

    def __init__(self) -> None:
        self.session: EffectSession | None = None

    def require(self) -> EffectSession:
        if self.session is None:
            raise RuntimeError("Open or create an effect first")
        return self.session

    def new(self, path: str) -> dict[str, Any]:
        self.session = EffectSession.new()
        self.session.save(path)
        return self.session.summary()

    def open(self, path: str) -> dict[str, Any]:
        self.session = EffectSession.open(path)
        return self.session.summary()


def create_server() -> FastMCP:
    """Create the MCP server without starting stdio, so it is testable."""
    server = FastMCP("Effekseer AI")
    documents = DocumentService()

    @server.tool()
    def effect_new(path: str) -> dict[str, Any]:
        """Create and save a new .efkefc effect."""
        return documents.new(path)

    @server.tool()
    def effect_open(path: str) -> dict[str, Any]:
        """Open an existing .efkefc effect."""
        return documents.open(path)

    @server.tool()
    def effect_save(path: str | None = None) -> dict[str, Any]:
        """Save the current effect, optionally under a new path."""
        session = documents.require()
        session.save(path)
        return session.summary()

    @server.tool()
    def edit_undo() -> dict[str, str]:
        """Restore the last saved document backup, if one exists."""
        return {"path": str(documents.require().edit_undo())}

    @server.tool()
    def bbs_package(effect_ir_path: str, output_zip: str, assets_root: str = ".", allow_partial: bool = False) -> dict[str, Any]:
        """Package an EffectIR JSON file as a BBS FS 2.7 resource ZIP."""
        import json

        effect_ir = json.loads(Path(effect_ir_path).read_text(encoding="utf-8"))
        return build_bbs_package(effect_ir, output_zip, assets_root, allow_partial)

    @server.tool()
    def effect_export(path: str, magnification: float = 1.0) -> dict[str, str]:
        """Export the current effect to the runtime .efk format."""
        return {"path": str(documents.require().export(path, magnification))}

    @server.tool()
    def node_list() -> list[dict[str, Any]]:
        """List node paths, names, and child counts."""
        return documents.require().node_list()

    @server.tool()
    def node_add(parent_path: str = "node/root", name: str | None = None) -> dict[str, str]:
        """Add a node and return its path."""
        return {"path": documents.require().add_node(parent_path, name)}

    @server.tool()
    def node_rename(node_path: str, name: str) -> dict[str, str]:
        """Rename a node."""
        documents.require().rename_node(node_path, name)
        return {"path": node_path}

    @server.tool()
    def node_remove(node_path: str) -> dict[str, str]:
        """Remove a node and all of its descendants."""
        documents.require().remove_node(node_path)
        return {"removed": node_path}

    @server.tool()
    def node_move(node_path: str, parent_path: str) -> dict[str, str]:
        """Move a node and return its new structural path."""
        return {"path": documents.require().move_node(node_path, parent_path)}

    @server.tool()
    def property_list(node_path: str) -> list[str]:
        """List editable property paths for a node."""
        return documents.require().property_list(node_path)

    @server.tool()
    def property_get(property_path: str) -> Any:
        """Read an editable value through node/... path notation."""
        return documents.require().property_get(property_path)

    @server.tool()
    def property_set(property_path: str, value: Any) -> dict[str, Any]:
        """Set an editable Core value through a property path."""
        session = documents.require()
        session.property_set(property_path, value)
        return {"value": session.property_get(property_path)}

    @server.tool()
    def asset_import_image(source: str, property_path: str | None = None) -> dict[str, str]:
        """Copy an image into resources/ and optionally bind it to a Core path."""
        return {"path": documents.require().import_image(Path(source), property_path)}

    @server.tool()
    def settings_list(node_path: str) -> dict[str, dict[str, object]]:
        """List editor setting panels and their editable fields for a node."""
        return documents.require().settings_list(node_path)

    @server.tool()
    def settings_set(node_path: str, panel: str, values: dict[str, Any]) -> dict[str, str]:
        """Set multiple fields in one editor settings panel."""
        documents.require().settings_set(node_path, panel, values)
        return {"panel": panel}

    @server.tool()
    def curve_list(curve_path: str) -> list[dict[str, float | int]]:
        """Read scalar curve keyframes as JSON-friendly data."""
        return documents.require().curve_keys(curve_path)

    @server.tool()
    def curve_set(curve_path: str, keys: list[dict[str, float | int]]) -> dict[str, str]:
        """Replace scalar curve keyframes with frame/value data."""
        documents.require().curve_set_keys(curve_path, keys)
        return {"curve": curve_path}

    return server


def main() -> None:
    create_server().run(transport="stdio")


if __name__ == "__main__":
    main()
