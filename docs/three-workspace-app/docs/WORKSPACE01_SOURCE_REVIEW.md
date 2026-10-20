# Workspace01 — Review nguồn và kế hoạch runtime đa rig

W01-PLAN-002 · 2026-10-19 · Code đã được duyệt; runtime thật chờ fixture từ người dùng. [Đặc tả chính](features/rig-animation-normalization.md), [8 gate](inventory/workspace01-normalization.yaml), [registry từng mẫu](fixtures/workspace01-source-candidates.yaml).

## Kết luận thiết kế

Mixamo65 là đích; nguồn không có số bone, tên hay hierarchy cố định. 115 chỉ là ví dụ. Adapter đọc/chuyển định dạng về graph + sampler chung, mapping và retarget chạy trên dữ liệu này. Preset hãng hỗ trợ gợi ý nhưng không là danh sách rig duy nhất engine nhận.

Ưu tiên MVP: A = rig Character Creator/iClone nguyên bản; B = UE Mannequin; C = Character Mixamo65 khác tỷ lệ/rest. A và B phải là hai topology/rest khác nhau trước conversion, không pre-retarget về cùng rig ở phần mềm nguồn. Cả hai action chuẩn hóa gán lên C và preview được. Nếu thiếu sample A/B, có thể đề xuất Maya custom hoặc Warcraft humanoid thay thế, giữ yêu cầu hai rig thật. Không tự đổi ứng viên thành đã kiểm.

Review nguồn ngoài hiện chỉ xác nhận đường định dạng qua tài liệu nhà cung cấp/repository tác giả. Người dùng chọn code trước, chưa dùng fixture CC/UE cho runtime. Đã tìm thấy canonical target topology trong Topview Female: 65 skin joints, tên/parent graph exact; file hash và CC-BY attribution được pin trong `packages/retarget/src/mixamo65.ts`. Bốn nhân vật Topview Female/Child/Man/Adult đều có 65 joints và cùng topology; rest local transforms khác nhau ở toàn bộ 65 joints, nên mỗi target Character vẫn cần profile/rest riêng. Đây là nguồn target Mixamo65, không tính là hai source rigs khác nhau và chưa phải runtime retarget.

## Ma trận nguồn và ứng viên

| ID / Nguồn | Mẫu đại diện đề xuất | Đường nhập cần kiểm | Phần cần adapter/đối chiếu | Trạng thái |
| --- | --- | --- | --- | --- |
| W01-S01 · iClone/CC | CC Base ở phiên bản người dùng có, action walk/turn; giữ twist/face/helper gốc | Xuất FBX mesh+motion hoặc motion-only từ Reallusion [R1] | unit/rest, twist ownership, clip timing; body so riêng với face/morph | NOT_RUN; chưa khóa file/version |
| W01-S02 · UE4 | Mannequin + walk/turn AnimationSequence | Skeletal mesh + animation FBX; không nhập .uasset trực tiếp [R2] | A-pose, root/pelvis, IK helpers, unit/basis | NOT_RUN; ứng viên B |
| W01-S03 · UE5 | Manny hoặc Quinn, action baked từ skeleton gốc | FBX sau bake animation; pin engine/exporter | correction/twist/IK chains, rest pose khác UE4 | NOT_RUN; chọn .02 hoặc .03 cho MVP, còn lại regression |
| W01-S04 · MetaHuman | Body có locomotion; face ghi riêng | Body AnimationSequence → FBX; DNA/DCC assets là đường khác [R3] | RigLogic/face/secondary deformation không được tự xem là65-body compatible | NOT_RUN; mở rộng sau MVP |
| W01-S05 · Maya | Humanoid custom joint names, nhiều twist/spine, animation constraint/IK đã bake | .ma/.mb → FBX có skin + bake tại Maya [R4] | joint orientation/pre-rotation, intermediary transforms, nhiều takes | NOT_RUN; file custom chưa chọn |
| W01-S06 · Unity Humanoid | Nhân vật trong project có Avatar + Animator clip | Ưu tiên FBX nguồn; nếu dùng kết quả Animator cần bake/evaluate ra bone TRS | Không xem Humanoid như một skeleton cố định; pin exporter/runtime, xem giới hạn [R5] | NOT_RUN; cần project/asset cụ thể |
| W01-S07 · Unity Generic | Humanoid custom cấu hình Generic có root motion | FBX nguồn hoặc export đã xác minh [R5] | root node, optimized hierarchy và khác biệt authored/evaluated clip | NOT_RUN; không dùng lại cùng rig S06 để tính hai nguồn |
| W01-S08 · Sketchfab | Humanoid custom rig, animated+downloadable, chưa chốt model UID | glTF archive + .bin + textures; đóng gói resolver/GLB an toàn [R6] | Không coi Sketchfab là loại rig; inspect skeleton, license, skin, animation thực | NOT_RUN; UID chưa khóa |
| W01-S09 · Warcraft III | Footman hoặc humanoid tương đương có Walk/Attack | MDX/MDL: ưu tiên adapter loader/evaluator Animation1.31.8 đã có; đối chiếu parser [R7] | helpers/pivots, global sequences, interpolation, visibility/particles; không bỏ effect tracks im lặng | NOT_RUN; chưa chọn bytes/version Classic/Reforged |
| W01-S10 · World of Warcraft | Humanoid có walk/turn + rig/skin đầy đủ | Khảo sát converter riêng như wow.export [R8]; format/animation export phải xác minh bằng file | Không suy MDX loader đọc được WoW; pin game version và converter | NOT_RUN; đường chuyển chưa được xác nhận |
| W01-S11 · Liên Minh Huyền Thoại | Ashe hoặc humanoid có run/attack, skeleton+mesh+animation cùng version | SKN/SKL/ANM → Blender adapter ứng viên Aventurine → FBX/GLB [R9] | name/hash binding, format versions, animation parity, accessory bones | NOT_RUN; chưa cài addon/chưa có bộ file |
| W01-S12 · Blender/custom | Rigify/custom humanoid có helper và action baked | .blend → FBX/GLB từ DCC, preserve source file | control vs deform rig, constraint bake, skin và scale; adapter khảo sát tiếp | NOT_RUN; nguồn fallback/test mở rộng |
| W01-S13 · Mixamo | Fixture Punch Combo/T-Pose đã có trong manifest cũ | FBX importer đã có bằng chứng lịch sử | control baseline/ứng viên target C; cần xác minh lại asset đích/khác tỷ lệ | NOT_RUN cho gate universal; không tính là hai nguồn mới |
| W01-S14 · Dota/custom game | Humanoid có skeletal animation, chưa chọn asset | Ưu tiên bản FBX/GLB được xuất hợp lệ; parser native/converter chưa chọn | phiên bản game/format/skin/motion cần nghiên cứu riêng | NOT_RUN; chưa có đường native được xác minh |

