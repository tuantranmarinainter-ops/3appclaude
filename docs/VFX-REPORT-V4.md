# App 4 V4 report: offline particle preview

## Changes

- Added `effekseer-ai preview` and `effekseer-ai-preview`, a local, deterministic PNG renderer for the Snowstorm subset produced by V2b. It performs no network access and writes a `preview-report.json` next to its images.
- Every result states `SIMULATION_ONLY`, marks actual BBS runtime `NOT_RUN`, and labels each PNG as not an Effekseer or BBS FS render. Unsupported/blocked conversions still produce timestamped blank status frames rather than suggesting the blocked feature rendered.
- Optional caller-supplied PNG references can be placed side by side with the simulation. Reports label provenance as unverified; the preview tool does not claim a reference is an Effekseer render or claim pixel equivalence.
- Uses only Python's standard library. Test-generated PNGs are temporary; no PNG assets are committed.

## Synthetic measurements

- The test exercised all three MVP fixtures (`glow-ring-explosion`, `ice-sword-trail`, `looping-aura`) at 0, 0.25, and 0.5 seconds: 9 timestamp PNGs total. Six frames used converted supported schemes; the three ice-ribbon frames are explicitly marked `BLOCKED`.
- Synthetic reference montage test: 80x80 simulation plus a 64x64 caller-supplied PNG yields a 144x80 side-by-side image. The reference is labeled synthetic/unverified.
- These are simulator measurements only. No actual Effekseer render or BBS FS game comparison was available.

## Gates

| Gate | Status | Result / rerun command |
| --- | --- | --- |
| VFX Python unit suite | PASS | `python -m pytest -q` from `three-workspace-app/vfx`: 28 passed, 1 skipped, 0 failed. The skip is the Windows Core integration test. |
| Offline preview for MVP fixtures | PASS | Covered by `test_all_three_mvp_fixtures_render_timestamp_pngs_and_label_simulation`; no network service is used by the preview implementation. |
| GitHub Actions `test` workflow | NOT_RUN | A prior head had run [39713541725](https://github.com/tuantranmarinainter-ops/3appclaude/actions/runs/39713541725) queued; the current documentation-only head reports no check. CI remains unverified. |
| Effekseer reference comparison | NOT_RUN | No Effekseer PNGs were available. On Windows, open each `.efkefc` fixture in Effekseer and save reference frames as `<effect>_<seconds>s.png` at the desired times; then run `effekseer-ai preview <effect-ir.json> <out-dir> --timestamps 0,0.25,0.5 --reference-dir <reference-dir>`. |
| BBS FS 2.7 actual runtime | NOT_RUN | Install generated resources in BBS FS 2.7 on Windows and capture actual game frames. The simulator does not certify game playback. |
| Compile and whitespace | PASS | `python -m compileall -q src tests`; `git diff --check`. |

## Dependency

This PR is based on PR #50 (`ai1/v2-convert`) and consumes V2b's EffectIR-to-Snowstorm conversion output. It does not depend on V3 packaging and has no V3 branch ancestry. PR #50 is itself stacked on PR #49 because V2a uses V1 stable node references. No merge was performed.
