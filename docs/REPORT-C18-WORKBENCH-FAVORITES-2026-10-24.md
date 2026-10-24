# C18 — Sao animation riêng cho nhân vật đích

Ngày kiểm tra: 2026-10-24. Nhánh: `ai1/c18-workbench-favorites`, nền `origin/main` tại `3cdd4196a1ba0db2108ed3a36c189cabff9b62fe`.

## Kết quả

- UI: `Duyệt animation` và bảng animation của lô có nút `☆/★`, bộ lọc `Chỉ ★`, số đếm `★ N`, và phím `S`. Gắn sao tự bật `Giữ`; bỏ `Giữ` không tự bỏ sao.
- Controller/state: trạng thái sao tách theo `charId`. Khi chọn nhiều nhân vật, thao tác sao áp cho toàn bộ nhóm đang chọn; đổi nhóm/nhân vật vẫn giữ trạng thái riêng của từng đích trong phiên Workbench.
- Core/library: payload chuyển chứa `favoriteFor` theo từng Action. Nháp của đúng nhân vật được ghi `favorite: true`; nháp khác không bị đánh dấu. Bản chỉnh sửa tiếp theo giữ trạng thái yêu thích.
- App 5 và hộp `Lấy từ kho…` của App 2: Action yêu thích hiện `★` và được xếp trước trong bộ của từng nhân vật.
- Không triển khai C16, không đổi golden, không thêm binary, không dùng kho người dùng. QA trình duyệt dùng `/tmp/c18-qa-library`.

## Đo và ảnh

- Workbench trình duyệt: 85/85 animation được giữ, bấm sao một dòng đổi số đếm thành `★ 1`; danh sách ảo render 27 hàng trong viewport 1600 × 1000 mà không cắt nút sao hay bộ lọc.
- Kiểm phím tắt: bỏ `Giữ` ở dòng hiện tại rồi bấm `S` làm dòng tự `Giữ` lại và tăng `★ 0 → 1`; bật `Chỉ ★` còn đúng 1 hàng, `aria-pressed=true`.
- Chuyển cùng một Action tới 3 đích: 3 Nháp; 2 đích trong `favoriteFor` có `favorite: true`, đích còn lại không có cờ yêu thích.
- Minecraft20 round-trip trong test tích hợp: sai số endpoint lớn nhất `0.0000032653130729889837`, trạng thái `PASS`.
- Ảnh ngoài repo: `/tmp/c18-evidence/c18-workbench-favorites.png` (1600 × 1070, SHA-256 `4920bfcf8152e120df7f2b9c8cb2c46113c371f0035a4db99ba4ad4ba8afd8a7`). Ảnh offline Studio: `/tmp/c18-evidence/c18-studio-offline.png` (1440 × 900).

## Gate Linux

| Gate | Trạng thái | Kết quả |
| --- | --- | --- |
| `pnpm --filter @topview/3d-builder build` | PASS | bundle + `.d.ts` |
| `pnpm typecheck` | PASS | 5 workspace packages |
| `pnpm lint` | PASS | 0 lỗi; 1 warning có sẵn ở `scene-review/index.tsx` |
| `characterActions.test.ts` | PASS | 4/4 |
| `workbench.test.ts` | PASS | 21 pass, 6 skip do thiếu mẫu Windows |
| `pnpm test:evaluate` | PASS | 593 pass, 1 skip; 105/105 file |
| `pnpm build` | PASS | Builder + Studio production build |
| `pnpm --filter @topview/3d-studio test:offline` | PASS | 0 request ngoài, tìm thấy 28 pose, một thanh điều hướng 5 app |
| `git diff --check` | PASS | không lỗi khoảng trắng |

Lần chạy offline đầu tiên bị BLOCKED vì Chromium chưa nằm trong cache tạm và cổng 3117 đang được tiến trình khác dùng. Chạy lại bằng Chromium đã có ở `/tmp/b5-playwright-browsers` và cổng 3128: PASS. Không dùng cổng 3101 hoặc 3016.

## Gate Windows

Trạng thái: **NOT_RUN** vì môi trường hiện tại là Linux. Cần chạy từ `three-workspace-app/editor` trên Windows:

```powershell
pnpm --filter @topview/3d-builder build
pnpm typecheck
pnpm lint
pnpm --filter @topview/3d-builder exec tsx --test ../library/characterActions.test.ts
pnpm --filter @topview/3d-builder exec tsx --test ../retarget/test/workbench.test.ts
pnpm test:evaluate
pnpm build
pnpm --filter @topview/3d-studio test:offline
```
