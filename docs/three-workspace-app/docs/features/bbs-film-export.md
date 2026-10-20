# 1.7.1–1.7.3 — Film BBS FS2.4, phát và keyframe chỉnh được

## Mục tiêu / nguồn chính xác
Đích BBS FS2.4/MC1.20.1. Pin commit0085f77ced9232dc4e26ac51fc7d98f95d1d5b0b; gradle.properties ghi mod_version2.4. Checkout HEAD hiện là2.7 nên mọi reference đọc bằng git show revision2.4; [SOURCES](../SOURCES.yaml) và [BBS evidence](../evidence/bbs-2.4.yaml) khóa file bytes. Không lấy HEAD2.7 làm codec2.4.

## Kiến trúc chọn cho exporter
Python CLI điều phối worker Java17 trong thư mục staging riêng. Reuse binary vendor/bbs-animation-bridge-0.2.0-mc1.20.1.jar và BbsCodec/FilmEditor đã pin SHA256, cùng logic DraftEditor của BBS_FS_MCP_MERGED_024. DOC-048 thêm project-scoped job/API command, CLI/MCP clients và Studio export panel nối shared-project samples tới converter và worker.

Worker mới nhận typed export manifest, tạo draft→actors/camera/animation/pose→đọc lại→xuất Film native. Không khởi chạy game, server HTTP gốc hoặc entrypoint addon; không gọi publish vào world thật. Không viết Python codec thứ hai. Giữ MIT/NOTICE binary; worker packaging kiểm checksum trước chạy. Không gọi reflection class/method/path do user tùy ý cung cấp.

## Lát cắt đã triển khai — DOC-042/DOC-043

Lệnh `python -m agent.unified_cli film export MANIFEST --output-dir EXISTING_FOLDER` nhận manifest `schemaVersion: 1`, `targetVersion: "2.4"`, `projectId`, số nguyên `sourceRevision`, `filmName`, `mode`, `durationTicks`, `models`, `actors` và `cameras`. Mỗi model liệt kê profile xương/action, `textureRequired` và file nguồn có `targetPath` cùng SHA-256. Có thể tạo BOBJ/profile/PNG trước bằng `python -m agent.unified_cli film convert-model SOURCE.fbx|SOURCE.glb --output-dir EXISTING_FOLDER`; vẫn cần đưa các đường dẫn/hash profile vào manifest. Actor hỗ trợ transform samples, action keyframes tùy chọn và pose tracks BOBJ; camera hỗ trợ các keyframe transform/FOV.

Worker biên dịch Java 17 trong thư mục tạm, kiểm tra hash JAR, manifest, giới hạn kích thước, ID/tick/profile và đường dẫn; tạo gói mới trong thư mục đích đã tồn tại, từ chối ghi đè, đọc lại `.dat` qua BbsCodec và kiểm tra cấu trúc actor/camera/pose trước khi đổi tên gói. Package gồm `films/<filmName>.dat`, `assets/models/<modelId>/...`, `export-manifest.json`, `export-report.json` và README. Không tự cài vào game.

Fixture DOC-042 tạo hai actor, một camera, thời lượng 60 tick và một pose track. Test xác nhận GZIP/BBS1, semantic read/write/read của codec, số actor/camera, loại/số key của pose track, asset hash và manifest. Đây chưa phải so sánh giá trị từng key với project nguồn hoặc playback parity. Gói test tạm đã bị dọn cùng thư mục temporary sau kiểm tra.

DOC-043 thêm converter cục bộ FBX/GLB rigged thành BOBJ để cấp asset cho manifest. Blender 4.2.3 tạo FBX và GLB tạm có rig/action/JPEG; cả hai chuyển thành BOBJ/profile/PNG và giữ nguyên hash nguồn. BOBJ/PNG từ GLB tiếp tục được đóng gói qua Java worker và so byte-for-byte sau native codec read-back. Chưa tự động tạo manifest từ project, lấy mẫu camera/actor/timeline, chạy converter qua broker/API/MCP, hoặc xác minh package trong Minecraft/Film Editor.

