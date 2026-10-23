# App 4 VFX — đặc tả UI/UX

Trạng thái: V1, đặc tả để duyệt; chưa nối giao diện với backend.  
Ngày: 2026-10-23.  
Đích: Effekseer 1.80.x → BBS FS 2.7 và AAA Particles trên Minecraft 1.20.1.

## 1. Mục tiêu và nguyên tắc sản phẩm

App 4 giúp người làm phim tìm, xem, tạo, chỉnh và kiểm tra hiệu ứng mà không phải hiểu cây thuộc tính Effekseer. Đường chính là: **chọn hoặc mô tả → xem đúng cỡ → chỉnh → kiểm tra → đóng gói → gửi cue sang App 2**. Giao diện dùng tiếng Việt; tên kỹ thuật chỉ xuất hiện trong chế độ Nâng cao hoặc báo cáo.

UI phải phân biệt rõ bốn mức bằng chứng: cấu trúc hợp lệ, hình ảnh đúng ý, hiệu năng đã đo, và chạy trong Minecraft thật. Preview mô phỏng không được mang nhãn “BBS”, “đã kiểm trong game” hay biểu tượng đạt màu xanh. Chỉ kết quả chụp từ BBS FS 2.7/AAA đúng profile mới tạo trạng thái **Đã chạy trong game**.

Mọi thao tác sửa tạo một phiên bản có thể quay lại. Lưu tài liệu và xuất gói là hai hành động riêng. Nếu node bị CHẶN, xuất mặc định bị vô hiệu hóa; “bỏ node bị chặn” là lựa chọn nâng cao có xác nhận và báo cáo mất dữ liệu.

## 2. Kiến trúc thông tin và bố cục

### 2.1 Thanh ứng dụng

Từ trên xuống dưới:

1. Header cao 44 px: logo/tên project, tên hiệu ứng đang mở và dấu chưa lưu, Hoàn tác/Làm lại, Lưu, trợ giúp, trạng thái runtime.
2. Thanh workspace cao 52 px kiểu DaVinci Resolve: **1 Chuẩn hoá · 2 Dựng cảnh · 3 Animation · 4 VFX · 5 Thư viện**. Workspace 4 dùng accent và `aria-current="page"`. Phím `1`–`5` chuyển workspace khi con trỏ không nằm trong ô nhập. App chưa cấu hình URL hiển thị mờ, tooltip nêu cách cấu hình; không làm mất project hiện tại và giữ `?unified=<id>` khi chuyển.
3. Vùng làm việc bốn panel: trái Thư viện/Cây lớp, giữa Khung xem, phải Inspector/Kiểm tra, dưới Timeline.
4. Thanh trạng thái cao 26 px: autosave, renderer `GPU: <tên>` hoặc `CPU`, preview đang dùng, profile xuất, lỗi/cảnh báo.

### 2.2 Lưới mặc định và kéo viền

Ở 1920×1080: trái 288 px, phải 344 px, timeline 248 px; giữa nhận phần còn lại. Ở 1366×768: trái 240 px, phải 300 px, timeline 196 px. Giới hạn: trái 220–420 px, phải 280–480 px, timeline 160 px đến 45% chiều cao; viewport giữa tối thiểu 520×300 px.

Mỗi separator rộng vùng bắt 8 px, nét nhìn thấy 1 px, có `role="separator"`, `aria-orientation`, `aria-valuemin/max/now`. Kéo chuột hoặc cảm ứng để đổi cỡ; phím mũi tên đổi 8 px, `Shift` + mũi tên đổi 32 px; nhấp đúp hoặc `Enter` khi focus đưa về mặc định. Cỡ lưu theo project/workspace trong `localStorage`; viewport render phải resize ngay, không kéo giãn bitmap. Trong lúc kéo, con trỏ và focus ring giữ rõ.

Khi cửa sổ dưới 1366×768, đây là chế độ hạn chế: trái/phải trở thành drawer chồng lên viewport, timeline giữ tối thiểu 160 px; banner đề nghị tăng kích thước. Không thu nhỏ control dưới 32 px.

### 2.3 Điều hướng trong App 4

