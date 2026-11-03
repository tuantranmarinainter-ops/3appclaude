---
name: w01-spec
description: Biến một ý tưởng/tính năng lớn của W01 thành đặc tả trong docs/ rồi soạn lệnh giao việc cho agent khác (Claude 2, Codex, Muse) kèm link GitHub và luật sub-agent. Dùng khi người dùng mô tả tính năng mới nhiều bước ("tôi muốn…", "làm giống iClone…", "chế độ mới…"), khi nói "hỏi tôi rõ hơn", "viết đặc tả", "giao lệnh cho agent khác/Codex", hoặc khi một yêu cầu quá lớn để code ngay trong lượt.
---

# Đặc tả và giao việc W01

Người dùng làm phim một mình, quyết định nhanh nếu được hỏi đúng cách. Việc lớn mà code ngay theo phỏng đoán thường phải làm lại.

## 1. Hỏi (từng câu hoặc cả bảng)
- Trước tiên **đọc code hiện trạng** để câu hỏi bám vào thứ đang có (file, hàm, giới hạn), không hỏi chung chung.
- Mỗi câu có 2–4 lựa chọn A/B/C, mô tả hệ quả người dùng sẽ thấy, đánh ⭐ lựa chọn đề xuất. Người dùng hay trả lời gọn kiểu "1a 2a 3b…".
  Muốn hỏi từng câu thì một câu mỗi lượt. Người dùng nói "hỏi rõ hơn, đặc tả kỹ" thì đưa cả bảng câu hỏi chia nhóm A/B/C/D/E.
- Câu bỏ trống thì dùng lựa chọn ⭐. Câu mở (mẫu tham khảo, số lượng thực tế) để cuối.
- Người dùng nói "bạn chốt" thì tự quyết, ghi rõ trong đặc tả là **[Claude chốt]** để họ đổi được.

## 2. Viết đặc tả
File `docs/<CHỦ-ĐỀ>-TASK-<yyyy-mm-dd>.md`, theo mẫu `references/spec-template.md`: vì sao, hiện trạng (đã kiểm code),
bảng chốt, mục tiêu / không làm / coi là hỏng, trải nghiệm người dùng, thiết kế kỹ thuật (hướng), chia đợt, **đo số bắt buộc**,
bài test thủ công, builder tự quyết, ràng buộc.
Tiếng Việt, ngắn từng ý. Ngưỡng đo phải là số kiểm được (cm, độ, FPS, giây, hash), không ghi kiểu "mượt".

## 3. Người đọc kiểm tra
Giao một sub-agent mới (Sonnet) đọc đặc tả với vai "người sẽ lập kế hoạch build, không hỏi được người viết". Yêu cầu: chỉ liệt kê
câu hỏi mà đoán sai sẽ tốn kém, xếp theo mức quan trọng, dưới 400 từ. Chia câu trả lời thành ba nhóm:
- đã có câu trả lời → ghi vào đặc tả
- nhỏ → tự chốt, ghi "[Claude chốt]" vào mục "Câu hỏi của người đọc kiểm tra"
- chỉ người dùng trả lời được → hỏi người dùng **một lần**

Commit đặc tả lên main (`docs: <chủ đề> task spec`).

## 4. Soạn lệnh giao việc
Theo `references/handoff-template.md`. Bắt buộc có:
- link GitHub tới đặc tả (`https://github.com/tuantranmarinainter-ops/3appclaude/blob/main/docs/...`)
- chia đợt + nhánh + PR xếp chồng, không tự merge
- **luật sub-agent**: điều phối viên huy động mọi sub-agent phù hợp, model luôn dưới Opus 5.5 (Sonnet cho code/đo/review, Haiku cho tìm/đọc),
  cấm Opus/Fable; tự kiểm lại kết quả sub-agent
- ràng buộc dữ liệu (bản sao, `W01_LIBRARY`), cổng riêng, các bẫy máy Windows
- trạng thái NOT_RUN/BLOCKED/FAIL/PASS, báo cáo tiếng Việt có thanh progress

Codex dùng model "terra" (high) cho sub-agent của nó. Muse cần đặc tả trong docs/ + push trước khi giao.

## 5. Sau khi giao
Ghi một memory ngắn: ai làm, nhánh nào, mình là người kiểm. Khi agent kia báo lại: đọc diff, chạy test, đo lại số, xem trình duyệt
(skill `w01-browser-check`). Đừng tin báo cáo suông.