DOC-044 mở rộng mỗi bone trong converter profile bằng ma trận bind/rest BOBJ toàn cục dạng 16 số row-major, đọc trực tiếp từ record `arm_bone`; test so khớp với file BOBJ do exporter ghi. Đây là dữ liệu đầu vào để tính delta pose tương đối với rest, chưa có bước chuyển hệ trục, bake pose track hay ghép project sampling vào manifest.

DOC-046 thêm pose baker nội bộ: kiểm tra một basis source→BOBJ dùng chung cho toàn skeleton, bỏ actor world placement và tạo `pose_transform` rest-relative. DOC-047 thêm manifest builder nối project samples, actor transform 20Hz, camera clips, profile converter cùng file hashes theo schema worker 2.4. Blender-generated one-bone FBX đã đi qua converter thật, builder và Java 17 worker tới native readback. Builder từ chối actor scale/roll/shear vì Replay schema chưa biểu diễn chúng. Đây vẫn là module nội bộ: chưa có project export job/API/UI/CLI/MCP gọi toàn luồng; end-to-end smoke chỉ dùng rig tĩnh một xương và không kiểm Film Editor hoặc game. [DOC-047 evidence](../evidence/film-manifest-builder.yaml).

DOC-048 thêm `film.export` vào project broker: chốt revision/hash snapshot, preflight/20Hz sample, kiểm hash asset nguồn, chạy Blender converter từng model, tạo typed worker manifest, chạy Java 17 BBS2.4 worker, đóng gói ZIP vào `.jobs/<jobId>/files` và trả artifact chỉ đọc sau khi kiểm size/SHA. Job dùng progress/cancel/job.get/job.cancel hiện có, giữ một local conversion slot, dọn staging khi hoàn tất và đánh dấu job dang dở nếu host restart. Studio có panel chọn Characters, camera sequence, frame range, aspect và tên Film; panel lưu ZIP đã xác minh vào thư mục `film-<jobId>` người dùng chọn. Python CLI có `film project-export`; MCP công bố command `film.export`, và client giữ output path ngoài broker. `filmName` bị giới hạn ký tự an toàn; source hash và converter/worker output path được kiểm trước khi dùng. Chromium smoke xác nhận panel/control và trạng thái export bị khóa khi project chưa có Character/sequence. Mốc job tĩnh ban đầu và trạng thái thất bại của fixture animated được ghi trong [DOC-048 evidence](../evidence/film-project-export-job.yaml).

DOC-049 calibrates each source bone delta into its BOBJ local bind frame and rejects scale/shear. DOC-050 adds collision-free BOBJ IDs for unsafe imported names and maps them back through FBXLoader-normalized `sourceName`. Punch Combo (65 bones, 1 action) passes real conversion and a two-Character/two-shot project job through Java 17 ZIP native readback. This verifies that fixture configuration only; Film Editor edit/save/reopen, numerical runtime comparison and Minecraft playback remain open. [DOC-050 evidence](../evidence/film-safe-bone-names.yaml).

## I/O và bố cục gói
Input shared snapshot, selected characters/range/sequence, mode playback|editable, target2.4, assets+profile+evaluator samples. Output thư mục mới:
- films/<safe-film-name>.dat — native compressed typed BBS data.
- assets/models/<asset-hash-prefix>/model.bobj, model.png và thư mục texture theo material khi cần; config.json chỉ có fields được source loader hỗ trợ.
- export-manifest.json — version1,sourceRevision/sourceHashes,targetVersion,characterId→replayIndex/modelId,camera/shot IDs,checksums,root policy,coordinate/time conversions.
- export-report.json và README hướng dẫn nhập/cài thủ công, vị trí đích được resolve theo profile game người dùng.

FilmManager dùng .dat→CompressedDataStorage→GZIP(BBS1 header + typed storage), không phải JSON hoặc NBT đổi đuôi. Worker giữ typed Node values; roundtrip so semantic values, không so compressed bytes/timestamps. assets/models là relative tới BBS asset root; không tự đoán rồi ghi config/world trong máy.

