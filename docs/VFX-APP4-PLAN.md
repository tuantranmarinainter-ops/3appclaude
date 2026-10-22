# App 4 VFX — Đánh giá và đề xuất nâng cấp effekseer-ai
Trạng thái: DRAFT — đề xuất để xem xét, chưa phê duyệt triển khai.
Ngày: 2026-10-21.
Repo: https://github.com/laodeng000/effekseer-ai
Commit được đọc: 208922ef192220322c2a79e1243ed51ff7d2b7af.
Phạm vi: audit mã nguồn và kế hoạch; không sửa mã nguồn repo.

## 1. Kết luận
Giữ lõi MCP hiện có và mở rộng thành quy trình: mô tả → tìm tài liệu/tài nguyên → xây hiệu ứng → render → đánh giá/sửa → đóng gói cho Minecraft. Repo hiện là cầu nối chỉnh tài liệu Effekseer, chưa phải hệ thống tự tạo VFX hoàn chỉnh.

Claude/Codex chịu trách nhiệm hiểu mô tả tiếng Việt, chọn phương án và đánh giá hình ảnh. MCP cung cấp thao tác có cấu trúc, kiểm tra và trả kết quả. Không cần bắt buộc thêm một API mô hình trả phí bên trong server.

## 2. Bản đồ nguồn và độ tin cậy
| Nguồn | Vai trò |
|---|---|
| src/effekseer_ai/mcp_server.py | Công cụ thật sự được công bố cho MCP |
| src/effekseer_ai/session.py | Thao tác tài liệu, node, curve và tài nguyên |
| runtime.py, settings.py | Nạp Effekseer Core và cấu hình |
| tests/test_cli.py, tests/test_runtime.py | Phạm vi kiểm thử hiện có |
| README.md, docs/mcp.md, docs/compatibility.md | Mô tả và môi trường tác giả công bố |
| Tài liệu chính thức Effekseer, trang license từng tài nguyên | Căn cứ cho chức năng và quyền sử dụng |

Đã chạy 4 test hiện có: 4 passed. Đây chỉ là kiểm tra CLI/cấu hình; không xác nhận render hay tương thích Minecraft. Môi trường audit không có Windows/Effekseer DLL để kiểm thử tích hợp thực. Không đồng nhất kết quả tác giả công bố với kết quả tự kiểm chứng.

## 3. Hiện trạng
Có 17 công cụ MCP: effect_new/open/save/export; node_list/add/rename/remove/move; property_list/get/set; asset_import_image; settings_list/set; curve_list/set.

- Tạo, mở, lưu tài liệu; chỉnh node, thuộc tính và curve: đã có lớp thao tác.
- Tìm web/tài liệu/tài nguyên, tải và quản lý license: chưa có.
- Nhập ảnh: có. Hàm import_model tồn tại nội bộ nhưng chưa thành MCP tool; không phải bộ chuyển đổi model.
- Render preview/video, tự đánh giá hình ảnh: chưa có.
- Prompt thành kế hoạch VFX, thư viện recipe, phối lại nhiều mẫu: chưa có.
- Đóng gói AAA Particles/BBS: chưa có.
- Một tài liệu mỗi process và Effekseer Core có trạng thái dùng chung: cần quản lý phiên trước khi mở rộng đồng thời.
- Tác giả nêu Windows, Python 3.11+, .NET 9, Effekseer 1.80.6. Phải kiểm thử phiên bản được chọn thay vì mặc định tương thích mọi bản.

### Vấn đề cần sửa trước
1. Đã tái hiện: hai ảnh khác nội dung nhưng cùng tên đều được chép vào resources/<tên>; ảnh sau ghi đè ảnh trước. Sửa bằng ID/hash và manifest tham chiếu.
2. settings_set ghi lần lượt, chưa có giao dịch nguyên tử: lỗi giữa chừng có thể giữ thay đổi một phần.
3. curve_set_keys xóa key cũ trước khi hoàn tất kiểm tra key mới: cần validate trước và rollback.
4. ID node dựa trên vị trí cây; xóa/di chuyển làm đổi đường dẫn. Cần ID ổn định hoặc revision + ánh xạ lại, kiểm thử trường hợp chuyển giữa các nhánh.
5. Thiếu backup/undo, kiểm tra toàn bộ dependency và kiểm thử mở–sửa–lưu–mở lại.
6. Test CLI hiện chủ ý loại bỏ generate/model-import/model-convert. Bổ sung các chức năng này là thay đổi phạm vi sản phẩm; cần cập nhật contract/test tương ứng.

