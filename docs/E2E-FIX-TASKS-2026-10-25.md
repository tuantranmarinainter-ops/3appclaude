# Sửa lỗi để chạy trọn App 1 → App 5 (2026-10-25)

Claude chạy thử trọn quy trình trên `main` `95a9207` (sau #117) bằng **bản sao** kho thật (`S:\Claude\w01-samples\lib-e2e`,
project thử `c8b30ad5-0419-44b0-a0d6-d8c25e089770` trong `S:\Claude\w01-samples\e2e-projects`), nguồn `mvp-src\Xbot.glb`,
nhân vật Hero, Gỗ Xưa, Đen. Kết quả:

| Bước | Kết quả |
| --- | --- |
| F1 App 1: chuyển 7 animation Xbot → Hero, Gỗ Xưa, Đen | ĐẠT (21 Nháp, PASS) — lỗi nhỏ E5, E6 |
| F5 Thư viện: xem Nháp từng nhân vật | ĐẠT — lỗi E7 (404 nhân vật Minecraft20) |
| F2 App 2: tạo project, thêm 3 nhân vật, gán clip | Hero, Gỗ Xưa ĐẠT; **Đen FAIL (E1)**; lỗi nhỏ E8, E9 |
| F3 App 3: mở shot 0–27, sửa 1 khung, lưu, trả về cảnh | ĐẠT (revision 7→8, Motion mới, Action gốc giữ) — lỗi nhỏ E10 |
| F4 VFX: thêm cue `aura01` vào cảnh | ĐẠT (1 cue) — lỗi nhỏ E11 |
| F2 xuất film BBS FS 2.7 (Hero + Gỗ Xưa, 0–27) | **FAIL (E2)** |
| Thanh 5 workspace | **3/5 nút mờ (E3, E4)** |

Ưu tiên: **E1, E2, E3/E4** (chặn quy trình) → E5–E11.

## Việc chặn quy trình

### E1 — App 2: gán clip thư viện cho nhân vật thứ hai cùng rig báo `PROFILE_MISMATCH`
- **Tái hiện:** App 1 chuyển cùng một nguồn cho Hero và Đen (cùng minecraft20) trong một lượt → hai Action "walk" khác uuid nhưng
  `anim.bobj`/`anim.glb` **trùng từng byte**. App 2 "Lấy từ kho…": gán walk của Hero cho Hero (đạt) rồi walk của Đen cho Đen →
  `POST /api/unified/commands` 422 `PROFILE_MISMATCH` "Imported Action is not compatible with the selected Character".
- **Nguyên nhân:** `apps/studio/src/unifiedProjectStore.ts` ~2370–2386: import khử trùng theo `(assetId, skeletonId, clipIndex)`,
  rơi vào nhánh `duplicate` → không tạo Motion có id = uuid của Đen; sau đó khối `if (libraryPlacement)` (~2436) tìm
  `next.motions[libraryPlacement.motionId]` = undefined → ném `PROFILE_MISMATCH` (sai thông báo, không phải lệch rig).
- **Yêu cầu:** nhân vật nào cũng gán được Action của chính nó dù byte trùng nhân vật khác. Ưu tiên: tạo Motion riêng mang uuid của
  Action (dùng chung asset được), giữ provenance `ownerCharId`; nếu chọn dùng lại Motion trùng thì `libraryPlacement.motionId` phải trỏ
  sang Motion đó. Thông báo lỗi tiếng Việt và đúng nguyên nhân.
- **Đạt khi:** test store: hai nhân vật cùng rig, hai Action trùng byte → cả hai `library.place` thành công, mỗi nhân vật có clip riêng;
  chạy lại kịch bản trên bản sao: Hero, Gỗ Xưa, Đen đều có clip.

### E2 — Xuất film BBS bị chặn `CHARACTER_TRANSFORM_UNAVAILABLE` với nhân vật thư viện
- **Tái hiện:** project trên, Xuất ▾ → Gói BBS FS → Film hiện tại, Chỉ nhân vật, Hero + Gỗ Xưa, frame 0–27 → "Lỗi: Không thể đo biến đổi
  thực của Hero/Gỗ Xưa; chưa thể xác nhận tỉ lệ/shear" (`apps/studio/src/filmPreflight.ts:153`, vì `args.footSamples[characterId]`
  rỗng). Kèm cảnh báo "Không đủ dữ liệu skeleton đo chân".
