import pytest


def test_cli_exposes_only_the_portable_effect_bridge_commands() -> None:
    from effekseer_ai.cli import build_parser

    parser = build_parser()
    command_parser = next(
        action for action in parser._actions if action.dest == "command"
    )
    commands = set(command_parser.choices)

    assert {"new", "open", "save", "export", "node-list", "node-add", "edit-undo"} <= commands
    assert not {
        "generate",
        "model-convert",
        "model-import",
        "experience-record",
        "experience-search",
        "experience-brief",
    } & commands


def test_cli_rejects_removed_recipe_commands() -> None:
    from effekseer_ai.cli import build_parser

    with pytest.raises(SystemExit):
        build_parser().parse_args(["generate", "black-hole", "effect.efkefc"])


def test_mcp_preserves_existing_tools_and_adds_one_step_undo() -> None:
    from effekseer_ai.mcp_server import create_server

    names = {tool.name for tool in create_server()._tool_manager.list_tools()}
    assert names == {
        "effect_new", "effect_open", "effect_save", "effect_export",
        "node_list", "node_add", "node_rename", "node_remove", "node_move",
        "property_list", "property_get", "property_set", "asset_import_image",
        "settings_list", "settings_set", "curve_list", "curve_set", "edit_undo",
    }