## 4. Các nhóm chức năng đề xuất
Tên công cụ sau là đề xuất, không phải API đã tồn tại.

| Nhóm | Công cụ gợi ý | Kết quả |
|---|---|---|
| Chẩn đoán | system_doctor, capabilities_get | Phiên bản, runtime, khả năng render/converter thực có |
| Kiến thức | docs_search, docs_read | Đoạn hướng dẫn kèm URL, phiên bản và ngày truy cập |
| Tài nguyên | asset_search, asset_inspect, asset_fetch | Tìm/đọc metadata/tải asset có nguồn và license |
| Thư viện | library_index, library_search | Cache cục bộ, phân loại màu/chủ đề/kiểu chuyển động |
| Lập cấu trúc | recipe_list, effect_build, effect_remix | Tạo và phối lại hiệu ứng từ EffectSpec |
| Chỉnh sửa an toàn | edit_batch, edit_undo | Validate cả lô, commit/rollback, backup |
| Model | asset_import_model, model_convert | Nhập/chuyển model khi converter đã được kiểm chứng |
| Xem trước | preview_render, preview_compare | Ảnh theo mốc thời gian, video hoặc bảng ảnh |
| Kiểm tra | effect_validate, dependency_scan | Lỗi cấu trúc, tài nguyên thiếu, tính năng ngoài profile |
| Minecraft | minecraft_package | Resource pack, credits, báo cáo và cấu hình đích |

Không gom toàn bộ vào một công cụ “generate” mơ hồ. Có thể thêm lệnh điều phối cấp cao, nhưng mỗi bước phải có đầu ra và lỗi rõ ràng.

### EffectSpec
Schema tối thiểu: chủ đề, bảng màu, thời lượng, vòng lặp, các lớp hiệu ứng, thời điểm phát, hình dạng/chuyển động, nguồn texture/model, seed và profile đích. Quy đổi giây sang frame và kích thước sang thế giới Minecraft phải minh bạch, có mẫu hiệu chuẩn. Có thể đặt ngân sách particle/texture; số FPS chỉ được báo khi đo thực tế.

Recipe khởi đầu: aura, vòng phép, vệt kiếm, projectile trail và impact burst. Remix phải thay đổi cấu trúc/thời gian/chuyển động có chủ đích, không chỉ đổi màu hoặc tên file. Nguồn gốc các phần được phối lại vẫn phải lưu.

## 5. Nguồn miễn phí và cơ chế tìm kiếm
Ưu tiên catalog có kiểm soát trước, tìm web mở sau:
- Effekseer Sample Effects: https://effekseer.github.io/en/contribute.html
  Phần Sample Effects hiện nêu CC0; phần Old có điều kiện riêng, không gắn CC0 cho cả trang.
- Kenney Particle Pack: https://kenney.nl/assets/particle-pack — CC0.
- OpenGameArt có thể bổ sung sau; kiểm tra license ở từng asset, không suy từ tên collection.
- Tài liệu Effekseer dùng để tra tham số/cách làm; không mặc định được đóng gói toàn bộ nội dung vào sản phẩm.

Mỗi asset lưu URL gốc, tác giả, license và căn cứ license, ngày tải, hash, dependency và yêu cầu ghi công. “Miễn phí tải” không đồng nghĩa được chỉnh sửa/phân phối lại. Asset chưa rõ quyền sử dụng cần được đánh dấu, không tự đưa vào gói phân phối.

Adapter tìm kiếm là thành phần cần bổ sung hoặc dùng công cụ tìm kiếm của host; stdio MCP không tự có quyền tìm internet. Cache giúp tránh tải lại. Giải nén có giới hạn dung lượng, chống đường dẫn thoát thư mục; không chạy script lấy từ kho asset. Nội dung tài liệu là dữ liệu tham khảo, không phải lệnh điều khiển agent.

## 6. Render và vòng lặp tự sửa
Đây là rủi ro kỹ thuật chính. Cần thử renderer native/offscreen hoặc một đường recorder được xác nhận có thể tự động hóa. Không giả định Recorder trong GUI đồng nghĩa đã có CLI/MCP để dùng.

Mỗi lần tạo: render vài mốc thời gian, xem trên nền sáng/tối và góc phù hợp; so với yêu cầu về silhouette, màu, nhịp, độ rõ; sửa có giới hạn số vòng. Render lỗi, thiếu tài nguyên hoặc timeout phải có log riêng. Nếu host không đọc được hình ảnh thì không tuyên bố đã đánh giá thẩm mỹ.

