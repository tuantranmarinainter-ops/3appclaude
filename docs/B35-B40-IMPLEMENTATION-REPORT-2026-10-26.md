# B35–B40 App2: integration and measurements (2026-10-26)

Branch based on main `5734042`. Replaces Part 2 / PR #175; no merge. No retarget source, golden, binaries or real user store changed.

## Delivered behavior

- Library reads use an invalidated in-process index without writing index.json; filesystem metadata detects external pack/character/model changes. Texture digests share a bounded path/mtime/ctime/size cache. Height UI uses scoped fingerprints and explicit profile events, without polling/focus reads.
- Undo/Redo use one project read and update the existing document/runtime. App2 remains mounted while App3 is active; unchanged model templates are retained with resource reference counts. Host refreshes serialize; overlapping reads coalesce and writes invalidate generations. Hidden App2 ignores viewport/global inputs and pauses playback/autosave.
- Hash-addressed project representations use private immutable cache headers and representation SHA256 ETags, authenticated before 304. Action placement checks frame gaps before conversion.
- Timeline supports Ctrl-drag (Alt-drag on Mac), focused Ctrl+C/V and Vietnamese context commands. Copies retain the same motion and playback settings, have new clip IDs and Undo. Missing motion references invalidate copied clipboard entries after host cleanup.
- Every timeline clip gets an independent AnimationAction even when motions match. Slow speed presets 0.1/0.25/0.5/1/2 and a numeric 0.01–16 field preserve source duration. BBS 0.25x export test verifies 81 pose samples over 80 ticks/4 seconds, maximum angular error 0.00000196115°.
- Explicit confirmed “Dọn tài nguyên thừa” removes unused motion/assets/conversion recipes and catalogue entries through normal history; physical files remain available for Undo.

## Performance method and limits

Identical disposable fixture: 300 independent synthetic motion-pack metadata files; 16 project assets, 8 motions, 15 minimal character instances; 643000-byte project JSON and 44527168 source bytes including 42 MiB unused BIN padding. Padding measures byte size, not real geometry complexity. Production baseline built from clean detached main `5734042`; source changes were never used as the baseline. Linux Chromium uses ANGLE Swiftshader software rendering.

Three matching samples per version, sequential, with builds/heavy suites stopped; every sample retained. First two exploratory baseline runs overlapped builds/suites and/or lacked the final Library-return measurement, so remain diagnostic logs in /tmp and are excluded by protocol, not by speed. After sample 1 was retained although slower than samples 2/3. Browser timing includes automation completion plus two animation frames. Library return follows the actual /library return link; App3 return includes POST shot.result.import with changed animation bytes through loaded new motion and two frames. Native App3 editing/export and optional ZIP upload time are excluded.

| Operation | Before median / max ms | After median / max ms |
| --- | ---: | ---: |
| Project open | 3337.6 / 3542.6 | 3123.3 / 4280.9 |
| Library → App2 | 2437.3 / 2662.4 | 2068.7 / 2286.4 |
| Undo | 2257.4 / 3127.7 | 340.3 / 392.2 |
| App3 result import → App2 | 3566.2 / 3920.1 | 1900.0 / 2012.7 |

**Absolute browser targets remain FAIL in this software-rendered fixture:** open < 2000 ms, Library return < 1500 ms, Undo < 300 ms. Improvements are measured, not a full performance PASS. Undo after samples are 392.2 / 287.1 / 340.3 ms; no fast-sample selection. Native browser/GPU and real Shot 01 / 368-pack Windows store: NOT_RUN. Real BBS game: NOT_RUN.

Every after Undo preserved Store/Stage/model instances, made one project GET and zero asset requests. Every App3 return preserved runtime/model instances, fetched exactly one changed motion and zero unchanged models. Library route reload emits model request events, potentially satisfied by browser cache; those events are not claimed as zero requests. Idle 17 seconds: zero height/library-character refreshes; unrelated profile event zero requests, relevant event one scoped request. No browser page errors.

Library 300-pack benchmark: warm search 1.88 ms (<20ms); filesystem byte/mtime snapshot unchanged. Cold search 17.78 ms. Texture profile benchmark 300 packs + 8 MiB texture: cold 120.01 ms, warm 5.15 ms (<100ms), mutation invalidates digest. These library metrics are separate from browser navigation measurements.

## Gates

- Production builder + Studio build: PASS.
- pnpm typecheck: PASS. pnpm lint: PASS (4 pre-existing warnings; 15-language locale check passes).
- Builder evaluation suite: 116 files, 643 cases PASS / 1 skipped. Golden remains unchanged.
- Direct per-file library suite: 5 files, 21 cases PASS; additional Studio cache/command coverage included below.
- Direct per-file Studio suite: 81 files, 319 cases PASS / 7 skipped / 0 failures after environment retries. Three files hit a native Node24 async assertion; their 9 actual cases PASS under standalone Node22.15 with system Chromium (temporary PLAYWRIGHT_BROWSERS_PATH) and loopback access. The browser scenario also PASS after providing Chromium. Blender roundtrip initially failed on both main and this branch because the installed Blender could not find libextern_draco.so; setting BLENDER_EXTERN_DRACO_LIBRARY_PATH=/workspace/.onboarding-tools/libextern_draco.so resolves it: 48 bone samples in each reopened .blend/FBX, maximum error 0 meters. Remaining skips require external FBX/native fixtures unavailable in this environment.
- Python unified CLI/MCP/shot-package: 117 cases PASS.
- pnpm test:all runner is not used as evidence because this Node24/tsx combination reports file wrappers without real case execution. The user-authorized builder/library/Studio/Python fallback above executes actual cases.
- Browser timeline interaction: PASS actual Ctrl+C/V, Vietnamese context duplicate/delete, Ctrl-drag, 0.25 preset, 0.5 numeric input and input shortcut scope. Final render/evaluate retries: PASS, as described above.

Machine-readable retained sample measurements: B35-B40-PERFORMANCE-RESULTS-2026-10-26.json. Repro harness: editor/apps/studio/test/b35Performance.smoke.ts; B35_PERF_SCALE=1, B35_PERF_PHASE=baseline|after, B35_PERF_OUTPUT=...; launch via node --import ./packages/builder/node_modules/tsx/dist/loader.mjs from editor. Local browser servers need loopback permission in the managed sandbox.
