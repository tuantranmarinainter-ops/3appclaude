# Gói 4 — Đề xuất cấu trúc: nhiều animation + Animation Controller (2026-10-31)

> Trạng thái: **ĐỀ XUẤT — chờ người dùng duyệt**. Chưa có mã. Theo mục 14–17 của
> `docs/APP3-BLOCKBENCH-FEATURES-TASK-2026-10-31.md` (nhánh `docs/app3-blockbench-task`), Gói 4 phải dừng ở bước này.

## 1. Có cần Gói 4 không?
Controller giúp nhân vật **tự chuyển động tác theo biến** (đứng → đi → tấn công) — giá trị lớn khi làm mob/nhân vật
chơi được (Bedrock add-on, GeckoLib). Quy trình **làm phim BBS FS** hiện tại xếp từng clip trên timeline App 2 theo kịch bản,
nên controller **không cần cho phim**. Đây là gói lớn nhất và rủi ro nhất (đổi cấu trúc project, đụng cầu nối App 2).

**Lựa chọn cho người dùng:** (A) làm đủ 4a–4c; (B) chỉ làm 4a (nhiều animation trong một project, có ích cả cho phim);
(C) hoãn toàn bộ Gói 4.

## 2. Hiện trạng
- Project App 3 `version: 1` = **một** animation: `duration`, `fps`, `keys[boneId]`, `ikModes`, `ikOptions`, `loop`,
  `playMode`/`startDelay`/`loopDelay` (Gói 1), `molangVariables` (Gói 2), cộng các phần gắn với animation:
  `lab` (Motion Lab: base + layers + clips), `director`, `parallelModes`, `poses`.
- Cầu nối App 2 (`host_bridge.js`): `open` nạp project, `save` trả `nativeProject = studio.serialized(false)` +
  GLB đã bake + `duration`/`fps`. App 2 lưu `nativeProject` và gửi lại khi mở.
- Lịch sử Hoàn tác = ảnh chụp **toàn bộ project** (tối đa 80 bản).
- Gói 3 đã xuất/nhập **một** animation Bedrock mỗi tệp.

## 3. Cấu trúc đề xuất — `version: 2`
```jsonc
{
  "type": "animation-studio", "version": 2,
  "name": "Zombie",                         // tên project
  "rig": { … }, "settings": { … }, "skinAdjustments": { … },
  "poses": [ … ],                           // thư viện pose dùng chung
  "molangVariables": { "is_moving": 0 },    // biến dùng chung cho mọi animation + controller
  "animations": [
    { "id": "anim1", "name": "idle",
      "duration": 2, "fps": 30, "keys": { … }, "ikModes": { … }, "ikOptions": { … },
      "loop": [0, 2], "playMode": "loop", "startDelay": 0, "loopDelay": 0,
      "lab": { … }, "director": { … }, "parallelModes": { … } }
  ],
  "activeAnimation": "anim1",
  "controllers": [                           // chỉ có khi làm 4b
    { "id": "controller.animation.zombie.move", "initialState": "idle",
      "states": {
        "idle": { "animations": [{ "animation": "anim1", "weight": "1" }],
                  "transitions": [{ "to": "walk", "condition": "v.is_moving > 0" }],
                  "blendTransition": 0.2 },
        "walk": { "animations": [{ "animation": "anim2", "weight": "1" }],
                  "transitions": [{ "to": "idle", "condition": "v.is_moving <= 0" }],
                  "blendTransition": 0.2 } } }
  ]
}
```
**Nguyên tắc tách:** cái gì thuộc chuyển động (thời lượng, key, IK theo thời gian, Motion Lab, director, chế độ phát)
nằm trong từng `animations[i]`; cái gì thuộc nhân vật/project (rig, cài đặt, skin, pose, biến) giữ ở gốc.

## 4. Chuyển đổi và tương thích
1. **Mở v1** → bọc mọi trường theo animation vào `animations[0]` (`id: "anim1"`, `name` = tên project), `activeAnimation = "anim1"`.
   Không mất dữ liệu; hàm thuần `migrateV1toV2` + test khứ hồi.
2. **Hạ v2 → v1** (`flattenActive`): lấy animation đang chọn trải ra gốc. Dùng cho mọi chỗ hiện cần một animation:
   xuất GLB/FBX/BVH/Minecraft20/`.bobj`, Gói 3 (một animation), và **cầu nối App 2**.
3. **Cầu nối App 2 không đổi mặc định:** `save` vẫn trả `nativeProject` dạng v1 của animation đang chọn
   (App 2 không phải sửa). Chỉ khi App 2 gửi `open` kèm `multi: true` mới trao đổi v2 — để sau, có task riêng ở App 2.
4. **Hook test** (`window.__studio.project()`, `serialized()`): giữ trả về dạng v1 của animation đang chọn; thêm
   `__studio.projectV2()` cho test mới, để ~150 test hiện có không phải viết lại.
5. Xuất Minecraft20 của project một animation phải **giống từng byte** trước/sau (như các gói trước).

## 5. Chia giai đoạn (mỗi giai đoạn một PR)
| Giai đoạn | Nội dung | Rủi ro |
|---|---|---|
| **4a** | v2 + chuyển đổi; danh sách animation (thêm, nhân bản, đổi tên, xoá, chọn) ở cả hai bố cục; mọi công cụ hiện có làm việc trên animation đang chọn; Gói 3 xuất **nhiều animation trong một tệp** và nhập chọn từng cái | Trung bình — đụng lưu/mở, Hoàn tác |
| **4b** | Mô hình controller (trạng thái, chuyển bằng Molang, trộn theo trọng số, `blendTransition`); xem trước trong khung 3D bằng thanh trượt biến | Trung bình — trộn pose nhiều animation |
| **4c** | Xuất/nhập `*.animation_controllers.json` (`format_version` "1.10.0") cùng tệp animation | Thấp |

## 6. Rủi ro và cách giảm
- **Bộ nhớ Hoàn tác:** ảnh chụp toàn project × N animation × 80 bản. Đề xuất: ảnh chụp chỉ animation bị sửa + thao tác
  cấu trúc (thêm/xoá animation) — đo heap trước/sau với 10 animation × 60 s.
- **Motion Lab / director / dual editor** đang giả định một animation: chuyển chúng vào `animations[i]`, kiểm từng màn hình.
- **Trộn pose** (4b): trộn quaternion theo trọng số (nlerp/slerp tuần tự), position/scale tuyến tính; cần test so với tính tay.
- **GPL:** có thể chuyển thể logic controller của Blockbench (`js/animations/animation_controllers.js`, GPL-3.0) vào App 3
  theo mục Bản quyền; giao diện tự viết, không dùng Vue/jQuery.

## 7. Việc cần người dùng quyết
1. Chọn **A / B / C** ở mục 1.
2. Đồng ý cầu nối App 2 **giữ v1** (chỉ animation đang chọn) ở 4a/4b?
3. Đồng ý chia 3 PR như mục 5?
