# Animation Studio 1.34.0

Bản App 3 nhúng trong App 2, build từ `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src`
tại commit `85f8254e9b1dd9e6eccc3b8c8a84d62aa1e1d19c` bằng `node scripts/embed-app3.mjs --version 1.34.0` (trong `editor/apps/studio`).

| Tệp | SHA-256 |
| --- | --- |
| `index.html` | `9030fd55b7e83c967edad3804ee5f0917903f2b9cfb74645c6f9d64d4b58f317` |
| `host-bridge.js` | `9e8d27eba3a6cbc42fbf8c3d5eaef1ac6aaa18b857d6d39682481446ee8b9582` (chép nguyên byte từ `src/host_bridge.js`) |

Kênh cầu nối: `bbs-animation-studio-v1.33.0` (phiên bản giao thức, không đổi theo số build).

Quay lại bản cũ: đổi `APP3_EMBED_VERSION` trong `editor/apps/studio/src/app3Embed.ts`.

App 3 phân phối theo GPL-3.0 (xem `LICENSE`, `NOTICE` bên cạnh). App 2 chỉ chạy App 3 trong iframe và trao đổi
bằng `postMessage`; không import mã App 3.
