# Đợt 1 — dữ liệu và điều khiển camera

## Lỗi đã tái hiện bằng test

- `setDoc(document)` đặt lại `userKeys` nhưng chỉ khôi phục lớp FCurve chính: **750 key camera (5 × 150) → 0**. Bản sửa giữ sidecar khi chỉ thay document; truyền sidecar rõ ràng vẫn thay thế dữ liệu cũ. Test chạy **5 vòng cập nhật document → đổi timeline → lưu**, giữ đủ 750 key, camera và shot.
- Gọi lại cùng FOV qua phép đổi mm ↔ độ **1.000 lần**: bản gốc tăng revision **2 → 1003**; bản sửa revision **không tăng**, không thêm lần lưu. Test riêng chạy cả **120° và 78,83°**, tổng 2.000 callback; bỏ qua NaN.
- Đang chờ tải sidecar vẫn có thể lưu document cũ; hàng đợi lưu cũ có thể chạy tiếp sau khi tải document mới. Bản sửa khoá ghi lúc tải và gắn hàng đợi vào thế hệ tải document.
- Tải sidecar thất bại bị coi là sidecar rỗng rồi mở ghi trở lại. Bản sửa báo lỗi tải và giữ khoá ghi đến khi tải lại đầy đủ thành công, kể cả lần mở đầu tiên.

**Chưa tái hiện chính xác vòng tự dao động 120° ↔ 78,83° từ lịch sử người dùng: NOT_REPRODUCED.** Không coi test gọi lại cùng giá trị là chứng minh nguyên nhân duy nhất của vòng dao động đó.

## Số đo red/green

Chạy hai file test mới trên bản sao mã nguồn, chỉ thay `StudioSession.ts` và `libraryActions.ts` bằng commit `82ad0cb` trước sửa: **26 PASS / 6 FAIL**. Các lỗi gồm revision thừa, mất key, ghi khi đang tải, hàng đợi vượt thế hệ tải, tải sidecar lỗi khi reload và khi mở đầu tiên. Test thứ bảy về thoát lái trong lúc tải cũng **FAIL** trên bản gốc: vị trí camera bị ghi từ **(0, 2, 4) → (99, 99, 99)**. Bản sửa thêm test huỷ lái camera khi tải scene: hai file **34 PASS / 0 FAIL**; thêm test Stage thật `hostRefresh.test.ts`: **40 PASS / 0 FAIL**.

Từ `three-workspace-app/editor/packages/builder`:

```sh
node_modules/.bin/vitest run src/sync/__tests__/cameraTransformEdit.test.ts src/sync/__tests__/documentSync.test.ts src/engine/__tests__/hostRefresh.test.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/tsc -p tsconfig.test.json
```

Lệnh tái hiện bản gốc trên bản sao (không sửa cây làm việc dùng chung), từ gốc repo:

```sh
mkdir -p /tmp/backlog-camera-red
cp -r three-workspace-app/editor/packages/builder/src /tmp/backlog-camera-red/
cp three-workspace-app/editor/packages/builder/vitest.config.ts /tmp/backlog-camera-red/
ln -s "$PWD/three-workspace-app/editor/packages/builder/node_modules" /tmp/backlog-camera-red/node_modules
git show 82ad0cb:three-workspace-app/editor/packages/builder/src/sync/StudioSession.ts > /tmp/backlog-camera-red/src/sync/StudioSession.ts
git show 82ad0cb:three-workspace-app/editor/packages/builder/src/sync/libraryActions.ts > /tmp/backlog-camera-red/src/sync/libraryActions.ts
/tmp/backlog-camera-red/node_modules/.bin/vitest run --root /tmp/backlog-camera-red src/sync/__tests__/cameraTransformEdit.test.ts src/sync/__tests__/documentSync.test.ts
```

Regression bổ sung cho hàng đợi mới: sau khi tải lại thành công nhưng lần lưu cũ chưa xong, yêu cầu lưu mới phải đợi rồi lưu scene mới. Trước sửa hàng đợi: chỉ **1 lần ghi**, scene mới còn dirty; sau sửa: **2 lần ghi nối tiếp**, lần thứ hai đúng khoảng frame 350 và dirty=false. Đây là regression của thay đổi khoá thế hệ, không phải lỗi độc lập của baseline `82ad0cb`.

Lệnh red cố định baseline `82ad0cb`, vẫn tái lập sau khi commit đợt này. Test hàng đợi bản gốc hết hạn 30 giây vì tiếp tục gửi lần lưu không được phép.

