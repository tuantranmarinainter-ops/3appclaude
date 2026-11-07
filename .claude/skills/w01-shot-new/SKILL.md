---
name: w01-shot-new
description: Dựng một shot MỚI của tập phim trong App 2 (bản thử) nối tiếp shot trước, có nhịp chậm/nhanh, prop bám tay, cú chạm, rơi/nằm sát đất, camera, VFX, thoại CapCut, SFX và ảnh duyệt, kèm cổng đo PASS/FAIL. Dùng khi người dùng nói "tạo shot mới", "làm short/shot 5", "slide N", "bắt đầu từ vị trí cuối shot trước", "nhịp chậm nhanh", "nằm không sát đất", "búa đập trúng đầu", "thêm thoại/âm thanh cho shot". Sửa shot đã có thì dùng w01-shot-edit; ghi sang project thật dùng apply_to_real.mts của w01-shot-edit.
---

# Dựng shot mới (bản thử) — App 2

Mỗi shot mới lặp lại cùng một chuỗi việc. Hãy dùng script ở `scripts/`, đừng viết lại. Mọi script đọc một file cấu hình
`shot.json` (do `new-shot.py` tạo, sửa tay được) và **từ chối** cổng 3016/3002 (App 2 thật). Không xuất ZIP / vào game khi chưa có lệnh.

## Ít token (bắt buộc)
Một shot từng tốn ~15% hạn 5 giờ vì phiên dài: mỗi lượt đọc lại 400–900 nghìn token lịch sử (đo 2026-11-07: 1.331 lượt gọi,
873 lệnh Bash, 79 ảnh). Quy tắc:
1. **Mỗi shot một phiên mới.** Sửa shot đã xong cũng mở phiên mới. Không dồn nhiều shot vào một phiên.
2. **Một lệnh cho cả chuỗi**: ghi các bước vào `shot.json` → `"build": [...]`, rồi chạy
   `node scripts/build.mjs <shot.json>` (thêm `--dry` để xem lệnh, `--from <n>` chạy tiếp, `--only <tên>` chạy một bước).
   Kết quả: 1 dòng/bước + tóm tắt cổng đo; log đầy đủ ở `work/<slug>/build/NN-<bước>.log`, `build/summary.json`.
   **Chỉ mở log khi bước FAIL**, và chỉ đọc đoạn cuối. Sửa nhịp/vị trí = sửa file JSON rồi chạy lại `build.mjs` (các bước chạy lại an toàn;
   `vfx add` đã có cue cùng hiệu ứng + khung thì tự bỏ qua).
3. **Không viết `step*.mjs` riêng cho từng shot.** Thiếu bước thì dùng `{"run": "<script>", "args": [...]}` hoặc thêm vào script chung.
4. **Ảnh**: một ảnh tổng hợp (`sheet.py`) cho mỗi vòng duyệt, không chụp từng khung, không dò dữ liệu bằng JS trên trình duyệt.
5. **Model**: Opus lập bảng nhịp và đọc kết quả; vòng sửa–chạy lại–đo giao subagent Sonnet (hoặc Haiku khi chỉ tìm động tác/đọc log).
6. **MCP `w01-shot`** (`.mcp.json` ở gốc repo, server `mcp/server.mjs`): dùng thay cho curl/Python/JS tự viết.
   `shot` = slug (`s5` → `S:/Claude/w01/work/s5/shot.json`) hoặc đường dẫn shot.json. Server từ chối 3016/3002.
   - `shot_read` `what: summary|clips|keys|cues|cast` (+ `char`, `frames`): bảng gọn; id cue rút 8 ký tự.
   - `shot_edit` `ops: moveClip|setClip|removeClip|setKeys|addCue|removeCue` (+ `dryRun`): mọi thao tác cảnh/đường cong = **một** bước hoàn tác.
     `setKeys` ghi lớp fcurve, không ghi userKeys (khoá người dùng). `shot_undo` hoàn tác.
   - `shot_measure` `metric: floor|height|distance|contact|continuity|gates` (+ `char`, `other`, `bone`, `frames`, `step`):
     probe chỉ chạy lại khi project đổi (~1,6 s), câu hỏi sau ~3 ms.
   - `shot_build`: chạy `build.mjs`.
   Kiểm thử: `node --test mcp/server.test.mjs mcp/measure.test.mjs scripts/build.test.mjs`.

Ví dụ `build` (thứ tự Shot 04):
```json
"build": [
  {"step": "continue"}, {"step": "place", "file": "place.json"}, {"step": "rhythm", "file": "rhythm.json"},
  {"step": "prop-follow"}, {"step": "align", "frame": 101, "target": "go", "offset": 0.1}, {"step": "prop-follow"},
  {"step": "ground", "char": "go", "hit": 102, "land": 118, "knock": 0.6},
  {"step": "flat", "char": "go", "in": 140, "hold": [156, 190], "out": 222}, {"step": "ground", "char": "go", "from": 118},
  {"step": "camera", "file": "camera.json"},
  {"step": "vfx", "cmd": "keep", "effect": "barrior01"},
  {"step": "vfx", "cmd": "add", "effect": "bonk", "start": 101, "at": "go:head@101", "dy": 0.1, "scale": 0.35},
  {"step": "voice", "who": "goxua", "text": "Ây ây da... đau quá!", "out": "voice.wav"},
  {"step": "sfx", "outDir": "sfx", "names": ["bonk", "thud", "whoosh:0.8"]},
  {"step": "audio", "file": "audio.json"}, {"step": "gates"}
]
```
`flat` tự làm mới probe trước khi chạy. Không có bước `gates` thì `build.mjs` tự đo ở cuối. Các bước dưới đây vẫn chạy tay được khi cần.

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
