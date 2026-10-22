# Animation Studio 1.32.0 (App 3) embedded runtime

Built from `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src` (`node src/build.mjs` → `outputs/Animation_Studio_v1_32_0.html`)
and copied here unchanged. Do not edit `index.html` in place: change the source, rebuild, copy, and update the hash below.

SHA-256 of `index.html`: `e95d332b15571ea5496733f2e2ecc894ce534587852da113310820bc18aafdb8`.

Feature parity: `node tools/check-features.mjs ../editor/apps/studio/public/animation-studio/v1.31.8/index.html outputs/Animation_Studio_v1_32_0.html` reports all 434 baseline IDs present, no unresolved lookups, and one additive ID.

SHA-256 of `host-bridge.js`: `2bde78159e7732ba09d5cc1d858976d03c656a8ed94982233ac2a91b67546ec7`; copied unchanged from `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/host_bridge.js`.

`host-bridge.js` adds to the 1.31.8 bridge (channel `bbs-animation-studio-v1.32.0`):
- `shotOpen {bytes}` — open a shot package ZIP produced by App 2 `shot.export`;
- `shotExport {includeMinecraft20?}` — return the result package ZIP for App 2 `shot.result.import`;
- `libraryActionOpen {actionUuid}` — open the selected Action composed with the exact source character asset from the active App 2 project as a single-clip animation model. The broker proof binds the Action UUID, character asset ID/hash, and selected clip index.