## Điều khiển và kiểm trình duyệt

Khi tải lại scene, huỷ tư thế lái đang xem thử của scene cũ; thoát lái trong lúc khoá tải cũng không được ghi tư thế đó.

Thêm nút **Khoá camera** khi đang lái: lưu tư thế vừa lái và chuyển sang chế độ chỉ xem. Trạng thái tiếng Việt nói rõ đang lái camera shot hay camera đã khoá; khoá chặn chuột, lăn và WASDQE.

Script tái lập (phải dùng server Studio có kho project thử riêng, có dist mới):

```sh
STUDIO_URL=http://127.0.0.1:3124 \
SMOKE_OUTPUT=/tmp/backlog-camera-evidence \
CHROMIUM_PATH=/usr/bin/chromium \
node three-workspace-app/editor/apps/studio/scripts/backlog-d1-camera-smoke.mjs
```

Script tạo project thử, lái WASDQE **30 giây**, khoá camera, kéo/lăn/bấm E, đổi timeline, chỉnh thanh **Tiêu cự**, rồi kiểm FOV và revision lưu đứng yên sau **5 giây** không chạm. Xuất ảnh và JSON vào `SMOKE_OUTPUT`.

Lần kiểm đầu với dist dùng chung trước bản khoá tải cuối: **38.584 ms**, camera + shot còn nguyên, FOV 120° đứng yên 5 giây, **0 lỗi trình duyệt**. Bằng chứng cục bộ: `/tmp/backlog-camera-evidence/camera-pilot-30s.png`, `camera-pilot-30s.json`, `camera-lens-stable.json`. Kiểm lại dist cuối được ghi bên dưới khi hoàn tất.


Kiểm dist trước lượt sửa CSS bổ sung (đã có `saveGeneration`, `cancelCameraPilotForLoad`, `hostLoadFailed`): **PASS**, project thử `bbed6725-13a4-4480-910e-5cf2b061d425`, tổng 43747 ms gồm 30 giây WASDQE và 5 giây idle. Bấm nút **Khoá camera** thật; kéo/lăn/bấm E sau khoá không đổi document. Camera + shot còn nguyên. Thanh Tiêu cự đặt FOV **120°**; revision trên server đứng yên **3 → 3** trong 5 giây. GET kiểm độc lập xác nhận đã lưu **rev 3 / FOV 120° / shot01 → camera_1**. **0 lỗi trình duyệt**.

Bằng chứng dữ liệu trước lượt sửa CSS cục bộ: `/tmp/backlog-camera-final/camera-before-interaction.png`, `/tmp/backlog-camera-final/camera-after-lock-idle.png`, `/tmp/backlog-camera-final/camera-pilot-30s.json`, `/tmp/backlog-camera-final/camera-lens-stable.json`, `/tmp/backlog-camera-final/persisted-project.json`. Hai ảnh là **trước thao tác / sau thao tác trên cùng bản code cuối**, không phải ảnh trước/sau sửa code. Ảnh baseline code gốc được chụp riêng sau đó tại `/tmp/backlog-before-code-evidence/d1-before-code-camera-pilot.png`: source `82ad0cbd73448aec293dafc72001ea4df73db8a1` được git archive, build và chạy bằng server/kho thử độc lập. Manifest hash và bước tái lập: `/tmp/backlog-before-code-evidence/baseline-manifest.json`, `STEPS.txt`. Ảnh baseline ghi UI lái camera cũ, không tự chứng minh tái hiện vòng FOV hoặc mất dữ liệu.

## Kiểm trực quan bổ sung — khung dựng cảnh và chữ trạng thái

Ảnh lần kiểm đầu cho thấy vùng dựng cảnh co lại và chữ trạng thái bị cắt. Chẩn đoán DOM loại trừ lỗi script kéo nhầm splitter: **trước bất kỳ thao tác kéo nào**, ngay sau bấm Khoá camera, wrapper vẫn **1600 px** nhưng `.t3d-studio-host` co từ **1600 → 820,97 px**, canvas còn **431,97 px**. Kéo bằng bounds mới không đổi số đo. Hint rộng **781,56 px**, mép trái **−65,80 px** nên không đọc được đầu câu.

Nguyên nhân CSS: host là flex item nhưng không có width/flex growth; hint dùng nowrap và không giới hạn theo canvas. Sửa `styles/base.css` cho host lấp đầy wrapper; `styles/viewport.css` giới hạn chiều rộng hint và cho chữ/nút xuống dòng. CSS thử trực tiếp trong trình duyệt khôi phục host **1600 px**; ở cửa sổ **700 px**, canvas **311 px**, hint **287 px** nằm trọn trong canvas (x **121–408**, canvas **109–420**).

