# Đề xuất AGENTS.md cho app hợp nhất ba workspace

Ngày: 2026-10-18. Trạng thái: **đã được người dùng duyệt và áp dụng phần AGENTS ở mục 3**. [AGENTS.md hiện hành](../AGENTS.md) có 65 dòng, dưới giới hạn 200 dòng; phần đối chiếu được giữ để truy nguyên. Ba AGENTS.md nguồn không thay đổi. Đây không phải quyền code ứng dụng.

## 1. Tài liệu đã đối chiếu

- [Animation Studio — AGENTS.md](<C:/Users/Administrator/Documents/Codex/2026-10-09/animation-studio/AGENTS.md>): quy tắc duyệt theo list tại dòng 86–94; ranh giới với Retarget tại dòng 23; điều hướng docs tại dòng 47–55. File còn chứa nhiều lịch sử và quyền triển khai tới 1.27.x; không dùng các đoạn “bản hiện hành” cũ để chọn source 1.31.8.
- [Retarget — AGENTS.md](<C:/Users/Administrator/Documents/Codex/2026-10-08/retarget-anim-65-20-html/AGENTS.md>): xác nhận trước code, đọc action.md, giới hạn V9.9/V9.11. Đã đối chiếu thêm [V9.12 changes](<C:/Users/Administrator/Documents/Codex/2026-10-08/retarget-anim-65-20-html/Emoticons_Mixamo_Full_Project/docs/V9_12_CHANGES.md>) và action.md mục 29: gỡ editor tạo pose riêng, giữ chỉnh motion/calibration và 85 clip.
- [Topview v0.1.8 — editor/AGENTS.md](<C:/Users/Administrator/Documents/ChatGPT/BBS MINECRAFT/.build-tools/topview-3d-builder-v0.1.8/editor/AGENTS.md>): phân tầng package/host, API tương thích, golden fixtures, bộ kiểm tra và tổ chức panel. Checkout này không có AGENTS.md ở root; file tìm thấy áp dụng cho `editor/`, không mô tả đầy đủ quy trình Python `agent/`.
- [AGENTS.md hiện tại của dự án](../AGENTS.md), [PROJECT](PROJECT.md), [STATUS](STATUS.md), [SOURCES](SOURCES.yaml), [REUSE_MATRIX](REUSE_MATRIX.md), cùng yêu cầu workspace do người dùng cung cấp.

Đã đối chiếu lệnh Topview với `editor/package.json`, `editor/apps/studio/package.json` và `agent/pyproject.toml`; chỉ xác minh khai báo, không chạy build/test.

## 2. Giữ, sửa và không kế thừa

