# Animation Studio (App 3) — mã nguồn

Mã nguồn của Animation Studio 1.31.8 (App 3), chép từ bản gốc ngoài repo
`C:\Users\Administrator\Documents\Codex\2026-10-09\animation-studio\sites\animation-studio-mdx-alpha-1318`
(2026-10-21). Bản nhúng trong Studio (`editor/apps/studio/public/animation-studio/v1.31.8/index.html`) được build từ
đây.

## Cấu trúc
| Đường dẫn | Vai trò |
| --- | --- |
| `work/material_alpha_v1_31_8/src/` | 47 module JS/CSS + `index.html` + `build.mjs` (giữ nguyên tên, nghiệp vụ của người dùng) |
| `work/material_alpha_v1_31_8/mcp_worker.js` | Bộ lệnh MCP cho AI của bản Sites (create_blocking, set_pose, retime_segment, smooth_motion, apply_patch, export_scene…). Chưa nối vào App 3 cục bộ |
| `vendor/` | three.js (bản đã khoá), tween easing, mdx runtime, war3-model + license |
| `scripts/build-material-site.mjs` | Script build bản Sites (tham khảo) |
| `../builtin-assets/animation-studio/sample.fbx` | Mixamo T-pose nhúng làm mẫu (binary chỉ được nằm trong `builtin-assets/`) |

## Build
Từ `work/material_alpha_v1_31_8`: `node src/build.mjs` → `../../outputs/Animation_Studio_v1_31_8.html` (thư mục
`outputs/` không commit). Không cần cài thư viện.

Kiểm khớp: SHA-256 của file build phải bằng bản nhúng hiện tại
`8E316DC81C37E2148487…` (= 1.31.8 gốc `3CB0CC25…` + 3 bản vá host bên dưới). Sau khi sửa giao diện thì đổi số phiên
bản, build ra thư mục phiên bản mới `editor/apps/studio/public/animation-studio/v<phiên bản>/index.html`, không ghi đè
bản cũ, và cập nhật README trong thư mục đó.

## Bản vá host đã đưa vào `src/app.js`
1. `exportSkeleton`: đặt tên `AuxScene` cho gốc và `Bone_n`/`Node_n` cho node không tên (Studio từ chối GLB có channel
   trỏ node không tên — `PROFILE_MISMATCH`).
2. `frame()`: dừng vòng vẽ khi `hostActive=false` (tab Animation bị ẩn trong Studio).
3. `window.__studio.setHostActive(active)`: host bật/tắt vòng vẽ.

## Quy tắc
- Không bỏ chức năng của người dùng; chỉ dời chỗ trên giao diện hoặc thêm qua `host-bridge.js`/broker.
- Phần nhập Warcraft (MDX/MDL/DDS, Reforged) đã ra khỏi phạm vi App 3: không kiểm, không sửa.
- Đánh giá giao diện và đề xuất: `docs/APP3-REVIEW-2026-10-21.md`.
