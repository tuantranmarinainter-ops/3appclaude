# Camera film BBS FS 2.7 — B59

Nguồn được đọc trực tiếp: [`Wemppy4/bbs-fs`, commit `998c9d585427b4cf0061940496ae1f6a7df1bb03`](https://github.com/Wemppy4/bbs-fs/tree/998c9d585427b4cf0061940496ae1f6a7df1bb03).
Đây là xác minh mã nguồn, không phải kết quả phát trong game. Bridge JAR đóng gói trong app chỉ chứa codec/editor, không chứa camera runtime.

Các đường dẫn dưới đây tính từ `src/main/java/mchorse/bbs_mod/`, trừ khi ghi khác.

| Nội dung | Ngữ nghĩa đọc từ nguồn | Áp dụng khi xuất |
| --- | --- | --- |
| Tick / duration | `utils/clips/Clip.java:isInside`: `start <= tick < start + duration`. | Các shot tiếp giáp cắt cứng; end là exclusive, key tại end chỉ là mẫu biên. Worker chặn clip chồng nhau. |
| Thứ tự / layer | `utils/clips/Clips.java:getClips`: lọc clip đang hoạt động, sort tăng theo layer (stable với cùng layer). `src/client/java/mchorse/bbs_mod/camera/controller/CameraWorkCameraController.java:apply` áp lần lượt. | Clip overwrite phía sau có quyền ghi đè clip trước. Không có bằng chứng idle đầu danh sách thắng keyframe cùng layer phía sau. Worker bỏ toàn bộ camera giữ chỗ của draft trước khi thêm shot. |
| `bbs:idle` | `camera/clips/overwrite/IdleClip.java:applyClip` copy toàn bộ `position` vào camera. | Không xuất idle tại gốc thế giới. Native readback kiểm tổng số camera đúng bằng số shot. |
| `bbs:keyframe` | `camera/clips/overwrite/KeyframeClip.java:applyClip`: thời gian `relativeTick + transition`; mỗi kênh không rỗng ghi thẳng x/y/z/yaw/pitch/roll/fov khi `additive=false`. | Bảy kênh absolute, không distance, `additive=false`. Mỗi mẫu được kiểm lại từ `.dat`. |
| Góc / dấu | `camera/data/Position.java:apply` đổi độ sang radian, không đổi dấu; `camera/Camera.java:updateView` dùng rotateZ(roll), rotateX(pitch), rotateY(yaw). `Camera.set(Entity,...)` dùng pitch Minecraft và **headYaw + 180°**. `camera/data/Angle.java:angle(dx,dy,dz)` dùng yaw=`atan2(dz,dx)+90°`, pitch=`-atan2(dy,hypot(dx,dz))`. | Camera yaw là góc view BBS; khác yaw actor Minecraft 180°. Pitch dương nhìn xuống; roll là góc quay view quanh Z. |
| FOV | `camera/Camera.java:updatePerspectiveProjection`: JOML `perspective(fov, width/height, near, far)`. `Position.apply` đổi fov độ sang radian. | **FOV dọc**, không nhân aspect vào giá trị xuất. App 2 dùng sensor **dọc 24 mm** (`evaluate/camera/focalLength.ts`); ở 16:9: 50 mm → vFOV 26.9914665616°, hFOV 46.2126537165°; 35 mm → vFOV 37.8492888321°, hFOV 62.7266044279°. |
| Nội suy | `utils/keyframes/Keyframe.java` + `utils/interps/Interpolation.java`: mặc định linear, `interp` có thể là chuỗi; nội suy theo channel, không tự đổi sang góc ngắn nhất. | Ghi rõ `interp: linear` cho camera. Mẫu từng tick giữ đúng tại tick nguyên; góc liên tục cần được unwrap trước khi ghi. |
| Additive | `KeyframeClip.applyClip`: cộng `channel(0)-channel(t)` vào giá trị bên dưới, **không phải** cộng trực tiếp channel(t). | Không dùng additive cho camera đã bake absolute. |
| Envelope | `utils/clips/Envelope.java:factorEnabled`: disabled → factor 1; enabled → fade/channel. `camera/clips/CameraClip.java:apply` blend camera dưới với camera clip (yaw lerpYaw). | Ghi `envelope.enabled=false`, tránh fade vô tình giữa shot. |

## Kiểm native codec

`PATH=/tmp/jdk-17.0.12/bin:$PATH python -m unittest agent.test_film_worker.NativeHeightFormTests -v`:
3/3 PASS (bao gồm height cũ, camera chuyển động, chặn shot chồng).
Fixture camera tự chứa, không phụ thuộc kho model thật: shot 0–149 dolly 3 m + pan 45° + zoom 50→35 mm, shot 150–159 nhìn theo điểm di chuyển, tọa độ quanh (107.63, −58.72, 210.34). Worker xuất `.dat` nén và giải mã lại bằng `BbsCodec`; so 160 × 7 = **1.120 giá trị**, sai số absolute lớn nhất **0** (double), đúng tick/start/duration và đúng hai clip camera, không idle. Đây là kiểm wire của mẫu manifest sau điểm neo; kiểm App 2 evaluator/điểm neo thuộc test TypeScript riêng, không được suy ra từ test Python này.

Worker chặn sai số vị trí >0,01 block, góc/FOV >0,1°, mất key hoặc đổi timing/type khi native readback, rồi mới publish package. Báo cáo `cameraReadback.valuesCompared` và `maxAbsoluteError` nằm trong `export-report.json`.

Trong game BBS thật: **NOT_RUN**. Manifest vẫn giữ nhãn tương thích wire `targetVersion: "2.4"` của bridge cũ; nguồn 2.7 xác minh các trường camera nêu trên, không tuyên bố đã kiểm toàn bộ tương thích game.

## Kiểm toàn chuỗi App 2 → native `.dat`

Test opt-in `editor/apps/studio/test/cameraBbsEndToEnd.test.ts` đã chạy PASS với Java 17:

```sh
# Từ editor/packages/builder; JDK 17 phải có trên PATH.
BBS_CAMERA_NATIVE_TEST=1 ./node_modules/.bin/tsx --test ../../apps/studio/test/cameraBbsEndToEnd.test.ts
```

Fixture project App 2 thật trong thư mục tạm: shot frame **0–149, 30 FPS → 100 tick** (dolly 3 m, pan 45°, zoom vFOV tương ứng 50→35 mm), shot thứ hai camera nhìn theo subject đang di chuyển, cắt cứng ở tick 100. Test gọi `sampleProjectCameraSequence` với userKeys compact-v1 → `cameraSamplesToFilm` → `applyFilmWorldAnchor` (pivot `[1,0,2]`, destination `[107.63,-58.72,210.34]`, yaw 37°) → Python worker xuất `.dat` → BbsCodec giải mã. Không ghi binary/project thật vào repo.

So độc lập từng mẫu camera với position/quaternion App 2 đã xoay quanh pivot bằng Three.js:

| Số đo | Kết quả thực chạy |
| --- | --- |
| Mẫu gồm endpoint hai shot | 112 |
| Giá trị native so lại (7 kênh/mẫu) | 784 |
| Sai số native codec lớn nhất | 0 |
| Sai số vị trí App 2 → film | 3.1776437161565096 × 10⁻¹⁴ m |
| Sai số góc quaternion App 2 → film | 1.7075472925031877 × 10⁻⁶ ° |
| Sai số FOV App 2 → film | 0 ° |

Test assert chuyển động dolly/pan/zoom và lookAt thực sự đổi, duration/start đúng, góc ≤0,1°, vị trí ≤0,01 m. Worker đồng thời assert chỉ còn đúng hai clip keyframe, không camera giữ chỗ. Native test opt-in để suite thông thường không bắt máy chưa cài JDK17 chạy worker; khi bật, lỗi compiler/worker hoặc sai lệch làm test FAIL, không tự skip.