## Mapping và luồng
| ID | Xử lý | Điều kiện |
| --- | --- | --- |
| 1.7.1 | Validate assets/profile/capabilities→sample→bake asset derivative nếu cần→worker create draft→native read-back→đóng gói nguyên tử | File refs/hash/loader đúng, không mất actor/texture; gói stage chưa là cài vào game. |
| 1.7.2 | Replay.keyframes x/y/z,yaw/pitch/headYaw/bodyYaw; ModelForm.model/actions; camera KeyframeClip x/y/z/yaw/pitch/roll/fov/distance | Reuse DraftEditor typed operations; camera clips [start,start+duration), endpoint sample tại duration. |
| 1.7.3 | Replay.properties pose hoặc pose.bones.<boneName>; KeyframeChannel type pose/pose_transform, keyframes tick/value/interp | Dùng schema Pose/PoseTransform và PerLimbService2.4, giữ bone names/hierarchy. Không chỉ đặt animation action rồi gọi là editable. |

Sample world position ở20Hz sau parent/path/root evaluation. 1m=1block; direction vector d cho yaw=atan2(-dx,dz), pitch=-atan2(dy,sqrt(dx²+dz²)); unwrap angles để không quay360 ngoài ý muốn. Camera Three nhìn local-Z; tính forward/up từ evaluated quaternion rồi đổi convention BBS, derive roll từ basis, không copy Euler trực tiếp. FOV source vertical degrees; BBS Angle.set chuyển camera.fov radians thành degrees và Recorder dùng vertical perspective(fov,aspect), nên ghi cùng vertical degrees khi aspect giống. Nguồn khai horizontalFOV thì vFOV=2*atan(tan(hFOV/2)/aspect). Kiểm framing với cùng aspect, tắt gameplay FOV modifiers khi nghiệm thu. Camera ortho không tương thích v1: chặn hoặc yêu cầu convert perspective có preview.

Scale actor bake vào model derivative/rest/translations/normals đúng một lần; ModelForm dùng scale1 cho profile portable. Animated/nonuniform scale phải converter giữ được mesh/limb transforms và có test, nếu không block, không bỏ qua như manifest importer cũ. Replay world motion nhận root delta thì model animation phải loại cùng delta. Skin/motion in-place vẫn giữ actor placement. Static props đi model replay không có motion; camera/character count đúng manifest.

Playback: BOBJ loader2.4 đọc model.bobj, model.png/material textures và actions; map action name/slot đã validate; exporter không đoán action tồn tại. Existing ManifestImporter có rounding frame→tick và bỏ scale, thiếu pose tracks: reuse validation/plan phần phù hợp, không coi là đường full-fidelity.

Editable: evaluate pose ởtick0..60, convert relative rest matrices vào PoseTransform theo model loader2.4, serialize channels type pose_transform dưới properties/pose.bones.<name>; giữ fix/color/lighting defaults nguồn. Đối chiếu với animationToPoseKeyframes/posesToLimbTracks. Tắt action playback cùng bones khi pose tracks đã sở hữu motion để không cộng animation2lần. Nếu bone group target không tồn tại: block với bone list; không báo thành công chỉ vì .dat parse được.

## UI / API / lỗi
Export dialog targetversion/mode/actors/sequence/range/root/loss, preflight và download/open-folder. film.export chỉ tạo gói. Cài/publish vào game là thao tác khác cần phạm vi riêng, không gộp vào Undo project. Nếu người dùng dùng bridge trong giai đoạn nghiệm thu thì filmId phải là draftID trả về, không phải tên Film game.

Chặn model không có mesh/armature, profile mismatch, missing texture, unknown property/codec, collisions/path traversal, unsupported material/scale/ortho, job interruption. Partial staging không được hiện như gói đạt; giữ report để sửa, không sửa nguồn.

## Nghiệm thu / tác động
FILM-01 kiểm native read/write, loader assets, scalar types/references/channels; FILM-02 playback position/pose/root/camera/cuts; FILM-03 mở Film Editor, sửa một bone key, save/reopen/play. E2E-01:2characters,3s,1camera; sửa keyframe tick30 và giữ key khác. Ngưỡng ở [acceptance](../acceptance.yaml). Codec/bridge và game parity phải được chạy khi triển khai, hiện chưa chạy. Toàn bộ3workspace cung cấp dữ liệu; Animation scene_package vẫn là manifest hỗ trợ, không phải native Film.

## Wire profile editable BOBJ2.4

