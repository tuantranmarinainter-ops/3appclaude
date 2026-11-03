# Animation Studio 1.34.0

Bản App 3 nhúng trong App 2, build từ `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src`
từ nhánh `claude/app3-scene-s3` (working tree, chưa commit; thêm "1 khung · Cả cảnh", chọn/sửa từng nhân vật) bằng `node src/build.mjs` rồi chép `outputs/Animation_Studio_v1_33_0.html` → `index.html` và `src/host_bridge.js` → `host-bridge.js`.

| Tệp | SHA-256 |
| --- | --- |
| `index.html` | `6045d5c6a644875c0c03496ade9a8770df5b9637fa2faa63b32b7b93830dea76` |
| `host-bridge.js` | `5d83dbc778f878f8ae5e8ec98355702b88d9ed9596cc7c8740cb5fc2772c5c29` (chép nguyên byte từ `src/host_bridge.js`) |

Kênh cầu nối: `bbs-animation-studio-v1.33.0` (phiên bản giao thức, không đổi theo số build).

Quay lại bản cũ: đổi `APP3_EMBED_VERSION` trong `editor/apps/studio/src/app3Embed.ts`.

App 3 phân phối theo GPL-3.0 (xem `LICENSE`, `NOTICE` bên cạnh). App 2 chỉ chạy App 3 trong iframe và trao đổi
bằng `postMessage`; không import mã App 3.
