# Animation Studio 1.34.0

Bản App 3 nhúng trong App 2, build từ `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src`
tại commit `50980129395d21a0a750415f14fe89eb1476f52b` bằng `node scripts/embed-app3.mjs --version 1.34.0` (trong `editor/apps/studio`).

| Tệp | SHA-256 |
| --- | --- |
| `index.html` | `729815434d02fd8e00db2d8e5aa69dc0dccd4d1d59184f56d7fb5b83e8532bb8` |
| `host-bridge.js` | `47d3d4ee7d285241b050d11ae6c8045a93364f726b7d7885faaa3ed08f1ddde7` (chép nguyên byte từ `src/host_bridge.js`) |

Kênh cầu nối: `bbs-animation-studio-v1.33.0` (phiên bản giao thức, không đổi theo số build).

Quay lại bản cũ: đổi `APP3_EMBED_VERSION` trong `editor/apps/studio/src/app3Embed.ts`.

App 3 phân phối theo GPL-3.0 (xem `LICENSE`, `NOTICE` bên cạnh). App 2 chỉ chạy App 3 trong iframe và trao đổi
bằng `postMessage`; không import mã App 3.
