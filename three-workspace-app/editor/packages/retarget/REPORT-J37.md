# Issue #37 report (based on PR #36)

Implemented in `cli/normalize.ts`, `cli/normalizeCore.ts`, `cli/glbContract.ts`, `cli/toMinecraft20.ts`, `src/extraBones.ts`, and `test/cliToMinecraft20.test.ts`.

J2 reads an adjacent `<source>.manifest.json` for GLB input, validates v1.1 metadata and declared extra skin joints/parent/rest TRS, and carries validated extra bones to the normalized GLB as extra skin joints. Extra bones with no mapping remain at declared rest. Source animation tracks targeting extras are dropped and named in `report.loss.extraBoneTracksDropped`. The v1.0 path is unchanged.

J4 reports every contract-named extra bone skipped by Minecraft20 conversion in `report.minecraft20.droppedExtraBones` (direct exporter field: `report.droppedExtraBones`).

Synthetic GLB measurement: normalized output retained all 65 core joints plus 1 extra joint (66 total); its parent and declared local TRS matched the v1.1 manifest; normalization/roundtrip status was `PASS`. Minecraft20 test asserted `X_LeftHand_twistHelper` appears in the dropped-extra report.

Rerun commands (from `three-workspace-app/editor`):

```sh
pnpm --filter @topview/3d-builder build
pnpm typecheck
cd packages/retarget
node ../builder/node_modules/typescript/bin/tsc --noEmit -p tsconfig.cli.json
node --import ../builder/node_modules/tsx/dist/loader.mjs --test test/cliToMinecraft20.test.ts
```

Gate status:

- Relevant test: PASS, 9/9.
- Retarget CLI typecheck: PASS.
- Builder build: BLOCKED; pnpm install guard stops with `ERR_PNPM_IGNORED_BUILDS` for `esbuild`, `sharp`, and `unrs-resolver` before the script runs.
- Full workspace typecheck: BLOCKED by the same pnpm install guard.
- Blender / Java / BBS FS / Chromium Windows checks: NOT_RUN. Claude can run the app-level checks on Windows after the pnpm build guard is resolved; for this issue, rerun the test and typecheck commands above from the editor workspace.
