# Task AAA VFX (add-on AAA Particles cho BBS FS 2.7) — giao Codex (2026-10-26)

> Người dùng chốt 2026-10-26: giao ngay phần việc liên quan add-on AAA VFX cho Codex. Gom từ backlog **B16, B18**
> (`docs/BACKLOG-2026-10-25.md`), quyết định "Đường AAA Particles" (`docs/DECISIONS.md`) và kế hoạch App 4
> (`docs/VFX-APP4-PLAN.md`). Mã task **V1–V5**. Subagent của Codex dùng model **"sol 6.1" bản nhẹ**.

## Vai trò người dùng (đọc trước)
Một người làm phim hoạt hình Minecraft (BBS FS) một mình, hay điều khiển từ điện thoại. Họ dựng cảnh ở App 2, thêm
hiệu ứng (App 4), bấm **Xuất film → Cài vào game** rồi mở Minecraft xem. Họ cần: hiệu ứng **hiện trong game đúng như
trong app**; nếu game thiếu mod thì **app nói trước bằng tiếng Việt**, không bao giờ để game sập.

## Hiện trạng (đã kiểm trên máy người dùng)
- Instance: `S:\Minecraft\Minecraft Forge-1.20.1` = **Forge 47.4.10 + Sinytra Connector 1.0.0-beta.46**; BBS FS
  `bbs-2.7-1.20.1.jar` (bản Fabric) chạy qua Connector cùng `fabric-api-0.92.6+1.11.14+1.20.1.jar`.
- Đã thử thêm `aaa-particles-fabric-1.20.1-2.2.3.jar`, `architectury-fabric-9.2.14.jar`, `bbs-aaaddon-2.0-1.20.1.jar`,
  `forgeconfigapiport-fabric-8.0.0.jar` → **game không khởi động**: `forgeconfigapiport-fabric` trùng package
  `net.minecraftforge.fml.config` với fmlcore của Forge; tắt jar đó vẫn sập vì `aaa-particles-fabric` **gói kèm**
  forgeconfigapiport trong `META-INF/jars`. Hiện cả 4 jar để đuôi `.off` (B18).
- Game sập khi bấm vào replay hiệu ứng mà **không có addon AAA**: `NullPointerException … FormUtilsClient.getRenderer(Form)
  is null` tại `RenderFrame.collect` ← `OrbitFilmCameraController.getOrbitTarget` ← `UIReplaysEditor.setReplay` (B16).
- Phía app (đã merge PR #153, A13): xuất film mặc định **Không kèm hiệu ứng** (`effectsPolicy: omit`); muốn kèm phải xác
  nhận `target { runtime: 'bbs-fs-2.7', aaaRendererAvailable: true, compatibleAddonConfirmed: true }`
  (`apps/studio/src/filmEffectsPolicy.ts`). Khi kèm, cue VFX thành replay AAA trong film (`filmAaaEffects`,
  `apps/studio/src/unifiedJobs.ts`), hiệu ứng đọc từ `config/bbs/assets/<W01_AAA_EFFECT_ROOT>` (mặc định `effeks/samples`);
  gói có `required-mods.json`. Cài vào game: `apps/studio/src/bbsInstall.ts` (plan/apply/uninstall).
- Addon: fork https://github.com/tuantranmarinainter-ops/BBS-AAAddon nhánh `fs-2.7` (port addon CC0 của Diobedevn sang
  API BBS FS 2.7, đã sửa sập khi thoát world); test tự động Minecraft dev ở nhánh `fs-2.7-autotest` (Fabric). **Chưa
  từng chạy trên Forge + Connector.**

## V1 — AAA chạy được trên instance Forge + Connector của người dùng (B18) — ưu tiên 1
Mục tiêu: một bộ jar thả vào `mods/` của instance trên mà game khởi động, vào world, phát được film có hiệu ứng AAA.
1. Khảo sát và ghi vào báo cáo (có link nguồn, license): AAA Particles có bản **Forge 1.20.1** không; nếu có, addon
   (`bbs-aaaddon`) gọi API của bản Forge đó được không khi BBS là mod Fabric chạy qua Connector.
2. Nếu không có bản Forge dùng được: dựng jar AAA Fabric **không gói kèm forgeconfigapiport** (bỏ entry `META-INF/jars`
   và khai báo `jars`/`depends` tương ứng trong `fabric.mod.json`), để Connector dùng config API sẵn có của Forge.
   Chỉ làm khi license AAA cho phép phân phối bản sửa; nếu không, làm **script vá cục bộ** (người dùng tự chạy trên jar
   họ đã tải, không commit jar) — script để trong repo chính `three-workspace-app/tools/aaa/`.
3. Kiểm `architectury-fabric` qua Connector (hay cần `architectury-forge`), và mọi phụ thuộc khác của AAA/addon.
4. Phương án dự phòng nếu 1–3 không được: hồ sơ **instance Fabric thuần** 1.20.1 (Fabric Loader + Fabric API + BBS FS 2.7
   + AAA + addon) — danh sách jar, phiên bản, SHA-256, link tải chính thức, cách chép world/`config/bbs` sang.
