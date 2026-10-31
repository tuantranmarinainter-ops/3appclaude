# Animation Studio 1.34.0

Bản App 3 nhúng trong App 2, build từ `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src`
tại commit `f206f2196dbfe5c2df2cb2ec72d33388b784dab8` bằng `node scripts/embed-app3.mjs --version 1.34.0` (trong `editor/apps/studio`).

| Tệp | SHA-256 |
| --- | --- |
| `index.html` | `f4fa1d93ed86d87d4e4f1b40b804c67a2212f396178f1881d8bf515780cd4a50` |
| `host-bridge.js` | `9e8d27eba3a6cbc42fbf8c3d5eaef1ac6aaa18b857d6d39682481446ee8b9582` (chép nguyên byte từ `src/host_bridge.js`) |

Kênh cầu nối: `bbs-animation-studio-v1.33.0` (phiên bản giao thức, không đổi theo số build).

Quay lại bản cũ: đổi `APP3_EMBED_VERSION` trong `editor/apps/studio/src/app3Embed.ts`.

App 3 phân phối theo GPL-3.0 (xem `LICENSE`, `NOTICE` bên cạnh). App 2 chỉ chạy App 3 trong iframe và trao đổi
bằng `postMessage`; không import mã App 3.
