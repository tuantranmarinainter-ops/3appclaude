# Đề xuất tích hợp Animation Creation vào Workspace 03

Ngày: 2026-10-19. **Phạm vi AC-00–AC-08 được người dùng duyệt code ngày 2026-10-19.** Implementation và runtime vẫn được chấm riêng theo bằng chứng; xem [AC task plan](../../ANIMATION_CREATION_TASK_PLAN.md) và trạng thái hiện hành. Đặc tả bổ sung cho [Animation](animation-workspace.md), phạm vi là hoàn thiện phần Animation Creation bị thiếu, không làm lại ba workspace.

## 1. Sửa cách hiểu MVP

Workspace 03 phải cho người dùng **tạo và sửa animation bằng Animation Studio 1.31.8 của họ**: chọn nhân vật từ scene, tạo motion mới hoặc mở motion hiện có, sửa pose/key xương, dùng control rig/IK và graph/easing cơ bản, lưu rồi dùng kết quả trong scene và export.

Đặt FBX có sẵn lên timeline, đổi thời gian clip hoặc đặt key transform của actor là các chức năng hữu ích nhưng không thay thế yêu cầu này. Bổ sung native creation tối thiểu thành P0; full parity nâng cao vẫn triển khai theo giai đoạn. Giữ nguyên các chức năng nguồn và ghi rõ chức năng nào chưa được nghiệm thu trong app hợp nhất.

| Bằng chứng mã nguồn đã đọc | Ý nghĩa |
| --- | --- |
| `editor/apps/studio/app/workbench/components/StudioOverlay.tsx` truyền `DirectorStudio` làm children cho `AnimationWorkspace` | Workspace 03 hiện dùng editor Topview |
| `AnimationWorkspace.tsx` gọi `motion.place`, `motion.binding.set`, lọc FBX cùng fingerprint | Có placement/binding; chưa mở editor Animation Creation |
| `editor/packages/shared/src/index.ts`: `Motion.edit`, `evaluator`, `derivedFrom` | Đã có chỗ lưu native edit; chưa chứng minh đường thực thi |
| `editor/apps/studio/src/unifiedProjectStore.ts`: allowlist/handler thiếu `motion.edit` | API thiết kế chưa phải API hoạt động |
| `unifiedSkeletonEvaluation.ts`: nạp `motion.assetId`, lấy `group.animations[clipIndex]` | CPU/export chưa đọc native edit, chỉ sửa UI sẽ không đủ |
| Source 1.31.8: `app.js` dùng DOM/global state, `core.js` có `newProject/evaluate/addKey/validateProject` | Tái dùng engine và UI nguồn; cần lớp nối lifecycle, persistence và playback |

Đường dẫn `editor/...` trong tài liệu này tính từ `three-workspace-app/`. Nguồn Animation chỉ đọc, khóa theo [SOURCES](../SOURCES.yaml) và [lineage evidence](../evidence/animation-lineage.yaml):

```text
C:/Users/Administrator/Documents/Codex/2026-10-09/animation-studio/sites/animation-studio-mdx-alpha-1318/work/material_alpha_v1_31_8/src
```

Nguồn có metadata package khác nhãn artifact; giữ ghi chú hiện hành. Không tự lấy bản khác hoặc sửa baseline để dễ tích hợp.

## 2. Hướng code đề xuất

**Giữ editor native trong một iframe cùng origin, build từ bản sao module đã khóa, với cầu nối host nhỏ và có kiểu dữ liệu.** Iframe là ranh giới DOM/CSS/Three.js, không phải một ứng dụng có project riêng. Animation dùng Three r186, Topview dùng r184; không truyền Object3D/AnimationClip giữa hai runtime. Không nhúng nguyên HTML rồi gọi đó là hoàn tất tích hợp.

Lý do: app nguồn dùng nhiều ID DOM/global state. Viết lại UI sang React và thống nhất Three ngay sẽ mở rộng phạm vi. Cô lập editor cho phép giữ control rig, timeline và graph sẵn có. Chỉ thay các điểm mở project, save, điều khiển hoạt động và giải phóng tài nguyên trong **bản sao tích hợp**.

```text
Project chung → chọn Character/Motion → editor Animation 1.31.8
                                          ↓ native project JSON
                                broker motion.edit + validator
                                          ↓
                         native edit bất biến + motion derivative
                                          ↓
                    Scene playback / CPU sampling / Film export
```

