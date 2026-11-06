# Xuất film BBS có tiếng (clip âm thanh camera): đặc tả 2026-11-06

> Người dùng chốt 2026-11-06: "phần 12 hãy giao cho Codex". Mục ghi **[Claude chốt]** là quyết định thay người dùng, đổi được.
> Đọc trước: `CLAUDE.md`, `docs/DECISIONS.md`, `docs/SHOT03-FILM-AUDIO-TASK-2026-11-05.md`, bộ nhớ "Bài học xuất film BBS".

## 1. Vì sao
Tập 15 · Shot 03 có 10 cue âm thanh (thoại CapCut + 6 SFX) trong App 2. Khi xuất **Gói BBS FS**, film `.dat` không có tiếng: ZIP chỉ
kèm `audio/mix.wav` để dựng video. Người dùng mở film trong game thấy im lặng. Ngày 2026-11-06 Claude chèn tay một **clip âm thanh
camera** vào `.dat` (script ngoài repo `S:\Claude\w01\work\shot03-measure\AddAudio.java`) rồi đóng ZIP riêng
`Tap15-shot03-gay-co-tieng.zip`. Mỗi shot đều phải làm lại tay → cần App 2 tự làm khi xuất.

## 2. Hiện trạng (đã kiểm)
- BBS 2.7 (`mods/bbs-2.7-1.20.1.jar`) có `mchorse.bbs_mod.camera.clips.misc.AudioClip` / `AudioClientClip`, đăng ký với khoá `audio`
  (`BBSModClient`) → kiểu clip trong film: `"bbs:audio"`. Trường: `audio` (ValueLink, vd `"assets:audio/w01/Tap15-shot03-mix.wav"`),
  `offset` (int, tick), `volume` (float 0–2, mặc định 1), cộng các trường chung của clip camera (`tick`, `duration`, `layer`, `enabled`,
  `additive`, `envelope`, `title`, `mcp_id`).
- File tiếng trong game nằm ở `config/bbs/assets/audio/…`; các file đang chạy được là **WAV PCM 16-bit, 44,1 kHz, mono**.
- `apps/studio/src/bbsInstall.ts`: mọi mục `assets/…` trong ZIP được chép vào `config/bbs/assets/…` (không lọc đuôi), nên
  `assets/audio/<…>.wav` cài được bằng nút "Cài vào game" sẵn có.
- Xuất film: manifest dựng ở `apps/studio/src/filmManifest.ts` → worker Java `agent/film_worker/src/main/java/local/bbsmerged/FilmExportWorker.java`
  (biên dịch lại mỗi lần xuất) + `DraftEditor.java` (sửa `.dat`: `add_camera_clip`…). Mixdown âm thanh có sẵn:
  `GET /api/unified/projects/<id>/audio-mixdown?start=&end=` (WAV 48 kHz mono).
- Clip chèn tay (đã kiểm bằng giải mã `.dat`):
  `{ type:"bbs:audio", tick:0, duration:150, layer:<lớp camera lớn nhất + 1>, audio:"assets:audio/w01/Tap15-shot03-mix.wav", offset:0, volume:1.0, enabled/additive/envelope chép từ clip camera đầu }`.
- **Chưa xác nhận trong game** rằng BBS phát tiếng từ clip này (người dùng chưa báo lại). Đợt 1 phải có bước người dùng nghe thử.

## 3. Người dùng đã chốt
| # | Câu | Chốt |
| --- | --- | --- |
| 1 | Ai làm | Codex (đặc tả + lệnh), Claude kiểm |
| 2 | Tiếng nào vào film | Toàn bộ cue âm thanh của shot (thoại + SFX), đúng khung như App 2 **[Claude chốt]**: một file mix cho cả film |
| 3 | Xuất ZIP / cài game | chỉ khi người dùng ra lệnh (quy tắc chung) |

## 4. Mục tiêu / không làm / coi là hỏng
**Mục tiêu**
- G1: "Gói BBS FS" của một shot có cue âm thanh tự kèm `assets/audio/w01/<filmName>-mix.wav` (44,1 kHz mono s16) và film có **một clip
  `bbs:audio`** từ tick 0, dài bằng film, offset 0, volume 1, ở lớp camera trống.
- G2: Xuất tập (`episode.export`, nhiều shot nối) cũng có tiếng: một mix cho cả tập hoặc một clip mỗi shot đặt đúng tick bắt đầu shot
  (builder chọn, ghi lý do).
- G3: Shot không có cue âm thanh → không thêm clip, không thêm file (ZIP như cũ, hash cũ không đổi).
- G4: Tuỳ chọn trong bảng Xuất: "Kèm tiếng trong film" (mặc định bật), tiếng Việt.
**Không làm (đợt này)**: pixelfx vào film; cue VFX gắn xương chuyển động (B77); nhiều track tiếng riêng từng cue.
**Coi là hỏng dù "chạy được"**: clip lệch tick so với App 2 > 1 tick; file WAV khác định dạng 44,1 kHz/mono/s16; film cũ (không tiếng) đổi
hash; cài vào game bị coi là xung đột với file tiếng của film khác (tên phải có tên film).

