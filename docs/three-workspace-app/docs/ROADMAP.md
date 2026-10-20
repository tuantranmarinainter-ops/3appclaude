# Kế hoạch phát triển và điều kiện chuyển bước

## Workspace01 — kế hoạch phần thiếu ngày 2026-10-20

[W01-PLAN-003](features/workspace01-remaining.md#4-thứ-tự-thực-hiện-và-điều-kiện-chuyển-bước) là kế hoạch hiện hành cho phần thiếu W01: P0 identity/capability/checks → P1 calibration/mapping → P2 animation-only/Assignment → P3 model/skin/atomic Scene → P4 review/runtime. Người dùng đã duyệt triển khai đầy đủ; [17 task và phụ thuộc](inventory/workspace01-remaining.yaml) đang được thực hiện. DOC-116 ghi solver regression và test; production build, fixture ngoài và browser runtime vẫn chưa xác minh. Các phạm vi rộng dưới đây không tự trở thành công việc ngoài yêu cầu W01.

| Giai đoạn | Phạm vi / đầu ra | Gate |
| --- | --- | --- |
| A — Nguồn/kiểm kê | Versions/hash/977file index/module-target maps và focused source audit đã có | File index không thay full behavior audit; characterization chi tiết từng module trước chuyển (3.7) |
| B — Thiết kế | 11specs,project/API contracts,28tasks,33cases,fixture registry đã hoàn thiện | Docs validation đạt; thiết kế làm căn cứ cho phạm vi triển khai đã được duyệt |
| C — Nền chung | Đang triển khai một phần trong app copy: shell/workspace/search, IDs/scene/native-motion/history/broker/migration/CLI | DATA,HISTORY,MIGRATE,API,UI,NAV cases; crash/stale/duplicate không mất dữ liệu |
| D1 — Scene | Đang triển khai một phần: builder/HostAdapter/scene/assets/camera/shot/check/render | Upstream gates+SCENE cases; typed identities không đổi semantics |
| D2 — Retarget | Đang triển khai một phần: V9.12,85actions65↔20,corrections,Metarig mapping,project/export | RETARGET,RIG,FORMAT; source85actions golden, unmapped weights chặn derivative |
| D3 — Animation | Đang triển khai một phần: rig/pose/IK/skin,graph/layer/library/director/scene-motion/import-export | ANIM,RIG,FORMAT; exact1.31.8 parity; Site riêng cho version mới |
| E — Film | Đang triển khai một phần: worker Java17 reuse codec2.4, assets, playback và pose keys | FILM-01 riêng với gameFILM-02/03; E2E hai actor3s1camera, sửa key/lưu/mở |
| F — Bàn giao | Chưa đạt: hồi quy chức năng, rights/notices, portable local, backup/restore | QA cases và mọi ID scope được duyệt có evidence; không gộp not-run thành pass |

Phụ thuộc cụ thể ở [development](inventory/development.yaml), thông số ở [acceptance](acceptance.yaml). Giữ IDs khi đổi ưu tiên. Source cũ vẫn dùng để so sánh, không sửa golden/baseline cho khớp adapter. Ngưỡng thất bại cần tìm nguyên nhân; thay yêu cầu phải được nêu và duyệt.

## Ưu tiên đấu nối và mốc demo — điều chỉnh 2026-10-19

Rút lại các ước lượng thời lượng DOC-061: chưa có bảng khối lượng các adapter còn thiếu hoặc tốc độ hoàn tất luồng đã đo để làm cơ sở. Số nhóm partial không quy đổi thành thời gian phát triển. Lịch sử thay đổi giữ ở HISTORY.

Đây là dự án tái sử dụng code. Theo AGENTS và REUSE_MATRIX, giữ solver/evaluator/importer/exporter đang hoạt động; bọc JS bằng adapter trước, không viết lại chỉ để đổi sang TypeScript/React. Các phần mới chủ yếu là identity, dữ liệu project chung, command/history và chuyển đổi unit/basis. Chỉ bổ sung logic khi đã xác nhận module nguồn không đáp ứng yêu cầu đích.

| Ưu tiên | Công việc cụ thể | Bằng chứng bàn giao |
| --- | --- | --- |
| Demo phần đã có | Khởi chạy bản sao Studio, dùng lại fixture và luồng import FBX → Motion cùng rig → timeline → Film export đã có kiểm thử DOC-059; chuẩn bị hướng dẫn thao tác và địa chỉ local đang chạy | Browser thực chạy lại thành công, file xuất kiểm hash, các chức năng dùng được và giới hạn được liệt kê |
| Retarget → project → timeline | Đối chiếu đường bake/export V9.12 và player hiện có; nối clip đích vào Motion, blob bất biến, shared command/history và playback. DOC-061 JSON download chưa đáp ứng luồng này | Cùng fixture kiểm pose nguồn/đích, save/reopen, undo/redo và phát trên timeline; không tăng tính năng xuất riêng trước khi khép luồng |
| Animation native → project chung | Dùng các module runtime Animation 1.31.8 đã khóa nguồn; adapter UI/state/history cho rig, graph, layers và import/export | Chức năng nguồn chạy trong app hợp nhất và dữ liệu giữ đúng khi chuyển workspace |
| Hoàn tất phạm vi | Tiếp tục mọi ID LISTCODE 1.1–1.7 và các gate liên quan theo đặc tả | Đủ bằng chứng cho từng yêu cầu, bao gồm các bước Film Editor/game cần quyền và kiểm thử tương ứng |

Tiến độ nghiệm thu vẫn theo số nhóm hoàn tất trên 24, không quy đổi partial thành %. Báo riêng luồng demo đã chạy được và điểm đấu nối còn thiếu để người dùng thấy đầu ra thực tế. Mốc demo không thay thế hoặc thu hẹp phạm vi toàn dự án; chỉ lập ETA mới khi có khối lượng adapter và kết quả đo đủ căn cứ.

Phạm vi triển khai hiện được duyệt là hoàn thành LISTCODE 1.1–1.7 trong bản sao ứng dụng `three-workspace-app/`, đồng thời cập nhật evidence và giữ các mục partial cho đến khi qua gate. Không sửa checkout Animation/Retarget/Topview gốc; không commit, publish Site/release, cài mod hoặc chạy game. Fixtures source/test đã chọn; binary golden/runtime chỉ phát sinh trong workspace copy khi kiểm thử phù hợp.
