# Bàn giao timeline App 2 — 05/11/2026

## Chỉ dẫn và phạm vi

Lệnh gốc: [LENH-GOC.txt](LENH-GOC.txt). Đọc đầy đủ hai đặc tả `docs/TIMELINE-FCURVE-KEYS-TASK-2026-11-04.md`, `docs/TIMELINE-F2-EDIT-TASK-2026-11-05.md`, `CLAUDE.md`, `docs/DECISIONS.md`, `three-workspace-app/editor/AGENTS.md` và `docs/AGENT-SKILLS.md`. Làm F1 → F2 → E1 → E2 → E3, trừ E1 được phép độc lập song song. Mỗi đợt nhánh/PR riêng; không merge khi chưa được người dùng bảo merge. PR xếp chồng giữ đúng base và sau này đổi base vào main theo thứ tự khi các PR nền đã merge.

PR #223 Ctrl+B / Tự dời đã merge `63bad8a`. Giữ nguyên logic cắt/tỉa/xóa ripple và test regression. Người dùng cho phép F2 sửa thêm đúng `apps/studio/src/LocalHostAdapter.ts`, `apps/studio/app/workbench/components/StudioOverlay.tsx` và test liên quan để nối lịch sử unified. Các phạm vi khác giữ theo lệnh gốc; không sửa retarget, golden, không commit binary/kho/project thật. Dùng sandbox riêng, port 3140–3149, không đụng server thật. Dùng subagent gpt-6.1-terra high, review độc lập. Báo tiếng Việt có thanh tiến độ.

## Trạng thái GitHub tại lúc bàn giao