Phân biệt bốn loại kiểm chứng: cấu trúc hợp lệ; hình ảnh đúng ý; hiệu năng đo thực; chạy được trong Minecraft. Một loại đạt không thay thế các loại còn lại.

## 7. Đích Minecraft
Đề xuất profile đầu tiên: Minecraft Java 1.20.1 Fabric + đúng bản AAA Particles mà người dùng cài. Nếu dùng baseline 2.2.3 đã khảo sát thì không gán tính năng 2.3.x cho nó.

AAA dùng tài liệu .efkefc; effect_export hiện xuất .efk nên đường đóng gói AAA phải dùng tài liệu lưu phù hợp, không đổi đuôi file. Gói cần quét đủ texture/model/material/curve và giữ tham chiếu hợp lệ trong assets/<namespace>/effeks/. Chọn pack metadata theo phiên bản Minecraft.

BBS là giai đoạn riêng: trigger, bám vị trí/entity/xương, đồng bộ thời gian, reset/seek và render lại cùng frame. Cần kiểm thử thực với bản BBS người dùng dùng; không coi có API setProgress là bằng chứng đã đồng bộ phim chính xác.

## 8. Lộ trình và tiêu chí qua từng giai đoạn
| Giai đoạn | Phạm vi | Điều kiện hoàn thành |
|---|---|---|
| 0 — Xác minh | Chốt runtime/profile, mẫu tối thiểu, thử render tự động | Một hiệu ứng mở–lưu–mở lại và tạo preview thực; ghi rõ cách render |
| 1 — Lõi tin cậy | Giao dịch, ID/revision, chống ghi đè, backup, schema lỗi | Dữ liệu không hỏng khi lỗi giữa lô; hai asset trùng tên cùng tồn tại |
| 2 — Tìm và nhập | Hai nguồn CC0, metadata/license, cache, dependency | Tìm và nhập được mẫu/texture; có bằng chứng license và không thiếu file |
| 3 — Tạo từ mô tả | 5 recipe, EffectSpec, remix, preview và tự sửa | Các mô tả thử tạo được VFX mở được, có preview và sửa được theo phản hồi |
| 4 — Minecraft | Đóng gói AAA và thử trong game | Ba hiệu ứng mẫu tải/hiển thị trên đúng profile, báo cáo hiệu năng đo thực |
| 5 — Mở rộng | Model/converter, thêm nguồn, bridge BBS | Converter có mẫu kiểm chứng; BBS phát/reset/render lặp ổn định |

Không đưa thời hạn chắc chắn trước giai đoạn 0: preview native và tương thích editor/runtime có thể quyết định phần lớn công sức.

## 9. MVP đề xuất
Đầu vào: “Tạo vòng phép xanh tím bán kính hai block, tụ sáng rồi nổ sau hai giây, dùng tài nguyên miễn phí.”
Đầu ra: tài liệu .efkefc chỉnh sửa được, resources đủ, preview, danh mục nguồn/credits, báo cáo kiểm tra và gói AAA sau khi qua giai đoạn 4.

Ba bài nghiệm thu:
1. Vòng phép tụ sáng rồi nổ: đúng nhịp và không thiếu texture.
2. Vệt kiếm băng: sửa được màu/độ dài bằng mô tả mà giữ cấu trúc còn lại.
3. Aura lặp: kiểm tra điểm nối vòng lặp và chạy lại từ đầu nhất quán.

Ngoài MVP: chuyển mọi particle Unity/Unreal/Blender tự động; mô phỏng chất lỏng; tạo mọi kiểu model từ prompt; giao diện web riêng; đồng bộ mọi phiên bản BBS. Blender bridge có thể bổ sung để tạo mesh/texture khi cần.

## 10. Quyết định đề xuất và bước tiếp theo
Ưu tiên: sửa độ tin cậy + xác minh render, sau đó catalog CC0 và 5 recipe; giữ model phức tạp/BBS ở giai đoạn sau. Chưa tạo task mapping triển khai vì yêu cầu này là đề xuất DRAFT.

Thông tin cần chốt khi triển khai: bản Effekseer/AAA/BBS thực dùng, cách host xem preview và phạm vi license mặc định. Trong kế hoạch này giả định ưu tiên CC0 và Minecraft Java; mọi khác biệt phải được đưa vào profile.

Tài liệu này là điểm đọc đầu tiên và nguồn thống nhất cho audit + đề xuất hiện tại. Khi triển khai mới tách requirements, tasks và báo cáo nghiệm thu; chỉ đánh dấu APPROVED sau khi người dùng duyệt.