Thanh trái có ba tab: **Thư viện**, **Lớp**, **Phiên bản**. Thanh phải có ba tab: **Thông số**, **Kiểm tra**, **Đóng gói**. Mở hiệu ứng từ Thư viện tự chuyển trái sang Lớp; nút “Quay lại thư viện” luôn ở breadcrumb. Trạng thái lựa chọn node, thời điểm và camera được giữ khi đổi tab.

## 3. Luồng 1 — Thư viện hiệu ứng

```text
Mở VFX → tải chỉ mục → tìm/lọc → xem nhanh thẻ → chọn hiệu ứng → mở bản làm việc
                                      └→ xem nguồn/license
```

Đầu trang có tìm kiếm theo tên, tag và mô tả; debounce 200 ms, `Esc` xóa. Bộ lọc dạng chip/drawer gồm:

- Loại: hào quang, vòng phép, vệt chém, đạn/projectile, va chạm/nổ, khiên, lốc và loại khác.
- Màu chủ đạo; thời lượng theo khoảng; lặp/không lặp.
- Nguồn, license; mặc định ưu tiên CC0.
- Đích: BBS FS 2.7, AAA; mức hỗ trợ OK/Xấp xỉ/Chặn.
- Xác minh: Đã chạy trong game, Chưa chạy, Lỗi lần chạy gần nhất.

Kết quả là lưới thẻ co giãn: 2 cột ở 1366, 3–4 cột ở 1920. Thẻ có sprite động khi hover/focus và khi người dùng chưa bật giảm chuyển động; mặc định đứng ở frame đại diện để tiết kiệm GPU. Trên thẻ: tên, loại, swatch, thời lượng, vòng lặp, nguồn/license và badge xác minh. Badge **Đã chạy trong game** chỉ có khi report ghi đúng phiên bản/profile, ngày chạy và bằng chứng; tooltip cho biết profile. “Mô phỏng” và “Render Effekseer” dùng badge trung tính riêng.

Chọn thẻ mở quick view ở phải với preview, kích thước block, dependency, nguồn/credit và các nút **Mở bản sao**, **Mở chỉ đọc**, **Dùng làm nền để tạo**. Hiệu ứng mẫu không bị ghi đè.

Trạng thái:

| Trạng thái | Trình bày và hành động |
|---|---|
| Rỗng lần đầu | Minh hoạ CSS, “Chưa có hiệu ứng”; Tạo từ mô tả, Nhập `.efkefc`, Nạp catalog mẫu. |
| Không có kết quả | Hiện số bộ lọc, nút Xóa bộ lọc; giữ câu tìm kiếm. |
| Đang tải | Skeleton đúng kích thước thẻ, `aria-busy=true`; không thay layout. |
| Lỗi chỉ mục | Thông báo tại panel, nguyên nhân ngắn, Thử lại/Mở file trực tiếp. |
| Ảnh lỗi | Placeholder và chữ “Không có xem nhanh”; vẫn mở metadata được. |
| Offline | Dùng cache cục bộ, nêu thời điểm đồng bộ; tìm web bị khóa. |

## 4. Luồng 2 — Xem trước

```text
Mở hiệu ứng → chọn nguồn preview → tải/render → phát hoặc scrub → đổi nền/cỡ/camera → đánh giá
```

Viewport giữa hiển thị một trong bốn nguồn, luôn ghi nhãn ở góc trên trái:

1. **Bảng sprite** — preview nhẹ dùng trong App 2.
2. **Render Effekseer** — frame native nếu runtime Windows thực sự trả ảnh.
3. **Mô phỏng Snowstorm** — renderer offline hiện có; luôn kèm “Không phải BBS FS”.
4. **Ảnh BBS/AAA trong game** — chỉ khi có provenance của lần chạy thật.

Nền chọn Sáng, Tối, caro alpha, hoặc **Như BBS** gồm trời/cỏ cách điệu. “Như BBS” là bối cảnh so cỡ, không được đổi nhãn nguồn preview thành BBS. Viewport có lưới và thước block, trục XYZ, bóng người Minecraft 1,8 block và nhân vật mẫu bật/tắt được. Kích thước Inspector dùng block, cho nhập số chính xác; khi hệ số Effekseer→block chưa hiệu chuẩn, đặt nhãn “ước tính” và cảnh báo trước xuất.