Chọn **GLB chứa skeleton + animation** làm derivative P0, tái dùng bake/GLTF export của nguồn. Model/skin/material vẫn lấy asset nhân vật gốc. GLB là dữ liệu phát trung gian, native JSON mới là dữ liệu để mở lại và tiếp tục chỉnh sửa. Không yêu cầu FBX→Blender→FBX cho riêng việc chỉnh animation. Native FBX animation exporter không được coi là exporter model có mesh/skin.

AC-00 phải chứng minh đường GLB qua loader hiện có và pose parity trước khi triển khai rộng. Nếu thất bại, báo đúng điểm hỏng và đề xuất adapter track nhỏ; không tự đổi sang viết lại solver/format hoặc hạ tiêu chí.

## 3. Luồng sử dụng và giao diện

1. Trong tab Animation, chọn nhân vật của scene. Có hai lệnh rõ ràng: **Tạo animation** và **Chỉnh animation** của clip đang chọn. Giữ **Đặt animation vào scene / Sửa thời gian clip** cho placement/binding hiện có.
2. Tạo mới dùng rig của Character và `core.newProject`; không bắt nhập một FBX animation giả để có MotionID. Nhập tên/thời lượng/FPS; lấy FPS scene làm mặc định. Edit FBX dùng đường nhập clip hiện có của nguồn (bao gồm `labBaseFromClip`); mở motion native dùng edit blob.
3. Editor native là vùng chính khi chỉnh animation; giữ native pose/control/IK, timeline/key, graph/easing. Scene và camera staging tiếp tục do Topview sở hữu. Có lệnh **Xem trong cảnh** để trở lại bố cục chung; không sửa toolbar/timeline/inspector/CSS nội bộ Topview.
4. Người dùng tạo ít nhất hai bone keys khác nhau, scrub/play, sửa interpolation và thử một control IK trên fixture hỗ trợ.
5. **Lưu animation** commit vào thư viện project; nếu đang sửa một clip thì commit đồng thời chuyển riêng clip đó sang motion mới. Với motion vừa tạo, **Đặt vào scene** dùng `motion.place` hiện có sau khi lưu thành công.
6. Reload, mở lại motion: vẫn có keys/curves/settings để sửa; Scene phát kết quả đã chỉnh. Export đọc cùng revision và derivative đã lưu.

Chỉ một editor native hoạt động. Chuyển tab tạm dừng playback/RAF của vùng ẩn; giữ draft trong phiên. Đóng/đổi nhân vật khi dirty: **Lưu / Bỏ sửa / Ở lại**; lỗi lưu hoặc conflict giữ nguyên draft. Không ghi đè pending key của Topview; đi qua guard điều hướng đang có. Undo trong editor tác động draft khi editor có focus; Undo host tác động transaction đã commit. Host undo khi còn draft phải qua cùng guard. Không nhận hai lần một phím tắt.

Nhãn host dùng locale hiện có. Native panel giữ khả năng nguồn; không mở thêm đợt redesign toàn bộ. Iframe có title, focus vào/ra bằng bàn phím, Esc không chiếm phím của vùng khác; resize ở 1366×768, 1440×900, 1920×1080 không tràn ngang.

## 4. Cầu nối và quyền sở hữu dữ liệu

Package **dự kiến** `editor/packages/animation/` gồm bản sao nguồn/NOTICE và entry adapter. Host component **dự kiến** `AnimationCreationPanel/index.tsx` quản lý iframe/selection/draft. Không sửa source gốc. Giữ phần math có thể gọi không cần DOM để validator/bake dùng lại.

Bridge P0 chỉ cần `ready`, `open`, `setActive`, `serialize`, `dirtyChanged`, `error`, `dispose`, có `protocolVersion`, `requestId`, `sessionId`; payload gồm JSON/bytes và ID ổn định. `open` có CharacterID/MotionID/ClipID tùy chọn, revision mở, asset bytes, native project và ánh xạ rig. Host resolve asset qua route hiện có; không truyền credential hoặc đường dẫn tuyệt đối cho iframe.

Kiểm `event.origin`, `event.source`, session và payload; gửi đúng targetOrigin, từ chối reply của phiên cũ, timeout có thông báo. Iframe giữ draft, host là bên duy nhất gọi mutation. `studio_bridge.js` của nguồn là mailbox `/api/studio/...`, **không phải** host adapter có sẵn: không mở mailbox/server thứ hai trong bản tích hợp. Iframe không là security sandbox cho code không tin cậy; chỉ chạy module local đã khóa.

