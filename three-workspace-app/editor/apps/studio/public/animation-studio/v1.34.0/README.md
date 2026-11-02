# Animation Studio 1.34.0

Bản App 3 nhúng trong App 2, build từ `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src`
tại commit `f206f2196dbfe5c2df2cb2ec72d33388b784dab8` bằng `node scripts/embed-app3.mjs --version 1.34.0` (trong `editor/apps/studio`).

| Tệp | SHA-256 |
| --- | --- |
| `index.html` | `5c58c5464e66e52adc567a9d52881cdad32168c9adf20c808947703f5cd5220c` |
| `host-bridge.js` | `32fe73b1df290e593e9b47de2b20b84b26ff3e2033456e6cef95537c93f00ac3` (chép nguyên byte từ `src/host_bridge.js`) |

Kênh cầu nối: `bbs-animation-studio-v1.33.0` (phiên bản giao thức, không đổi theo số build).

Quay lại bản cũ: đổi `APP3_EMBED_VERSION` trong `editor/apps/studio/src/app3Embed.ts`.

App 3 phân phối theo GPL-3.0 (xem `LICENSE`, `NOTICE` bên cạnh). App 2 chỉ chạy App 3 trong iframe và trao đổi
bằng `postMessage`; không import mã App 3.
