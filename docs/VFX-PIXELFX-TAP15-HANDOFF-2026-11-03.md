# Bàn giao: hiệu ứng pixelfx cho Tập 15 (App 4 VFX)

Ngày bàn giao: 2026-11-03. Phiên làm trước: Claude (session_017JBkXniDDP7NgscUZNwHF4), làm ngày 2026-10-31.
Người dùng: Trần Châu Tuấn. Trả lời bằng tiếng Việt, ngắn gọn.

## 1. Bối cảnh

- Người dùng làm film Minecraft trong **BBS FS 2.7 trên PC (Java)**, không dùng Bedrock.
- Nguồn hiệu ứng là [patch-gg/pixelfx](https://github.com/patch-gg/pixelfx):
  - giấy phép MIT, phiên bản 0.3.0;
  - commit đã dùng: `a84159688af3ca37a4be05a0d422b94451b2e24e` (2026-10-31).
  - pixelfx là hiệu ứng pixel-art viết bằng code JS, render ra sprite sheet PNG, JSON và GIF.
  - Bên trong có sẵn skill Claude Code (`skills/pixelfx`) để tạo hiệu ứng mới.
- Kết luận đã trao đổi với người dùng: pixelfx **có ích cho App 4**. Nó cho hiệu ứng 2D billboard kiểu hoạt hình (tiếp đất, trúng đòn, POW, aura, vòng phép). Các hiệu ứng này dùng chung với thư viện Effekseer có sẵn của App 4, không thay thế thư viện đó.
- Người dùng yêu cầu: "lấy mẫu thử cho Tập 15 kết hợp với các hiệu ứng trong thư viện". Phần này đã xong ở mức **mẫu**; chưa được kiểm trong game.

## 2. Đã làm

Đã làm 18 hiệu ứng, gắn vào 10 cảnh của Tập 15. Bảng cảnh, thời điểm và điểm gắn nằm trong `plan.json` → `shots`. Mỗi hiệu ứng có:

| Đầu ra | Dùng cho | Trạng thái |
|---|---|---|
| `app2-vfx-previews/<key>/sheet.png + sheet.json` | Xem trước trong viewport App 2 (`W01_VFX_PREVIEWS`, xem `apps/studio/src/vfxPreviews.ts`) | Tạo xong, **chưa mở trong App 2** |
| `bbs-particles/<key>.zip` | Particle Snowstorm cho BBS FS 2.7, đóng gói bằng `build_bbs_package` của App 4 | Cả 18 gói `PASS` ở bước chuyển đổi; **chưa thử trong game** |
| `previews/<key>.gif` | Ảnh động xem nhanh, khổ 1x | Xong |

Bảng màu đã đổi (trong `plan.json` → `palettes`):
- `honmang` (tím, cho Đen hỗn mang);
- `go` (xanh lá, cho Gỗ Xưa);
- `cauvong` (cho gậy cầu vồng của Hero).

Số đo từng hiệu ứng (khung, fps, kích thước, strip BBS) nằm ở `three-workspace-app/vfx/tools/pixelfx_tap15/report-2026-10-31.json`.

## 3. Tệp

**Trong repo** (nhánh `claude/vfx-pixelfx-handoff`):
- `three-workspace-app/vfx/tools/pixelfx_tap15/plan.json`: danh sách hiệu ứng (key → hiệu ứng nguồn pixelfx + bảng màu), bảng màu, và kế hoạch theo cảnh (thư viện App 4 + pixelfx).
- `render_all.mjs`: gọi `tools/render.mjs` của pixelfx (`--sheet --gif --scale 3 --no-actor --seed 15`) cho từng hiệu ứng.
- `build_pack.py`: cắt viền trong suốt, tạo preview App 2 (ô vuông, giữ pivot) và particle BBS (strip ngang, có IR) qua `effekseer_ai.bbs_package.build_bbs_package`.
- `report-2026-10-31.json`: kết quả lần chạy gốc.

**Ngoài repo** (ảnh và zip là file nhị phân, không commit). Người dùng giữ file **`tap15-pixelfx-samples.zip`** (≈18 MB), đã gửi kèm bàn giao. Bên trong:
- `README.md` (bảng theo cảnh);
- `LICENSE-pixelfx.txt`, `NOTICE-pixelfx.md`;
- `app2-vfx-previews/`, `bbs-particles/`, `previews/`, `report.json`.

## 4. Chạy lại

Cần Node ≥ 18, Python 3 + Pillow, `ffmpeg` trong PATH (chỉ để tạo GIF; thiếu thì vẫn có sheet), và một bản clone pixelfx ở đúng commit trên (dùng thư mục tạm ngoài repo).

```powershell
git clone https://github.com/patch-gg/pixelfx C:\w01-work\pixelfx
git -C C:\w01-work\pixelfx checkout a84159688af3ca37a4be05a0d422b94451b2e24e
cd <repo>\three-workspace-app\vfx\tools\pixelfx_tap15
node render_all.mjs C:\w01-work\pixelfx C:\w01-work\tap15fx
python -I build_pack.py <repo> C:\w01-work\tap15fx
# Kết quả: C:\w01-work\tap15fx\pack\...
```

- Đã chạy lại trên Linux ngày 2026-11-03: `pack/report.json` **trùng khớp** với `report-2026-10-31.json` (18/18), mất khoảng 40 s.
- `render.mjs` của pixelfx không cần `npm install`. GIF xem nhanh lấy từ `render/<key>/preview.gif`. Bộ zip gửi người dùng do phiên trước gom tay; script này chưa tạo README/GIF trong `pack/`.

## 5. Quy ước kích thước (cần người kiểm)

- `PX_PER_METER = 38 / 1.8`: nhân vật mẫu của pixelfx (scale 2) cao 38 px, coi bằng nhân vật Minecraft cao 1.8 m.
- App 2 `sizeMeters` = cạnh ô vuông / PX_PER_METER; pivot đặt ở chân hiệu ứng.
- BBS:
  - kích thước billboard = (rộng, cao) / PX_PER_METER × `BBS_BILLBOARD_SIDE` (2.25, lấy từ `ir_to_bbs`);
  - flipbook chạy 20 fps theo tick BBS, chỉ bước theo một trục, strip tối đa 8192 px;
  - hiệu ứng dài bị hạ xuống 15 fps hoặc 10 fps. `tap15-no-honmang` còn bị thu texture ×0.87.
- **Rủi ro:** vài hiệu ứng rất to (đập đất 11.6 m, nổ hỗn mang 11.7 m, chí mạng 8.4 m) vì khung pixelfx gồm cả sóng lan rộng. Chưa so trong game nên chưa biết to quá hay vừa.

## 6. Việc còn lại (theo thứ tự đề xuất)

1. **Người dùng kiểm** (NOT_RUN). Agent chỉ hướng dẫn và đọc kết quả:
   - Chép `app2-vfx-previews/*` vào thư mục `W01_VFX_PREVIEWS` rồi xem trong App 2.
   - Giải nén 1–2 gói `bbs-particles/*.zip` vào thư mục game, đặt particle trong film BBS, xem kích thước và độ mượt.
2. **Hiệu chỉnh kích thước** theo kết quả bước 1:
   - Thêm trường `scale` (mặc định 1) cho từng hiệu ứng trong `plan.json`.
   - Cho `build_pack.py` áp `scale` vào `sizeMeters` và billboard BBS.
   - Không đổi `PX_PER_METER` chung nếu chỉ vài hiệu ứng lệch.
3. **Đóng gói `.efkefc` (Effekseer) cho từng hiệu ứng**, để App 2 xuất film tự động được:
   - Worker xuất film hiện chỉ đóng gói AAA Particles `.efkefc` (`W01_AAA_ASSETS`, xem `docs/VFX-AAA-FILM-ASSETS.md`). Particle BBS Snowstorm phải đặt tay trong film.
   - Cần Windows có Effekseer:
     - CLI App 4: `effekseer-ai new / settings-set`, `add_texture.py`;
     - một sprite billboard dùng UV animation đọc từ strip PNG; sau đó `effect-dump` để kiểm IR.
   - Phải đo lại bằng ảnh preview, không tuyên bố PASS chỉ vì file mở được.
4. (Tuỳ người dùng) thêm hiệu ứng mới bằng skill pixelfx, rồi thêm key vào `plan.json`. Cảnh 17 hiện chỉ là "đề xuất thêm".

## 7. Ràng buộc

- Session App 4 chỉ sửa `three-workspace-app/vfx/` và `docs/VFX-*`. Muốn nối vào App 2 (cảnh/film) thì **đề xuất trước** (CLAUDE.md, `docs/DECISIONS.md`).
- Không commit ảnh, zip hay log nhị phân. Kết quả để ngoài repo.
- Credit MIT của pixelfx đã nằm trong `assets[].credit` của từng gói BBS và trong `CREDITS.md` của zip. Giữ nguyên credit khi phát hành.
- Không merge PR khi người dùng chưa đồng ý.