Đích editable portable dùng BOBJ derivative để có một semantics rõ, không trộn với Cubic Blockbench. Với mỗi bone, tính local pose sau basis/unit/parent conversion rồi deltaMatrix=inverse(restLocalBOBJ)*posedLocalBOBJ. Decompose delta thành t/q/s; shear hoặc matrix không decomposable trong tolerance thì chặn. BOBJBone nhân restLocal*Translate*RotateZYX*Scale; r lấy EulerZYX **radians**, r2=[0,0,0], t cùng đơn vị restBOBJ, s mặc định[1,1,1]. Duy trì Euler continuity khi sample; không ghi degrees vào BOBJ pose track. Model animation và IK bổ sung phải tắt trên bones đã bake.

Channel wire: properties["pose.bones.<boneName>"]={type:"pose_transform",keyframes:[{tick:float,value:{t:[float,float,float],s:[float,float,float],r:[float,float,float],r2:[0,0,0],fix:0.0,color:-1,lighting:0.0}}]}. Giữ native scalar type của BbsCodec; keyframe interp mặc địnhlinear, không tự chèn handle metadata. Nếu model có shear/scale khác profile hoặc UI còn action chồng pose: xuất report blocking. UI có thể hiển thị độ; expected30deg là pi/6 trong r cho profileBOBJ,40deg là2pi/9. Source Transform/PoseTransform/BOBJBone/BOBJModel đã pin trong evidence; runtime phải kiểm lại bằng Film Editor.


## Đặc tả sampler CPU range — DOC-036

Input SceneContract và range `{startFrame,endFrame,sampleFps}`; frame đầu/cuối inclusive, sampleFps hữu hạn dương. Sampler stream grid thời gian tương đối i/sampleFps trong khoảng [0,duration), thêm đúng một endpoint tại duration=(end-start+1)/sceneFPS. Output `{frame,timeSeconds,side,skeletonSamples}`; side right ở grid thường và left ở endpoint. Không thêm frame editor mới. Endpoint chọn clip trước tại cut, lấy source pose bên trái vòng loop, không reset sang rest pose; root trajectory cũng chọn cùng clip. Source sampling giữ trim/speed/reverse/fractional time. Range giữ độc lập document/clip, gọi evaluator đã load một lần và không sửa bytes nguồn. Path placement của actor được sample theo ownership tương ứng.

Đây là API CPU nội bộ phục vụ converter/Film; chưa là film.export hoặc job. Lỗi range/FPS/count vượt precision bị chặn trước yield. Nghiệm thu: 3s@30→20Hz có60 mẫu nội bộ+1endpoint, endpointsource đúng và không T-pose; cut giữ previous-left và next-right khác nhau; loop/reverse endpoint; path/root không chạy hai lần. Camera/shot endpoint, mesh conversion, codec và game acceptance vẫn cần triển khai riêng.


## Đặc tả camera/shot sampler — DOC-037

Input document/editorial sequence, SceneContract có saved overlays, sampleFps và viewportAspect hữu hạn dương. Validate sequence/camera/source ranges trước yield. Mỗi shot dùng range inclusive và grid + left endpoint như skeleton; output có shotId,cameraNodeId,sourceFrame,shotTimeSeconds,sequenceTimeSeconds,side,position,quaternion,lookAt,verticalFov,aspect,near,far. CameraRig giữ curve/procedural/trim/easing/chained semantics; export right chọn đoạn bắt đầu tại cut, left chọn đoạn trước. Giữ manual roll và user keys theo cùng helper engine. Quaternion/world pose và aspect lấy theo camera/source, không copy Euler trực tiếp sang BBS.

Sampler perspective-only; viewportAspect tường minh để resolve auto theo cameraNumericAspect, không đoán từ màn hình. Không round cut timestamps sang tick; exporter portable20Hz phải preflight các cut không nằm grid trước khi encode. Camera subject/lookAt target có root trajectory chưa được nối vào numeric camera evaluator sẽ trả lỗi blocking, không ghi camera placement giả làm world follow. Đây là converter input, chưa phải native Film hay render. Nghiệm thu: hai shot giữ previous-left/next-right riêng, FOV/aspect/roll đúng; camera path endpoint; preview/golden cũ không đổi; invalid sequence/missing camera/ortho/trajectory target bị chặn.