- F1 [PR #225](https://github.com/tuantranmarinainter-ops/3appclaude/pull/225), OPEN, base main, head `claude/timeline-fcurve-f1` `435cf854537774822020242408455a7a44c0a7a7`. Build/typecheck PASS, builder 773 PASS / 1 SKIP. Đo tổng hợp 150 frame × 3 thành phần 11,52 ms một lượt; dữ liệu Shot 03 thật BLOCKED.
- F2 [PR #226](https://github.com/tuantranmarinainter-ops/3appclaude/pull/226), OPEN DRAFT, base `claude/timeline-fcurve-f1`, head `claude/timeline-fcurve-f2` `ba050c38482b52ac8c7ac77e09fe386b2fc9e1a1`. Đã sửa Undo host thành hàng đợi checkpoint; build/typecheck PASS, builder 790 PASS / 1 SKIP, host 5/5. Browser synthetic hai kéo + hai undo/redo PASS; lỗi 409 giả lập giữ local và retry cùng requestId PASS; lưu không đổi 0 scene.apply; Đóng chờ save. Shot03, 150 khóa thật, ảnh dữ liệu thật BLOCKED. Chưa coi dữ liệu thật đạt. Lint toàn kho từng FAIL 6 lỗi import tại file ngoài thay đổi, không che giấu.
- E1 [PR #224](https://github.com/tuantranmarinainter-ops/3appclaude/pull/224), OPEN, base main, head `claude/timeline-f2-e1` `98cc824ec1492bf72033c0e4264fd0390d8d1a88`. Build/typecheck PASS; builder 775 PASS / 1 SKIP; 126 test liên quan PASS; offline smoke cô lập PASS. Kiểm thật Shot03 và ảnh BLOCKED.
- E2 [PR #227](https://github.com/tuantranmarinainter-ops/3appclaude/pull/227), OPEN DRAFT, base `claude/timeline-fcurve-f2`, head `claude/timeline-f2-e2` `f06111d7b1a7afbc6589a2e40ac24c2dc0fc7a46`. Builder 794 PASS / 1 SKIP, typecheck PASS. Browser synthetic copy khung 20 sang 60/100, sai lệch giá trị kiểm 0, key ngoài đích giữ nguyên và undo/redo khôi phục JSON. Ghost selection test unit, click ghost thật NOT_RUN. Shot03 BLOCKED. **Còn lỗi đường đi khi tắt lớp userKeys; đừng merge.**
- E3 chưa triển khai và chưa có PR. Đã khảo sát read-only; làm sau khi E2 hoàn tất.

Các con số là của lượt chạy đã nêu, không phải xác nhận máy mới. PR #226 và #227 vẫn nháp; không tự đổi trạng thái hay merge khi gate thiếu.

## Quyết định E2 người dùng đã trả lời

Ngày 05/11 người dùng chọn **chặn riêng và hướng dẫn bật lại**: khi userKeys đang tắt và node có track userKeys vị trí, chặn lệnh Dán vị trí cho trường hợp đó, kèm hướng dẫn bật lại userKeys. Không âm thầm sửa cơ chế toggle/đường đi hoặc chặn mọi lệnh dán: rotation/scale và trường hợp có fcurve đủ trục không vướng track vị trí phải được xét theo plan/mask. Giữ quy ước canonical path hiện có; kiểm bật/tắt không đổi JSON/history, bảo toàn clip thường/node khác, dán/undo/redo và vị trí/hướng. ĐÂY LÀ QUYẾT ĐỊNH ĐÃ CÓ, không hỏi lại. **Chưa được áp dụng vào PR #227** vì người dùng đã yêu cầu dừng.

## Việc cần tiếp tục

1. Kiểm GitHub mới nhất, tình trạng merge/branch/dirty trước khi sửa; `main` lúc bàn giao là `71e5ff410dc62995d535de68a84749f97560f016`, có thể thay đổi. Không reset hay force-push lịch sử người khác. Lệnh gốc và các quyết định của người dùng được ưu tiên.
2. Trên nhánh E2 áp dụng quyết định nêu trên. Cập nhật test theo userKeys off, position track, mixed selection/khóa, fcurve đủ và thiếu trục, camera, path/yaw, toggle/undo/redo. Test menu chuột phải/nhấp đôi, sao chép/dán nhiều đích với sai lệch ≤1e-6 và browser synthetic. Kiểm dữ liệu thật/ảnh khi có bản sao Shot03; ghi BLOCKED nếu không có. Chạy typecheck toàn workspace, builder tests, relevant Studio và cập nhật report, PR #227. Giữ các thay đổi #223 và lịch sử unified F2.
3. Tiếp E3 sau E2. Kéo nhóm clip + userKeys + fcurves chung một delta, 1 history và 1 undo/redo; không ghép `endClipMove` rồi `moveTimelineKeys` vì tạo 2 history. Trích mutation chung, snapshot content/userKeys/fcurves một lần; preview cùng delta, clamp theo đặc tả, bỏ locked riêng, kiểm revision/pointercancel. Bảo toàn single clip, blend, Ctrl+B/ripple, clip ngoài nhóm. Kiểm selection additive cả clip→key/key→clip và bó user/fcurve; `nextClipSelection`, `nextKeyframeSelection`, `nextBundleSelection` có thể làm rơi selection. Kiểm selection fcurve sau undo/redo. Browser và số đo đúng đặc tả, một PR nhánh `claude/timeline-f2-e3` từ E2 theo lệnh gốc.
4. E1 và F2 sửa cùng `StudioOverlay`, `StudioSession.save` và test: ghép thử trong worktree tạm từng có 3 conflict đã giải thử, build/typecheck PASS + 62/62 test save/exit/F2/ripple; browser Ctrl+S khi lưu chậm và Về danh sách PASS. **Bản ghép thử không được commit hay push**. Khi một PR merge, rebase/giải lại cẩn trọng, giữ cả E1 Lưu/Ctrl+S/thoát, F2 FIFO/ACK/retry/conflict recovery và #223; chạy test lại.

## Môi trường và bằng chứng

Workspace trước ở Linux: `/workspace/timeline-fcurve-f1`, `/workspace/timeline-fcurve-f2`, `/workspace/timeline-f2-e1`, `/workspace/timeline-f2-e2`; lúc bàn giao tất cả sạch và HEAD khớp remote. Các đường `/tmp` chứa ảnh/log trước có thể không còn trên máy mới; chưa đính kèm ảnh PR, không claim có ảnh Shot03. Kiểm `W01_LIBRARY`, `BBS_UNIFIED_PROJECTS_DIR` trỏ sandbox tổng hợp hoặc bản sao, không dùng mặc định kho thật; Next có thể tự sửa `apps/studio/tsconfig.json`, hoàn tác chỉ file sinh bởi lệnh mình trước commit. Chạy test bằng browser trên sandbox; không chạm 3016/3101/3127. PR skill script `gh_pr.py` đã thử nhưng `git credential fill` lỗi trong môi trường cũ; fallback `gh` đã mở PR thành công. Không in token hay vô hiệu TLS.
