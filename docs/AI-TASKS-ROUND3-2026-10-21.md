# Đợt 3 — giao AI-1 (trong lúc AI-2 làm EPIC-B)

**Cách nộp mới (Codex đã kết nối GitHub):** mỗi việc một nhánh `ai1/<mã>-<tên ngắn>` tạo từ `main` mới nhất, mở
**Pull Request** vào `main`, mô tả PR = nội dung `REPORT.md` cũ (file, lệnh test, kết quả PASS/FAIL/NOT_RUN, chỗ làm
khác đặc tả). **Không tự merge.** Claude kéo nhánh về, kiểm, rồi merge hoặc ghi lỗi trong PR. Nếu không đẩy được thì
quay lại cách zip như trước.

Quy tắc chung vẫn như `docs/AI-TASKS-2026-10-21.md`. Việc App 1 bắt buộc đọc `docs/RETARGET-LESSONS.md`.
AI-2 đang sửa `editor/packages/builder`, `editor/packages/shared/src/index.ts`, `editor/apps/studio/*`, `agent/unified_*`:
**không đụng các file đó.**

| Mã | Việc | Vùng file được sửa |
| --- | --- | --- |
| A5 | App 3: xuất `.bobj` có bỏ xoắn cẳng tay + khoá bàn tay như App 1 | `animation-studio/work/material_alpha_v1_31_8/src/` |
| D1 | App 1: khoá chân (foot lock) bằng IK ở khung chạm đất | `editor/packages/retarget/` |
| D4 | App 1: giảm xô lệch thân trên ở Minecraft20 | `editor/packages/retarget/cli/toMinecraft20.ts` + test |
| D5 | Workbench: chọn đoạn Action, nút huỷ lượt chạy | `editor/packages/retarget/workbench/` + test |
| D6 | Sửa 2 lỗi lint ở `workbench/public/app.js`, `viewer.js` | `editor/packages/retarget/workbench/public/` |

Thứ tự: A5 → D6 → D5 → D4 → D1 (D1 khó nhất, làm cuối). Mỗi việc một PR.

---

## A5 — App 3 xuất `.bobj` có sửa tay như App 1
Bối cảnh: App 1 (`editor/packages/retarget/cli/toMinecraft20.ts`) sau khi giải ngược Mixamo65→Minecraft20 còn chạy
`untwistLimbs`: bỏ xoắn cẳng tay/ống chân quanh trục của nó (giữ hướng gập), và khoá `low_*_arm.end` (bàn tay) theo
cẳng tay vì Minecraft20 không có cổ tay/ngón. Bản A4 của App 3 (`src/minecraft20_export.js`, `src/shot_reverse.js`)
chưa làm bước này nên Steve bị cẳng tay hình nêm (xem `docs/RETARGET-LESSONS.md`, dòng "Cẳng tay Steve").
Việc: chuyển `untwistLimbs` (và `limbTwistDegrees` để đo) sang JS trong App 3, chạy cho mỗi tick trước khi ghi BOBJ.
**Đạt khi:** test Node trên GLB thật của App 1 (như test A4): xoắn lớn nhất sau xử lý ≤ 15°, bàn tay trùng tư thế rest
so với cẳng tay (sai số 1e-6), BOBJ vẫn đọc lại đủ 20 xương; gói vẫn qua `validate-result`; `check-features` 434/434.
So kết quả với App 1: chạy `normalize.ts --bobj` cùng GLB, độ xoắn sau xử lý hai bên chênh ≤ 1°.

## D6 — sửa 2 lỗi lint có sẵn
`pnpm lint` (từ `three-workspace-app/editor`) báo lỗi parse `import` ở dòng 2 của
`packages/retarget/workbench/public/app.js` và `viewer.js` (file ES module chạy trong trình duyệt). Sửa cấu hình
nhận diện đúng các file này là module (ưu tiên sửa trong thư mục `workbench`, ví dụ khai báo cho ESLint; không đổi
luật lint của cả repo). **Đạt khi:** `pnpm lint` không còn 2 lỗi này, không phát sinh lỗi mới; Workbench vẫn chạy.

## D5 — Workbench: chọn đoạn Action, huỷ lượt chạy
- Mỗi Action có ô "từ giây – đến giây" (mặc định cả Action). CLI `normalize.ts` thêm `--range <start>:<end>` áp cho
  mọi Action được chọn; Workbench truyền xuống. GLB xuất ra chỉ chứa đoạn đó, `durationSeconds` trong manifest đúng.
- Nút **Huỷ** khi đang chạy: dừng lượt chạy (pipeline nhận `AbortSignal`), trạng thái `CANCELLED`, không để lại file
  dở trong thư mục kết quả.
**Đạt khi:** test cho `--range` (độ dài, khung đầu khớp nguồn tại `start`) và cho huỷ (không file dở, trạng thái
CANCELLED); `test/workbench.test.ts` vẫn PASS; toàn bộ test retarget PASS.

## D4 — Minecraft20: giảm xô lệch thân trên
Số đo hiện tại (khớp `body → low_body` trên 7 animation LoL/WC3 so với 85 emote gốc): gập p95 **76°** (gốc 43°),
xoắn p95 33° (gốc 27°). Việc: giới hạn/chia lại góc giữa `body` và `low_body` sau khi giải ngược (ví dụ chuyển phần
vượt ngưỡng lên `body` để hông/ngực vẫn đúng hướng), viết trong `toMinecraft20.ts` cạnh `untwistLimbs`, có số đo trong
report (`report.torso`). **Đạt khi:** test tổng hợp chứng minh góc `body→low_body` không vượt ngưỡng, hướng đầu và
hướng hông giữ nguyên (sai số ≤ 2°); test cũ PASS. Claude đo lại trên mẫu thật.

## D1 — App 1: khoá chân bằng IK
Bối cảnh: `cli/quality.ts` đã tính khung chạm đất (`contactRanges`) và độ trượt (`footSlideMeters`); hiện chỉ cảnh báo
`FOOT_SLIDE`. Việc: tuỳ chọn `--foot-lock on|off` (mặc định `off` ở bản này), với mỗi đoạn chạm đất giữ vị trí bàn chân
cố định (vị trí tại khung đầu đoạn), giải IK hai khớp đùi–gối–cổ chân để đặt chân vào đó, chuyển mượt 3–5 khung ở
hai đầu đoạn; không đổi hông/thân. Đặt trong `src/` (thuật toán) + nối `normalizeCore.ts`, `normalize.ts`.
**Đạt khi:** test tổng hợp (chân trượt có chủ đích) cho độ trượt sau khoá < 1 cm trong đoạn chạm, gối không gập ngược,
chiều dài xương không đổi; với `off` kết quả giống hệt hiện tại (so SHA-256 GLB); toàn bộ test PASS. Claude đo trên
Samba (hiện trượt 2.23/2.40 m) và WC3 trước khi bật mặc định.
