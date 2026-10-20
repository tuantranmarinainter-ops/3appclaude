# App 1 Workbench (MVP)

Ứng dụng web cục bộ để chạy App 1 (chuẩn hoá rig + animation → Mixamo65) từ đầu đến cuối và kiểm tra bằng mắt + số đo.
Dùng lại lõi CLI `packages/retarget/cli/` (`inspectNormalize`, `runNormalize`, `applyModelMode`, `exportMinecraft20`); không có
logic retarget riêng, không thêm dependency, không bundler (ES module + import map).

## Chạy

Từ `three-workspace-app/editor/packages/builder` (để `tsx` resolve được):

```powershell
node --import tsx ../retarget/workbench/server.ts [--port 3101]
```

Mở `http://127.0.0.1:3101`. Máy chủ chỉ bind `127.0.0.1`, từ chối Host/Origin lạ. File tải lên và kết quả nằm trong
`%TEMP%\w01-workbench\<phiên>\` (in ra khi khởi động); không bao giờ ghi vào repo hay cạnh file của bạn. File nguồn chỉ đọc.
`three` (loader, OrbitControls, Draco decoder) được phục vụ từ gói đã cài của `packages/retarget`.

## Luồng

1. **Nguồn** — kéo-thả `.glb/.fbx/.bobj` (≤ 512 MB) hoặc dán đường dẫn cục bộ (cần cho `.gltf` có `.bin` ngoài; file lớn).
2. **Đích** — một trong 4 nhân vật Mixamo65 trong `builtin-assets/characters`.
3. **Kiểm tra** — không bake: family, mapping 65 khớp, danh sách Action, tỉ lệ hông (+ `--root-scale` gợi ý), hướng mặt đo được, lý do BLOCKED.
4. **Tuỳ chọn** — chế độ xuất (animation / model), root, hệ số root, calibration, hướng mặt, đơn vị, trục lên, `.bobj`.
   Đổi tuỳ chọn → kiểm tra lại tự động; kết quả cũ được đánh dấu "cũ".
5. **Chạy** — có thanh tiến trình thật (stage + Action i/n + giây).

Viewer hai khung cùng đồng hồ: trái = nguồn gốc (mesh nếu load được + SkeletonHelper), phải = GLB kết quả phát trên nhân vật đích
(track `Hips` → `mixamorigHips`; Model mode thì phát chính GLB model). Chọn Action, play/pause, kéo timeline theo frame, tốc độ
0.25–2×, bật/tắt mesh/xương/lưới, "Khớp camera". Dải màu phía trên timeline = frame chạm đất (xanh chân trái, cam chân phải)
lấy từ `report.quality.contactRanges`. Dòng "Track gắn vào đích: n/m" cho biết bao nhiêu track của GLB bám được vào xương của đích.

Panel phải: **Tổng quan** (status, gate, hợp đồng, cảnh báo chất lượng + nút "Áp dụng --root-scale", mất dữ liệu, model),
**Mapping** (65 dòng, lọc, sửa trực tiếp; "Xác nhận mapping" tạo preset `bbs.mixamo65-mapping-preset` gửi kèm lần chạy và tải về
để dùng với CLI `--mapping`; mapping suy theo hình học bắt buộc xác nhận trước khi chạy), **Actions** (chọn Action xuất; sau khi chạy: hông min–max,
trượt chân, cảnh báo), **Minecraft20** (preview + sai số), **Tải về**.

## API (JSON; lỗi trả `{ error }` kèm HTTP 4xx/5xx, không lộ stack)

| Route | Việc |
| --- | --- |
| `GET /api/targets` | 4 nhân vật đích (`id`, `file`, `hipsHeightMeters`, `url`) |
| `POST /api/sources` | raw body + header `x-file-name`, hoặc JSON `{ path, armaturePath? }` → `{ sourceId, … }` |
| `GET /api/sources/<id>/file` | file nguồn cho viewer (`.gltf` ngoài → GLB gộp, bỏ texture) |
| `POST /api/inspect` | `{ sourceId, targetId, options, mappingPreset?, presetFamily? }` → mapping/Action/tỉ lệ/hướng mặt/blocker |
| `POST /api/preset` | `{ sourceId, targetId, assignments:{Joint: tênXương\|null} }` → `{ preset }` |
| `POST /api/runs` | `{ sourceId, targetId, options, mappingPreset?, presetFamily?, wait? }`; mặc định chờ xong và trả `{ runId, status, report, manifest, files[] }`; `wait:false` → 202 và poll `GET /api/runs/<id>`; đang có lượt khác → 409 + `runId` đang chạy |
| `GET /api/runs/<id>` | `{ state: running\|done\|error, stage, done, total, elapsedMs, result? }` |
| `GET /api/runs/<id>/files/<tên>` | chỉ các file lượt chạy đó đã tạo |

`options`: `actions`, `previewAction`, `unitMeters`, `upAxis`, `rootPolicy`, `rootScale`, `calibrate`, `facingDegrees`, `mode`, `bobj`, `bobjRoot`, `preview`
(cùng ý nghĩa với cờ CLI `normalize`).

## Giới hạn đã biết

- Nguồn `.bobj` không có mesh: khung trái chỉ hiện thông báo (rig dựng từ armature, không vẽ).
- `.gltf` tải lên (raw) bị từ chối vì mất `.bin` ngoài — dùng đường dẫn. Viewer của `.gltf` ngoài bỏ texture (chỉ để xem).
- Chạy tuần tự một lượt một lúc; không huỷ giữa chừng. Phiên và file tạm bị xoá khi tắt máy chủ bằng đường đóng sạch, còn kill đột ngột thì để lại trong `%TEMP%`.
- Cảnh báo chất lượng chỉ đo, chưa sửa chuyển động (chưa foot lock/IK). Chưa kiểm `.bobj` trong BBS FS thật.
- Mapping sửa tay chỉ gán 1 xương nguồn cho 1 khớp (chưa soạn chuỗi nhiều xương/trọng số trong UI).
- Kiểm bằng trình duyệt thật ở độ rộng ≥ 1280 px; dưới đó bố cục xếp dọc.

## Kiểm thử

`pnpm --filter @topview/3d-builder exec tsx --test <đường dẫn tuyệt đối>/packages/retarget/test/workbench.test.ts`
