# Animation Studio (App 3) — mã nguồn

Mã nguồn Animation Studio App 3 được bắt đầu từ bản 1.31.8, chép từ bản gốc ngoài repo
`C:\Users\Administrator\Documents\Codex\2026-10-09\animation-studio\sites\animation-studio-mdx-alpha-1318`
(2026-10-21). Runtime mới nhất được build từ nguồn này là 1.33.0 tại
`editor/apps/studio/public/animation-studio/v1.33.0/index.html`; các bản cũ được giữ nguyên.

## Cấu trúc
| Đường dẫn | Vai trò |
| --- | --- |
| `work/material_alpha_v1_31_8/src/` | 47 module JS/CSS + `index.html` + `build.mjs` (giữ nguyên tên, nghiệp vụ của người dùng) |
| `work/material_alpha_v1_31_8/mcp_worker.js` | Bộ lệnh MCP cho AI của bản Sites (create_blocking, set_pose, retime_segment, smooth_motion, apply_patch, export_scene…). Chưa nối vào App 3 cục bộ |
| `vendor/` | three.js (bản đã khoá), tween easing, mdx runtime, war3-model + license |
| `scripts/build-material-site.mjs` | Script build bản Sites (tham khảo) |
| `../builtin-assets/animation-studio/sample.fbx` | Mixamo T-pose nhúng làm mẫu (binary chỉ được nằm trong `builtin-assets/`) |

## Build
Từ `work/material_alpha_v1_31_8`: `node src/build.mjs` → `../../outputs/Animation_Studio_v1_33_0.html` (thư mục
`outputs/` không commit). Không cần cài thư viện.

Runtime 1.33.0 thêm luồng Blocking → Tinh chỉnh → Xuất. `tools/check-features.mjs` xác nhận 434/434 ID nền vẫn còn,
không có lookup chưa giải quyết, và artifact có sáu ID bổ sung. Khi sửa tiếp, tăng phiên bản và tạo thư mục runtime mới;
không ghi đè các bản cũ.

## Bản vá host đã đưa vào `src/app.js`
1. `exportSkeleton`: đặt tên `AuxScene` cho gốc và `Bone_n`/`Node_n` cho node không tên (Studio từ chối GLB có channel
   trỏ node không tên — `PROFILE_MISMATCH`).
2. `frame()`: dừng vòng vẽ khi `hostActive=false` (tab Animation bị ẩn trong Studio).
3. `window.__studio.setHostActive(active)`: host bật/tắt vòng vẽ.

## Quy tắc
- Không bỏ chức năng của người dùng; chỉ dời chỗ trên giao diện hoặc thêm qua `host-bridge.js`/broker.
- Phần nhập Warcraft (MDX/MDL/DDS, Reforged) đã ra khỏi phạm vi App 3: không kiểm, không sửa.
- Đánh giá giao diện và đề xuất: `docs/APP3-REVIEW-2026-10-21.md`.