| Chủ đề | Đề xuất cụ thể cho dự án hợp nhất | Căn cứ / lý do |
| --- | --- | --- |
| Quyền code | Giữ duyệt theo ID LISTCODE, phạm vi và tiêu chí; quyền đã duyệt còn hiệu lực, không hỏi lại từng mục. Quyền ở chat/app nguồn không tự chuyển sang app mới. | Animation quy định rõ; Retarget cùng nguyên tắc. Hiện chỉ A–B tài liệu được duyệt. |
| Nội dung AGENTS | Chỉ giữ quy tắc hiện hành và liên kết; trạng thái ở STATUS, nguồn ở SOURCES, quyết định ở HISTORY, bằng chứng ở CHECKPOINTS. | Animation hiện trộn lịch sử, phiên bản và quyền; dễ chọn sai source hoặc phạm vi. |
| Ranh giới Animation/Retarget | Đổi “app độc lập” thành “workspace trong cùng project”; bảo vệ source/app gốc. Editor tạo pose ở Animation; chỉnh khớp, reference pose, calibration và timeline đích vẫn ở Retarget. | Mục tiêu hợp nhất mới và yêu cầu V9.12. Pose library của Topview vẫn được giữ. |
| Kiến trúc Topview | Giữ package/host boundary, public exports, HostAdapter, host quản lý file/asset URL. Studio dùng package build, không alias trực tiếp vào source builder. | Topview §1/§3; giảm phụ thuộc ngược khi gắn ba workspace. |
| Định vị sản phẩm | Sửa “chỉ npm package + host debug” thành “app local với host sản phẩm và các package tái sử dụng”. Không bắt buộc giữ overlay/route cũ nếu thiết kế tích hợp đã được duyệt. | App mới có ba workspace; cấu trúc tương tác không phải toàn bộ sản phẩm cũ. |
| Ngôn ngữ | Không chép quy tắc host chỉ dùng tiếng Trung/cấm locale. Giữ hệ thống locale đang có; ngôn ngữ mặc định app hợp nhất chốt trong đặc tả UI. | Topview AGENTS dòng 123 mâu thuẫn với `apps/studio/src/locale/catalog.ts` ở cùng tag: có 15 locale, gồm `vi`, mặc định `en`. |
| Git và quyền thao tác | Dùng `codex/<mo-ta>` theo môi trường hiện tại, không tự sao chép `feature/`, `fix/`, `refactor/` từ upstream. Commit/push/public/production cần quyền tương ứng. | Quy trình workspace/app hiện tại; quyền code không tự bao gồm phát hành. |
| Site kiểm thử | Bản Animation Studio mới phải có Site mới, owner-private; không ghi đè bản trước. Site là bằng chứng browser, không thay nghiệm thu CLI/local/game. | Quy định workspace ngày 2026-10-16. Không chép lại lệnh “không publish” của một đợt cũ thành cấm Site private hiện hành. |
| Kiểm thử | Giữ bộ gate Topview khi sửa editor; thêm kiểm tra CLI khi sửa agent và đối chiếu golden cho Retarget/Animation. Sửa docs chỉ kiểm docs. | Không đồng nhất DOM/typecheck với WebGL hoặc game; golden evaluator không bao phủ tải model và playback. |
| FPS/trục/đơn vị | Giữ semantics từng nguồn qua adapter; không biến Minecraft 30 FPS thành FPS chung toàn app; BOBJ/BBS tick rate là đại lượng riêng. Không tự mở mục 120 FPS đang hoãn. | Retarget action.md; shared contract cần chuyển đổi tường minh, bảo toàn dữ liệu. |
| File lớn và tái sử dụng | Quy tắc panel React áp dụng phần mới hoặc phần đang sửa; không ép tách toàn bộ HTML/JS cũ chỉ để đạt ngưỡng dòng. | Topview §8 + yêu cầu tái sử dụng và chuyển module theo đợt. |
| Quyền ưu tiên | Không chép “AGENTS này là nguồn quyền duy nhất” của upstream thành quyền ghi đè người dùng/workspace. Phân biệt quy tắc sản phẩm, bằng chứng code và lịch sử cấp quyền. | Ba bộ hướng dẫn có phạm vi khác nhau; chỉ dẫn mới của người dùng quyết định mục tiêu hợp nhất. |

## 3. Bản AGENTS.md đề xuất để thay file hiện tại

Khối dưới dùng đường dẫn tương đối tính từ **AGENTS.md ở gốc `docs/three-workspace-app/`**, không tính từ file đề xuất này. Các đường dẫn `editor/` và `agent/` là cấu trúc app đích dự kiến. Khi tạo thư mục source app riêng, đặt hướng dẫn ở root app và cập nhật liên kết; AGENTS ở thư mục docs không tự áp dụng cho source nằm bên ngoài nó.

