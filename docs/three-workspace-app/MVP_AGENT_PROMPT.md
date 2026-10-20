# Prompt giao agent triển khai MVP

> **Mẫu lịch sử chưa bao gồm Animation Creation tối thiểu.** Không gửi nguyên mẫu bên dưới cho đợt bổ sung này: D2 chỉ có actor transform sẽ lặp lại thiếu sót. Đọc [đặc tả native integration](docs/features/animation-creation-integration.md) và [task AC](ANIMATION_CREATION_TASK_PLAN.md), rồi xác nhận phạm vi AC muốn giao. Native creation đang được đề xuất, chưa được tự động cho phép code. Prompt bên dưới giữ để truy vết phạm vi trước.

Ngày: 2026-10-19. Đây là **mẫu để người dùng đọc và gửi** sang agent code. File nằm trên đĩa không tự cấp quyền. Mẫu chọn Mixamo65 và ca forward Minecraft20→Mixamo65 trong đặc tả; sửa phạm vi trong prompt trước khi gửi nếu đó không phải lựa chọn mong muốn.

---

Tôi xác nhận cho phép sửa mã ứng dụng hợp nhất để hoàn thành MVP Runtime theo phạm vi dưới đây. Workspace: `C:/Users/Administrator/Documents/ChatGPT/BBS MINECRAFT`.

Đọc AGENTS hiện hành, rồi đọc:

1. `docs/three-workspace-app/MVP_IMPLEMENTATION_HANDOFF.md` — đặc tả triển khai, hợp đồng nối,20 assertion và giới hạn.
2. `docs/three-workspace-app/MVP_RUNTIME_READINESS_REVIEW.md` — bằng chứng hiện trạng, không phải kết quả nghiệm thu mới.
3. `docs/three-workspace-app/MVP_PRIORITY_PLAN.md` — P0/phụ thuộc; phương án hiện tại là B một app, A chỉ đối chiếu/dự phòng.

Tôi chọn MVP target **Mixamo65**, model có mesh/skin và một action Minecraft20 từ thư viện BOBJ V9.12 để forward-retarget thật. Giữ nguyên mọi source/action. Không dùng same-rig FBX import để thay bước retarget; không dùng Minecraft20 thay target25. Không mở rộng sang arbitrary rig, MC25, full parity hoặc toàn bộ tính năng nâng cao trong lượt này.

Hãy hoàn thành luồng trong một app: Import target model + chọn motion nguồn → Retarget → lưu target asset/Motion dùng chung → Scene với hai Character/camera → Animation và một blocking transform key → export ZIP native thật. Ưu tiên tái dùng native forward solver/bake/export, host converter GLB→FBX, importer FBX, shared store/history, evaluator và Film worker hiện có. Không viết lại solver hoặc serializer. Nếu roundtrip fail, chứng minh nguyên nhân và sửa adapter nhỏ nhất; không hạ tiêu chí hoặc giả fingerprint.

Triển khai D0 tối thiểu rồi D1→D2→D3, chỉ sửa các module/caller/tests/config cần cho phạm vi này. D0 dùng CLI/broker/DevTools và harness đang có; bổ sung health, snapshot, job stage/error và gói báo lỗi. MCP dùng server hiện có, chỉ báo kết nối thành công sau live handshake đúng client. CLI hoạt động là đường debug tạm thời nếu MCP chưa nối; không để việc xây MCP kéo dài phần MVP.

Trước sửa kiểm tra thay đổi đang có và evidence liên quan; giữ nguyên việc của người dùng/agent khác. Không rà lại toàn bộ catalog hoặc lập một hệ kế hoạch mới. Ánh xạ evidence cũ vào assertion đúng version/fixture, làm phần còn thiếu. Gặp lựa chọn kỹ thuật thông thường trong phạm vi đã duyệt thì tự quyết phương án ít sửa nhất, ghi lý do; chỉ cần hỏi khi thiếu asset bắt buộc, thay phạm vi sản phẩm hoặc cần quyền ngoài phạm vi này. Tiếp tục phần độc lập trong khi chờ.

Thường xuyên báo thanh tiến độ **APP n/16 PASS; BBS m/4 PASS**, milestone đang làm, blocker cụ thể và bước tiếp theo. Đây là tiến độ MVP, không phải toàn bộ dự án. Không dùng số dòng code,93% nhóm có code, unit test hoặc UI mock làm phần trăm runtime. Sau D0/D1 cung cấp ước lượng phần còn lại dựa trên lỗi/task thực tế và điều kiện chờ, không hứa ngày thiếu căn cứ.

Giao ngay từng mốc chạy được. Khi D0–D3 đạt, cung cấp cách launch, URL local thật, project/fixture manifest, ZIP trên đĩa, hướng dẫn click và report assertion để tôi test. Chạy gate của AGENTS và browser/WebGL phù hợp, ghi rõ cái chưa kiểm. Không gọi E2E hoàn tất trước D4: BBS FS2.4/MC1.20.1 import, playback, sửa key, save/reopen. Hãy chuẩn bị package/hướng dẫn để tôi kiểm game; không tự chạy game, copy vào profile, thay mod. Chờ game không phải lý do dừng phần app đã được duyệt.

Không sửa source/baseline gốc; không tự commit/push hoặc publish public/production. Nếu tạo phiên bản Animation Studio mới, thực hiện quy định Site kiểm thử mới owner-private, không ghi đè Site cũ; ghi rõ phần backend/game không kiểm được trên Site. Cập nhật docs hiện trạng và checkpoint theo bằng chứng; không nâng trạng thái chỉ vì build hoặc codec parse PASS.

---

Chỉ phần giữa hai đường kẻ là nội dung giao việc. Người dùng gửi phần đó là xác nhận phạm vi code cho agent nhận; agent đang chuẩn bị tài liệu không tự thực thi prompt này.
