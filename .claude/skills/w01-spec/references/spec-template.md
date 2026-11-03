# <Tên tính năng>: đặc tả <yyyy-mm-dd>

> Người dùng chốt <ngày>. Mục ghi **[Claude chốt]** là quyết định thay người dùng, đổi được.
> Đọc trước: `CLAUDE.md`, `docs/DECISIONS.md`, <đặc tả liên quan>.

## 1. Vì sao
<tình huống thật của người dùng; ví dụ cụ thể: cảnh, nhân vật, khung>

## 2. Hiện trạng (đã kiểm code)
- <file:hàm>: <đang làm gì, giới hạn>

## 3. Người dùng đã chốt
| # | Câu | Chốt |
| --- | --- | --- |

## 4. Mục tiêu / không làm / coi là hỏng
**Mục tiêu**: G1…
**Không làm (đợt này)**: …
**Coi là hỏng dù "chạy được"**: <điều kiện đo được>

## 5. Trải nghiệm người dùng
<từng bước bấm, chữ tiếng Việt trên nút, trạng thái hiện ra>

## 6. Thiết kế kỹ thuật (hướng, builder tự quyết chi tiết)
<dữ liệu, file sẽ đụng, chỗ dùng lại code sẵn có>

## 7. Chia đợt
| Đợt | Nội dung | Xong khi |
| --- | --- | --- |
Mỗi đợt một nhánh/PR, xếp chồng, không tự merge.

## 8. Đo số (bắt buộc)
<ngưỡng số: cm, độ, FPS, giây, hash; dữ liệu đo (bản sao nào); report docs/REPORT-<chủ-đề>-<ngày>.md>
Trạng thái: NOT_RUN / BLOCKED / FAIL / PASS.

## 9. Bài test thủ công (người dùng)
1. …

## 10. Câu hỏi của người đọc kiểm tra: Claude chốt
1. …

## 11. Builder tự quyết
…

## 12. Ràng buộc
Không sửa `packages/retarget` (trừ test), không đổi golden, không commit binary/kho thật/project thật. Test trên bản sao, luôn đặt
`W01_LIBRARY` bản sao. App 3 giữ mọi chức năng. UI tiếng Việt, nền tối. `pnpm typecheck` toàn workspace trước push.