```markdown
# App ba workspace — Quy tắc làm việc

## 1. Phạm vi và quyền thao tác

- Tuân thủ [AGENTS workspace](../../AGENTS.md) và yêu cầu mới nhất của người dùng. Superpowers đang tạm ngưng theo quy định workspace; không tự bật lại.
- Đây là app PC local, giao diện browser, dùng TypeScript/React/Three.js và Python CLI; Retarget, Scene và Animation cùng làm việc trên một project.
- Giai đoạn hiện hành và phạm vi được duyệt ghi ở [STATUS](docs/STATUS.md), liên kết các ID trong [LISTCODE](LISTCODE). Tại thời điểm lập quy ước này chỉ A–B tài liệu/khảo sát được duyệt; chưa có quyền sửa ứng dụng.
- Trước đợt code mới, trình danh sách ID, thay đổi, phần tái sử dụng, phụ thuộc và tiêu chí nghiệm thu. Chỉ code phạm vi người dùng xác nhận rõ. “Ghi nhận”, “góp ý”, “đề xuất” hoặc “sửa docs/AGENTS” không cấp quyền sửa ứng dụng.
- Phạm vi đã được duyệt tiếp tục có hiệu lực: thực hiện đầy đủ và kiểm tra cần thiết, không hỏi lại mỗi mục hoặc tự thu hẹp. Chỉ làm rõ phần còn thiếu thông tin quyết định hoặc công việc mới ngoài phạm vi.
- Không kế thừa quyền code, phát hành hay phiên bản baseline từ các chat/app nguồn. Không tự commit, push, phát hành công khai, đưa lên production, thay mod hoặc chạy game khi chưa có quyền tương ứng.

## 2. Thứ tự đọc và nơi lưu thông tin

- Phiên mới đọc AGENTS → [STATUS](docs/STATUS.md) → [SOURCES](docs/SOURCES.yaml) → LISTCODE và đặc tả liên quan → inventory/CODEMAP → source, caller và tests bị ảnh hưởng.
- [PROJECT](docs/PROJECT.md) chứa yêu cầu đã chốt; [ARCHITECTURE](docs/ARCHITECTURE.yaml) là thiết kế đích; [CODEMAP](docs/CODEMAP.md) mô tả code thực tế. Không coi kiến trúc dự kiến là implementation đã có.
- STATUS chỉ giữ hiện trạng. [HISTORY](docs/HISTORY.md) giữ quyết định theo thời gian. [CHECKPOINTS](docs/CHECKPOINTS.md) giữ nguồn, artifact, kiểm tra và giới hạn thực tế. Không chèn lại lịch sử phiên bản dài vào AGENTS.
- Sau thay đổi, chỉ cập nhật những tài liệu bị ảnh hưởng. Không đổi hoặc xóa lịch sử để làm trạng thái trông hoàn thiện hơn.

## 3. Khóa nguồn và bảo toàn chức năng

- Nguồn chuẩn, phiên bản, đường dẫn, commit/hash, builder và artifact nằm trong SOURCES. Không tự chọn thư mục `src/` gốc hoặc bản có tên mới nhất.
- Animation Studio 1.31.8 còn sai khác nhãn package/lineage; giữ trạng thái chưa xác minh cho tới khi chứng minh source–artifact. Retarget dùng V9.12. Topview dùng full checkout v0.1.8 đã pin, không lấy bundle runtime làm toàn bộ source.
- Source, HTML bàn giao, Site, baseline và fixture gốc là tài liệu đối chiếu; triển khai app hợp nhất ở nguồn riêng sau khi vị trí được chốt. Không chỉnh nguồn gốc để làm kết quả mới khớp.
- Ưu tiên giữ logic đã hoạt động: JS qua adapter có kiểu trước, chuyển TypeScript theo module sau. Không viết lại solver, evaluator, importer/exporter hoặc schema chỉ để đồng nhất công nghệ.
- Mỗi quyết định sửa/viết mới phải có lý do không tái sử dụng nguyên trạng, phạm vi ảnh hưởng và đặc tả. Mọi chức năng nguồn phải có ánh xạ tới app đích hoặc ngoại lệ được người dùng chốt.
- Giữ Metarig, Mixamo65 và Minecraft20 trong mục tiêu hiện tại; không tự thêm lại Minecraft25. Không suy ra mọi skeleton hoặc format đều tương thích.
- Retarget giữ 85 clip, hai chiều, mapping/calibration/reference pose, chỉnh motion, timeline đích, root motion, project/history và import/export. Không khôi phục editor tạo pose đã gỡ ở V9.12; chức năng đó thuộc Animation. Pose library và posing của Scene được bảo toàn theo source Topview.
- FPS, tick rate, trục, đơn vị, rotation order và quyền sở hữu root motion phải tường minh; chuyển ở adapter và giữ dữ liệu nguồn. Không dùng tốc độ preview để thay tốc độ export hoặc tính root motion hai lần.

## 4. Kiến trúc và dữ liệu chung — áp dụng khi triển khai được duyệt

- Giữ Next.js/pnpm và ranh giới package của Topview. Host `editor/apps/studio` quản lý project list, lưu file, asset catalog, path/URL, API và UI chuyển workspace. Package builder xử lý editor của một document qua public exports/HostAdapter; host tiêu thụ build package, không alias vào `builder/src`.
- Không đưa `fetch`, URL `/api/`, đường dẫn local, tên model cố định hoặc CDN fallback vào builder. Giao tiếp I/O đi qua host/adapter. Kiểm API hiện có trong `src/index.ts` và `src/host/types.ts`, không suy từ tài liệu kiến trúc mục tiêu.
- Các package Retarget/Animation giữ nghiệp vụ riêng; shared chỉ chứa hợp đồng và xử lý thực sự dùng chung. Không tạo thêm khung trừu tượng chưa có nhu cầu trong LISTCODE.
- Một dữ liệu project có AssetID/CharacterID, SkeletonProfile, Scene Graph/Transform, Timeline/Motion/Root Motion và Camera/Shot. Đổi workspace không tạo ba bản project độc lập.
- UI, Python CLI và API/MCP đi qua cùng command/validation/revision boundary. Chỉ một bên ghi project tại một thời điểm; xử lý stale revision, lỗi và Undo/Redo theo hợp đồng đã đặc tả.
- Giữ tương thích public API, field lưu trữ và asset keys, kể cả `pippitAssetId` của Topview. Thay đổi có thể làm hỏng dữ liệu phải có migration/version và kiểm tra đọc lại; ưu tiên API bổ sung và adapter.
- Import dữ liệu cũ tạo bản chuyển đổi riêng, báo field không chuyển được, không ghi đè bản nguồn. Không gọi một manifest scene là Film native nếu codec/importer BBS chưa xác nhận.
- Giao diện theo Topview, có tìm kiếm/thu gọn cây chức năng và thao tác thống nhất. Giữ locale hiện có; không áp quy tắc host chỉ tiếng Trung. Ngôn ngữ mặc định và hành vi tích hợp overlay/route theo đặc tả UI đã chốt.
- Panel React mới theo cấu trúc Topview: mỗi panel một thư mục, `index.tsx` điều phối, hook riêng ở `hooks/`, xử lý thuần ở `utils.ts`/`utils/`. Áp dụng ngưỡng tách của Topview cho panel mới/đang sửa; không di chuyển hàng loạt source legacy chỉ để đạt hình thức.

## 5. LISTCODE, inventory và đặc tả

- ID là chuỗi ổn định, không đổi khi sắp thứ tự ưu tiên. Dùng ID đích LISTCODE/ARCHITECTURE để liên kết công việc; giữ mã module nguồn riêng và ánh xạ rõ nếu namespace cũ khác nhau.
- Mỗi mục inventory có cha/con, chức năng, input/output, caller/phụ thuộc, file/symbol hoặc vùng HTML, trạng thái, bằng chứng và giới hạn, cách tái sử dụng, đặc tả và ID đích.
- Chức năng mới/sửa cần đặc tả: mục tiêu, luồng, I/O, UI, API/module, lỗi, nghiệm thu và tác động liên workspace. Có mặt trong LISTCODE không tự đồng nghĩa đã được duyệt code.
- Tách trạng thái implementation, kiểm thử tự động, runtime và nghiệm thu người dùng. Thiếu bằng chứng ghi unknown/chưa xác minh và lý do; nút UI, file code hoặc build thành công không chứng minh chức năng hoàn thiện.

## 6. Kiểm chứng và bàn giao

- Đổi tài liệu: kiểm YAML, ID/cha-con/phụ thuộc, đích liên kết, source/file/symbol được tham chiếu và tính nhất quán hiện trạng; không chạy build sản phẩm chỉ vì sửa docs.
- Khi sửa builder/Studio, giữ gate upstream: từ `editor/` chạy `pnpm typecheck`, `pnpm lint`, `pnpm test:evaluate`, `pnpm build`, `pnpm --filter @topview/3d-studio test:offline`. Các script tồn tại ở nguồn v0.1.8; báo rõ lệnh nào chưa chạy hoặc bị chặn. Kiểm locale host riêng nếu thay phần đó.
- Khi sửa Python CLI, chạy suite liên quan và hồi quy command/schema/persistence của agent; cấu hình v0.1.8 có pytest, lệnh từ `agent/` là `python -m pytest`. Khi sửa Node renderer, dùng suite trong `editor/packages/director-cli/test/`. Cập nhật lệnh trong README/tài liệu testing khi cấu trúc thay đổi.
- Trích/chuyển module phải đối chiếu cũ–mới trên cùng fixture: pose/transform, animation, texture, JSON và output format. Không ngầm cập nhật golden để test qua; đổi expected phải có thay đổi hành vi đã duyệt và lý do.
- Sửa asset loading, retarget, playback, contract runtime hoặc viewport phải kiểm browser/WebGL phù hợp. Test DOM, renderer giả lập, typecheck và golden evaluator không thay thế kiểm tương tác thật.
- Film BBS FS kiểm theo hai mức: phát đúng scene/nhân vật/motion/camera; và keyframe chỉnh được, lưu/mở lại. Ca xuyên suốt: hai nhân vật, ba giây, một camera qua ba workspace; sửa một keyframe trong Film Editor rồi lưu/mở lại. Game chỉ chạy khi được phép.
- Mỗi phiên bản Animation Studio mới tạo Site kiểm thử mới sau build/kiểm tra phù hợp, owner-private, thể hiện đúng version; không ghi đè Site cũ. Báo URL, source/version/hash và phần cần runtime local hoặc chưa kiểm trên Site. Không tự mở public/production.
- Bàn giao theo cùng ID đã duyệt: đã sửa, tái sử dụng, kết quả kiểm tra, phần còn thiếu, phần chưa kiểm và hạn chế. Không nhận hoàn tất toàn bộ khi mới đạt một phần.

## 7. Tài nguyên, Git và bảo vệ dữ liệu

- Kiểm license/NOTICE theo từng code, asset, font và vendor; license repository không tự áp dụng cho mọi tài nguyên. Giữ attribution khi tái sử dụng.
- Tài nguyên binary và draft người dùng theo manifest/quy tắc lưu trữ đã có; không né `.gitignore` bằng cách nhét model vào docs/package. Built-in assets Topview giữ ở `builtin-assets/`; không tự di chuyển hoặc xóa asset người dùng.
- Không ghi key/token, header Authorization hoặc credential vào source, docs, checkpoint, Site hay log. Dùng cấu hình môi trường theo workspace.
- Khi cần branch dùng tiền tố `codex/`. Không coi quyền sửa code là quyền commit/push. Không ghi đè thay đổi của người dùng, phiên dirty hoặc baseline; chỉ ghi khả năng khôi phục khi thật sự có snapshot/artifact tương ứng.
```