Native Scene Studio/director có project/actor/camera riêng phải qua adapter shared IDs trước khi được bật mutation. Các lệnh chưa nối ghi rõ chưa hỗ trợ trong app hợp nhất; không để chúng lặng lẽ tạo project thứ hai. Đây không phải xóa tính năng nguồn; full integration của chúng nằm P1/P2.

### Hợp đồng mutation được đề xuất, chưa có trong API thực thi

Mở rộng thiết kế `motion.edit` hiện có, giữ command envelope/revision/idempotence/history:

```ts
args: {
  characterId: ID;
  motionId?: ID;       // thiếu: tạo mới từ rig; có: chỉnh bản sao motion nguồn
  clipId?: ID;         // có: atomically rebind riêng clip này, giữ ClipID
  edit: VersionedNativeAnimationProject;
  mode?: 'clone';      // P0 chỉ clone; shared edit chưa hỗ trợ phải bị từ chối
}
result: { motionId: ID; derivedFrom: ID | null; affectedClipIds: ID[] }
```

- Native project chứa tên/thời lượng/FPS/keys/curves/IK/options/settings/layers và field nguồn có thể roundtrip; dùng validator native. Envelope lưu version bridge/source cùng native project, bone map, asset hash, fingerprint và đơn vị/trục cần cho khôi phục. Không chỉ lưu baked poses; không strip field bằng whitelist tự phát.
- Cần đối chiếu Character/skeleton/source Motion/clip, giới hạn kích thước và số mẫu, số hữu hạn, thời gian hợp lệ, khóa actor, asset references. Unknown version/khác rig không được sửa fingerprint để đi qua validation.
- Tạo native blob và derivative bất biến trước khi cập nhật project. Host dùng evaluator nguồn để validate/bake (không tin derivative client gửi); hash và validation hoàn tất rồi mới commit một revision. Baking dài vượt request budget phải dùng job infrastructure hiện có, giữ atomic commit; không thêm hàng đợi khác.
- `Motion.edit` trỏ native envelope; `sourceClip` trỏ GLB derivative; `evaluator='animation-1.31.8'`; `derivedFrom` là motion gốc hoặc null. `assetId` giữ asset nguồn rig để truy xuất provenance; resolver native **phải** đọc `sourceClip`, không suy ra clip từ `assetId`. Không ghi derivative vào asset nguồn dùng chung rồi thay nội dung của nhân vật khác.
- Với `clipId`: clip phải thuộc Character, đang trỏ `motionId`; đổi motion reference ở native clip và binding trong cùng transaction. Range hiện tại phải còn hợp lệ; nếu motion mới ngắn hơn, trả lỗi yêu cầu chỉnh range, không âm thầm cắt clip. Không có clipId thì chỉ tạo motion trong thư viện.
- Conflict, lỗi validate/bake/storage: không đổi revision, clip hoặc motion cũ; draft còn nguyên. Retry cùng requestId không sinh motion trùng. Undo/Redo phục hồi cả Motion/reference/binding. `scene.apply document.replace` không được ghi snapshot cũ đè mất native motion; stale revision đi qua guard sẵn có.
- Schema project v1 đã có các field cần thiết: ưu tiên không đổi version project. Thêm envelope/command validation, update contract/tests cùng nhau. Không sửa YAML contract hiện hành trong lượt đề xuất này.

## 5. Playback và export dùng chung kết quả

- Thêm resolver theo `Motion.evaluator/sourceClip` trong host; direct FBX vẫn dùng đường hiện hành. `motion.place`, `motion.binding.set`, thư viện UI và validation không được hard-code mọi motion là FBX.
- Cả đường WebGL (host/library/asset URL → builder loader) và CPU (`unifiedSkeletonEvaluation.ts`) phải dùng cùng derivative và clip index hợp lệ. Giữ MotionID làm khóa tham chiếu; không nhầm AssetID. Dùng public HostAdapter/builder exports, không import lén `builder/src` từ host.
- Chuyển native bone IDs sang shared bone names/IDs có kiểm tra một-một và parent/rest; giữ nativeFingerprint riêng shared fingerprint. Đơn vị, basis và actor transform áp đúng một lần. Animation local của nhân vật không được bake cả vị trí actor/camera vào xương.
- FPS editor, thời gian nguồn theo giây, frame scene và Film 20Hz là các đơn vị khác nhau. Dùng mapping trim/speed/reverse/loop hiện có, không viết lại bằng làm tròn frame. Bổ sung mẫu fractional và ranh giới clip.
- Derivative có giới hạn lấy mẫu/interpolation: AC-00 đo sai số tại key và giữa key theo ngưỡng đã khóa trong acceptance. Không tự coi bake 30FPS giữ chính xác mọi IK/easing. Chọn mật độ đạt ngưỡng, ghi vào provenance; nếu không đạt thì chặn capability đó hoặc sửa sampler trước khi công bố hỗ trợ.
- P0 xác minh root skeletal và in-place. Native trajectory phải được chứng minh hoặc báo unsupported rõ; không làm hỏng direct FBX trajectory đang có. Không để export âm thầm dùng nguồn cũ khi thiếu edit/derivative.
- Film job lấy snapshot revision đã commit, cùng sampler và root policy; giữ pipeline model/camera/manifest/native codec hiện có. Native JSON vẫn lưu trong project để sửa tiếp dù Film chỉ chứa sampled transforms.