Chuột thống nhất mọi khung 3D: trái xoay, giữa kéo, lăn zoom. `F` đóng khung vừa; `Home` về camera mặc định; menu ngữ cảnh cung cấp thao tác tương đương. Camera không đổi khi chọn node. Người dùng giảm chuyển động sẽ không tự quay camera hoặc autoplay.

Thanh phát dưới viewport: về đầu, phát/tạm dừng, một frame trước/sau, thời gian hiện tại/tổng, scrubber, lặp, tốc độ 0,25×/0,5×/1×/2×. `Space` phát/dừng, `J/K/L` lùi/dừng/tiến; nhấn L/J nhiều lần đổi tốc độ. Scrub hiển thị preview thô ngay và tinh sau khi thả. Với BBS không hỗ trợ seek thật, UI ghi “khởi động lại để tới mốc” và không giả vờ scrub chính xác.

Chỉ báo renderer ở status bar lấy từ WebGL/runtime: `GPU: NVIDIA…`, `CPU: SwiftShader`, hoặc `Không xác định`. Đây là thông tin renderer của preview, không phải kết quả benchmark. Khi GPU lỗi, banner một dòng báo đã chuyển CPU và cho xem log.

Trạng thái:

| Trạng thái | Trình bày |
|---|---|
| Chưa chọn | Hướng dẫn chọn thẻ hoặc tạo hiệu ứng. |
| Đang render | Giữ frame cũ mờ nhẹ, progress + Hủy; không làm viewport nhấp nháy. |
| Preview chặn | Frame trạng thái ghi node/tính năng bị chặn; tuyệt đối không dùng hình giả như kết quả. |
| Runtime thiếu | Chuyển sang sprite/mô phỏng nếu có; nút Chẩn đoán runtime. |
| Texture thiếu | Checker magenta, tên đường dẫn và nút Chọn lại texture. |
| Lỗi GPU | Fallback CPU, giữ camera/thời gian; cho Thử lại GPU. |

## 5. Luồng 3 — Tạo và sửa bằng mô tả

```text
Mô tả tiếng Việt → kiểm EffectSpec → Tạo 3 phương án → xem/so sánh → chọn một bản
       ↑                                                        ↓
       └──────── yêu cầu sửa bằng lời ← phiên bản mới + diff ──┘
```

Nút **Tạo từ mô tả** mở panel toàn chiều cao. Ô mô tả có ví dụ, đếm ký tự và không tự gửi. Form EffectSpec luôn sửa được:

- chủ đề/tên; bảng màu (swatch + mã màu);
- thời lượng giây; lặp; seed;
- lớp hiệu ứng, thứ tự và vai trò;
- thời điểm phát/tụ/nổ;
- kích thước theo block;
- profile đích BBS FS 2.7 hoặc AAA; ngân sách hạt/texture.

Sau khi phân tích mô tả, UI đánh dấu trường được suy ra và trường cần người dùng quyết định. Bấm **Tạo phương án** tạo tối đa ba thẻ A/B/C, mỗi thẻ có preview cùng camera/thời điểm, điểm khác nhau bằng ngôn ngữ thường, mức hỗ trợ đích và license tài nguyên. Có thể chọn hai phương án để xem cạnh nhau. Không dùng điểm “AI chất lượng” không có căn cứ.

Sau khi chọn, ô “Sửa bản này bằng lời” nhận câu như “xanh hơn, nổ muộn 0,5 s”. Trước khi chạy, UI hiện patch dự kiến trên EffectSpec; kết quả luôn là phiên bản con, không ghi đè. Tab Phiên bản là timeline nhánh: tên/timestamp, mô tả thay đổi, tác giả, trạng thái lưu và gate. Có So sánh, Đặt tên, Quay lại bản này; quay lại cũng tạo head mới để giữ lịch sử.

Trạng thái rỗng có ba prompt mẫu MVP. Đang tạo hiển thị từng bước “Lập cấu trúc / lấy tài nguyên / tạo node / render”; cho Hủy. Lỗi giữ nguyên prompt và EffectSpec, nêu bước hỏng, Thử lại từ bước đó. Nếu nguồn/license chưa rõ, phương án vẫn xem được nhưng không đóng gói. Nếu backend tạo từ mô tả chưa có, prototype phải ghi “Bản minh hoạ — chưa nối trình tạo”, không giả kết quả thật.

## 6. Luồng 4 — Chỉnh thông số

