# App 4 V2 report: EffectIR dump and Snowstorm conversion

## Changes

- Added `effect-dump` CLI to read Effekseer Core 1.80.6 fields at their parent paths, including `DrawingValues/Type` and `RendererCommonValues/AlphaBlend`; each mapped field records its exact `sourcePaths` entry. Unmapped renderer enums are explicitly `unsupported`, never `unknown`.
- Added the documented EffectIR contract and a pure-Python EffectIR-to-BBS FS 2.7 Snowstorm converter. Reports include per-property `OK` / `APPROX` / `BLOCKED` / `WARNING` entries, 60 fps to seconds conversion quantized to 1/20 second, and blocked-node behavior. Add uses the approved option 2: luminance alpha, a white-core transform, and a halo layer before the core. Schemes reference derived core/halo texture paths; V3 packages the generated textures. Each warning is coded `ADD_BLEND_APPROXIMATED` and records all coefficients. CLI options tune alpha scale, core exponent, halo size, halo alpha, and halo color boost.
- Random `life.min`–`life.max` ranges are retained as `math.random(quantizedMin, quantizedMax)` in `particle_lifetime_expression.max_lifetime`; quantization is reported as `APPROX`. Malformed endpoints are reported `BLOCKED` with no conversion exception.
- Added hand-authored JSON fixtures for glow-ring explosion, ice sword ribbon, and looping aura. The ribbon fixture is blocked with a sprite-billboard alternative; no scheme is written unless `--allow-partial` is explicit.
- Output files are replaced atomically, and a rerun removes schemes listed in the prior converter report without deleting unrelated files.

## Synthetic measurements

- Glow-ring explosion: 3 input nodes (one group, two drawable sprites), 3 Snowstorm schemes (one non-Add plus Add halo and core); 3 source frames at 60 fps become 0.05 s and 20 spawns/s. Add report records luminance weights 0.2126/0.7152/0.0722, core exponent 1.5, halo size 1.9×, alpha 0.55×, RGB boost 0.25, and `particles_blend` draw order halo then core.
- Ice sword trail: 2 input nodes (one group, one ribbon); default conversion status `BLOCKED`, 0 schemes, with a short-lived oriented-sprite suggestion.
- Looping aura: 2 input nodes (one group, one drawable sprite), 2 schemes (halo then core); continuous rate 20/s, looping emitter lifetime, particle lifetime range `math.random(0.4, 0.6)` after 20 Hz endpoint quantization (reported `APPROX`).
- These are deterministic fixture outputs, not measured Effekseer/BBS runtime visual equivalence.

## Gates

| Gate | Status | Result / rerun command |
| --- | --- | --- |
| VFX Python unit suite | PASS | `python -m pytest -q` from `three-workspace-app/vfx`: 30 passed, 2 skipped, 0 failed. Skips require the Core DLL and official sample directory. |
| GitHub Actions `test` workflow | NOT_RUN | CI status is unverified for this report update; check PR #50's current run before review. |
| Integration using Effekseer Core DLL and official samples | NOT_RUN | Neither input is available here. On Windows: `$env:EFFEKSEER_AI_BIN_DIR='C:\\path\\to\\Effekseer\\Tool\\bin'; $env:EFFEKSEER_AI_SAMPLE_DIR='C:\\path\\to\\Effekseer\\Sample\\00_Basic'; python -m pytest -m integration -q` from `three-workspace-app/vfx`. Integration checks that Simple_Sprite_BillBoard and Simple_SpawnMethod1 export schemes, while Simple_Ribbon_Sword, Simple_Ring_Shape1, and Simple_Distortion block. |
| BBS FS 2.7 runtime | NOT_RUN | Requires the real game/runtime. On the Windows review machine, install the generated schemes and exercise them in BBS FS 2.7; do not treat schema conversion as a runtime pass. |
| Compile and whitespace | PASS | `python -m compileall -q src tests`; `git diff --check`. |
| Repository-root Python collection | FAIL | `python -m pytest -q` at repository root collects 10 unrelated `three-workspace-app/agent` tests as top-level modules and fails their relative imports. The scoped VFX suite above passes; no out-of-scope files were changed. |

## Dependency

V2b conversion is independent of V1. V2a uses V1 stable IDs; PR #49 has merged to main, and PR #50 is based on main. Official Core path behavior remains gated on the Windows integration run above. PR #50 remains unmerged.
