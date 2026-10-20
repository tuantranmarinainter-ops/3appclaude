# 2.1–2.4 — Kiểm thử, bảo toàn chức năng và bàn giao

## Mục tiêu / Input/Output
Input source revisions, artifact hashes, fixtures, implementation đã được duyệt. Output report theo ID/test case với expected/actual/tolerance/runtime/version/hash và phần chưa kiểm. [acceptance.yaml](../acceptance.yaml) định nghĩa ca cụ thể; [fixtures](../fixtures/manifest.yaml) khóa files/recipes. Không coi file test tồn tại hoặc report lịch sử là kết quả của bản mới.

## Luồng / code và tài liệu liên quan
| ID | Công việc | Bằng chứng cần có |
| --- | --- | --- |
| 2.1 | Characterization cũ→adapter cùng fixture, importer/exporter/evaluator/time/axes/root/migration/revision | Per-case old/new hashes + sampled errors; native inputs unchanged. Golden lấy từ phiên bản khóa, không sửa expected để test qua. |
| 2.2 | Desktop/WebGL/keyboard/selection/context-loss và Site mới từng Animation version | Browser/GPU/resolution, steps, screenshots/logs, URL Site owner-private/version/source hash; capability local chưa chạy phải nêu. |
| 2.3 | Source file→module→target ID, license/code/assets/fonts/vendor notices | Không orphan chức năng; code presence/test/runtime/user acceptance riêng. Unknown license chặn phân phối asset đó, không xóa importer/chức năng. |
| 2.4 | Gói portable local, startup/preflight, backup/restore, migration/loss reports | Manifest build/tool versions/checksum/NOTICE, start/stop/doctor, mở project sạch và restore vào thư mục mới. |

## Test gates khi code được duyệt
Topview editor: pnpm typecheck, pnpm lint, pnpm test:evaluate, pnpm build; pnpm --filter @topview/3d-studio test:offline; locale checks khi sửa locale. Python từ agent: python -m pytest; Node renderer suite trong editor/packages/director-cli/test. Reuse script upstream theo pinned package.json, không ghi PASS khi chưa chạy.

Animation/Retarget: chạy source fixture harness với artifact khóa rồi bản adapter; ghi exact input/hash/output and browser. Scan85actions + all source modules covered bằng mapping; source test generator là fixture recipe, output golden chỉ được tạo khi chạy characterization sau này.

Numeric thresholds phân biệt adapter giữ nguyên math và chuyển format/bake20Hz. Screenshot phải dùng cùng browser/renderer/GPU/dimensions/camera, tolerance ghi trong report; screenshot đẹp không thay pose/root/tick tests. Game người dùng kiểm khi được phép, build/API không thay game acceptance.

## Gói và startup
Thiết kế v1: portable folder Windows x64 với Studio production build, shared/workspace packages, Python CLI, launcher start.ps1/stop.ps1 và doctor; giữ Next/pnpm build chain. Launcher preflight Node/Python, bind loopback, tạo token/session và exclusive writer. Không tự cài service hoặc sửa PATH. Blender5.1.2 và Java17 là external capabilities (Film worker cần Java); thiếu thì UI giải thích, không chặn các workspace không dùng.

Backup dùng project.export unified, gồm manifest/history/native edits/assets/originals/checksums, không token/runtime lock/cache. Restore kiểm hashes/version/references vào directory mới; projectId mới + restoredFrom; không ghi đè active project. Migration rollback bằng giữ original bytes, không khẳng định có runtime snapshot nếu chưa tạo.

## UI / API / lỗi
Diagnostics panel nguồn/version/capability/test evidence; mỗi case trạng thái not-run/pass/fail/blocked và lý do. Không hiện “đã hoàn tất” chỉ vì build. API project.export/restore và job reporting dùng chung; release packing sau approval, không tự publish/public.

## Nghiệm thu / tác động
QA-01..03 và toàn bộ acceptance matrix. F chỉ kết thúc khi các ID scope đã duyệt đạt hoặc có ngoại lệ người dùng chấp nhận rõ; source behavior gap/unknown game giữ visible. AGENTS giữ dưới200dòng (hiện65); chi tiết kiểm thử ở docs. Chưa có build, runtime, Site hoặc release mới trong đợt hoàn thiện đặc tả.