```text
Chọn lớp/node → chỉnh nhanh → preview tạm → áp dụng thành phiên bản
                    └→ Nâng cao → thuộc tính/curve đầy đủ
```

Tab Lớp hiển thị cây có icon kiểu vẽ, bật/tắt xem, khóa, trạng thái OK/Xấp xỉ/Chặn. Kéo để sắp xếp hoặc đổi cha chỉ khi backend xác nhận hợp lệ. Xóa node cần xác nhận vì có hậu duệ; sau xóa có toast Hoàn tác. Đường dẫn kỹ thuật hiện trong tooltip/chế độ Nâng cao vì path hiện thay đổi khi move.

Inspector **Cơ bản** ưu tiên các trường người dựng phim dùng nhiều: thời điểm bắt đầu, tuổi thọ, tốc độ sinh/số hạt, vị trí, vận tốc/gia tốc, kích thước block, xoay, màu/alpha, blend, texture/flipbook, lặp và seed. Slider luôn đi với ô số có đơn vị; kéo slider tạo preview tạm, thả mới ghi một lịch sử. Màu nhập bằng picker và hex. Giá trị ngẫu nhiên dùng Min/Max. Curve đơn giản có keyframe, zoom/pan, nhập frame/value, snap; đường Bezier khi xuất BBS phải hiện badge Xấp xỉ tuyến tính.

Inspector **Nâng cao** ánh xạ panel Effekseer (`CommonValues`, `LocationValues`, `RotationValues`, `ScalingValues`, `GenerationLocationValues`, `RendererCommonValues`, `DrawingValues`…), tìm thuộc tính và xem giá trị thô. Thuộc tính không hỗ trợ bởi profile đích có cảnh báo ngay cạnh control; Ribbon/Track/Ring/Model/GPU, sub-emitter, Sub/Mul, distortion/material phức tạp là CHẶN cho đường Snowstorm. Add là XẤP XỈ bắt buộc và cho xem hệ số core/halo; mặc định halo 1,9×, alpha 0,55×.

Lưu lỗi không được làm mất thay đổi trên form. Vì thao tác batch/curve có rủi ro ghi một phần ở backend hiện tại, UI chỉ bật “Áp dụng nhóm” sau khi có transaction; trước đó từng thay đổi phải có snapshot/backup và trạng thái rollback rõ ràng.

## 7. Luồng 5 — Kiểm tra, đóng gói và gửi App 2

```text
Kiểm tra → sửa lỗi CHẶN → render đối chiếu → checklist chạy game → đóng gói
                                                             ├→ tải ZIP
                                                             └→ gửi cue App 2
```

Tab Kiểm tra chia bốn gate độc lập:

| Gate | Trạng thái hợp lệ | Ý nghĩa |
|---|---|---|
| Cấu trúc & dependency | NOT_RUN/RUNNING/PASS/BLOCKED/ERROR | JSON/node, texture, component, đường dẫn. |
| Hỗ trợ & hình ảnh | NOT_RUN/RUNNING/PASS/WARN/BLOCKED | OK/Xấp xỉ/Chặn và so preview; mô phỏng không chứng nhận game. |
| Hiệu năng | NOT_RUN/RUNNING/PASS/WARN/FAIL | Chỉ ghi FPS/particle khi đo thật, kèm máy/profile. |
| BBS/AAA trong game | NOT_RUN/RUNNING/PASS/FAIL | Gate MVP; cần đúng Minecraft 1.20.1, BBS FS 2.7/profile AAA và bằng chứng. |

Mỗi vấn đề có mức, đường dẫn node/thuộc tính, giải thích dễ hiểu, “Đi tới” và cách sửa. Các lỗi texture/license/credit chặn đóng gói. Xấp xỉ bắt buộc được liệt kê trong report; Add mô tả biến đổi alpha/lõi/quầng và hệ số. Sự kiện dưới 1/20 giây, đơn vị/trục chưa hiệu chuẩn, ngẫu nhiên BBS không tái lập đều là cảnh báo nổi bật.

Checklist chạy game ghi phiên bản, người/máy chạy, ngày, các mốc thời gian, ảnh/log, kết quả nạp, phát lại, bám actor/xương, pause/restart/seek và hiệu năng. Người dùng có thể đính bằng chứng nhưng chỉ runner/tác vụ tích hợp mới ký PASS; nhập checkbox thủ công mang nhãn **Tự khai báo**, không tạo badge xác minh.

