# Nghiên cứu định dạng film/cảnh BBS FS và `.scene.bobj`

Ngày khảo sát: 21/10/2026. Phạm vi: trả lời issue [#10](https://github.com/tuantranmarinainter-ops/3appclaude/issues/10), chỉ tài liệu; không sửa exporter và không chạy Minecraft.

## 1. Kết luận và mức độ xác nhận

**Đề xuất EPIC-H3 xuất `<scene>.bbs-film.zip`, chứa film native `films/<scene>.dat` và các model BOBJ/texture riêng. Không dùng `.scene.bobj` làm tên một định dạng native mới.** Film giữ các actor, vị trí, thời gian, thuộc tính và camera; BOBJ giữ hình học, rig và animation của model. ZIP chỉ là phương tiện chuyển các thành phần này, không phải bằng chứng game có chức năng nhập ZIP tự động.

Trong các nguồn đã đọc, không thấy định dạng cảnh native có tên `.scene.bobj`. Có thể đặt tên một file như vậy, nhưng đổi tên không tạo ra schema cảnh hoặc khả năng tự dựng nhiều actor. BOBJ parser có cấu trúc nhiều mesh/armature/action; điều đó **không đồng nghĩa** model loader sẽ dựng tất cả thành nhiều nhân vật độc lập.

Quy ước chứng cứ trong tài liệu:

- **Đã xác nhận từ mã:** đọc trực tiếp file tại revision được ghi trong nguồn.
- **Chứng cứ nội bộ repo:** tài liệu/evidence mô tả bản FS 2.4 và kết quả thử trước đây; nghiên cứu này không chạy lại các thử nghiệm đó.
- **Đề xuất / chưa xác nhận:** thiết kế EPIC-H3 hoặc hành vi cần người dùng thử trong game.

Repo ứng dụng được khảo sát tại commit `702206c1aa8a0ddaa79d682f8ff517c5f98398d4`. Đích nội bộ là **BBS FS 2.4 / Minecraft 1.20.1**, evidence pin commit FS `0085f77ced9232dc4e26ac51fc7d98f95d1d5b0b` [R7]. Nguồn công khai BBS mod được đọc tại `3cbfc79b9168c1aa6f51e774820ff646140c0167` [P1–P7]; README của nguồn này phân biệt nhánh master 1.20.4 và nhánh 1.20.1. Đây không phải xác minh trực tiếp toàn bộ fork FS 2.4. Không coi BBS, BBSFix và Blockbuster là cùng một phiên bản/codec.

## 2. Một film nhiều nhân vật được lưu như thế nào?

### 2.1. Hai lớp dữ liệu: film và tài nguyên model

Trong BBS công khai, `Film` là `ValueGroup` có `replays` (danh sách actor/replay), `camera` (danh sách clip), inventory và một số trạng thái người chơi [P1]. `FilmManager` dùng `CompressedDataStorage`, phần mở rộng `.dat`; lớp storage bọc `DataGzipStorage(DataFileStorage(...))` [P2]. Đây không phải JSON hoặc OBJ đổi đuôi. Evidence FS 2.4 mô tả GZIP bao dữ liệu typed có header BBS1; worker dùng `BbsCodec` để ghi/đọc, không tự xây một JSON codec thay thế [R1, R2, R7].

Mỗi `Replay` có `form`, `keyframes`, `properties`, `actions`, nhãn, enabled, looping, actor/entity, relative offset… [P3]. Không phải mỗi replay đều cần một model riêng trên đĩa: nhiều replay có thể tham chiếu cùng model ID, nhưng có placement/timeline riêng.

| Thành phần | Vai trò và nơi lưu | Ánh xạ trong worker hiện có |
| --- | --- | --- |
| Actor/replay | Một instance trong `Film.replays`, có nhãn và trạng thái riêng | `characterId` → `replayId` trong export manifest |
| Model/form | `form` chọn loại hiển thị; model form tham chiếu resource ID | `form.id = bbs:model`, `form.model = modelId`; file dưới `assets/models/<modelId>/` |
| Mesh/rig | Hình học, UV, weights, hierarchy/bind của model | `model.bobj`, texture và profile đã xác minh |
| World motion | Track placement của replay | `keyframes` cho `x/y/z/pitch/yaw/bodyYaw/headYaw` |
| Pose chỉnh được | Thuộc tính model/bone theo thời gian | `properties["pose.bones.<bone>"]`, channel `pose_transform` |
| Animation model | Named action trong BOBJ; cấu hình chọn action thuộc model form | `properties.actions`, channel `actions_config`; mapping slot/name/loop/speed/fade/action tick |
| Action gameplay | Clip sự kiện của replay, tách với animation skeletal | `Replay.actions`; ví dụ swipe/interact, không phải một BOBJ action |
| Camera | Các clip trên timeline `Film.camera` | `bbs:keyframe`, start/duration, các channel vị trí/góc/FOV |

Schema và tên trường phía worker ở bảng được xác nhận trong `DraftEditor.java` [R2]. Phải phân biệt **BOBJ action** (animation xương), **action mapping** của ModelForm (ví dụ slot `idle`, `running`, `base_pre`) và **action clip** (sự kiện game); chúng không thay thế nhau.

Mô hình quan hệ, không phải JSON có thể nhập trực tiếp:

```text
Film .dat
├── replays[0]: form.model → models/hero/model.bobj + texture
│   ├── world keyframes
│   ├── properties: pose hoặc action mappings
│   └── action clips
├── replays[1]: form.model → models/partner/model.bobj + texture
└── camera[]: clip start/duration + camera keyframes
```

Model/texture là dependency bên ngoài film; `.dat` không tự bảo đảm mang theo mesh, ảnh, map Minecraft hoặc âm thanh. Cảnh có world/set phải ghi rõ dependency và vị trí world; xuất film không đồng nghĩa xuất cả bản đồ.

### 2.2. Tick, frame, keyframe

- Quy ước export là **20 tick/giây**: 1 tick = 0,05 giây. Timeline source có FPS khác phải chuyển theo thời gian; không lấy frame 30 FPS làm tick 20 Hz. Exporter Blender vendored dùng hệ số `20 * fps_base / fps`; loader BBS đổi độ dài action thành giây bằng `duration / 20` [R5, P5].
- Worker nhận `durationTicks`, tick actor và tick action dạng số nguyên không âm. Native channel có thể lưu tick bằng số thực (`DraftEditor.key` ghi float), nên giới hạn integer là **hợp đồng worker**, không phải khẳng định mọi keyframe native chỉ có integer [R1, R2].
- Camera có `startTick` trên film và keyframe `relativeTick` trong clip. Ví dụ clip bắt đầu tick 40, key local 10 tương ứng tick film 50. Không cộng start hai lần.
- BOBJ text dùng `an` mở action, `ao` mở nhóm bone, `ag location|rotation|scale <axis>` mở channel, `kf` lưu thời gian/giá trị/interpolation/handles [P4]. Animation Studio ghi mẫu tick 0 tới `ceil(durationSeconds*20)`, interpolation `LINEAR`, giữ pose cuối ở mẫu cuối [R4].
- Với shot/camera nên quy định khoảng phát `[start, start+duration)` và giữ endpoint cuối để nội suy. Cut cần previous-left/next-right; phải preflight cut lệch grid 20 Hz, không âm thầm làm tròn. Đây là hợp đồng sampler nội bộ được mô tả trong tài liệu Film và hiện thực ở `filmCamera.ts` [R6, R8].

### 2.3. Đơn vị và hệ trục

| Miền dữ liệu | Quy ước cần áp dụng |
| --- | --- |
| Minecraft world / replay | Y-up; X đông, Y lên, Z nam theo convention Minecraft. Vị trí tính bằng block; pipeline đặt 1 mét = 1 block. |
| Góc world actor | yaw/pitch bằng độ theo convention Minecraft; hướng `d` dùng `yaw=atan2(-dx,dz)`, `pitch=-atan2(dy,sqrt(dx²+dz²))`, đổi radian sang độ. Yaw 0 hướng +Z, yaw +90 hướng −X; pitch dương nhìn xuống. |
| Camera | Vị trí world, yaw/pitch/roll và vertical FOV bằng độ trong manifest worker. Camera Three nhìn local −Z; phải chuyển forward/up từ quaternion, không chép Euler model sang camera. Cùng aspect mới so framing được. |
| BOBJ bind và pose | `arm_bone` chứa ma trận bind/rest toàn cục armature-space dạng row-major; pose delta theo local rest. Với profile BOBJ của repo: `local = restLocal * TRS(delta)`, rotation ZYX bằng radian; translation cùng đơn vị bind. Không dùng độ của world yaw cho bone rotation. |
| App 3 scene editor | Placement editor được chuyển `(x,y,z) → (x,z,−y)` sang Minecraft; rotation đổi basis bằng quaternion, không chỉ hoán vị ba góc. Model `cm` nhân 0,01, rồi bake actor scale; game dùng scale 1. |

Công thức/basis pipeline được đọc ở `scene_evaluator.js`, `scene_studio.js`, `filmCamera.ts`, exporter BOBJ và evidence FS [R3–R8]. Nguồn BBS công khai `BOBJBone` nhân lần lượt rotateZ/Y/X, phù hợp cách hiểu rotation BOBJ [P6]. BOBJ không có một header chuẩn bắt buộc nói mọi file đều là mét/Y-up; dòng comment `units` của App 3 là mô tả của exporter. Khi nhận BOBJ từ ngoài, phải biết basis/unit của file trước khi ghép.

Root motion phải có đúng một chủ sở hữu: hoặc bake chuyển động vào BOBJ với replay đứng ở placement gốc, hoặc đưa đường đi sang replay và loại cùng delta khỏi animation. Đưa world placement vào cả mesh/bone và replay sẽ làm dịch chuyển hai lần. Contact/IK trong editor cần bake ra pose; chưa có bằng chứng BBS tự chạy solver của App 3 từ manifest.

### 2.4. Blockbuster cũ khác ở đâu?

Nguồn Blockbuster nhánh 1.12 có `Scene.replays`, mỗi replay tham chiếu recording; `Scene.toNBT/fromNBT` dùng danh sách `Actors`, các cờ loop, title, command và audio. Khi phát, scene gọi manager để chơi record của từng replay [P8]. Cấu trúc NBT/recording này không phải `Film.replays/camera` typed `.dat` của BBS. Camera ở hệ sinh thái Blockbuster thường đi với Aperture; không lấy schema scene cũ để tạo film FS 2.4. Nghiên cứu này không xây bộ chuyển đổi Blockbuster → BBS.

## 3. Có `.scene.bobj` hoặc một BOBJ chứa cả cảnh không?

### 3.1. Khả năng của parser khác khả năng của model loader

`BOBJLoader.readData` của BBS công khai tạo `List<BOBJMesh>`, map armature và map action. Nó đọc nhiều record `o`, `arm_name`, `an`; mesh chỉ ra armature bằng `o_arm`. Do vậy **một BOBJ text có thể biểu diễn nhiều object/armature/action ở cấp parser** [P4]. Action được map theo tên, nhóm animation theo tên bone; đây không phải namespace actor và track camera như film.

Tuy nhiên `BOBJModelLoader.load` ở revision công khai đã kiểm [P5]:

1. Tìm `model.bobj` hoặc link `.bobj` phù hợp và texture `model.png`/PNG.
2. Lấy `bobjData.armatures.values().iterator().next()`.
3. Tìm mesh đầu tiên nối với armature đó rồi `break`.
4. Tạo một `ModelInstance`, chuyển named actions thành animations.

**Hệ quả xác nhận cho revision đó:** parse được nhiều armature không bảo đảm render đủ chúng; không thể khẳng định một BOBJ nhiều mesh sẽ lên đủ cả cảnh. Thứ tự map cũng không phải cách chọn nhân vật ổn định. Fork FS/BBSFix có thể đã sửa loader; chưa đọc trực tiếp bản fork 2.4 để kết luận giống hệt. Evidence pin loader FS nhưng không thay việc kiểm mesh/armature trong game [R7].

Trong phạm vi các lớp và exporter đã khảo sát, không có schema `.scene.bobj` dành cho actor instances, world placement, camera shots và film timeline. Không suy rộng thành khẳng định không tồn tại bất kỳ công cụ bên thứ ba nào dùng tên đó.

### 3.2. Các cách gom gần nhất

| Phương án | Giữ được gì | Mất/rủi ro | Đánh giá |
| --- | --- | --- | --- |
| Film native + nhiều model BOBJ trong ZIP | Actor độc lập, world motion, camera, action/pose theo film; model tái sử dụng | Cần cài đúng resource root, xác minh target version | **Chọn cho H3** |
| Nhiều BOBJ + manifest JSON App 3 | Mesh/animation từng actor, hướng dẫn placement/path | Không phải film; chưa tự tạo replay/camera trong game | Fallback có hướng dẫn thủ công |
| Một BOBJ nhiều object/armature | Parser có thể giữ nhiều cấu trúc | Loader có thể chỉ chọn một rig/mesh; không có film semantics | Chỉ thí nghiệm, không cam kết full scene |
| Gộp thành một mesh + một armature, bake một action toàn cảnh | Có thể tạo một model ghép diễn đồng bộ | Mất actor độc lập, camera không thuộc BOBJ; tên bone, texture atlas, limits và skin phải xử lý | Đề xuất tùy chọn sau khi thử loader, không là định dạng cảnh native |

Không nối chuỗi nhiều file BOBJ để tạo scene: face indices phải offset, tên armature/action/bone phải tránh collision, rest/weights phải nhất quán và loader vẫn có giới hạn ở trên. Animation Studio hiện xuất một armature `AnimationStudio`, một action và nhiều mesh record; converter Blender phía worker chỉ nhận một armature. Cả hai chưa chứng minh multi-armature scene loading [R4, R5, R9].

## 4. Repo hiện có và khác biệt đầu ra

### 4.1. Java Film worker

`three-workspace-app/agent/film_worker` dùng Java 17 và JAR BBS Animation Bridge đã pin hash. `FilmExportWorker` nhận manifest typed `schemaVersion:1`, `targetVersion:"2.4"`, project/revision, filmName, mode, duration, models, actors, cameras [R1]. Model có ID, danh sách bones/actions đã xác minh và file có sourcePath/targetPath/SHA-256.

Worker tạo staging, copy asset đã kiểm hash, tạo draft film, thêm replay/model/transform, pose hoặc action mappings, camera clips; publish vào **thư mục staging**, đọc lại compressed `.dat` qua `BbsCodec`, so semantic codec roundtrip và kiểm số actor/camera/pose track. Sau đó mới đổi tên thư mục hoàn chỉnh. Report ghi `runtimeAcceptance: "not-run"`; đọc lại bằng cùng codec chưa chứng minh game đọc đúng, đúng hình học hoặc từng giá trị key tương đương source.

```text
<filmName>/
  films/<filmName>.dat
  assets/models/<modelId>/model.bobj
  assets/models/<modelId>/<texture files>
  export-manifest.json
  export-report.json
  README.txt
```

**Phân biệt tầng xuất:** Java worker tự tạo thư mục package, không trực tiếp ghi ZIP. Luồng project `film.export` bên ngoài worker đóng gói ZIP và UI lưu artifact; tài liệu tính năng mô tả rõ bước này, hook UI gọi job rồi lưu ZIP [R6, R10]. Vì vậy cách gọi “worker xuất ZIP” là rút gọn của toàn pipeline.

Giới hạn trực tiếp ở worker: 1–64 actor, 1–3 camera clip, tối đa 64 model, 512 bone/profile, tối đa 256 key mỗi transform track/camera clip/pose bone và 256 animation key; duration 1–1.000.000 tick. Đây là giới hạn implementation, không phải trần định dạng BBS. Sampling dày 20 Hz với endpoint chỉ cho tối đa 255 khoảng tick mỗi track 256 key (12,75 giây); không suy ra mọi film chỉ dài 12,75 giây vì track có thể thưa. H3 phải báo lỗi, giảm key có kiểm sai số hoặc chia gói hợp lệ; không tự cắt mất dữ liệu.

Worker từ chối pose tracks trong mode playback và từ chối pose đồng thời với animation keyframes trên cùng actor. Editable ghi `pose_transform`; playback dựa named BOBJ action/config đã xác minh. Transform actor chỉ có vị trí/pitch/yaw; không có kênh actor roll/scale tùy ý. Cần bake scale/basis đúng hoặc chặn tính năng không hỗ trợ.

README worker còn mô tả project sampling/job/UI là chưa triển khai, trong khi tài liệu tính năng và hook UI đã có các bước DOC-048–050. Đây là **độ lệch tài liệu nội bộ**; không dùng README cũ để phủ nhận luồng mới, cũng không xem báo cáo thử cũ là lần chạy kiểm chứng của nghiên cứu này [R6, R10].

### 4.2. App 3 `scene_package.js`

`build()` lọc actor visible và không muted, lấy mẫu scene, bake GLB trung gian cho từng actor, gọi `bobj()` và đóng ZIP `<safe-scene-name>.bbs.zip` [R3]. Các entry thực tế:

```text
<actorId>/model.bobj
<actorId>/texture-<mesh/material key>.png|jpg|webp
<actorId>/animation.fbx                 (tùy chọn)
scene.bbs-scene.json
report.json
README.txt
```

Manifest có `type:"animation-studio-bbs-package"`, `version:2`, tickRate 20, placement, rotation, texture links, scaleBaked, modelUnits, root-motion policies/path, markers và contacts. Đây là **manifest riêng của app**, không phải native BBS film. README do code sinh cũng nói người dùng tự nhập model, gán texture và đặt actor. Không có `films/*.dat`, không tạo replay native, không serialize camera film; report `passed:true` là kết quả preflight/bake của app.

Với clip `rootMotion:"bbs-path"`, path nằm ngoài animation và cần importer/film builder áp dụng. Copy mỗi BOBJ vào game sẽ thiếu đường đi. Texture JPG/WebP và nhiều material có trong ZIP không tự bảo đảm loader BBS đích hỗ trợ hoặc bind đúng: nguồn public loader tìm PNG; phải chuyển/gộp texture hoặc xác minh fork. Marker/contact được mang theo metadata và contact được evaluator bake; chưa có bằng chứng game đọc schema này để tái dựng quan hệ editable.

### 4.3. `bobj_export.js`

Exporter đọc `gltf.animations[0]`, duyệt bones/studioJoint, tạo một armature `AnimationStudio` với `StudioRoot`, ghi bind matrices, mesh/weights/UV/normal/faces và một action đã bake. Nó lấy mẫu trực tiếp 20 Hz dù API có tham số FPS; tham số FPS được validate, không biến clock BOBJ thành FPS nguồn [R4]. Rotation được chuyển sang Euler ZYX liên tục; pose delta được tính tương đối rest; phát hiện shear hoặc scale rest bằng 0 thì chặn.

File này xuất **asset model/animation**, không xuất film, camera, actor instances hoặc mapping resource. Có nhiều `o` trong BOBJ không giải quyết giới hạn mesh/armature của loader. `up:'y'` xuất hiện trong comment đơn vị, không phải tự nó là phép chuyển mọi dữ liệu đầu vào sang Y-up; basis phải được các bước trước xử lý đúng.

## 5. Đề xuất hợp đồng xuất toàn cảnh EPIC-H3

### 5.1. Tên và cấu trúc

Chọn tên sản phẩm **BBS FS 2.4 Film Package**, file `<scene-slug>.bbs-film.zip`. Phần dưới là **đề xuất**, không khẳng định schema mới này đã được BBS triển khai:

```text
films/<scene-slug>.dat
assets/models/<stable-model-id>/model.bobj
assets/models/<stable-model-id>/model.png
assets/models/<stable-model-id>/<other-verified-assets>
export-manifest.json
export-report.json
README.txt
```

Đặt các thư mục trên ngay ở gốc ZIP, tránh thêm một tầng tên scene khiến người dùng copy nhầm. Dùng model ID an toàn, ổn định theo hash derivative/profile; deduplicate khi mesh/rig/texture thực sự giống nhau. Actor instances vẫn có replay riêng. Prop tĩnh cần model/form tương thích; nếu converter chưa hỗ trợ prop không armature thì báo blocking, không bỏ prop và vẫn gọi là toàn cảnh.

Tái dùng schema export manifest v1 của worker cho film path/hash, assets, actor/camera ID mapping, project/revision và sourceHashes. Nếu bổ sung fields ngoài schema hiện có, phải version hóa/ghi extension rõ; không giả sử BBS đọc chúng. Ghi thêm metadata kiểm toán cho unit/basis, frame→tick, root ownership, source action/bone aliases, aspect/FOV, mode, dependency world và tính năng chưa hỗ trợ. Report tách `nativeReadback`, đối chiếu source và `runtimeAcceptance`; chưa chạy game phải giữ trạng thái chưa chạy.

### 5.2. Luồng tạo gói

1. Chốt snapshot/revision; chọn đủ actor/prop và camera sequence; liệt kê dependency ngoài gói. Preflight orthographic camera, material/texture, scale/shear, số key và cut lệch tick.
2. Convert asset sang BOBJ/PNG theo profile FS 2.4. Giữ model local và world placement tách biệt, kiểm unit/basis/rest/bone aliases. Không xem BOBJ tự ghi được là loader chắc chắn dựng đủ mesh.
3. Lấy mẫu chung clock 20 Hz. Bake IK/contact thành pose. Với **editable**, ghi bone pose rest-relative và không chồng action playback. Với **playback**, ghi named action và mapping/timing hợp lệ. Không tuyên bố hai chế độ có cùng khả năng chỉnh sửa.
4. Ghi world trajectories đúng một lần, camera shots/local ticks, góc liên tục và vertical FOV cùng aspect; giữ endpoint/cut semantics.
5. Gọi Java worker hiện có để tạo native film/package. Kiểm codec, dependency hash, actor/camera/bone counts và so từng key quan trọng với mẫu nguồn; đóng ZIP sau khi kiểm thành công. Không dùng `scene.bbs-scene.json` thay `.dat`.
6. README ghi cách cài theo đúng game profile và giới hạn; giữ bản JSON App 3 chỉ như sidecar tùy chọn nếu cần, không đặt nó là nguồn native cho game.

Nếu cần chức năng “một file” cho người dùng, ZIP là một file bàn giao chứa đầy đủ tài nguyên. Chế độ model ghép một rig chỉ nên là tùy chọn thí nghiệm với tên thể hiện rõ model, không quảng bá `.scene.bobj` là native full-scene.

### 5.3. Cách BBS FS nạp

Worker hiện **không tự cài** và chưa chứng minh có menu native import toàn ZIP. Quy trình đề xuất là giải nén/copy các thành phần vào root đúng rồi mở Film Editor:

- Xác định đúng Minecraft instance, world/server và phiên bản mod; sao lưu film cũ trước khi chép.
- Nguồn BBS công khai tạo film root `<world>/bbs/films`, asset root `<game>/config/bbs/assets` [P7]. Theo đó, gộp `films/<name>.dat` vào film root và **nội dung** `assets/models/...` vào `<game>/config/bbs/assets/models/...`; tránh `assets/assets/models`.
- Với fork FS 2.4, **đường dẫn trên là tham chiếu upstream cần xác nhận**: tạo/lưu một film mẫu trong chính game, tìm thư mục film/model đang dùng rồi đối chiếu README/profile. Dedicated server có thể tách client asset và server world; không tự giả định một lần copy là đủ.
- Refresh/reload model hoặc khởi động lại theo khả năng bản mod; mở film theo tên trong Film Editor. Model form phải resolve đúng resource ID, không phải đường dẫn tuyệt đối máy xuất. Gán action đúng slot trong playback nếu cần xác minh; editable phải thấy bone channels.
- ZIP, export manifest và report được công cụ/người dùng dùng để cài/kiểm; BBS đọc `.dat` và tài nguyên model. Không cần đổi `.dat` sang `.scene.bobj`.

## 6. Người dùng cần kiểm trong game

Nghiên cứu này chưa chạy game; mọi mục dưới đây còn mở. Dùng fixture ngắn 3 giây = 60 tick, hai actor khác placement, ít nhất một actor nhiều mesh, một prop nếu có và hai camera shots để thấy cut. Ghi phiên bản FS/MC/bridge và kết quả từng mục.

| Kiểm tra | Kết quả cần quan sát | Dấu hiệu cần sửa |
| --- | --- | --- |
| Nạp và dependency | Film xuất hiện; đủ actor/prop; model/texture không thiếu sau reload | Film chỉ mở trên máy xuất, model fallback, mất mesh/phụ kiện |
| Scale/trục | Mốc cách nhau 1 block; đúng Y-up, trước/sau và hướng quay | Lệch 90°, đối xứng, tỷ lệ ×100/0,01 |
| Rig/mesh/material | Đủ các mesh, skin bám xương, ảnh/UV/alpha đúng | Chỉ mesh đầu hiện, phụ kiện rơi, UV lật, sai material |
| Đồng bộ tick | So tick 0/20/30/60 với preview; pose cuối giữ đúng | Tốc độ theo FPS nguồn, lệch bắt đầu, reset pose ở cuối |
| Root ownership | Đúng vị trí ở đầu/giữa/cuối; in-place và path đúng policy | Đi xa gấp đôi, animation chạy tại chỗ khi cần path |
| Pose/action | Playback gọi đúng tên action; editable có bone tracks và không cộng action lần nữa | Action không chạy, double pose, radians/độ sai |
| Contact | Hai tay/chân/prop tiếp xúc cùng tick như preview | Trượt chân, điểm chạm lệch, scale mismatch giữa hai actor |
| Camera | Framing/FOV/aspect, roll và cut đúng; không có một frame bay/quay vòng | Copy Euler sai convention, FOV ngang/dọc nhầm, cut lệch tick |
| Save/reopen | Sửa một bone key ở tick 30, save, đóng/mở lại và phát; key khác và camera còn nguyên | Film parse được nhưng editor không giữ pose hoặc làm mất channel |
| Tính độc lập | Thử gói trên profile sạch có đúng world/dependency đã khai | Resource vẫn trỏ file cục bộ hoặc model ID trùng |

Nên chụp cùng các mốc tick từ game và preview; ghi sai số vị trí/pose/camera và ngưỡng chấp nhận của dự án trước khi gọi đạt parity. Một lần đọc lại `.dat` thành công hoặc `report.passed` không thay các bước nghiệm thu này.

## 7. Nguồn đã đọc

Các liên kết mã dưới đây pin revision để tránh thay đổi main làm mất căn cứ. Nguồn công khai là tài liệu kỹ thuật gốc bằng mã; phần FS 2.4 chưa có checkout trực tiếp trong phiên này được ghi là evidence nội bộ.

### Repo ứng dụng

- [R1 — FilmExportWorker.java](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/three-workspace-app/agent/film_worker/src/main/java/local/bbsmerged/FilmExportWorker.java): schema input, limits, package, codec read-back, runtime report.
- [R2 — DraftEditor.java](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/three-workspace-app/agent/film_worker/src/main/java/local/bbsmerged/DraftEditor.java): replay/form/pose/actions/camera wire fields.
- [R3 — scene_package.js](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/scene_package.js): thành phần ZIP App 3, sample/bake, README.
- [R4 — bobj_export.js](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/bobj_export.js): một armature/action, mesh records, 20 Hz, rest-relative ZYX radians.
- [R5 — Blender BBSFix exporter vendored](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/three-workspace-app/agent/film_worker/vendor/blender_bobj/bbsfix/bobj402/export_bobj.py) và [NOTICE](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/three-workspace-app/agent/film_worker/NOTICE.md): nguồn gốc bản copy và frame→tick.
- [R6 — bbs-film-export.md](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/docs/three-workspace-app/docs/features/bbs-film-export.md): pipeline DOC-042–050, ZIP project job, pose semantics, nghiệm thu còn mở.
- [R7 — evidence/bbs-2.4.yaml](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/docs/three-workspace-app/docs/evidence/bbs-2.4.yaml): target revision 2.4, hash source/bridge, runtime chưa chạy.
- [R8 — filmCamera.ts](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/three-workspace-app/editor/apps/studio/src/filmCamera.ts), [scene_evaluator.js](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/scene_evaluator.js), [scene_studio.js](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/scene_studio.js): camera conversion, placement basis, manifest riêng của App 3.
- [R9 — Film worker README](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/three-workspace-app/agent/film_worker/README.md) và [film_worker.py](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/three-workspace-app/agent/film_worker.py): converter một armature, Java 17, dependency pin; README có trạng thái cũ so với R6.
- [R10 — useFilmExport.ts](https://github.com/tuantranmarinainter-ops/3appclaude/blob/702206c1aa8a0ddaa79d682f8ff517c5f98398d4/three-workspace-app/editor/apps/studio/app/workbench/components/film-export/hooks/useFilmExport.ts): UI gọi project job và lưu ZIP.

### BBS/Blockbuster công khai

- [P1 — BBS Film.java](https://github.com/mchorse/bbs-mod/blob/3cbfc79b9168c1aa6f51e774820ff646140c0167/src/main/java/mchorse/bbs_mod/film/Film.java): film có replays và camera clips.
- [P2 — FilmManager.java](https://github.com/mchorse/bbs-mod/blob/3cbfc79b9168c1aa6f51e774820ff646140c0167/src/main/java/mchorse/bbs_mod/film/FilmManager.java) và [CompressedDataStorage.java](https://github.com/mchorse/bbs-mod/blob/3cbfc79b9168c1aa6f51e774820ff646140c0167/src/main/java/mchorse/bbs_mod/utils/manager/storage/CompressedDataStorage.java): `.dat` và storage nén.
- [P3 — Replay.java](https://github.com/mchorse/bbs-mod/blob/3cbfc79b9168c1aa6f51e774820ff646140c0167/src/main/java/mchorse/bbs_mod/film/replays/Replay.java): form/keyframes/properties/actions.
- [P4 — BOBJLoader.java](https://github.com/mchorse/bbs-mod/blob/3cbfc79b9168c1aa6f51e774820ff646140c0167/src/main/java/mchorse/bbs_mod/bobj/BOBJLoader.java): grammar text và collections nhiều mesh/armature/action.
- [P5 — BOBJModelLoader.java](https://github.com/mchorse/bbs-mod/blob/3cbfc79b9168c1aa6f51e774820ff646140c0167/src/client/java/mchorse/bbs_mod/cubic/model/loaders/BOBJModelLoader.java): chọn armature/mesh, PNG, đổi action length theo 20 Hz.
- [P6 — BOBJBone.java](https://github.com/mchorse/bbs-mod/blob/3cbfc79b9168c1aa6f51e774820ff646140c0167/src/main/java/mchorse/bbs_mod/bobj/BOBJBone.java): thứ tự biến đổi bone.
- [P7 — BBSMod.java](https://github.com/mchorse/bbs-mod/blob/3cbfc79b9168c1aa6f51e774820ff646140c0167/src/main/java/mchorse/bbs_mod/BBSMod.java) và [README](https://github.com/mchorse/bbs-mod/blob/3cbfc79b9168c1aa6f51e774820ff646140c0167/README.md): resource roots và phạm vi phiên bản upstream.
- [P8 — Blockbuster Scene.java, nhánh 1.12](https://github.com/mchorse/blockbuster/blob/192480142b9eef0805014d32ac526f9027dc66f7/src/main/java/mchorse/blockbuster/recording/scene/Scene.java): scene/replay/record, NBT Actors; đối chiếu lịch sử, không làm đặc tả FS 2.4.
