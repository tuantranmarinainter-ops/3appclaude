from pathlib import Path

import pytest


def test_editor_bin_directory_requires_an_explicit_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A public release must never probe a contributor's local disks."""
    monkeypatch.delenv("EFFEKSEER_AI_BIN_DIR", raising=False)

    from effekseer_ai.runtime import editor_bin_directory

    with pytest.raises(RuntimeError, match="EFFEKSEER_AI_BIN_DIR"):
        editor_bin_directory()


def test_editor_bin_directory_uses_a_configured_core_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    core_directory = tmp_path / "Tool" / "bin"
    core_directory.mkdir(parents=True)
    (core_directory / "EffekseerCore.dll").touch()
    monkeypatch.setenv("EFFEKSEER_AI_BIN_DIR", str(core_directory))

    from effekseer_ai.runtime import editor_bin_directory

    assert editor_bin_directory() == core_directory