Tab Đóng gói chọn profile:

- **BBS FS 2.7 / Snowstorm**: package JSON + texture + report; node chặn làm nút Xuất vô hiệu. “Cho phép bỏ node bị chặn” nằm trong Nâng cao, yêu cầu nhập tên hiệu ứng để xác nhận.
- **AAA Particles**: `.efkefc` và dependency vào đúng `assets/<namespace>/effeks/`; chỉ bật khi backend/package profile đã có và đúng phiên bản. UI không đổi đuôi `.efk` thành `.efkefc`.

Sau thành công, hiện nội dung gói, hash, credits, report và **Tải ZIP**. Không gọi gói là “sẵn sàng sản xuất” khi gate game chưa PASS.

**Gửi sang App 2** chỉ bật khi bridge được cấu hình và gói phù hợp chính sách project. Dialog gồm project/cảnh, tên cue, nhân vật/xương hoặc vị trí thế giới, frame bắt đầu, scale block, và chế độ **Tự phát** / **Phát thủ công trong BBS FS**. Màn xác nhận tóm tắt asset ID/version và không tự mở/ghi vào App 2 trước khi người dùng bấm Gửi. Thành công trả link “Mở cue trong App 2”; lỗi giữ gói cục bộ và cho Thử lại. Đây là tích hợp tương lai, không thuộc V1.

## 8. Trạng thái toàn cục và an toàn dữ liệu

- Chưa lưu: dấu tròn cạnh tên; `Ctrl/Cmd+S` lưu. Khi đóng/chuyển hiệu ứng, hỏi Lưu/Bỏ/Hủy.
- Autosave chỉ lưu draft cục bộ, không thay file gốc; status bar ghi thời điểm.
- Backend mất kết nối: khóa thao tác ghi, giữ form/draft, cho Kết nối lại; preview cache vẫn xem được.
- Một tài liệu trên mỗi MCP process: UI xếp hàng mở tài liệu và không gửi lệnh vào nhầm session. Tên effect/session luôn đi cùng request ở bridge tương lai.
- Tác vụ dài có progress, log, Hủy; timeout không được biến thành FAIL thẩm mỹ.
- Toast dùng cho thành công có thể hoàn tác; lỗi cần xử lý nằm cố định gần control hoặc trong bảng vấn đề.

## 9. Hệ thống thiết kế

### 9.1 Token

Giữ cảm giác Studio tối: nền ứng dụng `#111318`, panel `#181b22`, surface nổi `#222631`, viền `#343947`, chữ chính `#f2f4f8`, chữ phụ `#aab1c0`, accent VFX `#8b7cff`. Trạng thái: PASS `#43c98b`, WARN/Xấp xỉ `#e5ad45`, ERROR/BLOCKED `#ef6b73`, thông tin `#62a8ff`, NOT_RUN xám. Màu luôn đi cùng icon và chữ.

Font hệ thống Studio/`Inter`, fallback `Segoe UI`, sans-serif; body 13–14 px, caption tối thiểu 12 px, line-height ≥1,4. Lưới khoảng cách 4 px; dùng chủ yếu 8/12/16/24. Control cao 32 px, nút chính 36 px, target tương tác tối thiểu 32×32 px.

### 9.2 Nút và feedback

Nút có các trạng thái default/hover/pressed/focus/disabled/loading. Mỗi màn chỉ có một primary action. Disabled phải có lý do nhìn thấy hoặc tooltip; lỗi không chỉ đổi màu. Focus ring 2 px tương phản, không bị separator/panel cắt. Skeleton chỉ dùng khi chưa có dữ liệu; khi refresh giữ nội dung cũ và chỉ báo nhỏ.

## 10. Bàn phím và khả năng tiếp cận

| Phím | Hành động |
|---|---|
| `1`–`5` | Chuyển workspace ngoài ô nhập. |
| `Space` | Phát/tạm dừng ngoài ô nhập. |
| `J` / `K` / `L` | Lùi / dừng / tiến. |
| `F` | Đóng khung đối tượng; `Home` camera mặc định. |
| `Ctrl/Cmd+S` | Lưu; `Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z` hoàn tác/làm lại. |
| `Delete` | Xóa node đã chọn sau xác nhận; không áp dụng khi đang nhập. |
| `[` / `]` | Frame trước/sau. |
| `?` | Mở bảng phím tắt. |

