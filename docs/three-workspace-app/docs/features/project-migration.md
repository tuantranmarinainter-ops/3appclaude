# 1.2.6 — Migration và project cũ

**Implementation hiện tại:** Python CLI có `import-topview project|draft <id>` để tạo project mới từ DirectorDocument/fcurves và ghi source ID vào extension; lệnh `import`/`export` làm việc với unified manifest scene-only. Không xóa/sửa nguồn. Chưa copy/hash asset bytes hoặc chuyển format Animation/Retarget; import manifest có native blob records bị reject rõ ràng.

## Mục tiêu / nguồn
Đọc đúng format/version, giữ original bytes/hash và tạo project mới. Reuse core.validateProject, scene_studio.validate, validateProjectV99/applyProjectV99, Topview schema/normalizer. Không sửa validator nguồn để dữ liệu sai đi qua.

## Mapping Input/Output
| Nhận diện nội dung | Field nguồn | Đích / xử lý |
| --- | --- | --- |
| type=animation-studio,version=1 | name,duration,fps,rig.fingerprint/profile | Motion + Profile/nativeFingerprint; relink rig bytes trước evaluate. |
| Cùng format | keys,poses,ikModes,ikOptions,settings,skinAdjustments,loop,metadata | Native edit blob đầy đủ, evaluator1.31.8; không bake để lưu project. |
| type=animation-studio-scene,version=1 | actors.id/slot/profile/rigFingerprint/units/transform/visible/locked/muted | Character/Node idMap; Z-up→Y-up; giữ flags/slot/provenance; model units không đổi placement lần2. |
| Cùng scene | clips.sourceId/start/length/sourceStart/sourceLength/speed/loop/reverse/fade/align/rootMotion | Motion/native clip/binding; giây→frame; baked→skeletal, bbs-path→trajectory, in-place→in-place. Fractional precision giữ native; export mới resample có report. |
| Cùng scene | library motions/poses/rigProfiles/templates,markers,contacts,settings | Library thành assets/motions; markers/contacts/templates giữ namespace và editor/evaluator Animation, không chỉ giữ opaque rồi coi đã tích hợp. |
| type=mixamo-retarget-project,version=1 | build/mode/rig/source/target | Native session + profiles/fingerprints. build thực tếV9.9 trong HTMLV9.12; không đoán version bằng build string. |
| Cùng Retarget | state.context: offsets/calibration/segments/mapping/sourcePose/interpolation/feet | NativeProject giữ đầy đủ; mapping sidecar/profile pair; sourcePose không phải editor tạo pose. |
| Cùng Retarget | state.controls/sides/movement,tick,previewSpeed | Controls giữ native; movement/root switch→policy; tick/speed preview là UI, không đổi exportFPS. |
| Topview DirectorDocument pinned schema | type,pippitAssetId,extra,content và native unknowns hợp lệ | Giữ scene nodes/timeline/editorial/settings/environment/scenePlan/generate; host map asset references, giữ keys gốc. |
| Topview project assets/compact fcurves ngoài document | manifests/local refs/fcurves/generation records | Copy original, hash assets, giữ native fcurves/provenance; thiếu asset mở read-only tới khi relink. |

## Luồng
Input file/folder handle + autodetect/relink/destination. Validate type/version/size → plan → kiểm hash/rig/assets → report → xác nhận loss được phép → stage → validate references → commit project mới.

Output migrationReport gồm projectId,idMap,fieldMap,assets,issues,sourceHashes,outputHash. Issue: code,severity(blocking|warning),path,sourceValueSummary,action,preservedAt. Không log binary/credential.

Retarget JSON không nhúng FBX gốc: relink phải khớp source fingerprint, target hierarchy/rest fingerprint; Minecraft action phải tồn tại. Cùng tên file nhưng khác fingerprint không được chấp nhận. Có thể import asset mới và retarget lại theo flow riêng.

## Mất mát / version
Unknown metadata an toàn giữ extension; field ảnh hưởng hành vi thiếu adapter => blocking/read-only. Không cho “bỏ qua tất cả” đối với nhân vật/xương/curve/camera/texture. Chỉ warning UI preference/thumbnail có thể bỏ qua, ghi từng code.

Generic JSON Blockbench không phải một format duy nhất: chỉ loader đã khai báo mới nhận; .bbmodel chưa có reader tương thích phải báo UNSUPPORTED_CAPABILITY, giữ source. Hậu tố .ani.* và .moani.* là tên gợi ý; content option quyết định dữ liệu. Export dẫn xuất có thể bake; project luôn giữ native edits/source.

## UI / API / lỗi
Dialog source version/format/destination/relink/report/Open read-only/Create migrated project. API project.import/asset.relink. Same requestId không tạo2project. Chặn path traversal, symlink escape, prototype keys, depth/NaN, unsupported version, duplicates; IO interruption giữ bản cũ. Không thay project lỗi bằng project rỗng.

## Nghiệm thu / tác động
MIGRATE-01..02 trong [acceptance](../acceptance.yaml):4formats, original hash giữ, native payload tương đương, relink đúng/sai, unknown fields, lỗi giữa commit. Ba workspace cùng dùng idMap. Chỉ export về legacy nếu native state còn biểu diễn được; không hứa lossless mọi format.
