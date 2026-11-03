# Animation Studio 1.34.0

Bản App 3 nhúng trong App 2, build từ `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src`
từ nhánh `claude/app3-scene-s2` (working tree, chưa commit; thêm "1 khung · Cả cảnh") bằng `node src/build.mjs` rồi chép `outputs/Animation_Studio_v1_33_0.html` → `index.html` và `src/host_bridge.js` → `host-bridge.js`.

| Tệp | SHA-256 |
| --- | --- |
| `index.html` | `f439c10e8442705ef928a1c2b56a7a601e47a060e85b733f82492209c514c5b3` |
| `host-bridge.js` | `5fd19ded0bfafd0283a7c298ed9a6c898195e3de5f2e3a4561afa4862e8cdd30` (chép nguyên byte từ `src/host_bridge.js`) |

Kênh cầu nối: `bbs-animation-studio-v1.33.0` (phiên bản giao thức, không đổi theo số build).

Quay lại bản cũ: đổi `APP3_EMBED_VERSION` trong `editor/apps/studio/src/app3Embed.ts`.

App 3 phân phối theo GPL-3.0 (xem `LICENSE`, `NOTICE` bên cạnh). App 2 chỉ chạy App 3 trong iframe và trao đổi
bằng `postMessage`; không import mã App 3.
