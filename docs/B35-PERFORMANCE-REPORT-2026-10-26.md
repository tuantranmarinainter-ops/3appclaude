# B35/B26 — hiệu năng App 2 (2026-10-26)

**Chức năng cache/cập nhật từng phần: PASS. Ngưỡng thời gian chưa ổn định: FAIL ở một số lượt.** Không dùng trung vị để che lượt vượt ngưỡng; PR giữ draft. Kho thật, Tập 15 thật, Windows và game: NOT_RUN.

## Phép đo

Ba lượt trước và ba lượt sau, mỗi lượt tạo project/thư viện tổng hợp và production server/Chromium mới, tuần tự. Linux cloud, Next 15.1.9, Chromium headless SwiftShader, 1440×900. Project JSON compact 643.000 byte; 16 asset, 44.527.168 byte nguồn, 8 motion, 15 nhân vật. Model là tam giác MC20 đơn giản với 42 MiB BIN không dùng; JSON có padding extension. Đây là stress dung lượng/đọc file, **không tương đương độ phức tạp geometry/texture của Tập 15**.

Bundle nền được giữ trước sửa tại commit `f3c029d`; bundle đó có phần 1, nhưng workload này dùng Action MC20 native, không đi qua công thức chuyển đổi. Fixture được dựng bằng helper độc lập trên main của phần 2. Không truy cập dữ liệu thật.

Undo gửi Ctrl+Z thật. Ghi riêng: thời gian từ sự kiện phím trong DOM đến document đổi + hai requestAnimationFrame; và tổng thời gian driver gồm gửi phím qua Playwright. Cả hai được giữ trong JSON. Đo trả kết quả bằng HTTP upload ZIP đã chuẩn bị → `shot.result.import` → chuyển workspace → UUID mới trong document, `MotionPlayer.getRaw` có clip mới và hai frame. Không giả thao tác editor đầy đủ: **xuất GLB/ZIP bên trong iframe App 3 nằm ngoài timer và NOT_RUN**.

## Kết quả (ms)

| Chỉ số | Trước: trung vị / lớn nhất | Sau: trung vị / lớn nhất |
|---|---:|---:|
| Ctrl+Z từ DOM | 2049,10 / 2224,70 | 272,50 / 391,60 |
| Ctrl+Z gồm driver | 2058,35 / 2235,48 | 347,81 / 396,93 |
| Import → motion đã nạp + cảnh | 2662,59 / 2732,99 | 1078,61 / 1151,99 |
| HTTP upload + import + cảnh | 3576,48 / 3695,11 | 1969,82 / 2089,82 |

Sau sửa, DOM Undo có 2/3 lượt <300 ms; upload/import/cảnh có 2/3 lượt <2000 ms. Kiểm strict hiện giữ cả ngưỡng driver và upload: 1/3 PASS, 2/3 FAIL. Chưa thể tuyên bố tất cả lượt đạt mục tiêu.

[JSON từng lượt](B35-PERFORMANCE-RESULTS-2026-10-26.json) giữ toàn bộ ba mẫu mỗi build, không chọn mẫu nhanh nhất. Các phép đo chẩn đoán cũ/fixture thử bị lỗi không dùng để thay số trong bảng này.

## Điều đã kiểm chứng

- Undo: project JSON GET từ 8 xuống 1; source model GET từ 15 xuống 0.
- Trả kết quả: project JSON GET từ 6 xuống 1; 14 model không đổi không tải lại, chỉ nạp 1 motion mới.
- Giữ nguyên Stage, store và toàn bộ model instance trong cả ba lượt sau.
- Chờ 17 giây: listing nhân vật từ 1 request xuống 0; endpoint height mới cũng 0 request nền. Sửa hồ sơ đúng nhân vật đọc lại 1 lần; thông báo nhân vật khác đọc lại 0 lần.
- Panel xuất mở vẫn chạy preflight; đóng rồi sửa project không tạo preflight nền (smoke riêng PASS).
- Không có page error trong các lượt đo.

## Thay đổi

Giữ runtime App 2 khi đổi workspace; khi ẩn dừng playback/ambient/autosave và không bắt phím của App 3. Reload host giữ document/camera/frame, chỉ thêm/xoá/thay node hoặc motion đổi. Cache template theo SHA-256/fingerprint và loại representation; vòng đời tài nguyên dùng chung có pin, eviction chờ loader cuối giải phóng. Clip cùng ID nhưng đổi nguồn được nạp lại, gồm direct và UAL1; không đổi solver/calibration.

Đọc project đồng thời được gộp khi đang bay, không giữ snapshot đã hoàn tất. Commit/command làm mất hiệu lực lượt cũ; caller nhận clone; adapter dùng đúng snapshot vừa đọc. Undo dùng revision đã biết, server vẫn từ chối revision cũ, và nút/phím bận đến khi cảnh cập nhật xong.

Profiling thật cho thấy Undo đọc project/history lặp trước/sau khóa. Fast path chỉ cho undo/redo thực, giữ cache replay trước khóa, phục hồi và đọc có thẩm quyền trong khóa, validation và thứ tự ghi/fsync cũ. Test gồm crash-recovery mất cache, collision, replay sau lệnh khác/xoá project, stale revision, writer exclusion và dry run. Không bỏ fsync. Preflight panel ẩn không còn chạy theo revision.

## Chạy lại

Từ `three-workspace-app/editor`, sau build:

```sh
B35_PERF_SCALE=1 B35_PERF_PHASE=after B35_PERF_UPLOAD_HTTP=1 B35_PERF_ASSERT=1 node --import ./packages/builder/node_modules/tsx/dist/loader.mjs apps/studio/test/b35Performance.smoke.ts
```

PowerShell:

```powershell
$env:B35_PERF_SCALE='1'
$env:B35_PERF_PHASE='after'
$env:B35_PERF_UPLOAD_HTTP='1'
$env:B35_PERF_ASSERT='1'
node --import ./packages/builder/node_modules/tsx/dist/loader.mjs apps/studio/test/b35Performance.smoke.ts
```

`CHROMIUM_PATH` chọn browser cục bộ; Windows mặc định dùng Chromium của Playwright và không ép software GL. `B35_PERF_SOFTWARE_GL=1` ép SwiftShader để đối chiếu cloud. `B35_PERF_OUTPUT` chọn file kết quả; mặc định trong thư mục temp. `B35_PERF_DRAWER_CHECK=1` thêm kiểm mở/đóng panel sau phần đo. Mỗi lượt chỉ tạo/xoá dữ liệu tổng hợp trong temp, không chỉ đường dẫn tới kho thật. Kết quả trên Windows hiện NOT_RUN.

## Validation

Builder build, full workspace typecheck, lint, production build, Studio liên quan và Python CLI: PASS (lệnh/số test thật trong PR). Evaluate 633 PASS/1 SKIP, không regenerate golden. Kiểm offline với roots riêng: PASS, 28 pose hits, 0 external requests. Review cache lifecycle, request race và history transaction: không còn lỗi nghiêm trọng được phát hiện. Không sửa `packages/retarget`, không commit binary, giữ CRLF/LF cũ. Ngưỡng thời gian và game là gate riêng, không bị suy thành PASS từ các test chức năng.
