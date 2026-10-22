# Định dạng kịch bản `storyboard.v1` (B14 "Kịch bản → cảnh")

Một file JSON tự chứa mô tả cả tập phim. App 2 dựng thành **một project mới** bằng các lệnh thường của App 2 (thêm
nhân vật, đặt động tác, keyframe, camera, chuyển động camera, hậu cảnh, hiệu ứng), nên project tạo ra sửa và hoàn tác
được như project dựng tay. Code: `three-workspace-app/editor/apps/studio/src/storyboard.ts`.

## Cách chạy
- Dòng lệnh (từ `three-workspace-app/editor/apps/studio`):
  `BBS_UNIFIED_PROJECTS_DIR=<thư mục project> pnpm --filter @topview/3d-builder exec tsx <đường dẫn tuyệt đối>/scripts/storyboard-build.mts <file.json>`
- API Studio: `POST /api/unified/storyboard` với `{ "storyboard": {...}, "baseDir": "<thư mục>" }`.
- Đường dẫn tương đối trong file tính từ thư mục chứa file (dòng lệnh) hoặc `baseDir` (API).
- Lỗi kiểm tra trả về danh sách `{ path, message }`, ví dụ `shots[3].actors[0].acts[1]: unknown action walk for hero`.
  Lỗi tên động tác được phát hiện trước khi tạo project.

## Cấu trúc
```json
{
  "version": "storyboard.v1",
  "name": "Tap 15",
  "fps": 30,
  "area": 40,
  "sequenceId": "tap15",
  "skyColor": "#87B5E8",
  "actionSets": {
    "mc": { "glb": "C:/.../minecraft20-actions.glb", "names": ["idle", "running", "..."] },
    "mx": { "glb": "C:/.../actions.glb", "manifest": "C:/.../actions.manifest.json" }
  },
  "cast": { "hero": { "model": "C:/.../hero.mc20.glb", "actions": "mc" } },
  "sets": { "arena": "C:/.../arena.set.glb" },
  "shots": [
    {
      "id": "01", "sec": 4.5, "set": "arena",
      "camera": { "target": [0, 1.4, 0], "az": 25, "el": 8, "dist": 5.5, "fov": 50, "motion": { "presetId": "dolly_in", "config": { "strength": 0.6 } } },
      "actors": [ { "who": "hero", "at": [0, 0, 0], "yaw": 0, "acts": [["idle", 0, 2], ["running", 2, 4.5]], "moves": [[0, 0, 0, 0], [4.5, 3, 0, 0, 90]] } ],
      "fx": [ { "effect": "aura01", "at": [0, 0, 0], "yaw": 0, "scale": 0.7, "t0": 0.6, "t1": 4.5 } ],
      "lines": [ ["Hero", "Câu thoại", 0.1] ]
    }
  ]
}
```

| Trường | Ý nghĩa |
| --- | --- |
| `fps` | Khung hình/giây của project (mặc định 30). |
| `area` | Mỗi cảnh đặt ở một vùng riêng dọc trục X: cảnh thứ k có gốc `x = k × area` (mặc định 40 m). Mọi toạ độ trong cảnh tính từ gốc này. |
| `actionSets` | Bộ động tác: GLB nhiều Action. `manifest` (App 1) được nhập cùng GLB và đặt tên Action; hoặc `names` liệt kê tên theo thứ tự clip; không có cả hai thì lấy tên animation trong GLB. |
| `cast` | Nhân vật: model GLB và bộ động tác dùng. Mỗi cảnh tạo bản nhân vật riêng tên `<who> <id cảnh>`. |
| `sets` | Hậu cảnh (GLB). `shot.set` đặt một hậu cảnh ở gốc cảnh. |
| `camera` | Camera nhìn vào `target`, đặt theo góc phương vị `az` (độ, 0 = phía +Z), độ cao `el` (độ), khoảng cách `dist` (m), không thấp hơn 0,3 m. `motion`: một mục trong thư viện 30 chuyển động camera (`dolly_in`, `orbit_180`, `handheld_shot`, …) chạy suốt cảnh. |
| `acts` | `[tên Action, t0, t1]` theo giây trong cảnh; Action ngắn hơn khoảng thì được lặp. |
| `moves` | Keyframe `[t, x, y, z, yaw?]`. Có `yaw` thì nhân vật quay (khi xuất film và khi "Xem như BBS" bật). |
| `fx` | Hiệu ứng (làn VFX của App 2): tên hiệu ứng App 4, vị trí, `yaw`, `scale`, thời gian `t0`–`t1`. |
| `lines` | Thoại `[người nói, câu, t]`; hiện được trả về trong kết quả dựng, sẽ vào làn thoại khi có B16. |

Kết quả trả về: `projectId`, `sequenceId` và mỗi cảnh `{ shotId, start, end, ox, cameraId, characterIds, lines }`.
Ví dụ đầy đủ: Tập 15 tại `C:\w01-samples\tap15v3\tap15.storyboard.json` (ngoài repo).
