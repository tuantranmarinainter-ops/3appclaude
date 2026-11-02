# Đợt 6 — kiểm B8, B15, B16 (2026-11-02)

Nhánh `claude/backlog-d6-misc`, dựa trên Đợt 5 (`claude/backlog-d5-characters`) chưa merge.

| Mã | Kết luận | Bằng chứng |
| --- | --- | --- |
| B8 | **Sửa.** Bảng "Phím tắt" nhớ trên cùng địa chỉ (đã đúng từ E9: đóng → tải lại → không hiện), nhưng `localStorage` tách theo cổng nên mỗi server thử (3016, 3025, 3032…) lại hiện. Thêm cookie `t3d-nav-hint-dismissed` (cookie dùng chung mọi cổng của cùng host) bên cạnh `localStorage`. | Trình duyệt (production 3044): đóng → `topview.3d-builder.navigation-hint-dismissed.v1=1` → tải lại không hiện. Test `navigationHintCookie.test.ts`: đóng ở "cổng 3016" → module mới ở "cổng 3025" đọc thấy đã đóng. `127.0.0.1` và `localhost` vẫn là hai host khác nhau. |
| B15 | **Đóng, không tái hiện.** Sau điểm neo F3+C (S2) và Đợt 1, film Shot 01 (`Tap15-Shot01-v5-vfx`, `-v6`) đặt nhân vật + hiệu ứng đúng chỗ trong game (người dùng xác nhận, ghi ở `docs/CAMERA-BBS-TASK-2026-11-01.md`). Đợt 1 so số camera App 2 → `.dat`: vị trí 3,2e-14 m, góc 1,7e-6°. | Không đổi mã. |
| B16 | **Đóng, đã chặn.** Mặc định film **không kèm** hiệu ứng (`resolveFilmEffectsPolicy(undefined) = omit`, không đánh giá cue); chỉ kèm khi `target.runtime = bbs-fs-2.7`, `aaaRendererAvailable` và `compatibleAddonConfirmed` (test `filmEffectsPolicy.test.ts`). Từ Đợt 2, ô "Kèm hiệu ứng" chỉ bật khi app tìm thấy mod AAA trong thư mục game; preflight báo `VFX_OMITTED`; gói ghi `filmRequiredMods`. | Không đổi mã. Trong game không có AAA: NOT_RUN. |

## Phát hiện mới (ghi backlog, chưa sửa)

**B60** — Mọi động tác đã **chuyển xương** (vd Stun Mixamo65 → MC20 của Đen) bị coi là "thiếu file" (`ASSET_FILE_MISSING`, "Bộ chuyển đã đổi — chuyển lại?") sau **mỗi lần cập nhật mã**: `converterVersion()` (`apps/studio/src/libraryMotionConversion.ts`) băm toàn bộ `packages/retarget/cli` + `src`, chính file chuyển và `pnpm-lock.yaml`. Bản sao Shot 01 đang ở trạng thái này từ khi gộp `main` (Đợt 1) → film preflight chặn xuất và không lấy được mẫu chân. Đề xuất: phiên bản bộ chuyển = số phiên bản khai báo tay (tăng khi đầu ra thực sự đổi, như `FLOOR_FIT_VERSION`), giữ băm làm thông tin; khi lệch phiên bản thì vẫn dùng bản đã chuyển và chỉ gợi ý "Chuyển lại".
