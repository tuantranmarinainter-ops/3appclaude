# C1 browser QA handoff (2026-10-24)

Scope: scene-to-animation navigation, iframe startup/reload readiness, durable shot Save and Return QA. Native-rig export belongs to C2. No C2 sources, original library, golden files or binaries were modified.

## Reproduce

From `three-workspace-app/editor`, start a built Studio on port 3003 with:

- `BBS_UNIFIED_PROJECTS_DIR`: a directory inside this worktree's `qa-c1/`.
- `W01_LIBRARY`: the copied character library, never the original library.

Run `node apps/studio/scripts/c1-roundtrip-qa.mjs` with the same project directory and `C1_FIXTURE_PROJECT_DIR` pointing to a seed project directory containing `project.json`, `assets/`, and `originals/`. Optional `C1_BASE_URL` and `C1_EVIDENCE_DIR` select the server/evidence directory. Each run creates a new UUID project without deleting existing data. It re-adds the three library-owned Characters from the current library so old pre-L3 mannequin assets in the seed do not define their profiles. It removes all copied timeline motion clips through `scene.apply`, fetches each actor's owned draft v1 with `/api/library?charId=…&status=draft`, places it with `library.place`, and sets one covering clip per actor to frames 0–300 with `motion.binding.set`.

The browser opens the actual shot and edits a recorded bone key. Save must POST a real validated draft ZIP; GET readback and disk SHA must match. Return must create exactly one project revision and a new binding for the editable actor, preserve the two reference bindings, and allow App 2 playback to advance. Failures write a report and screenshot; a host alert ends Save QA immediately. C7 uses actual mouse clicks; the overlapping pre-C7 header uses keyboard navigation and is explicitly labelled as such.

Run `node apps/studio/scripts/c1-navigation-qa.mjs` with `C1_NAV_PROJECT_ID` set to a prepared copied project to check navigation focus, discard/reload with a delayed bridge, cleared shot identity, disabled Save/Return during reload, and reopening after the handshake.

## Acceptance boundary

A real three-native-actor shot (frames 0–300) opened and recorded a changed key, then the v1.32 exporter rejected Save with `Gói kết quả cần rig Mixamo65.` The guard is in `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/shot_export.js`, `bakeEditedGLB`. This is not a durable Save/readback/Return PASS. Parent will run final three-actor acceptance on combined C1+C2+C7. Keep PR #99 draft until that evidence passes.

Samba reference GLB SHA-256 verified read-only: `68fcdb75d373b7338ecf58a9f2f8a2d3a12d3501615a88de9f06285254f644c4`. Retarget code was not changed.

## Verified C1 checks

- Focused workspace navigation and App 1/shot/durable-draft tests: 15 PASS.
- Production build, full `pnpm typecheck`, and `pnpm lint`: PASS (existing scene-review img warning).
- `pnpm test:evaluate`: 592 PASS, 1 SKIP.
- Production Chromium navigation/reload: PASS. One deliberately delayed bridge reload; Open disabled during reload, stale shot cleared, Save/Return disabled until a shot was reopened, reopening after handshake succeeded. Current C1 header required keyboard navigation; final C7 mouse click remains for combined QA.
- Native durable Save/Return: BLOCKED on C2; no PASS claimed.

The final stricter owned-draft fixture was also executed on standalone C1: `library.place` rejects the native owned Action with `PROFILE_MISMATCH: Imported Action is not compatible with the selected Character` before opening App 3. Combined C2 support is required for this fixture. Earlier three-native-actor Open/Edit evidence used the copied project's existing native Motions and demonstrates only those steps, not the stricter owned-draft acceptance.
