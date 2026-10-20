# Báo cáo hoàn thiện đặc tả trước code

Cập nhật2026-10-18. Kết luận: đã hoàn thiện đặc tả thiết kế cho28/28đầu việc phát triển trong LISTCODE; không còn chỉ mô tả cấp nhóm. Chưa có code ứng dụng hợp nhất, test/runtime hoặc phê duyệt code.

## Thành phần bàn giao

| Hồ sơ | Nội dung |
| --- | --- |
| [11feature specs](features/) | Mục tiêu, luồng/I-O, UI/API/module, errors, acceptance, ảnh hưởng và lý do tái dùng/mới |
| [project-v1](contracts/project-v1.yaml) | Field/type/default/validation, IDs/profiles/native motion, transform/time/root ownership, lưu trữ |
| [commands-v1](contracts/commands-v1.yaml) | Command arguments/result/error, broker/lock/CAS/dedup/Undo/Redo/jobs, mẫu request/result/conflict |
| [development](inventory/development.yaml) | 28ID ổn định, dependency, nguồn, planned module, spec/test/phase/UI và trạng thái riêng |
| [acceptance](acceptance.yaml) | 33ca, steps/expected/thresholds/fixture/evidence; toàn bộ đang not-run |
| [fixtures](fixtures/manifest.yaml) | 14file thật khóa SHA256 +3fixture recipes/embedded source, phân biệt expected và actual |
| [source index](inventory/source-index.yaml) | 977file: Topview929,Animation47,Retarget HTML1; kind/hash/target mapping và lexical symbol locations |

## Những khoảng trống đặc tả đã giải quyết

- Chọn Topview native scene graph/timeline/camera, Y-up/mét; giữ native skeleton/motion payload và chuyển Z-up qua adapter rõ ràng. Frame end inclusive, camera ms, Film20Hz; root delta chỉ có một chủ.
- Schema tới field/type/default và command envelope/CAS/history/one-writer; duplicate/timeout/cancel/crash có hành vi và ca kiểm tra.
- Mapping4legacy formats, Retarget type/version1 vẫn ghi buildV9.9; asset relink/fingerprints/unknown fields/loss báo rõ.
- Shell dùng overlay hiện có; transitions/drafts/selection/keyboard/search/capability được mô tả.
- Metarig mapping và skin derivative được xác định là phần mới, không gán thành khả năng V9.12 sẵn có; pose creation vẫn thuộc Animation.
- [Animation lineage](evidence/animation-lineage.yaml):35modules+6app files+2CSS khớp HTML1.31.8; metadata package1.31.5 vẫn ghi riêng. Không rebuild/vendor reconstruction trong đợt này.
- [BBS2.4](evidence/bbs-2.4.yaml):pin0085f77ced9232dc4e26ac51fc7d98f95d1d5b0b,25git blobs và5bridge artifacts. HEAD2.7 không dùng cho2.4. Chọn reuse Java codec/FilmEditor worker staging; native .dat/GZIP/BBS1 và pose/limb channels được mô tả.
- Source namespace khác target ID được ánh xạ rõ; không coi Animation source1.1 là shell đích1.1 hay Topview source1.5 là Animation đích1.5.

## Giới hạn chứng cứ còn lại, không phải đặc tả chưa viết

1. Index file/symbol không thay audit hành vi từng dòng hoặc chạy434builder files; preservation/characterization đầy đủ vẫn là gate trước thay đường chạy cũ (LISTCODE3.7).
2. FX-METARIG và FX-E2E đã có recipe/expected nhưng chưa tạo asset/project/Film golden. Historical reports chưa chạy lại; ngưỡng thiết kế phải được đo thực tế, không tự nới để pass.
3. Offline Film worker và editable bone export là thiết kế mới dùng codec/schema cũ; parseable file chưa chứng minh game parity. Playback và edit/save/reopen chưa nghiệm thu.
4. Vendor bridge thiếu source, API binary đã pin; redistribution/license/model rights cần kiểm trước đóng gói. Java17 là dependency tái dùng codec, chỉ bắt buộc cho Film worker.
5. Tên/root app chưa chọn; code scope chưa duyệt. Các quyết định kỹ thuật ở hồ sơ là đề xuất cụ thể để triển khai, không được biến thành “user-accepted” tự động.

## Bước kế tiếp

Có thể trình phạm vi C (IDs1.1.*,1.2.*,1.6.1/1.6.3 liên quan) kèm fixture/gates cho người dùng duyệt. Không tự triển khai từ yêu cầu hoàn thiện đặc tả. Kiểm tra hồ sơ thực tế và kết quả ở [validation report](evidence/docs-validation.yaml); build/browser/game/Site chưa chạy.
