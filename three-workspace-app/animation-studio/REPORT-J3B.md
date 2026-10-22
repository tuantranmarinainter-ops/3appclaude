# J-C / J3b report

## Work completed

- Added GLB v1.1 extra-bone metadata validation for a Mixamo65 core, including chained extras, named core ancestry, unique names, local rest TRS, and finite/nonzero transforms.
- Extra bones remain in the existing rig tree and use the existing selection, transform, keyframe, and GLB export paths. The tree labels them as extras; exported GLBs carry `mixamo65+extras` metadata, and the existing `window.__studio.recordNames()` bridge reports `extraBone` while `window.__studio.extraBones()` exposes validated metadata.
- Kept the feature inventory intact: **434/434 IDs**, no missing IDs or unresolved lookups.

## Rerun commands and gates

- `node --test work/material_alpha_v1_31_8/src/extra_bones.test.mjs` — **PASS**, 4 passed, 0 failed.
- From `three-workspace-app/animation-studio/work/material_alpha_v1_31_8`: `node src/build.mjs` — **PASS**, standalone HTML built.
- From `three-workspace-app/animation-studio`: `node tools/check-features.mjs ../editor/apps/studio/public/animation-studio/v1.31.8/index.html outputs/Animation_Studio_v1_32_0.html` — **PASS**, 434/434.
- From `three-workspace-app/editor`: `pnpm --filter @topview/3d-builder build && pnpm typecheck` — **PASS**, workspace package builds and recursive typechecks completed.
- Synthetic browser import/select/edit/save/reload/export test — **BLOCKED**. The first Chromium harness attempt failed while parsing the generated synthetic GLB (`GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported.`); this does not establish whether the Studio roundtrip passes. Re-run after correcting the synthetic GLB generator/harness.
- Native Windows checks — **NOT_RUN** in this Linux environment. Claude can run `pnpm --filter @topview/3d-builder build && pnpm typecheck` from `three-workspace-app/editor`, then repeat the synthetic GLB browser roundtrip on Windows/Chromium. Blender, Java, and BBS FS checks are not part of this App3 change.

## Bridge boundary

The editor host bridge file is outside the assigned `animation-studio` region, so it was left unchanged. The existing host bridge can consume the enriched record names and the exported GLB metadata through its current API. Separate host controls for changing extras metadata were not added or verified; the Studio’s existing in-app selection and transform controls are used for edits.