## 5. Trải nghiệm người dùng
Xuất ▾ → Gói BBS FS → ô "Kèm tiếng trong film" (bật) → Xuất. Báo cáo xuất có dòng "Tiếng: 1 clip, 7,5 s, đỉnh −2,3 dB". Cài vào game như cũ.
Trong BBS: mở film → dòng thời gian camera có clip "W01 âm thanh" ở lớp dưới, phát film nghe được thoại và SFX.

## 6. Thiết kế kỹ thuật (hướng, builder tự quyết chi tiết)
- Lấy mixdown (hàm sẵn có của route audio-mixdown) theo range xuất → chuyển 44,1 kHz mono s16 (ffmpeg đã có trên máy, hoặc resample trong
  Node) → thêm vào gói như asset `assets/audio/w01/<filmName>-mix.wav` (+ SHA trong export-manifest/REPORT).
- Manifest: thêm `audioClips: [{ tick, durationTicks, link, volume }]` → worker Java thêm clip camera kiểu `bbs:audio` (tham khảo
  `AddAudio.java` dưới đây; đặt `layer` = lớp lớn nhất + 1; không đụng clip camera hiện có).
- Giải mã kiểm trong test: dùng `BbsCodec.read` + `toJson` như `agent/test_film_world_anchor.py` để chắc chắn clip có đủ trường.

```java
// AddAudio.java (ngoài repo, đã chạy 2026-11-06)
Node clip = map(); Map<String, Node> m = map(clip);
m.put("mcp_id", string(UUID.randomUUID().toString())); m.put("tick", integer(0)); m.put("title", string("W01 âm thanh"));
m.put("type", string("bbs:audio")); m.put("duration", integer(durationTicks)); m.put("layer", integer(maxLayer + 1));
m.put("additive", deepCopy(map(first).get("additive"))); m.put("enabled", deepCopy(map(first).get("enabled"))); m.put("envelope", deepCopy(map(first).get("envelope")));
m.put("audio", string("assets:audio/w01/<film>-mix.wav")); m.put("offset", integer(0)); m.put("volume", floating(1f));
list(map(root).get("camera")).add(clip);
```

## 7. Chia đợt
| Đợt | Nội dung | Xong khi |
| --- | --- | --- |
| A1 | Shot đơn: mix → WAV 44,1k → asset + clip `bbs:audio` + ô "Kèm tiếng trong film" + report | test giải mã PASS, ZIP Shot 03 bản sao có clip + file |
| A2 | Xuất tập (episode.export) có tiếng | test 2 shot nối: clip/tick đúng từng shot |
Mỗi đợt một nhánh/PR (`codex/film-audio-a1`, `codex/film-audio-a2` xếp chồng), không tự merge.

## 8. Đo số (bắt buộc)
- Giải mã `.dat` xuất từ **bản sao** Shot 03 (`S:\Claude\w01-samples\s3rod-projects` hoặc bản sao mới; KHÔNG project thật):
  có đúng 1 clip `bbs:audio`, `tick` 0, `duration` = số tick film (150), `audio` trỏ file có trong ZIP. PASS/FAIL.
- WAV trong ZIP: 44100 Hz, 1 kênh, 16-bit, dài = film ± 1 tick; đỉnh ≤ −1 dBFS.
- Shot không có cue âm thanh: hash `.dat` và danh sách file ZIP **giống hệt** trước khi sửa.
- Test: `agent/test_film_worker.py` (cần fixture; nếu thiếu `bbs-animation-MCP-reference` thì ghi BLOCKED + lý do) và test TS cho manifest.
- `pnpm typecheck` toàn workspace PASS. Report `docs/REPORT-film-audio-2026-11-xx.md` có bảng trạng thái NOT_RUN/BLOCKED/FAIL/PASS.

## 9. Bài test thủ công (người dùng)
1. App 2 → Shot 03 bản thử → Xuất ▾ → Gói BBS FS (ô "Kèm tiếng trong film" bật) → Cài vào game (game tắt).
2. Vào world → mở film → thấy clip "W01 âm thanh" trong dòng thời gian camera → phát: nghe thoại Gỗ Xưa khung 2 và Hero khung 40.

## 10. Câu hỏi của người đọc kiểm tra: Claude chốt
1. Mix hay từng cue? → **[Claude chốt]** một mix (BBS chỉ cần 1 clip; giữ gain/cắt như App 2).
2. Tên file → `assets/audio/w01/<filmName>-mix.wav` (tên film đã duy nhất trong world).

## 11. Builder tự quyết
Cách resample; vị trí ô tuỳ chọn; tách hàm mix dùng chung với route audio-mixdown.

## 12. Ràng buộc
Không sửa `packages/retarget`; không đổi golden; không commit binary/kho thật/project thật. Test trên bản sao, `W01_LIBRARY` bản sao.
Không ghi vào thư mục game khi game đang chạy (kiểm `java/javaw`). UI tiếng Việt, nền tối. `pnpm typecheck` trước push.
PR #234 (mọi ô action → `w01_rest`) đang mở, cùng đụng `filmManifest.ts`/`FilmExportWorker.java`: rebase lên main sau khi #234 merge.
