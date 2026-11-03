# Animation Studio 1.34.0

Bản App 3 nhúng trong App 2, build từ `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src`
tại commit `0c56dac8a2059f00eda46909e26732906d893588` bằng `node scripts/embed-app3.mjs --version 1.34.0` (trong `editor/apps/studio`).

| Tệp | SHA-256 |
| --- | --- |
| `index.html` | `5569d0916ee68a9bbae2bd95ad2e7f3d84c6f87291e116699c33a487009280e2` |
| `host-bridge.js` | `5fd19ded0bfafd0283a7c298ed9a6c898195e3de5f2e3a4561afa4862e8cdd30` (chép nguyên byte từ `src/host_bridge.js`) |

Kênh cầu nối: `bbs-animation-studio-v1.33.0` (phiên bản giao thức, không đổi theo số build).

Quay lại bản cũ: đổi `APP3_EMBED_VERSION` trong `editor/apps/studio/src/app3Embed.ts`.

App 3 phân phối theo GPL-3.0 (xem `LICENSE`, `NOTICE` bên cạnh). App 2 chỉ chạy App 3 trong iframe và trao đổi
bằng `postMessage`; không import mã App 3.
