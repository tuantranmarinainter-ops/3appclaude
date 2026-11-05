# Tập 15 · Shot 03: xuất film BBS, sửa cú nảy biến dạng, âm thanh + lồng tiếng: đặc tả 2026-11-05

> Người dùng chốt 2026-11-05, **cần gấp**. Thứ tự ưu tiên: **A → B → C**. Mục ghi **[Claude chốt]** đổi được.
> Đọc trước: `CLAUDE.md`, `docs/DECISIONS.md`, skill `.claude/skills/w01-shot-edit/` (SKILL.md + `references/traps.md`,
> mục "Xuất film BBS"), PR #231 (prop có khoá trong film: gậy cầu vồng).

## 0. Dữ liệu và trạng thái hiện tại (đã kiểm)
- Project thật: `S:\Claude\w01-samples\tap15v3\projects\5673640e-bfd9-4a96-8d22-0e8a648ee130` (Tập 15 · Shot 03), **rev 312**.
  App 2 của người dùng chạy ở cổng 3016 (`S:\Claude\w01-app`, main `c800e05`, **chưa có** #231). Người dùng có thể đang mở project:
  trước mỗi lần ghi, đọc revision mới nhất; **không** dùng `history.undo` nếu revision đã đổi do người dùng.
- Nhịp shot (30 fps, 0–225, editorial 0–224): Đen gục ~30; sáng 32; vòm 36–225 (1 cue); Hero hiện 40, rơi chậm, đáp 72
  (hiệu ứng `landing_grass_dirt_heavy` 72–200 + vòng sóng); gậy hiện 76, lơ lửng, lao vào tay Hero 122–127 → nổ 127;
  Gỗ Xưa: ReadyGlv 0–75 | StandWound 76–89 | BackFlipStart 90–115 | BackFlipLoop 116–171 | BackFlipLoop 172–225 (nối khít,
  không trộn); cú nảy trục Y của Gỗ Xưa **đã tạm bỏ** (rev 308) theo lệnh người dùng.
- Code film có gậy: nhánh `claude/film-prop-anim` (PR #231, chưa merge): prop có khoá xuất từng tick + kênh `visible` +
  kênh `texture` (`frames/<n>.png`), commit `12e50d5` sửa gậy quay ngược (BOBJ xoay 180° quanh Y so với glTF).
- Hiệu ứng mắt sáng của Đen (2 cue `eye_glow_skyblue` gắn xương đầu) **không xuất được** (effects.json chỉ 1 vị trí/cue):
  lần xuất trước tạm gỡ rồi hoàn tác (`scripts/film/eyes-off.mjs off|on`).
- Script có sẵn: `.claude/skills/w01-shot-edit/scripts/film/` (`export-install.mjs` preflight + `film.export` + plan cài,
  `install-job.mjs`, `uninstall.mjs`, `eyes-off.mjs`), giải mã `.dat`: `references/traps.md` (BbsCodec).

## A. Xuất film + cài vào game (ưu tiên 1)
1. Chạy server tạm từ worktree nhánh `claude/film-prop-anim` (đã `pnpm install`, build builder), cổng 3140–3149,
   `BBS_UNIFIED_PROJECTS_DIR=S:/Claude/w01-samples/tap15v3/projects`, `W01_LIBRARY=S:/Claude/w01-library` (chỉ đọc),
   `W01_AAA_ASSETS=S:/Claude/w01-samples/tong-duyet/config-bbs-assets/effeks/samples`, `W01_VFX_PREVIEWS=S:/Claude/w01-samples/vfx-previews`,
   `BBS_JAVA_HOME=C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot`.
2. Tham số xuất (giữ nguyên): `content:'both'`, `propIds:['user_prop_6awe79i6']`, `characterIds` = cả 3, `sequenceId:'sequence_1'`,
   `range:{0,224}`, `viewportAspect:16/9`, `filmName:'Tap15-shot03-gay'`, `effectsPolicy` include (bbs-fs-2.7, AAA đã xác nhận,
   gameDir `S:/Minecraft/Minecraft Forge-1.20.1`), `worldAnchor:{mode:'local-origin', pivot:[-0.6,0,1.2], destination:[107.08,-60,207.13],
   yawDegrees:-64.47, dimension:'minecraft:overworld'}`. Đường dẫn game trong code dùng dấu `/` (heredoc Bash nuốt `\`).
3. Mắt sáng: [Claude chốt] tạm gỡ 2 cue → xuất → hoàn tác 2 bước, chỉ khi revision không bị người dùng đổi giữa chừng
   (nếu đổi: thêm lại 2 cue bằng `vfx.cue.add` với đúng tham số cũ thay vì undo).
4. Cài: **chỉ khi `Get-Process java,javaw` rỗng**. Gỡ install cũ `91052ba1-f700-45fa-9bb7-90be54641212` rồi cài job mới.
   BBS đã lưu lại `.dat` cũ nên bộ gỡ giữ nó: sao lưu `.dat` cũ vào `S:\Claude\w01-samples\game-backups\films-<ngày>\` rồi chép
   `.dat` mới từ ZIP đè lên; so sha256.
5. Lưu ZIP vào `S:\Claude\w01-samples\tap15v3\film-zips\`.

**Đo (bắt buộc, giải mã `.dat`)**: có 4 actor model + VFX; replay "Gậy cầu vồng": `visible` 0→1 ở tick 51, `texture` 151 khoá,
`pose.bones.root` 151 khoá; **hướng gậy**: dựng lại hướng trục dài của gậy từ film (actor yaw + root pose, BOBJ = Ry(180)·glTF)
và so với App 2 (`filmSceneWorldMatrices`) ở tick 90, 100, 120: lệch ≤ 10°. Hero y: 40 m tới tick 26, đáp tick 48.
Báo người dùng tên film + world để xem.

## B. Cú nảy không biến dạng + hết giật 115→116 (ưu tiên 2)
**B1 Cú nảy.** Người dùng muốn **giữ** cú nảy (độ chân thật khi bị xung lực đẩy ra). Đo được trong film cũ: khoá vị trí Y của
node Gỗ Xưa (0→0,5 m) bị **tính hai lần**: actor y +0,42 m **và** `pose.bones.COG` t.y +0,58 m (StandWound gốc chỉ dịch COG
~0,1 m) → thân lệch khỏi chân, trông co rúm trong game; X không bị (chỉ actor). Gỗ Xưa là rig gốc Verity (`profile.originalRig`,
`projectOriginalVerityPoseTracks` trong `filmManifest.ts`). Tìm chỗ khoá vị trí node lọt vào tư thế xương (nghi: ma trận actor/
placement của bộ lấy mẫu không cộng fcurve Y trong khi xương có, hoặc ngược lại) và sửa tận gốc cho mọi nhân vật.
- Test: nhân vật có fcurve `transform.position[1]` → film actor y có độ nảy, COG pose giống hệt khi không có fcurve (≤ 1 cm).
- Sau khi sửa: khôi phục cú nảy theo nhịp của người dùng: `fc_s3_go_y` khoá `[79,0,linear]`, `[85,0.5,bezier]`, `[93,0,linear]`.
**B2 Giật khung 115→116** (BackFlipStart → BackFlipLoop nối thẳng, tư thế cuối Start ≠ đầu Loop). Vùng trộn hiện bị film ép
`footLock:true` (validator `footLock: z.literal(true)`) làm xoắn chân khi đang bay. Hướng: cho phép `footLock:false` (validator +
App 2 + film bake bỏ khoá chân) rồi đặt trộn 4–6 khung ở 116 không khoá chân; hoặc dời `motion.time` của Loop cho khớp tư thế.
Đo: chênh góc xương lớn nhất giữa khung 115 và 116 trong App 2 và trong film < 15° (hiện ~60°).

## C. Âm thanh + lồng tiếng (ưu tiên 3)
**C1 Hiệu ứng âm thanh**, mỗi âm **một file WAV riêng** (48 kHz, mono/stereo), đặt vào `S:\Claude\w01-samples\tap15v3\audio\shot03\`:
| File | Khung bắt đầu | Mô tả |
| --- | --- | --- |
| `01-sam-set.wav` | 30 | sấm sét khi Đen gục, trước luồng sáng |
| `02-luong-sang.wav` | 32 | luồng sáng chiếu từ trên cao (ngân, tăng dần ~1,5 s) |
| `03-vom-bao-ve.wav` | 36 | vòm bảo vệ bật lên quanh Đen + tiếng ù nhẹ có thể lặp |
| `04-nen-dat-block-vo.wav` | 72 | Hero nện xuống đất: va mạnh + block cỏ/đất vỡ vụn văng ra |
| `05-gay-lao-no.wav` | 122 | gậy lao vào tay + nổ xung kích ở 127 |
| `06-go-xua-trung-xung-kich.wav` | 127 | tiếng kêu/rên của Gỗ Xưa khi trúng xung kích |
| `07-lon-nhao-vut.wav` | 90 | tiếng vút khi Gỗ Xưa lộn nhào (có thể lặp nhẹ ở 116) |
**Bản quyền (bắt buộc, để đăng YouTube)**: chỉ dùng (1) âm **tự tổng hợp bằng code** (numpy/scipy, ghi script tạo vào repo), hoặc
(2) nguồn **CC0** có link trang tải và tên tác giả. Không dùng CC-BY-NC, không dùng âm thanh game Minecraft. Ghi `CREDITS.md` trong
thư mục: mỗi file → nguồn, giấy phép, link, cách tạo. [Claude chốt] Ưu tiên tự tổng hợp.

**C2 Lồng tiếng** theo kịch bản (tiếng Việt). Thoại người dùng giao: *(Herobrine/Hero xuất hiện từ trên cao)* **Hero: "Một đống hỗn độn
này… lại phải chính tay mình dọn sao."** Các thoại khác [Claude chốt, người dùng cho tự đặt cho gay cấn; builder được chỉnh nhịp]:
| Khung | Nhân vật | Thoại | Ghi chú |
| --- | --- | --- | --- |
| ~18 | Gỗ Xưa | "Hết rồi… nhóc con." | cười khẩy khi Đen gục |
| ~34 | Gỗ Xưa | "Cái… ánh sáng gì thế này?!" | ngước nhìn lên |
| ~46 | Hero | "Một đống hỗn độn này… lại phải chính tay mình dọn sao." | trầm, vọng từ trên cao, chậm |
| ~100 | Gỗ Xưa | "Ngươi… là ai?!" | lùi lại |
| ~128 | Gỗ Xưa | (rên khi trúng xung kích, dùng file 06) | |
| ~150 | Hero | "Đứng yên đó, Đen. Phần còn lại để ta." | sau vụ nổ, giọng chắc |
Mỗi câu một file `voice-<khung>-<nhân vật>.wav`. Giọng: TTS chỉ dùng khi giấy phép **cho phép thương mại/YouTube** (ghi rõ dịch vụ,
điều khoản, link vào `CREDITS.md`); nếu không chắc chắn → xuất bản nháp + ghi "giọng tạm, cần thu âm thật" và báo người dùng.
**C3** Gắn tất cả vào Shot 03 bằng `audio.cue.add` (`kind` sfx|voice, `speaker`, `text`, `gainDb`), nhập file bằng upload + `asset.import`;
kiểm nghe trong App 2; film xuất kèm âm (`filmAudioPackage`) như Shot 01.

## Chia đợt / PR
| Đợt | Nội dung | Xong khi |
| --- | --- | --- |
| A | Xuất + cài film (dùng code #231) | `.dat` đo đạt mục A, người dùng có tên film |
| B | B1 + B2 (nhánh từ `claude/film-prop-anim`) | test mới + đo B, xuất lại film thử trên **bản sao** project |
| C | Âm thanh + lồng tiếng | 7 SFX + 6 thoại + CREDITS.md, cue trong project, film có âm |
Mỗi đợt code một nhánh/PR xếp chồng, không tự merge. Ghi project thật chỉ qua lệnh App 2 (có hoàn tác), sao lưu `project.json` trước.

## Ràng buộc
Không sửa `packages/retarget` (trừ test), không đổi golden, không commit binary (WAV, film, ZIP), không ghi thư viện thật.
Cài game chỉ khi game tắt. UI tiếng Việt. `pnpm typecheck` toàn workspace trước push. Báo cáo tiếng Việt, có số đo.
