---
name: w01-shot-new
description: Dựng một shot MỚI của tập phim trong App 2 (bản thử) nối tiếp shot trước, có nhịp chậm/nhanh, prop bám tay, cú chạm, rơi/nằm sát đất, camera, VFX, thoại CapCut, SFX và ảnh duyệt, kèm cổng đo PASS/FAIL. Dùng khi người dùng nói "tạo shot mới", "làm short/shot 5", "slide N", "bắt đầu từ vị trí cuối shot trước", "nhịp chậm nhanh", "nằm không sát đất", "búa đập trúng đầu", "thêm thoại/âm thanh cho shot". Sửa shot đã có thì dùng w01-shot-edit; ghi sang project thật dùng apply_to_real.mts của w01-shot-edit.
---

# Dựng shot mới (bản thử) — App 2

Mỗi shot mới lặp lại cùng một chuỗi việc. Hãy dùng script ở `scripts/`, đừng viết lại. Mọi script đọc một file cấu hình
`shot.json` (do `new-shot.py` tạo, sửa tay được) và **từ chối** cổng 3016/3002 (App 2 thật). Không xuất ZIP / vào game khi chưa có lệnh.

## Quy trình
0. **Đọc kịch bản/slide**, hỏi người dùng các điểm chưa rõ (thời lượng, ai làm gì sau cú đánh, thoại nào). Đề xuất bảng nhịp:
   nói chuyện/giữ cảnh **chậm**, tấn công **nhanh** (người dùng chốt quy tắc này). Ghi các mục tự chốt là **[Claude chốt]**.
1. **Bản thử**: `python -I scripts/new-shot.py --from <thư mục project shot trước> --name "Tập 15 · Shot 05" --slug s5 --port 3142 --end 300`
   → bản sao project (id mới, cả trong URL asset), thư viện con, thư mục xem trước VFX (gồm pixelfx tap15-*), mục launch, `work/s5/shot.json`.
   Bật server bằng `preview_start name=s5`.
2. **Nối tiếp**: `node scripts/continue-from.mjs <shot.json>` — khung cuối shot trước thành khung 0 (clip đang chạy dời về trước 0 nên giữ
   đúng pha; đường cong chốt giá trị; cue VFX còn sống bắt đầu lại ở 0; xoá cue âm thanh). Chạy lại được.
3. **Đo**: `node scripts/gates.mjs <shot.json>` → CONTINUITY ≤ 2 cm phải PASS trước khi làm tiếp.
4. **Động tác**: `python -I scripts/find-motion.py <shot.json> <char> "fly attack"` (lọc đúng bộ xương: Gỗ Xưa chỉ nhận động tác riêng của
   nó; Hero/Đen MC20), `--copy <uuid…>` chép gói vào thư viện bản thử → `node scripts/place.mjs <shot.json> place.json` (đặt ở vùng tạm,
   cả clip phát ngược để "ngồi dậy từ từ") → `node scripts/rhythm.mjs <shot.json> rhythm.json` (khung, tốc độ, trộn, root).
5. **Đường đi / chạm / sàn**:
   - đường bay vòng cung: viết khoá vị trí của nhân vật (fcurves) — ví dụ trong `references/shot04-example.md`;
   - `node scripts/prop-follow.mjs <shot.json>` (gậy bám xương tay, grip lấy ở khung 0);
   - `node scripts/align-contact.mjs <shot.json> --frame F --target go --list` để chọn khung gậy quét xuống nhanh nhất, rồi bỏ `--list`
     để dời người cầm cho đầu prop chạm đỉnh đầu; chạy lại `prop-follow.mjs`;
   - `node scripts/ground.mjs <shot.json> go --hit 102 --land 118 [--knock 0.6]` (rơi nhanh tới sàn rồi luôn sát sàn);
   - nằm nghiêng (chân cao, đầu dưới đất): `node scripts/flat.mjs <shot.json> go --in 140 --hold 156 190 --out 222`, rồi chạy lại `ground.mjs`.
6. **Camera**: `node scripts/camera.mjs <shot.json> camera.json` ([khung, mắt, điểm nhìn]); cuối shot lùi rộng nếu cần thấy mọi nhân vật.
7. **VFX**: `node scripts/vfx.mjs <shot.json> add <effect> <start> --at go:head@101 --dy 0.1 --scale 0.35` (độ dài tự lấy theo hiệu ứng),
   `vfx.mjs keep barrior01` (hiệu ứng sống cả shot: nối cue gối nhau), `vfx.mjs list`.
8. **Âm thanh**: `python -I scripts/voice.py goxua "Ây ây da... đau quá!" out.wav` (CapCut, preset giọng nhân vật),
   `python -I scripts/sfx.py <dir> bonk thud whoosh:0.8 charge` (tự tổng hợp), `node scripts/audio.mjs <shot.json> audio.json`
   (đặt cue + mixdown + AUDIO_PEAK ≤ −1 dB). Ghi nguồn vào CREDITS.md.
9. **Kiểm + ảnh**: `gates.mjs` (mọi cổng PASS hoặc giải thích), ảnh duyệt theo `scripts/stills.md` + `scripts/sheet.py`, gửi người dùng.
   Báo: link `http://127.0.0.1:<port>/?unified=<id>`, bảng nhịp theo khung, số đo, điều chưa kiểm (chưa nghe tiếng, pixelfx chưa vào film).

## shot.json — các mục người dùng hay chỉnh
`floor`: `[["go", 118, true], ["den", 0, true, 0.25]]` (từ khung nào phải sát sàn; MC20 dùng 0.25 vì xương nằm trong khối thân) ·
`fastFrames`: `[[96, 108]]` (đoạn tấn công nhanh, không tính SEAM_JUMP) · `contact`: `{ "frame": 101, "char": "go" }` ·
`prop`: `{ "node", "follow": "hero", "bone": "low_right_arm_end", "tip": [0, 1.0, 0] }` (đầu gậy Spectrite ở y≈1,0–1,13).

## Bẫy đã gặp (đừng lặp lại)
- Clip non-loop kết thúc giữa shot → nhân vật **về tư thế nghỉ** (đứng thẳng). Kéo clip cuối tới hết shot (rhythm.mjs cảnh báo).
- Death để `in-place` thì mất cú gục; rơi/ngã dùng `skeletal`. Đổi root của clip đang chồng/trộn phải đỗ tạm (rhythm.mjs đã làm).
- Bù sàn phải **đặt lại về 0 rồi đo** (ground.mjs làm sẵn); bù chồng lên đường cũ làm nhân vật lơ lửng 0,7 m.
- Phát ngược một động tác ngã để "ngồi dậy": giới hạn đoạn nguồn, nếu không sẽ đứng hẳn thành tư thế sẵn sàng.
- Cue dài hơn hiệu ứng một lần sẽ phát lại (landing 2 lần); vòm barrior01 tự tắt ~250 khung → `vfx.mjs keep`.
- Cue VFX không bắt đầu trước khung 0 được (vòm nở lại ở đầu shot); clip động tác thì được (frameStart âm).
- Ảnh `stills.py` (w01-shot-edit) bỏ qua khoá người dùng; ảnh duyệt shot dùng `stills.md` (khung 3D thật).
- pixelfx (tap15-*) chỉ xem được trong App 2; film BBS chưa có (việc của Codex). BBS không phát cue âm thanh: cần clip âm thanh camera.
- Người dùng hay nói nhầm tên khi đọc giọng nói ("đen" ↔ Gỗ Xưa): đối chiếu khung hình/nhân vật trước khi sửa, hỏi lại nếu cả hai đều hợp lý.
