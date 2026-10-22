# App 4 V3 report: BBS FS package

## Changes

- Added the `bbs-package` CLI and MCP `bbs_package` tool. Both consume EffectIR and use the same packaging implementation.
- Packages Snowstorm particle JSON under `config/bbs/assets/particles/<id>.json`, includes referenced texture files under `config/bbs/assets/`, and writes an EffectIR conversion report plus a package asset manifest. Add textures are transformed into core and halo PNGs (luminance alpha, normalized RGB, white-core mix); halo alpha is multiplied by 0.55, and each derived asset retains source credit and license metadata.
- External textures require `license` and `credit` entries in EffectIR `assets`; optional `source` paths must stay within `--assets-root`. The ZIP includes a generated `CREDITS.md` and usage notes for `ParticleForm` actor/bone attachments and pause/restart behavior.
- Blocked conversion creates no ZIP unless `--allow-partial` is explicit. ZIP creation is atomic. Existing MCP tools remain registered; V2's `effect-dump` and V1's `edit_undo` are preserved.
- Invalid package inputs return one JSON error object and exit code 2 from the CLI; they do not produce a traceback. Unit tests use transient synthetic PNGs in pytest temp directories; no binary asset is committed.

## Synthetic measurements

- Glow-ring fixture: 3 drawable schemes (one non-Add plus Add halo and core) and 2 licensed temporary source textures produced an 11-entry ZIP (3 particle JSON files, 3 texture files including derived core/halo, manifest, conversion report, credits, usage notes).
- Ice sword ribbon fixture: packaging status `BLOCKED`, with no output ZIP created in default mode.
- Asset traversal and missing license/credit metadata are rejected before writing a package.
- These results verify package structure only; they do not certify BBS FS runtime behavior.

## Gates

| Gate | Status | Result / rerun command |
| --- | --- | --- |
| VFX Python unit suite | PASS | From `three-workspace-app/vfx`, install test tools with `python -m pip install -e ".[dev]"`, then run `PYTHONPATH=src python -m pytest -q` (PowerShell: `$env:PYTHONPATH='src'; python -m pytest -q`): 36 passed, 2 skipped, 0 failed. Skips require Windows Core DLL and official sample directory. Includes CLI success/error paths and generated texture verification. |
| Integration using Effekseer Core DLL and official samples | NOT_RUN | On Windows set `$env:EFFEKSEER_AI_BIN_DIR='C:\\path\\to\\Effekseer\\Tool\\bin'` and `$env:EFFEKSEER_AI_SAMPLE_DIR='C:\\path\\to\\Effekseer\\Sample\\00_Basic'`, then run `python -m pytest -m integration -q` from `three-workspace-app/vfx`. |
| MCP tool inventory | PASS | Unit test checks all existing tools remain present and confirms the additive `bbs_package` tool. |
| GitHub Actions `test` workflow | NOT_RUN | The workflow is pending for the latest rebased head; check PR #51's current run before review. |
| BBS FS 2.7 runtime | NOT_RUN | Install the generated ZIP in an actual BBS FS 2.7 resource pack and exercise its particles on Windows. |
| Compile and whitespace | PASS | `python -m compileall -q src tests`; `git diff --check`. |

## Dependency

This PR is based on PR #50 (`ai1/v2-convert`), now based on main after V1 PR #49 merged. It consumes the V2b EffectIR converter. V3 depends on #50. No merge was performed.