Smoke đã bổ sung kiểm host bằng wrapper trước/sau điều khiển, kiểm hint không vượt canvas/không tràn chữ trên desktop và cửa sổ 700 px; tính lại bounds trước mỗi lần kéo sau đổi chế độ. Bằng chứng chẩn đoán cục bộ: `/tmp/backlog-camera-final/layout-diagnostics.json`, `layout-fresh-bounds.png`, `layout-injected-diagnostics.json`, `layout-injected-700.png`. Các ảnh thử CSS không thay cho lượt chạy dist cuối sau sửa CSS.

### Kết quả production sau sửa CSS

Build production cuối và smoke tại `http://127.0.0.1:3130`: **PASS**, project `5569b27d-40dc-45de-b4f7-6db00575b9ce`, tổng **42.716 ms**. Lái WASDQE 30 giây; bấm Khoá camera thật; kéo/lăn/E khi khoá không đổi document. Camera + shot còn nguyên. FOV đã lưu **120°**; revision server **1 → 1** trong 5 giây idle; **0 lỗi trình duyệt**.

- Desktop: host/wrapper luôn **1600/1600 px** trước thao tác, khi lái và sau khoá; canvas **1211 px**. Hint sau khoá **781,56 px** nằm trong canvas, không tràn chữ.
- Cửa sổ 700 px: host/wrapper **700/700 px**, canvas **311 px**, hint **287 px** nằm tại **121–408 px**, tràn chữ **0 px**. Đã xem ảnh: đọc được toàn bộ “Camera đã khoá…” và hai nút.
- Cặp ảnh trước/sau code: `/tmp/backlog-before-code-evidence/d1-before-code-camera-pilot.png` và `/tmp/backlog-camera-css-final/camera-after-code-pilot.png` (cùng fixture, ở tư thế ban đầu trước khi lái).
- Ảnh cuối desktop/narrow: `/tmp/backlog-camera-css-final/camera-after-lock-idle.png`, `camera-locked-700px.png`. Số đo: `camera-layout.json`; dữ liệu/revision đã lưu: `camera-lens-stable.json`; thời gian/camera/shot: `camera-pilot-30s.json` trong cùng thư mục.

Không thay golden, không commit, không đổi nhánh trong phần việc này.

### Nghiệm thu có bật Debug thật

Đã chạy lại **trên production :3130**, chỉ sửa script/docs: bấm **Debug → Bắt đầu ghi**, đóng đúng drawer bằng **Đóng bảng**, lái WASDQE 30 giây, khoá camera/đổi timeline/chỉnh tiêu cự, rồi mở lại Debug → **Dừng ghi → Tải file log**. **PASS**, project `05a85092-b8fe-41a0-aa3b-1a95e10eb8d6`, tổng **42.867 ms**, camera + shot giữ nguyên; FOV đã lưu **120°**, revision idle **1 → 1**, layout desktop/700 px đều đạt, **0 lỗi trình duyệt**.

- File tải từ nút UI: `/tmp/backlog-camera-debug-final/camera-debug.txt`.
- Server trả `written` tổng **25**, file JSONL thực tế cũng **25 dòng**: `/tmp/backlog-production-projects/.debug-logs/2026-11-01-11-16-11-z5r6eq.jsonl`.
- Đọc JSONL thật: **3 lần KeyE** và **1 request scene.apply** thành công, `operations=[document.replace]`, `expectedRevision=0`, `revision=1`, HTTP **200**.
- Bằng chứng phản hồi ghi log: `/tmp/backlog-camera-debug-final/camera-debug-proof.json`; kiểm file server: `camera-debug-server-proof.json` cùng thư mục. Các ảnh/JSON camera và layout của lượt này nằm trong `/tmp/backlog-camera-debug-final/`.

Script đã assert log tải có phím E và `scene.apply` HTTP 200, có phản hồi server `written>0` trùng đường dẫn hiển thị; thao tác đóng drawer đều được scope đúng dialog Debug, không bấm nút Đóng toàn Studio. Targeted ESLint cho script và `node --check` đều **PASS**. Đây là kiểm hồi quy với ghi Debug, **không phải tái hiện thành công lỗi lịch sử camera bị xoá hoặc vòng FOV 120↔78,83**.
