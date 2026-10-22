# Issue #35 report — App 5 Library (I4)

## Implemented

- `/library` previews a selected Action against a compatible built-in or registered library character. Track binding uses canonical Mixamo naming so `mixamorig:` character bones receive normalized tracks. The preview route serves only allowlisted built-ins or registered character model files.
- App 2 `library.place` imports the selected Action as a broker-owned Motion and places it on the selected compatible character in one project transaction. It preserves the source Action UUID and provenance; repeated placement reuses the same imported Motion without replacing a distinct UUID collision. Rig mismatch leaves project data, revision, and undo history unchanged. A single Undo returns to the state before both import and placement. Mixamo65, extended Mixamo, and Minecraft20 families are covered.
- The Builder accepts library Action drop/place requests for its selected character and delegates all file reads to the Studio host/broker boundary.
- App 3 `libraryActionOpen` validates the selected Action and active project character, then composes that exact character source asset with the requested Action clip into the bridge payload. The selected clip index is proof-bound and tested with a two-Action pack. Existing project geometry is retained.
- Rebuilt App 3 v1.32.0 and copied its output to `apps/studio/public/animation-studio/v1.32.0/index.html`; source and embedded index hash match. The embedded bridge is also copied byte-for-byte from source. Feature parity preserves all 434 baseline IDs (435 candidate IDs; no missing IDs or unresolved lookups). No assets or binaries were added.
- MCP `library.place` is registered and tested.

## Changed files

The implementation touches the Studio library page/routes and broker, Builder character drop/place integration, `packages/library` tests/report, MCP agent/tests, App 3 host bridge/tests, and the generated text-only App 3 v1.32.0 runtime and README. No retargeting or VFX source was changed.

## Validation gates

Run from `three-workspace-app/editor` unless specified.

- `pnpm --filter @topview/3d-builder build` — **PASS**.
- `pnpm typecheck` — **PASS**, all five workspace projects.
- `pnpm lint` — **PASS**.
- `pnpm test:evaluate` — **PASS**, 563 passed, 0 failed, 1 skipped.
- `pnpm test:all` — **FAIL** (exit 1; do not treat the overall gate as passing). Builder tests 563 passed/0 failed/1 skipped; retarget tests 160 passed/0 failed/9 skipped; Python tests 115 passed/0 failed; Studio tests 107 passed/4 failed/4 skipped; App 3 tests 61 passed/1 failed. Exact Studio failures: `v1.1 import, evaluate, jaw pose Undo and v1.0 rest (bare)` (local renderer unavailable), `scene.evaluate returns Topview grounding, overlap and frustum measurements without writing history` (Chromium missing), `H4: scene GLB → .blend/FBX reopened in Blender matches scene.evaluate bone positions within 1 cm` (Blender unavailable), and `scene.render runs an immutable Topview snapshot and exposes only verified output files` (local renderer unavailable). The App 3 failure was `E5 default real browser demo executes without skips`, because Playwright Chromium was absent. Those browser/render/Blender executions are **BLOCKED/NOT_RUN**, although the harness records the dependent tests as failed. The same full run reported builder build, typecheck, lint, evaluation, retarget, Python, App 3 build and feature parity as **PASS**.
- `pnpm --filter @topview/3d-studio build` — **PASS** (Next.js build; existing CSS autoprefixer warning).
- `pnpm --filter @topview/3d-studio test:offline` — **BLOCKED before test execution**: pnpm's dependency-status check tried to create `/home/agent/.local/share/pnpm`, which does not exist, then a non-TTY retry refused to purge `node_modules`. A later attempt could not finish dependency reinstallation because npm registry requests returned HTTP 503. Browser execution remains **NOT_RUN**; full `test:all` confirms Chromium is absent.
- `node_modules/.pnpm/node_modules/.bin/tsx --test apps/studio/test/libraryPlace.test.ts` — **PASS**, 3 passed, 0 failed.
- `node --test work/material_alpha_v1_31_8/src/app3_bridge.test.mjs` (from `animation-studio`) — **PASS**, 28 passed, 0 failed.
- `python -m unittest agent.test_unified_mcp` (from `three-workspace-app`) — **PASS**, 21 passed.
- App 3 runtime parity — **PASS**, 434 baseline IDs preserved, 435 candidate IDs, no missing IDs or unresolved lookups. Source and embedded `index.html` SHA-256: `e95d332b15571ea5496733f2e2ecc894ce534587852da113310820bc18aafdb8`. Source and embedded `host-bridge.js` SHA-256: `2bde78159e7732ba09d5cc1d858976d03c656a8ed94982233ac2a91b67546ec7`.
- Chromium UI smoke — **NOT_RUN**. Windows rerun: from `three-workspace-app/editor`, run `pnpm --filter @topview/3d-studio dev`, then open `http://127.0.0.1:3002/library` in Chromium; preview a compatible Action, place it on the selected App 2 character, and open it in Animation Studio. App 3's existing real-browser demo command is `pnpm --dir ../animation-studio/work/material_alpha_v1_31_8 test`.
- Windows-only checks — **NOT_RUN** in this Linux environment. Dynamic imports that use `pathToFileURL` must receive absolute paths on Windows; Python `win32` integration checks require Windows. Windows rerun from `three-workspace-app/editor`: `pnpm --filter @topview/3d-builder build && pnpm typecheck && pnpm test:all`; then `pnpm --filter @topview/3d-studio dev` and open `http://127.0.0.1:3002/library` in Chromium for the interactive smoke.

## Environment blockers

Playwright Chromium is not installed at `/home/agent/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`; browser tests and interactive Chromium smoke were not run. Blender is not installed/available to `scene_blender_export.py`; the Blender round-trip gate therefore failed. These do not change the targeted App 2/App 3 library test results above.

## Final host-flow recheck

After moving popup/message handling from Builder into the Studio host adapter, the cached pnpm 9.15.9 toolchain was used with the existing complete dependency tree:

- `node /workspace/.onboarding-tools/node_modules/pnpm/bin/pnpm.cjs --dir editor --filter @topview/3d-builder build` — **PASS**.
- `PATH=/workspace/.onboarding-tools/node_modules/.bin:$PATH node /workspace/.onboarding-tools/node_modules/pnpm/bin/pnpm.cjs --dir editor typecheck` — **PASS**, all five projects.
- `PATH=/workspace/.onboarding-tools/node_modules/.bin:$PATH node /workspace/.onboarding-tools/node_modules/pnpm/bin/pnpm.cjs --dir editor lint` — **PASS**.
- `PATH=/workspace/.onboarding-tools/node_modules/.bin:$PATH node /workspace/.onboarding-tools/node_modules/pnpm/bin/pnpm.cjs --dir editor test:evaluate` — **PASS**, 563 passed, 1 skipped.
- `node_modules/.pnpm/node_modules/.bin/tsx --test apps/studio/test/libraryPlace.test.ts` (from `editor`) — **PASS**, 3 passed.
- `node --test work/material_alpha_v1_31_8/src/app3_bridge.test.mjs` (from `animation-studio`) — **PASS**, 28 passed.
