# App 4 V3 report: BBS FS package

## Changes

- Added the `bbs-package` CLI and MCP `bbs_package` tool. Both consume EffectIR and use the same packaging implementation.
- Packages Snowstorm particle JSON under `config/bbs/assets/particles/<id>.json`, includes referenced texture files under `config/bbs/assets/`, and writes an EffectIR conversion report plus a package asset manifest.
- External textures require `license` and `credit` entries in EffectIR `assets`; optional `source` paths must stay within `--assets-root`. The ZIP includes a generated `CREDITS.md` and usage notes for `ParticleForm` actor/bone attachments and pause/restart behavior.
- Blocked conversion creates no ZIP unless `--allow-partial` is explicit. ZIP creation is atomic. Existing MCP tools remain registered; V2's `effect-dump` and V1's `edit_undo` are preserved.
- Unit tests use transient synthetic texture bytes in pytest temp directories; no binary asset is committed.

## Synthetic measurements

- Glow-ring fixture: 2 drawable schemes + 2 licensed temporary texture inputs produced an 8-entry ZIP (2 particle JSON files, 2 textures, manifest, conversion report, credits, usage notes).
- Ice sword ribbon fixture: packaging status `BLOCKED`, with no output ZIP created in default mode.
- Asset traversal and missing license/credit metadata are rejected before writing a package.
- These results verify package structure only; they do not certify BBS FS runtime behavior.

## Gates

| Gate | Status | Result / rerun command |
| --- | --- | --- |
| VFX Python unit suite | PASS | `python -m pytest -q` from `three-workspace-app/vfx`: 33 passed, 1 skipped, 0 failed. The skip is the Core integration test. Includes an end-to-end CLI package invocation. |
| Integration using Effekseer Core DLL | NOT_RUN | Requires `EFFEKSEER_AI_BIN_DIR` and an actual Windows Effekseer installation. Run `python -m pytest -m integration -q` on the Windows review machine after configuring it. |
| MCP tool inventory | PASS | Unit test checks all existing tools remain present and confirms the additive `bbs_package` tool. |
| GitHub Actions `test` workflow | NOT_RUN | Run [39713527814](https://github.com/tuantranmarinainter-ops/3appclaude/actions/runs/39713527814) was `IN_PROGRESS` at the report snapshot; CI is unverified until completion. |
| BBS FS 2.7 runtime | NOT_RUN | Install the generated ZIP in an actual BBS FS 2.7 resource pack and exercise its particles on Windows. |
| Compile and whitespace | PASS | `python -m compileall -q src tests`; `git diff --check`. |

## Dependency

This PR is based on PR #50 (`ai1/v2-convert`), which is stacked on PR #49 (`ai1/v1-core`). It consumes the V2b EffectIR converter. The branch ancestry also includes V2a's Core dump because V2a and V2b share the V2 PR; review this stack after #49 and #50. No merge was performed.
