# Issue #36 report: D7 wrist and D3 model mode

## Work completed

- D7: mapped `LeftHand`/`RightHand` effectors preserve animated local translation in the mapped forearm frame. The behavior requires one mapped source bone and does not transfer finger translation. Rotation-only Mixamo clips have a zero translation delta, so their current wrist output is unchanged.
- D3: model mode now accepts supported humanoid families (`ue`, `cc`, `lol`, `wc3r`, and `wow`, in addition to Mixamo), fits mapped Mixamo65 joint positions to the source model rest positions, adjusts baked translation samples by the same rest-fit offsets, and recalculates inverse bind matrices.
- Added a deterministic UE-named synthetic model export test based on the built-in Mixamo65 GLB fixture. No golden files or assets were regenerated or committed.

## Reproduction and measurements

From `three-workspace-app/editor`:

```sh
node --import ./node_modules/.pnpm/node_modules/tsx/dist/loader.mjs --test packages/retarget/test/universal.test.ts
node --import ./node_modules/.pnpm/node_modules/tsx/dist/loader.mjs --test packages/retarget/test/cliModelExport.test.ts
```

- D7 synthetic wrist delta: input wrist local translation delta was `0.25 m`; output mapped wrist displacement was `0.25 m` along target forearm-frame Z (absolute error `< 1e-6 m`). Finger-local translation was not transferred. Test result: PASS.
- D3 synthetic UE GLB export: `65` mapped/fitted joints; maximum mapped joint position error `4.97e-16 m`; maximum CPU-skinned rest position error `2.27e-8 m`; output skin has `65` joints. Test result: PASS.
- Relevant direct TypeScript checks passed: `tsc --noEmit -p packages/retarget/tsconfig.json`, `tsc --noEmit -p packages/retarget/tsconfig.cli.json`, `tsc --noEmit -p packages/builder/tsconfig.json`, and `tsc --noEmit -p packages/builder/tsconfig.test.json`.

## Gates

| Gate | Status | Evidence |
|---|---|---|
| D7 and D3 targeted tests | PASS | `universal.test.ts`: 18 passed; `cliModelExport.test.ts`: 4 passed, 4 skipped because external sample files are absent. Synthetic coverage passed in both files. |
| Full workspace `pnpm typecheck` | BLOCKED | `pnpm typecheck` could not complete: pnpm reports ignored dependency build scripts (`esbuild`, `sharp`, `unrs-resolver`) and requires build approval. Direct checks for retarget, builder, and builder tests passed. Remaining downstream checks cannot resolve the builder package before its package outputs are built. |
| Samba sample preservation (foot slide `2.23/2.40 m`) | NOT_RUN / BLOCKED | The Samba FBX/GLB sample is not present in this environment. The documented baseline is not asserted as measured. Run the project’s Samba evaluation on the original sample on Windows and compare against `2.23/2.40 m`. |
| Real non-Mixamo game model measurements | NOT_RUN / BLOCKED | No game GLB samples are available here. The reported D3 measurements above are from the checked-in built-in GLB-derived synthetic fixture. |
| Windows Blender / Java / BBS FS / Chromium checks | NOT_RUN | On Claude’s Windows machine, run the relevant project test/evaluation commands after installing dependencies; for the retarget tests use `pnpm exec tsx --test packages/retarget/test/universal.test.ts packages/retarget/test/cliModelExport.test.ts` from `three-workspace-app/editor`. Then run the Samba evaluation with the real sample. |

