# App 4 V2 report: EffectIR dump and Snowstorm conversion

## Changes

- Added `effect-dump` CLI to read a `.efkefc` with the existing Effekseer Core session and write versioned EffectIR v1 JSON. It preserves discovered public properties and stable node IDs. Unknown renderer types are marked unsupported so the converter blocks them rather than guessing.
- Added the documented EffectIR contract and a pure-Python EffectIR-to-BBS FS 2.7 Snowstorm converter. Reports include per-property `OK` / `APPROX` / `BLOCKED` / `WARNING` entries, 60 fps to seconds conversion quantized to 1/20 second, blocked-node behavior, and the Add-to-alpha fallback with the exact 2.0 brightness multiplier.
- Added hand-authored JSON fixtures for glow-ring explosion, ice sword ribbon, and looping aura. The ribbon fixture is blocked with a sprite-billboard alternative; no scheme is written unless `--allow-partial` is explicit.
- Output files are replaced atomically, and a rerun removes schemes listed in the prior converter report without deleting unrelated files.

## Synthetic measurements

- Glow-ring explosion: 3 input nodes (one group, two drawable sprites), 2 Snowstorm schemes; 3 source frames at 60 fps become 0.05 s and 20 spawns/s. Add fallback output records `particles_blend`, brightness boost `2.0`, and the clamped output tint.
- Ice sword trail: 2 input nodes (one group, one ribbon); default conversion status `BLOCKED`, 0 schemes, with a short-lived oriented-sprite suggestion.
- Looping aura: 2 input nodes (one group, one drawable sprite), 1 scheme; continuous rate 20/s, looping emitter lifetime, particle lifetime range `math.random(0.4, 0.6)` after 20 Hz endpoint quantization (reported `APPROX`), and Add fallback boost `2.0`.
- These are deterministic fixture outputs, not measured Effekseer/BBS runtime visual equivalence.

## Gates

| Gate | Status | Result / rerun command |
| --- | --- | --- |
| VFX Python unit suite | PASS | `python -m pytest -q` from `three-workspace-app/vfx`: 26 passed, 1 skipped, 0 failed. The skip is the integration test below. |
| GitHub Actions `test` workflow | NOT_RUN | CI status is unverified for this report update; check PR #50's current run before review. |
| Integration using Effekseer Core DLL | NOT_RUN | `EFFEKSEER_AI_BIN_DIR` and an actual `.efkefc` sample are unavailable here. On Windows: `$env:EFFEKSEER_AI_BIN_DIR='C:\\path\\to\\Effekseer\\Tool\\bin'; python -m pytest -m integration -q`; then `effekseer-ai effect-dump .\\effect.efkefc .\\effect-ir.json`. |
| BBS FS 2.7 runtime | NOT_RUN | Requires the real game/runtime. On the Windows review machine, install the generated schemes and exercise them in BBS FS 2.7; do not treat schema conversion as a runtime pass. |
| Compile and whitespace | PASS | `python -m compileall -q src tests`; `git diff --check`. |
| Repository-root Python collection | FAIL | `python -m pytest -q` at repository root collects 10 unrelated `three-workspace-app/agent` tests as top-level modules and fails their relative imports. The scoped VFX suite above passes; no out-of-scope files were changed. |

## Dependency

V2b conversion can be reviewed independently of V1. V2a's `effect-dump` uses the stable IDs from V1, so this branch is stacked on PR #49 (`ai1/v1-core`) and its base is that branch. PR #50 should be reviewed after PR #49; no merge was performed. Real Core field mappings remain gated on testing with the official Windows DLL.
