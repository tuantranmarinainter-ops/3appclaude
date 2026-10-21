# Animation Studio 1.32.0 (App 3) embedded runtime

Built from `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src` (`node src/build.mjs` → `outputs/Animation_Studio_v1_32_0.html`)
and copied here unchanged. Do not edit `index.html` in place: change the source, rebuild, copy, and update the hash below.

SHA-256 of `index.html`: see `git log` of this folder; verify with `sha256sum index.html` against a fresh build.

`host-bridge.js` adds to the 1.31.8 bridge (channel `bbs-animation-studio-v1.32.0`):
- `shotOpen {bytes}` — open a shot package ZIP produced by App 2 `shot.export`;
- `shotExport {includeMinecraft20?}` — return the result package ZIP for App 2 `shot.result.import`.
