# J-C / J3b report

## Work completed

- Added GLB v1.1 extra-bone validation for Mixamo65 rigs, including chained extras, named core ancestry, unique names, local rest TRS, and finite/nonzero transforms.
- Extra bones appear in the existing rig tree and use standard selection and editing. Exported GLBs carry extra-bone metadata while ordinary rigs keep the v1.0 path.
- Extended the Animation Studio broker context with `extraBone` on each bone and an `extraBones` list containing each extra's ID, name, parent name, and rest transform. The existing MCP transport in `studio_bridge.js` sends this context and dispatches broker calls; no out-of-scope editor-host file was changed.
- Feature inventory remains **434/434 IDs**, with no missing IDs or unresolved lookups.

## Rerun commands and gates

- From `three-workspace-app/animation-studio/work/material_alpha_v1_31_8`: `node src/build.mjs` — **PASS**.
- From `three-workspace-app/animation-studio`: `node --test work/material_alpha_v1_31_8/src/extra_bones.test.mjs` — **PASS**, 4 passed, 0 failed.
- From `three-workspace-app/animation-studio`: `node tools/check-features.mjs ../editor/apps/studio/public/animation-studio/v1.31.8/index.html outputs/Animation_Studio_v1_32_0.html` — **PASS**, 434/434.
- From `three-workspace-app/animation-studio`: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium node tools/test-extra-bones-roundtrip.mjs` — **PASS** on Linux. The test derives a valid synthetic GLB from the built-in character GLB, adds an uncompressed skinned triangle, `X_Head_Jaw` as joint 66, and a jaw animation. Chromium imported it (66 records, 1 mesh, 1 source clip), selected the tree row, edited the jaw through broker `set_pose` + `apply_patch`, read its key through `read_keyframes`, exported and reloaded it, and verified the bone, animation track, and GLB `extras.extraBones` metadata. After reload, `get_animation_context` still reports the extra.
- From `three-workspace-app/editor`: `pnpm --filter @topview/3d-builder build && pnpm typecheck` — **PASS**, builder build and recursive workspace typechecks completed.
- Native Windows run — **NOT_RUN** here. With dependencies and Chromium installed, Claude can run `node tools/test-extra-bones-roundtrip.mjs` from `three-workspace-app/animation-studio`; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` only if Chromium is not at Playwright's default path. Blender, Java, and BBS FS checks are not part of this App3 change.

## Broker API exercised

The roundtrip test used `window.__studio.director.call('get_animation_context')`, `set_pose`, `apply_patch`, and `read_keyframes`. These are the same `context` and `call` methods passed by `director_controller.js` to the existing `StudioBridge` in `studio_bridge.js`, which transports them to the connected host. The editor-side host bridge remains unchanged and outside this agent's permitted file scope.
