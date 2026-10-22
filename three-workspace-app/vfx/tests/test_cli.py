import pytest


def test_cli_exposes_only_the_portable_effect_bridge_commands() -> None:
    from effekseer_ai.cli import build_parser

    parser = build_parser()
    command_parser = next(
        action for action in parser._actions if action.dest == "command"
    )
    commands = set(command_parser.choices)

    assert {"new", "open", "save", "export", "node-list", "node-add"} <= commands
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