5. Đầu ra: `docs/AAA-RUNTIME-REPORT.md` (bảng jar → phiên bản → SHA-256 → nguồn → kết quả), script/hồ sơ ở trên,
   và **danh sách bước Claude kiểm trên Windows** (Codex cloud không chạy được game Forge của người dùng).
   Gate trong game = NOT_RUN cho tới khi Claude/người dùng chạy.

## V2 — Không bao giờ để game sập vì thiếu renderer (B16)
1. Addon (fork, nhánh mới từ `fs-2.7`): form AAA luôn có renderer an toàn; nếu hiệu ứng/tài nguyên thiếu thì vẽ không
   gì + log cảnh báo, không ném lỗi. Thêm test tự động vào `fs-2.7-autotest`: replay trỏ tới hiệu ứng không tồn tại,
   chọn replay trong film editor → không sập.
2. Trường hợp **không cài addon** thì không sửa được trong game (lỗi của BBS) → phía app chặn: xem V3.
3. Gửi PR addon lên fork của người dùng (không gửi upstream khi chưa được duyệt).

## V3 — App biết game có AAA hay không trước khi xuất (repo chính, App 2)
1. `bbsInstall.ts`: hàm quét `mods/` của thư mục game (bỏ qua `.off`/`.disabled`), nhận diện BBS FS (phiên bản),
   AAA Particles, addon AAA, Connector/Forge/Fabric; trả `{ bbs, aaa, addon, loader, issues[] }`. API GET mới hoặc mở
   rộng `GET /api/unified/bbs-install?gameDir=…`.
   - Nhận `gameDir` là **thư mục gốc instance**; nếu người dùng đưa nhầm thư mục con (vd `…\config\bbs\data\films` — đang
     lưu như vậy trên máy người dùng và trả 400) thì tự dò lên thư mục có `mods/` và báo đã sửa.
2. Bảng Xuất film: lựa chọn "Kèm hiệu ứng" chỉ bật khi quét thấy AAA + addon tương thích; khi đó tự điền `target`
   (không bắt người dùng tích 2 ô xác nhận nữa); thiếu thì hiện lý do tiếng Việt ("Game chưa có AAA Particles — hiệu ứng
   sẽ không được kèm để tránh game sập"). API vẫn giữ kiểm `effectsPolicy` như hiện tại.
3. Preflight: lỗi chặn nếu film kèm hiệu ứng mà game đích không có addon; cảnh báo nếu quét thấy cấu hình V1 đã biết
   là sập (vd `forgeconfigapiport-fabric` trên Forge).
4. Test: thư mục game giả (mods có/không AAA, jar `.off`, Forge+Connector, Fabric thuần, đường dẫn con) cho quét và preflight.

## V4 — Cài hiệu ứng AAA cùng film (repo chính, App 2 + App 4)
1. Khi film kèm hiệu ứng: gói xuất chứa đủ `.efkefc` + texture/model/material mà các cue dùng, đặt dưới
   `config/bbs/assets/effeks/<namespace>/…` (namespace theo project, không đè `samples`); replay trỏ đúng đường dẫn đó
   (thay mặc định `W01_AAA_EFFECT_ROOT`). Không đổi đuôi `.efk` thành `.efkefc` (xem `VFX-APP4-PLAN.md`).
2. `bbsInstall` plan/apply/uninstall xử lý các file đó như file film (có ghi nhận để gỡ, không đè file người dùng).
3. Test: gói có 2 cue dùng chung 1 texture → texture chỉ chép 1 lần; gỡ cài xoá đúng file đã cài.

## V5 — Kiểm trên game thật (Claude chạy trên Windows, Codex chỉ chuẩn bị)
Codex viết `docs/AAA-INGAME-CHECKLIST.md`: các bước Claude làm trên instance người dùng (luôn sao lưu `mods/` trước, mọi
thay đổi trong game phải hỏi người dùng), film thử 3 hiệu ứng mẫu (laser/ribbon/ring) + 1 replay trỏ hiệu ứng thiếu,
tiêu chí: khởi động được, phát film thấy hiệu ứng đúng vị trí/thời điểm, bấm từng replay trong film editor không sập,
thoát world không sập, FPS ghi số.

## Ranh giới và cách giao
- Repo chính: https://github.com/tuantranmarinainter-ops/3appclaude — mỗi task 1 nhánh/PR (`codex/v3-aaa-detect`, …),
  không merge; Claude "check hub" rồi người dùng nói "merge".
- Addon: https://github.com/tuantranmarinainter-ops/BBS-AAAddon (nhánh gốc `fs-2.7`, test ở `fs-2.7-autotest`).
- Không commit jar Minecraft/AAA/BBS hay binary ngoài `builtin-assets/`. Không sửa mod BBS FS.
- Chạy trước khi đẩy (từ `three-workspace-app/editor`): `pnpm --filter @topview/3d-builder build`, `pnpm typecheck`,
  test Studio liên quan; repo addon: `./gradlew build` + autotest nếu môi trường cho phép.
- Báo cáo bằng số/kết quả thật; gate in-game = NOT_RUN cho tới khi kiểm trên máy người dùng.