- **Chẩn đoán (Claude + subagent, cần xác nhận khi sửa):** `footSamples` do server tạo trong `collectFilmPreflightEvidence`
  (`apps/studio/src/unifiedProjectStore.ts:318-381`). Lấy mẫu chỉ chạy khi `canSample` (dòng ~355) — cần `durationTicks` hợp lệ
  (`unifiedFilmSampling.ts:141-144`: `(end-start+1)/fps*20` phải nguyên; 0–27 ở 30 fps = 18,67 tick → không hợp lệ) và
  `editorial.sequences` có 1–3 shot camera (`unifiedFilmSampling.ts:147-150`; project mới có `sequence_1` với `clips: []`). Lỗi trong
  `try` bị `catch {}` nuốt (dòng ~377). Nhân vật thư viện tự nó lấy mẫu được (`sampleProjectSkeletonRange` trả mẫu cho Hero và Gỗ Xưa).
  Kết quả: người dùng thấy lỗi "không đo được biến đổi" gây hiểu nhầm, không thấy nguyên nhân thật.
- **Yêu cầu:**
  1. Preflight báo **nguyên nhân thật** bằng tiếng Việt (khoảng frame không khớp lưới 20 tick, chuỗi camera chưa có shot, vượt 255 tick…);
     khi điều kiện lấy mẫu chưa thoả thì không thêm `CHARACTER_TRANSFORM_UNAVAILABLE`. Không nuốt lỗi lấy mẫu im lặng.
  2. Panel Xuất tự làm tròn khoảng frame về lưới hợp lệ (vd 0–27 → 0–29 ở 30 fps) và báo cho người dùng.
  3. Project mới / chuỗi camera rỗng: tự tạo một shot camera (Main Camera, phủ khoảng xuất) hoặc nút "Tạo shot camera cho khoảng này"
     ngay trong panel Xuất, để người dùng không phải biết chỗ dựng chuỗi camera.
- **Đạt khi:** trên project mới chỉ có 3 nhân vật thư viện + clip + cue `aura01`, xuất được ZIP film Hero + Gỗ Xưa + Đen không cần thao tác
  ngoài panel Xuất; `nativeReadback` đọc lại đủ actor; test preflight cho ca khoảng lệch lưới và chuỗi camera rỗng.

### E3 — Thanh 5 workspace: App 1 không dẫn sang App 2/Thư viện khi chưa đặt biến môi trường
- `packages/retarget/workbench/server.ts` `/api/workspace-navigation` trả `null` khi thiếu `W01_STUDIO_URL`,
  `W01_ANIMATION_STUDIO_URL`, `W01_VFX_URL` → nút Dựng cảnh / Animation / VFX / Thư viện mờ.
- **Yêu cầu:** mặc định hợp lý khi thiếu biến: Studio `http://127.0.0.1:3016` (cổng người dùng dùng thật), Animation = Studio +
  `?workspace=animation`, VFX = Studio (mở bảng Hiệu ứng) — vẫn cho ghi đè bằng biến môi trường. Cập nhật
  `docs/claude-memory/launch.json.example` (cấu hình `app1-workbench` đặt `W01_STUDIO_URL`).

### E4 — Thanh 5 workspace trong Studio: Chuẩn hoá / Animation / VFX mờ ngoài project
- `apps/studio/app/layout.tsx` + `WorkspaceNavigation.tsx`: thiếu `NEXT_PUBLIC_RETARGET_WORKBENCH_URL`, `NEXT_PUBLIC_ANIMATION_STUDIO_URL`,
  `NEXT_PUBLIC_VFX_URL` → mờ.
- **Yêu cầu:** Chuẩn hoá mặc định `http://127.0.0.1:3101` (Workbench); Animation và VFX ngoài project dẫn tới danh sách project kèm
  gợi ý "Mở một project để dùng Animation/VFX"; trong project giữ chuyển nội bộ như hiện tại.