Số xương ở mọi mẫu trên: **chưa đo**. Không ghi số mặc định theo thương hiệu; mỗi LOD/export option/version có thể cho graph khác. Skin joints, bone nodes, helpers và tổng scene nodes được báo riêng. Files rig/animation rời phải khớp source profile trước khi mapping.

## Bằng chứng đường chuyển và giới hạn

- [R1 — Reallusion CC4: Saving One Motion Per File](https://manual.reallusion.com/Character-Creator-4/Content/ENU/4.0/17_Export/Saving_One_Take_Per_File.htm): có export Motion hoặc Mesh and Motion sang FBX, tùy chọn mỗi motion một file. Đây là khả năng exporter của CC, chưa chứng minh importer app đọc mọi FBX hoặc retarget CC thành công.
- [R2 — Epic: FBX Animation Pipeline](https://dev.epicgames.com/documentation/en-us/unreal-engine/fbx-animation-pipeline-in-unreal-engine): mô tả skeletal animation pipeline và skeleton không bắt buộc kèm mesh. Phiên bản FBX/engine phải được ghi theo tool thực chạy; tài liệu không phải bằng chứng đã chuyển Mannequin trong app.
- [R3 — Epic: Animating Your Character with APEX](https://dev.epicgames.com/documentation/en-us/metahuman/animating-your-character-with-apex): mô tả bake body track thành AnimationSequence và export FBX; [MetaHuman Export Tool](https://dev.epicgames.com/documentation/metahuman/metahuman-creator-export-tool-in-unreal-engine) phân biệt DCC/DNA/geometry. Đề xuất MVP chỉ body-compatible channels, giữ và báo face/DNA ngoài projection65.
- [R4 — Autodesk: Game Exporter](https://help.autodesk.com/cloudhelp/2023/ENU/Maya-ManagingScenes/files/GUID-2DB6E7B0-04B8-4585-91E9-7D64B02D0338.htm): bake constraint thành bone curves, có xuất clip thành takes hoặc file riêng. Không gửi constraint graph chưa evaluate sang Three.js rồi gọi là animation đầy đủ.
- [R5 — Unity FBX Exporter 4.2.1](https://docs.unity3d.com/Packages/com.unity.formats.fbx@4.2/manual/exporting.html): tài liệu phiên bản này ghi Humanoid rigs không được hỗ trợ trong nhóm export SkinnedMeshRenderers. Không suy hạn chế này cho mọi phiên bản; cần khóa version thực dùng. Đề xuất dùng FBX nguồn hoặc adapter bake Animator, chưa có cam kết đọc .anim/.controller/.unity trực tiếp.
- [R6 — Sketchfab Download API](https://sketchfab.com/developers/download-api/downloading-models): glTF download dạng archive chứa scene.gltf, scene.bin và textures; tải API có xác thực. [glTF export](https://sketchfab.com/features/gltf) là đường interchange, không bảo đảm mọi sample có skeletal animation. Hiện importer local giới hạn tài nguyên embedded ở một số đường chạy: cần resolver/đóng gói thêm cho archive, không gắn nhãn trực tiếp hỗ trợ ZIP.
- [R7 — mdx-m3-viewer của tác giả](https://github.com/flowtsohg/mdx-m3-viewer): có parser MDX/MDL read/write, viewer Warcraft3; repo ghi không còn duy trì tích cực. Ưu tiên khảo sát port đã khóa của Animation1.31.8 qua [inventory](inventory/animation.yaml), không tự thay vendor. Không coi M3 Starcraft là WoW.
- [R8 — wow.export của tác giả](https://github.com/Kruithne/wow.export): ứng viên nghiên cứu riêng cho WoW; lượt này chưa xác minh animation output/version/roundtrip, không cam kết glTF animation từ repo chỉ dựa tên công cụ.
- [R9 — Aventurine League Tools của tác giả](https://github.com/RitoShark/Aventurine-League-Tools): README công bố Blender4+, SKN/SKL và ANM handling. Đây là claim upstream, chưa test plugin. [alanpq/lol-blender](https://github.com/alanpq/lol-blender/blob/main/README.md) ghi ANM còn planned; do đó không chọn chỉ vì có mesh/skeleton import. Khi chọn adapter cần khóa revision/license/Blender và kiểm Action thực.

## Định nghĩa kết quả và kế hoạch đo

Mỗi mẫu có 4 kết quả riêng: import, retarget, assignment, model export. Runtime tổng PASS chỉ khi các gate bắt buộc của chế độ được chọn đều PASS. Animation-only không cần skin pass; Model+Rig+Animation cần skin/rest/deformation/texture pass. Không có file: NOT_RUN với lý do; chạy rồi sai: FAIL kèm lỗi; thiếu converter: BLOCKED sau kiểm tra khả năng thực tế.

Báo coverage auto và confirmed bằng số target slots mapped/65; report thêm required roles đạt/tổng required, số manual corrections, extra/source bones đã xử lý, synthetic rest-only target slots. So confidence với mapping được kiểm thủ công; mapping đúng mới được tính, không chỉ tồn tại link. Quality metrics lấy từ spec chính, ghi sample frame/time và worst joints/vertices; tỷ lệ mapping cao không thay animation accuracy.

Fixture lock phải có: source URI/path+hash, quyền sử dụng, software/exporter/adapter versions, skeleton signature, actual bone/node counts, action names/durations/FPS, root policy và source preview. So original → interchange để tách converter loss; sau đó interchange → target65 → assigned C để tách retarget/assignment loss. Video/browser log cùng numerical report và files xuất là bằng chứng; screenshot pose tĩnh không đủ.

MVP không bị khóa bởi việc phải hỗ trợ mọi format native ngay. Hoàn tất hai nguồn có đường chuyển xác minh trước, sau đó mở rộng matrix theo cùng adapter contract. Các nhóm iClone/UE/Unity/Maya/Sketchfab/Warcraft/LoL vẫn nằm trong kế hoạch review và regression; không xóa khỏi scope vì chưa có sample.

## Hiện trạng và bước kế tiếp

Chưa có mẫu mới nào được kiểm runtime universal; **0/8 gate nghiệm thu, 0/2 nguồn đạt MVP**. File registry để metric null và evidence rỗng. Tìm file bằng rg theo .fbx/.glb/.mdx/.mdl/.skl/.anm/.m2 trong workspace (không duyệt ignored) chỉ thấy một số builtin GLB và fixture Film; không kết luận các nhóm nguồn không tồn tại ở toàn bộ máy. Manifest cũ có generator iClone, không dùng generator đó làm bằng chứng xuất iClone thật.

Sau khi người dùng duyệt code: khóa hai fixture → implement chung inspect/mapping/retarget → animation-only+Assignment preview → nhánh model/skin → export/Scene → regression. Hiện chỉ cập nhật docs, không chạy DCC hoặc thay dữ liệu project.
