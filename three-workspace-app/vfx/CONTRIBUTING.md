# Contributing

Thank you for contributing to Effekseer AI.

## Scope

Keep changes focused on the local Python bridge to the official EffekseerCore API. Do not add Effekseer binaries, official samples, generated effects, private assets, credentials, machine-specific paths, or client-specific configuration files.

## Development setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
python -m pytest
```

## Pull requests

- Add or update tests for behavior changes.
- Keep public text in English and add corresponding Simplified Chinese documentation when user-facing behavior changes.
- Do not rely on a hard-coded local Effekseer installation path. Use `EFFEKSEER_AI_BIN_DIR`.
- Mark tests that require a real `EffekseerCore.dll` as `integration`.
- Confirm that `git status --ignored --short` does not reveal accidental local effects, caches, or secrets before opening a pull request.
