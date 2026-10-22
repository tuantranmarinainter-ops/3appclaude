# App 4 V2 report: EffectIR dump and Snowstorm conversion

## Changes

- Added `effect-dump` CLI to read Effekseer Core 1.80.6 fields at their parent paths, including `DrawingValues/Type` and `RendererCommonValues/AlphaBlend`; each mapped field records its exact `sourcePaths` entry. Unmapped renderer enums are explicitly `unsupported`, never `unknown`.
- Added the documented EffectIR contract and a pure-Python EffectIR-to-BBS FS 2.7 Snowstorm converter. Reports include per-property `OK` / `APPROX` / `BLOCKED` / `WARNING` entries. Effekseer generation time uses 60 fps source frames without 20 Hz interval rounding; bursts shorter than one BBS tick use `emitter_rate_instant` to retain their particle count. Add uses the approved option 2: luminance alpha, a white-core transform, and a halo layer before the core. Schemes reference derived core/halo texture paths; V3 packages the generated textures. Each warning is coded `ADD_BLEND_APPROXIMATED` and records all coefficients. CLI options tune alpha scale, core exponent, halo size, halo alpha, and halo color boost.
- Core value dump reads active mode values with `property_get` on parent paths and retains every active value and its `sourcePaths`; absent active values are listed as unsupported rather than silently becoming zero/unit/white. This cloud run does not have Effekseer Core DLLs to validate all real Core mode paths.
- Random `life.min`–`life.max` ranges are retained as `math.random(quantizedMin, quantizedMax)` in `particle_lifetime_expression.max_lifetime`; quantization is reported as `APPROX`. Malformed endpoints are reported `BLOCKED` with no conversion exception.
- Core scalar vector/color leaves are read individually. Effekseer 1.80.6 source tag `1806` (commit `93dd29c`) defines `LocationValues/{Fixed, PVA, Easing}`, `ScaleValues/{Fixed, PVA, Easing, SinglePVA, SingleEasing}`, scalar X/Y/Z values, and Center/Amplitude or Min/Max random values. Source: [Effekseer 1806 LocationValues.cs](https://github.com/effekseer/Effekseer/blob/93dd29c/Dev/Editor/EffekseerCore/Data/LocationValues.cs), [ScaleValues.cs](https://github.com/effekseer/Effekseer/blob/93dd29c/Dev/Editor/EffekseerCore/Data/ScaleValues.cs), [FloatWithRandom.cs](https://github.com/effekseer/Effekseer/blob/93dd29c/Dev/Editor/EffekseerCore/Data/Value/FloatWithRandom.cs). Core package calls now query each scalar parent (`.../X/Center`, etc.) instead of coercing a vector object. Real sample-path validation remains an integration gate.
- PVA motion uses `particle_age * sourceFps` because Effekseer velocity and acceleration are per source frame. Easing size/location uses `math.lerp(start,end,math.clamp(particle_age/particle_lifetime,0,1))`; random endpoints use stable `variable.particle_random_1..4`. SinglePVA and SingleEasing scale share one expression across both billboard dimensions. AllColor Random maps its range to a Snowstorm gradient with one stable interpolant and is marked `APPROX` because the channels are correlated; non-static random Easing endpoints are explicitly blocked. Rotation maps Euler Z to billboard spin and reports X/Y loss as `APPROX`.
- Added hand-authored JSON fixtures for glow-ring explosion, ice sword ribbon, and looping aura. The ribbon fixture is blocked with a sprite-billboard alternative; no scheme is written unless `--allow-partial` is explicit.
- Output files are replaced atomically, and a rerun removes schemes listed in the prior converter report without deleting unrelated files.

## Synthetic measurements

- Glow-ring explosion: 3 input nodes (one group, two drawable sprites), 3 Snowstorm schemes (one non-Add plus Add halo and core); 3 source frames at 60 fps become 0.05 s and 20 spawns/s. Add report records luminance weights 0.2126/0.7152/0.0722, core exponent 1.5, halo size 1.9×, alpha 0.55×, RGB boost 0.25, and `particles_blend` draw order halo then core.
- Ice sword trail: 2 input nodes (one group, one ribbon); default conversion status `BLOCKED`, 0 schemes, with a short-lived oriented-sprite suggestion.
- Looping aura: 2 input nodes (one group, one drawable sprite), 2 schemes (halo then core); continuous rate 20/s, looping emitter lifetime, particle lifetime range `math.random(0.4, 0.6)` after 20 Hz endpoint quantization (reported `APPROX`).
- These are deterministic fixture outputs, not measured Effekseer/BBS runtime visual equivalence.

## Review 2 image gate

| Sample / time | Effekseer bright pixels / bbox / mean RGB | Converted bright pixels / bbox / mean RGB | Gate |
| --- | --- | --- | --- |
| Simple_Sprite_BillBoard / 0.25 s | NOT_RUN | NOT_RUN | NOT_RUN |
| Simple_Sprite_BillBoard / 0.50 s | NOT_RUN | NOT_RUN | NOT_RUN |
| Simple_Sprite_BillBoard / 1.00 s | NOT_RUN | NOT_RUN | NOT_RUN |
| Simple_SpawnMethod1 / 0.25, 0.50, 1.00 s | NOT_RUN | NOT_RUN | NOT_RUN |
| Simple_Turbulence_Particles / 0.25, 0.50, 1.00 s | NOT_RUN | NOT_RUN | NOT_RUN |
| Laser01 / 0.25, 0.50, 1.00 s | NOT_RUN | NOT_RUN | NOT_RUN |

No Effekseer DLL or official sample directory is mounted in this cloud environment, so no pixel measurements are claimed. The Windows gate must use one fixed 512×512 camera, distance, angles, background, and world scale for both renderers (no per-image auto-fit). It records pixels differing from background by >8/channel, their bounding box, and mean RGB over those pixels. Fail if converted bbox width or height is below 50% of Effekseer, or mean RGB Euclidean distance exceeds 40/255. The synthetic BBS preview is only a simulation and cannot establish BBS runtime equivalence.

PowerShell rerun on the Windows Effekseer 1.80.6 machine (from `three-workspace-app/vfx`):

```powershell
$env:EFFEKSEER_AI_BIN_DIR='C:\path\to\Effekseer\Tool\bin'
$env:EFFEKSEER_AI_SAMPLE_DIR='C:\path\to\Effekseer\Sample\00_Basic'
python -m pytest -m integration -q
```

The `test_four_official_effects_match_fixed_frame_visual_gate` integration test runs `tools/render_preview.py` for all four named samples at frames 15/30/60, dumps and converts each effect, runs the offline Snowstorm simulation at 0.25/0.5/1s, measures bright pixels/bbox/mean RGB, writes a table to `docs/VFX-REPORT-V2-IMAGE-GATE.md`, and asserts the gates. Both use fixed 512×512 output, background 20,20,24, distance 15, angles 20/30, and no per-image auto-fit. The converted renderer uses a fixed orthographic 8-world-unit camera as an explicit projection approximation to Effekseer's perspective viewer; the comparison is a heuristic screen-space gate, not a claim of camera equivalence or BBS runtime correctness.

## Gates

| Gate | Status | Result / rerun command |
| --- | --- | --- |
| VFX Python unit suite | PASS | From `three-workspace-app/vfx`, install dev tools with `python -m pip install -e ".[dev]"`, then run `PYTHONPATH=src python -m pytest -q` (PowerShell: `$env:PYTHONPATH='src'; python -m pytest -q`): 39 passed, 3 skipped, 0 failed. Skips require the Core DLL and official sample directory. |
| GitHub Actions `test` workflow | NOT_RUN | CI status is unverified for this report update; check PR #50's current run before review. |
| Integration using Effekseer Core DLL and official samples | NOT_RUN | Neither input is available here. On Windows: `$env:EFFEKSEER_AI_BIN_DIR='C:\\path\\to\\Effekseer\\Tool\\bin'; $env:EFFEKSEER_AI_SAMPLE_DIR='C:\\path\\to\\Effekseer\\Sample\\00_Basic'; python -m pytest -m integration -q` from `three-workspace-app/vfx`. Integration checks that Simple_Sprite_BillBoard and Simple_SpawnMethod1 export schemes, while Simple_Ribbon_Sword, Simple_Ring_Shape1, and Simple_Distortion block. |
| BBS FS 2.7 runtime | NOT_RUN | Requires the real game/runtime. On the Windows review machine, install the generated schemes and exercise them in BBS FS 2.7; do not treat schema conversion as a runtime pass. |
| Review 2 image comparison | NOT_RUN | Automated pytest gate is present but skipped here because the Core DLL and samples are not mounted. It will write metric rows and fail below the 50% bbox width/height or above RGB mean distance 40/255 on Windows. No image metrics are available in cloud. |
| Compile and whitespace | PASS | `python -m compileall -q src tests`; `git diff --check`. |
| Repository-root Python collection | FAIL | `python -m pytest -q` at repository root collects 10 unrelated `three-workspace-app/agent` tests as top-level modules and fails their relative imports. The scoped VFX suite above passes; no out-of-scope files were changed. |

## Dependency

V2b conversion is independent of V1. V2a uses V1 stable IDs; PR #49 has merged to main, and PR #50 is based on main. Official Core path behavior remains gated on the Windows integration run above. PR #50 remains unmerged.