## 4. Những chỗ nên sửa đồng thời khi chốt quy ước

Các mục dưới là việc cần đồng bộ tiếp trong hồ sơ A–B; áp dụng AGENTS không tự đóng các mục này. Xem [mức đầy đủ đặc tả](SPEC_READINESS.md).

1. **PROJECT.md:** bảng “Yêu cầu người dùng đã nêu” còn Minecraft25 và phần “chưa chốt” còn nguồn Topview/Animation dù phần đầu đã chốt nguồn. Đánh dấu đoạn yêu cầu cũ là lịch sử, dẫn quyết định Minecraft20 và SOURCES hiện hành; giữ riêng vấn đề lineage Animation chưa chứng minh.
2. **Namespace ID:** `inventory/topview.yaml` dùng `1.5` cho nguồn Topview, trong ARCHITECTURE/LISTCODE `1.5` là Animation. `inventory/animation.yaml` dùng `1.1`, trong cây đích là shell React. Cần chốt ánh xạ mã nguồn → ID đích, ví dụ lưu mã cũ ở `source_module_id` và thêm `target_ids`; không đổi ID đầu việc đã dùng hoặc coi trùng số là cùng chức năng.
3. **AGENTS ở source tương lai:** hiện hướng dẫn chỉ nằm dưới thư mục docs. Khi chọn root app mới, đặt hướng dẫn tại đó và xử lý các điều khoản upstream đang xung đột trong bản copy dành cho phát triển. Giữ checkout v0.1.8 đã pin làm nguồn đối chiếu.
4. **Các phần chưa chốt:** ngôn ngữ UI mặc định, tên/root app, ngưỡng sai số golden và hợp đồng Film cần nằm ở đặc tả/STATUS, không tự biến thành quyết định chỉ bằng cách đưa vào AGENTS.

## 5. Giới hạn của đề xuất

Phần AGENTS ở mục 3 đã được áp dụng theo yêu cầu người dùng; nội dung đối chiếu còn lại là hồ sơ truy nguyên, không cấp quyền code hoặc nghiệm thu kiến trúc. Chưa chạy build/test/browser/game. Ba AGENTS.md nguồn giữ nguyên.

## Cập nhật sau áp dụng

Ngày2026-10-18: đã làm các cập nhật tài liệu phụ thuộc trong bản đặc tả; xem SPEC_READINESS và DOC-005. Nội dung đề xuất/so sánh phía trên được giữ để truy nguyên, không thay STATUS hiện hành. AGENTS vẫn65dòng, không sửa lại trong đợt hoàn thiện đặc tả.