## 6. Ranh giới MVP và nghiệm thu

**P0:** native editor; chọn Character; tạo mới và sửa motion nhập; FK keys; control IK cơ bản; graph/easing; persistence; clone isolation; playback/CPU/export; lỗi và draft guard. **P1:** thêm fixture rig/profile, skin/texture roundtrip rộng hơn, native director/scene tools nối shared IDs. **P2:** full parity layers/motion lab/smoothing/contacts/templates/dual editor và toàn bộ format/rig. Giữ modules và native data từ đầu; không tuyên bố những mục P1/P2 đã chạy trong host.

Fixture nghiệm thu: model skinned Mixamo65 cùng một animation nguồn đã chạy ở app/native, hai Character dùng chung asset, scene 3 giây/30FPS, một camera; motion tạo mới dài 3 giây. Khóa bytes/hash và khả năng IK ở AC-00. Fixture này cô lập Animation; retarget thật vẫn là gate riêng của toàn MVP, không được thay bằng same-rig import.

| Gate | PASS phải có | FAIL điển hình |
| --- | --- | --- |
| N1 — Mở native | Character thật mở trong editor 1.31.8, đổi tab/draft/focus đúng | Chỉ iframe với project độc lập hoặc chỉ Topview |
| N2 — Tạo/sửa | Motion mới + edit motion nhập, bone keys, một IK control, graph/easing đổi pose thật | Chỉ actor transform, binding hoặc clip source |
| N3 — Lưu/mở | Native JSON giữ khả năng sửa; clone isolation; history; conflict không mất draft | Chỉ download file hoặc chỉ giữ pose bake |
| N4 — Scene | WebGL và CPU dùng edited motion; clip timing/root/basis đúng | Native preview đúng nhưng Scene phát nguồn cũ |
| N5 — Export | Package từ revision đã lưu, mẫu xương khác nguồn đúng như chỉnh sửa | ZIP có file nhưng bỏ native edit |

Mẫu so sánh: frame scene 0/15/30/45/60/89, fractional 15.5/44.25 và điểm loop/trim; timestamp export theo grid20Hz. Đối chiếu native evaluator và adapter theo [acceptance](../acceptance.yaml), [fixtures](../fixtures/manifest.yaml); ghi cụ thể ngưỡng adapter/format dùng trước chạy, không tự nới khi fail. Runtime cần ảnh/video thao tác và hash project/output, không dùng mock hoặc build để thay WebGL.

**ANIMATION_CREATION_RUNTIME_READY = N1–N4 PASS. ANIMATION_EXPORT_READY = thêm N5 PASS.** APP_RUNTIME_READY còn đòi các gate Retarget/Scene/export của MVP gốc. Game import/playback/sửa key/save-reopen vẫn là nghiệm thu riêng do người dùng kiểm. Không tạo một tỷ lệ toàn dự án từ năm gate này.

## 7. Rủi ro và thứ tự quyết định

Rủi ro cao nhất là chuyển native pose sang shared playback/export sai bone/rest/basis/root hoặc bỏ curve/IK khi bake. Vì vậy AC-00 kiểm một bone key và một IK pose xuyên native→GLB→CPU trước. Sau đó mới làm lifecycle/persistence và hoàn thiện UI.

Không viết lại solver, Topview, thư viện UI hay MCP debug framework. Dùng CLI/broker/DevTools hiện có để đọc IDs, revision, edit hash, derivative hash và sample lỗi. Chưa có cơ sở chốt số giờ hoàn tất: sau AC-00/AC-01, agent phải đưa ước lượng dựa trên seam thực tế, test thất bại và phần chờ người dùng; không hứa ngày từ độ phủ code.