Thứ tự Tab: header → workspace → panel trái → viewport/control phát → panel phải → timeline/status. Cây lớp dùng pattern treeview (`aria-expanded`, phím mũi tên); grid thư viện dùng danh sách/link chuẩn; tab dùng `role=tablist`. Viewport có tên truy cập mô tả nguồn và thời điểm, kèm bảng thông số/ảnh tĩnh thay thế cho nội dung canvas. Mọi icon có nhãn; slider công bố tên, giá trị và đơn vị; thay đổi do render/gate báo qua live region `polite`, lỗi chặn qua `assertive` một lần.

Độ tương phản chữ/control đạt WCAG 2.2 AA; trạng thái không dựa riêng vào màu. Zoom trình duyệt 200% vẫn dùng được bằng drawer/reflow, không mất nút xuất. `prefers-reduced-motion` tắt autoplay thumbnail, transition lớn và camera tự động. Cho tắt nhấp nháy; cảnh báo với hiệu ứng flash nhanh. Canvas không bẫy bàn phím và mọi thao tác chuột có nút/menu tương đương.

## 11. Ánh xạ màn hình với backend

Ký hiệu: **Có thật** đã có mã gọi được; **Một phần** cần bridge/điều phối nhưng lõi có; **Đề xuất** chưa có API tương ứng.

| Chức năng UI | CLI/MCP/lõi hiện có | Mức | Việc backend còn thiếu / cách UI ghi nhãn |
|---|---|---|---|
| Tạo/mở/lưu `.efkefc` | CLI `new/open/save`; MCP `effect_new/open/save` | Có thật | Runtime cần Windows/Core; hiển thị lỗi chẩn đoán. |
| Hoàn tác một backup | CLI `edit-undo`; MCP `edit_undo` | Có thật | Chưa phải lịch sử phiên bản/redo; UI không đồng nhất hai khái niệm. |
| Cây node, thêm/đổi tên/xóa/di chuyển | `node-list/add/rename/remove/move`; MCP tương ứng | Có thật | Path không ổn định sau move; cần ID/revision trước cộng tác/lịch sử bền. |
| Thuộc tính và panel nâng cao | `property-list/get/set`, `settings-list/set` | Có thật | Cần transaction/rollback cho batch và validation trước ghi. |
| Curve | `curve-list/set` | Có thật | Cần validate/rollback; curve đơn giản phải ánh xạ rõ Approx cho BBS. |
| Nhập ảnh | `image-import`, MCP `asset_import_image` | Có thật | Cần hash/ID chống trùng tên và metadata license. |
| Xuất runtime `.efk` | CLI `export`, MCP `effect_export` | Có thật | Không dùng thay `.efkefc` cho AAA. |
| Dump EffectIR | CLI `effect-dump` | Có thật (CLI) | Chưa công bố MCP tool; bridge có thể chạy job CLI. |
| Preview Snowstorm offline | CLI `preview`; `preview.render_preview` | Có thật | Luôn `SIMULATION_ONLY`, BBS runtime `NOT_RUN`; UI gắn nhãn bắt buộc. |
| Render Effekseer native | `tools/render_preview.py` | Có thật nhưng phụ thuộc môi trường | Cần Windows/Core/DLL, job API, progress/cancel và provenance. |
| So số liệu hình | `image_gate.image_metrics/compare_metrics` | Có thật ở lõi | Cần orchestration và lưu report; không suy ra đúng thẩm mỹ tuyệt đối. |
| Chuyển EffectIR → Snowstorm | `ir_to_bbs.convert_effect_ir` | Có thật ở lõi | Trả OK/APPROX/BLOCKED; UI bám đường dẫn và không làm nhẹ blocker. |
| Đóng gói BBS FS 2.7 | CLI/MCP `bbs-package`/`bbs_package` | Có thật | ZIP + report; mặc định chặn, `allow_partial` phải là lựa chọn nâng cao. |
| Add core/halo | tùy chọn CLI package; converter/texture transform | Có thật | MCP chưa lộ hệ số; UI dùng mặc định và ghi report. |
| Thư viện/tìm kiếm/lọc | Không có `library_index/search` | Đề xuất | V1 dùng mock/sprite route; cần catalog, cache, provenance, license. |
| Route sprite App 2 | `/api/unified/vfx-previews` ở Studio | Có ở App 2, chưa bridge | Prototype chỉ đọc khi có `?previews=`; không sửa Studio trong V1. |
| Tạo tiếng Việt → EffectSpec/3 phương án | Không có `effect_build/remix`, recipe | Đề xuất | Ghi “Bản minh hoạ” cho đến khi có schema/job thật. |
| Sửa bằng lời + lịch sử nhánh | Chỉ có `edit_undo` một backup | Đề xuất | Cần revision, diff, edit batch nguyên tử và kho version. |
| Tìm/tải asset và license | Không có `asset_search/inspect/fetch` | Đề xuất | Cần adapter, cache an toàn, hash và bằng chứng license. |
| Chẩn đoán runtime/GPU | Chưa có `system_doctor/capabilities_get`; script render có môi trường riêng | Đề xuất/Một phần | Cần API capability; nhãn GPU lấy renderer thực, fallback CPU. |
| Validate dependency/license/profile | Converter/package kiểm một phần manifest, texture, node | Một phần | Cần `effect_validate`, `dependency_scan`, schema thống nhất. |
| Gate BBS/AAA trong game | Không có runner tích hợp; report hiện `NOT_RUN` | Đề xuất | Chỉ runner đúng profile mới ký PASS/badge. |
| Package AAA | Không có `minecraft_package` AAA | Đề xuất | Cần gom `.efkefc` + dependency, namespace/profile 2.2.3 hoặc bản chốt. |
| Gửi cue sang App 2 | App 2 có khái niệm cue Tự phát/Thủ công; chưa có bridge App 4 | Đề xuất | Phải đề xuất và duyệt trước khi sửa App 2; cần asset/version contract. |

