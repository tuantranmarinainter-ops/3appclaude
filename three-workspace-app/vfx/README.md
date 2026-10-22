# Effekseer AI

[简体中文](README.zh-CN.md) | English

Effekseer AI is an open-source Python CLI and [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for creating and editing [Effekseer](https://effekseer.github.io/) effects with AI agents. It uses the official `EffekseerCore.dll` API to work with `.efkefc` effect documents and export runtime `.efk` files.

> **Compatibility:** this release is verified with **Effekseer 1.80.6 for Windows**. The Effekseer application, `EffekseerCore.dll`, samples, and assets are not included in this repository. See [Compatibility](docs/compatibility.md).

## What it does

- Create, open, save, and export `.efkefc` effects.
- Add, rename, move, and remove effect nodes.
- Discover and edit Core properties through stable `node/...` paths.
- Read and update editor-panel settings and scalar curve keyframes.
- Import image assets into an effect-local `resources/` directory using relative paths.
- Serve the same operations to MCP-compatible AI clients over stdio.

## What it does not do

- It does not bundle, patch, automate, or control the Effekseer GUI.
- It does not parse or rewrite the `.efkefc` binary format directly.
- It does not ship Effekseer DLLs, official samples, model converters, generated effects, or private project assets.
- It does not support Effekseer versions other than 1.80.6 as a verified configuration.

## Requirements

- Windows 10 or later
- Python 3.11 or later
- [.NET 9 Runtime](https://dotnet.microsoft.com/download/dotnet/9.0)
- Official Effekseer **1.80.6** Windows distribution

The selected Effekseer installation must contain `Tool/bin/EffekseerCore.dll`.

## Installation

Clone the repository and install it into a virtual environment:

```powershell
git clone https://github.com/laodeng000/effekseer-ai.git
cd effekseer-ai
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

Point the bridge at your own Effekseer 1.80.6 `Tool/bin` directory for the current terminal session:

```powershell
$env:EFFEKSEER_AI_BIN_DIR = '<Effekseer-install>/Tool/bin'
```

`EFFEKSEER_AI_BIN_DIR` is required. The project deliberately never searches local drives for an installation.

## CLI quick start

Create an effect, add a node, inspect settings, and export the runtime file:

```powershell
effekseer-ai new .\effects\spark.efkefc
effekseer-ai node-add .\effects\spark.efkefc --name Spark
effekseer-ai settings-list .\effects\spark.efkefc node/root/0
effekseer-ai export .\effects\spark.efkefc .\effects\spark.efk
```

Use `property-list` or `settings-list` before writing a value. This prevents an AI client from guessing editor-specific property paths.

```powershell
effekseer-ai property-list .\effects\spark.efkefc node/root/0
effekseer-ai property-get .\effects\spark.efkefc '<property-path>'
effekseer-ai property-set .\effects\spark.efkefc '<property-path>' '0.5'
```

All CLI results are JSON printed to standard output, which makes the commands suitable for scripts and agent tools.
`node-list` includes a stable `id` (`node/id/<uuid>`) alongside each display path. Use the ID when referring to a node across delete/move operations in the same session. `image-import` stores resources by SHA-256 and records source names in `resources/manifest.json`. Saving over an existing effect keeps one `.bak` file; `edit-undo <effect.efkefc>` restores that prior saved version once.

### CLI commands

| Group | Commands |
| --- | --- |
| Document | `new`, `open`, `save`, `export`, `edit-undo` |
| Nodes | `node-list`, `node-add`, `node-rename`, `node-remove`, `node-move` |
| Properties | `property-list`, `property-get`, `property-set` |
| Resources | `image-import` |
| Editor data | `settings-list`, `settings-set`, `curve-list`, `curve-set` |

Run `effekseer-ai --help` or `effekseer-ai <command> --help` for arguments and JSON input formats.

### Convert EffectIR to BBS FS 2.7 Snowstorm

V2 accepts a versioned EffectIR JSON file and writes one scheme per drawable node plus `report.json`:

```powershell
effekseer-ai-ir-to-bbs .\effect-ir.json .\out
effekseer-ai-ir-to-bbs .\effect-ir.json .\out --allow-partial
```

By default, any `BLOCKED` node blocks all scheme output. `--allow-partial` writes only supported nodes and retains every blocker in the report. Time conversion, 20 Hz quantization, approximations, and the additive-to-alpha brightness fallback are recorded explicitly. See [`docs/VFX-IR-CONTRACT.md`](../../docs/VFX-IR-CONTRACT.md) for the IR shape. The converter is a structural approximation; BBS FS 2.7 in-game playback remains a separate gate.

## MCP server

After installation and environment configuration, start the stdio server:

```powershell
effekseer-ai-mcp
```

Configure your MCP client to launch `effekseer-ai-mcp` with the same `EFFEKSEER_AI_BIN_DIR` environment variable. The available tools are documented in [docs/mcp.md](docs/mcp.md). This repository does not track any client-specific `.codex`, IDE, or local configuration files.

## Development

```powershell
python -m pytest
python -m pip wheel . --no-deps --wheel-dir .\dist
```

The default tests do not require an Effekseer installation. Tests that exercise the official Core assembly must be explicitly marked as integration tests and configured with `EFFEKSEER_AI_BIN_DIR`.

## Privacy and security

Effekseer AI performs its document operations locally. It has no telemetry, analytics, account system, or network client. See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## License and third-party software

This bridge is licensed under the [MIT License](LICENSE). Effekseer is a separate project with its own license and distribution terms; install it from the official project and review its license before redistribution.

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.
