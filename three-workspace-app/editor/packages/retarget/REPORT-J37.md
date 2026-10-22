# Issue #37 report (depends on PR #47 for issue #36)

Implemented in `cli/normalize.ts`, `cli/normalizeCore.ts`, `cli/glbContract.ts`, `cli/toMinecraft20.ts`, `src/extraBones.ts`, and `test/cliToMinecraft20.test.ts`.

J2 reads an adjacent `<source>.manifest.json` for GLB input, validates v1.1 metadata and declared extra skin joints/parent/rest TRS, and carries validated extra bones to the normalized GLB as extra skin joints. Extra bones with no mapping remain at declared rest. Source animation tracks targeting extras are dropped and named in `report.loss.extraBoneTracksDropped`. The v1.0 path is unchanged.

J4 reports every contract-named extra bone skipped by Minecraft20 conversion in `report.minecraft20.droppedExtraBones` (direct exporter field: `report.droppedExtraBones`).

Synthetic GLB measurement: normalized output retained all 65 core joints plus 1 extra joint (66 total); its parent and declared local TRS matched the v1.1 manifest; normalization/roundtrip status was `PASS`. Minecraft20 test asserted `X_LeftHand_twistHelper` appears in the dropped-extra report.

Rerun commands (from `three-workspace-app/editor`, using pnpm 9.15.9):

```sh
pnpm --filter @topview/3d-builder build
pnpm typecheck
node --import ./packages/builder/node_modules/tsx/dist/loader.mjs --test ./packages/retarget/test/cliToMinecraft20.test.ts
```

Gate status:

- Builder build: PASS (`pnpm --filter @topview/3d-builder build`).
- Full workspace typecheck: PASS (`pnpm typecheck`; builder, retarget, shared, and studio typechecks completed).
- Retarget Minecraft/GLB tests: PASS, 9/9.
- Blender / Java / BBS FS / Chromium Windows checks: NOT_RUN; Claude can run the app-level checks on Windows.