## 12. Hợp đồng dữ liệu UI đề xuất

Mỗi hiệu ứng trong catalog cần `id`, `version`, `name`, `tags`, `colors`, `durationSeconds`, `loop`, `source`, `author`, `license`, `licenseEvidence`, `credits`, `dependencies`, `preview[]`, `targetSupport`, `gameVerification`. Preview phải có `kind` (`sprite`, `effekseer-native`, `snowstorm-simulation`, `bbs-capture`, `aaa-capture`), renderer/profile, timestamp, tạo lúc nào và provenance.

EffectSpec gồm `theme`, `palette`, `durationSeconds`, `loop`, `layers`, `events`, `sizeBlocks`, `seed`, `targetProfile`, `budgets`. Mọi kích thước UI dùng block và giữ giá trị nguồn/hệ số chuyển đổi trong report. Version có `id`, `parentId`, `createdAt`, `changeRequest`, `specDiff`, `documentHash`, `gateSummary`.

Kết quả job dùng trạng thái `QUEUED/RUNNING/SUCCEEDED/BLOCKED/FAILED/CANCELED`, progress 0–1, log có cấu trúc và artifact. Gate dùng đúng các trạng thái ở §7; không quy `NOT_RUN` thành `FAIL` hay `PASS`.

## 13. Tiêu chí nghiệm thu UI V1 và thứ tự nối thật

Prototype đạt V1 khi mở trực tiếp không build, đi được đủ năm luồng bằng bàn phím, mọi empty/loading/error có thể xem, separator kéo/đặt lại/nhớ cỡ, thư viện lọc đúng, lịch sử phiên bản không ghi đè, và các kết quả giả/mô phỏng mang nhãn rõ. Kiểm ở 1366×768, 1920×1080, zoom 200%, giảm chuyển động và chỉ bàn phím.

Thứ tự nối backend nên là: (1) capability/runtime + mở/lưu an toàn; (2) catalog cục bộ và preview có provenance; (3) node/property/curve qua transaction và revision; (4) validate/converter/package BBS; (5) runner game và gate; (6) EffectSpec/recipe/remix; (7) package AAA; (8) hợp đồng cue với App 2 sau khi được duyệt. Cho đến bước tương ứng, control vẫn có thể xuất hiện để duyệt thiết kế nhưng phải gắn **Chưa nối backend** và không tạo thành công giả.