- **Kèm:** trong project, tab "1 Chuẩn hoá" đang mở công cụ V9.12 cũ của Studio, dễ nhầm với App 1 Workbench → thêm nút/nhãn rõ
  "Mở App 1 Workbench" (link 3101, giữ `?unified=`), hoặc đổi tên tab cũ thành "Chuẩn hoá nhanh (V9.12)".

## Lỗi nhỏ (vẫn đi tiếp được)

| Mã | App | Lỗi | Vị trí | Yêu cầu |
| --- | --- | --- | --- | --- |
| E5 | 1 | Bảng "Animation của lô" hiện chữ **"null"** sau tên mỗi animation (từ C16) | `packages/retarget/workbench/public/app.js:592` `nameCell.append(..., adjustmentDot(key))` — `append(null)` ghi chữ "null" | Không append khi `adjustmentDot` trả `null`; rà mọi chỗ gọi `adjustmentDot` |
| E6 | 1 | Ô "Thẻ động tác" khi Chuyển rơi về **idle** → run/walk cũng gắn idle | `app.js:1317` (khi nhân vật không có `requiredActions`) | Thêm lựa chọn mặc định "— (không gắn thẻ / theo tên)" và đoán thẻ theo tên từng animation (`suggestActionKey`) thay vì gán một thẻ cho cả lô |
| E7 | 5 | Xem chi tiết nhân vật Minecraft20 (Hero, Đen…) báo `404 Character not found` | `apps/studio/app/api/library/character/[id]/route.ts` chỉ nhận `model === 'model.glb'` | Phục vụ được nhân vật `.bobj` (chuyển sang GLB khi đọc, hoặc trả skin + bobj cho viewer), xem 3D trong Thư viện |
| E8 | 2 | Hộp "Lấy từ kho…": ô "Nhân vật nhận" hiển thị Hero nhưng danh sách là của nhân vật khác | `apps/studio/app/workbench/components/AnimationWorkspace.tsx:44, 145, 275` (`pickerCharacterId` khởi tạo `''`) | Khởi tạo bằng nhân vật đang chọn trong cảnh (hoặc phần tử đầu) và nạp đúng danh sách ngay khi mở |
| E9 | 2 | Bấm "Thêm animation" ở tab Dựng cảnh tự nhảy sang tab 3 Animation; bảng "Phím tắt" hiện lại mỗi lần vào cảnh | Studio | Giữ tab Dựng cảnh; bảng phím tắt nhớ đã đóng (localStorage) |
| E10 | 3 | "Mở shot từ cảnh" mặc định frame 0–300 → báo (tiếng Anh) "requires one MotionClip covering frames 0–300" khi clip chỉ 0–27 | `AnimationWorkspace` (ô Từ/Đến frame) | Mặc định khoảng = clip của nhân vật đang chọn; thông báo tiếng Việt nêu nhân vật + khoảng clip hiện có |
| E11 | 4 | Bảng Hiệu ứng: ô "Cảnh biên tập" trống ("Không có cảnh trong bộ lọc này"); ô tên hiệu ứng chỉ là placeholder `aura01`, phải gõ tay | `apps/studio/app/workbench/components/vfx-cues/` | Danh sách chọn hiệu ứng từ kho App 4 (`/api/unified/vfx-previews`), có ảnh sprite; "Cảnh biên tập" có ít nhất cảnh mặc định |

## Quy tắc chung
- Đọc `docs/DECISIONS.md`, `docs/RETARGET-LESSONS.md`, `CLAUDE.md` trước khi làm. Giao diện mặc định tiếng Việt.
- Giữ SHA GLB Samba mặc định `68fcdb75d373…` (Samba → `a3d_char_30ec…`). Không regenerate golden, không commit binary, không đổi kiểu xuống dòng.
- Test trên **bản sao** kho (`S:\Claude\w01-samples\lib-<việc>`); không ghi vào `S:\Claude\w01-library`.
- Mỗi việc (hoặc nhóm nhỏ cùng file) một nhánh `ai1/e<n>-…`, một PR đích `main`; build, `pnpm typecheck` toàn workspace, test trên Windows.
  **Không tự merge.** Xong báo mã việc + số PR.
