# A1 — Kéo clip đổi tốc độ

Branch: `ai1/a1-clip-stretch`; base: `7de2419203a1790e58e567987f71e4a17d772d07` (`main` at assignment).

App 2 uses the existing `playback.speed` contract. Inclusive clip frames 0–39 represent 40 frames; a 20-frame source stretched to that interval plays at exactly 50%. Both source start and source window are preserved. Numeric speed and reset update duration in the same undo transaction. Invalid rates outside 1–1600% are rejected visibly.

App 3 retains `project.lab.clips` and its existing evaluator. The tail stretches the source, the label shows percent, and clicking the clip opens its numeric controls. Extending the final clip can extend project duration. Resetting an otherwise empty single-clip Lab also removes the unused tail; keyed layers, pins and markers prevent shortening.

The native GLB already bakes Lab timing. On `motion.edit`, the host replaces the complete edited clip range and plays that derivative at 100%; applying the old speed again would double the retiming. Overlapping clips and scene overflow are rejected before project mutation.

## Verified

| Check | Result | Evidence |
| --- | --- | --- |
| App 2 focused regressions | 65 PASS, plus real pointer/numeric/reset/Undo/JSON reload PASS | `app2-focused-tests.log`, `app2-pointer-report.json` |
| Builder typecheck | PASS | `app2-builder-typecheck.log` |
| Studio typecheck | PASS | `studio-typecheck.log` |
| Scoped builder/host ESLint | PASS | `app2-scoped-eslint.log`, `host-eslint.log` |
| App 3 real pointer, numeric, reset, serialization reload | PASS | `app3-pointer.log`, `app3-stretch.json`, `app3-stretch.png` |
| Native baked timing and invalid bounds | 2 PASS | `native-clip-timing.log` |
| Real GLB through `asset.import`, `motion.edit`, `motion.place`, second `motion.edit`, disk reload and `scene.evaluate` | PASS | `native-return-qa.log`, `native-return-report.json` |
| Existing App 3 shot/package regressions | 65 PASS in final full gate | `test-all.log` |
| Features | 434 baseline IDs retained; 441 total | `features.json` |
| Windows production build and offline smoke | PASS | `windows-build.log`, `offline-smoke.log` |
| Full workspace gates | PASS: install, build, typecheck, lint and all suites | `test-all.log`, `windows-build.log`, `offline-smoke.log` |

The host evaluates the returned four-second derivative at frames 0/30/60/90/119: the test bone's x positions are 0/0.5/1/1.5/1.9833333333. This matches the 50% source cadence and has no rest frame within the clip.

No retarget solver, golden fixture, original library, Tập 15 project or Minecraft file was changed. Full retarget suite verified exact Samba GLB SHA: `68fcdb75d373b7338ecf58a9f2f8a2d3a12d3501615a88de9f06285254f644c4`.

Screenshots, GLB payloads and copied test projects stay local and are not committed.

Final full gate: builder 636 PASS / 1 SKIP; retarget 254 PASS / 2 SKIP; Studio 256 PASS / 5 SKIP; Python 115 PASS; App 3 65 PASS. The eight pre-existing skips are reported by the suite; no failures. Offline pnpm install PASS. Existing production build warnings remain (hooks/img/CSS); no errors.
