# App 1 — chọn animation và chuyển nhanh sang nhân vật đích (GẤP, 2026-10-23)

Người dùng yêu cầu gấp: nguồn có rất nhiều animation; người dùng muốn **xem, tích chọn** những cái cần, rồi **một bước** chuyển sang
nhân vật đích, đồng thời đưa vào thư viện (gán cho nhân vật, và/hoặc kho dùng chung). Tên hiện **song ngữ**: `English | Tiếng Việt`.

## Hiện trạng (sau L2 #71, W1 #74, W2 #78)
- Workbench (`packages/retarget/workbench/public/app.js`): danh sách Action ở tab **Actions** (bảng có ô tích `state.checked` để xuất);
  ô `actionSel` dưới khung xem là dropdown, chọn xong đóng; tab **Tải về** có **bộ ô tích thứ hai** + chọn nhân vật + nút
  "Đưa vào thư viện của…" (server `POST /api/runs/:id/library…`, tạo bản Nháp, Verity kèm `.original.*`).
- Thư viện (`packages/library`): action có `ownerCharId/status/version` (L1); gói nhập không có `ownerCharId` = kho dùng chung.

## A1 — Bảng chọn animation ghim được + chuyển một bước (Workbench)
Vùng file: `packages/retarget/workbench/` (`public/app.js`, `public/index.html`, `public/styles.css`, `server.ts`, `pipeline.ts`),
`test/workbench.test.ts`.
1. **Bảng "Animation của nguồn"** mở bằng nút cạnh ô Action (và phím `A`): bảng nổi trên khung xem, **ở yên cho tới khi bấm X** (Esc
   cũng không đóng nếu đang ghim), kéo di chuyển được, đổi cỡ được, nhớ vị trí/cỡ (localStorage).
   - Mỗi dòng: **ô tích** · số thứ tự · **tên song ngữ** `Walk | Đi bộ` (dùng A2) · thời lượng · nhãn chất lượng (sau khi chạy).
   - **Bấm vào dòng = xem thử** ngay ở khung nguồn (và khung kết quả nếu đã chạy), bảng không đóng; dòng đang xem được tô.
   - Thanh trên bảng: ô tìm (lọc theo tên Anh/Việt), "Chọn hết", "Bỏ hết", "Đảo chọn", đếm "đã chọn 5/58".
   - **Một lựa chọn duy nhất**: bỏ bộ ô tích thứ hai ở tab Tải về; tab Actions và tab Tải về dùng chung `state.checked`.
2. **Nút "Chuyển sang nhân vật đích"** ở chân bảng (bật khi đã chọn ≥ 1 action và đã chọn đích):
   - Hộp xác nhận nhỏ: nhân vật đích đang chọn (đổi được), **☑ Bộ của nhân vật** (bản Nháp, mặc định bật nếu đích là nhân vật thư viện),
     **☑ Kho dùng chung** (gói không gắn nhân vật), ít nhất một ô phải bật; thẻ động tác (`requiredActions.key`) gợi ý theo tên.
   - Bấm "Chuyển" → **chỉ chuẩn hoá các action đã tích** (dùng lại run hiện có với `actions` = danh sách đã tích), xong tự đưa vào thư viện
     theo 2 ô trên, rồi báo kết quả: "Đã chuyển 5 animation → Chirity (5 Nháp) + kho dùng chung (1 gói)". Verity: kèm bản bộ xương gốc
     như L2; Minecraft 20: kèm `.bobj`.
   - Lỗi một action không chặn các action khác; báo rõ action nào lỗi, có nút "Thử lại các action lỗi".
3. Tên song ngữ hiện ở mọi chỗ Workbench liệt kê action (bảng mới, tab Actions, tab Tải về, ô `actionSel`).
**Đạt khi:** test workbench: chọn 2/4 action → một lệnh chuyển → chỉ 2 action được chuẩn hoá, có 2 Nháp của nhân vật và 1 gói chung khi
bật cả hai ô; chỉ bật "kho dùng chung" → không có Nháp; bảng không đóng khi xem thử (test DOM bằng logic thuần nếu cần); test cũ PASS.

## A2 — Tên animation song ngữ (dùng chung mọi app)
Vùng file: `packages/library/` (file mới `actionNames.ts` + test, `types.ts`, `library.ts`/`characters.ts` chỗ ghi tên, `mcp.ts`, README).
1. `translateActionName(en: string): { vi: string; source: 'glossary' | 'words' | 'none' }` + `formatBilingual(en, vi) => 'en | vi'`
   (nếu `vi` rỗng hoặc trùng `en` → chỉ `en`). **Không gọi mạng/AI**: từ điển nội bộ.
   - Từ điển ≥ 200 mục cho tên hay gặp: Mixamo (`Idle`→`Đứng yên`, `Walking`→`Đi bộ`, `Running`→`Chạy`, `Samba Dancing`→`Nhảy samba`,
     `Jump`→`Nhảy lên`, `Death`→`Chết`, `Hit Reaction`→`Trúng đòn`…), WC3 (`Stand`→`Đứng`, `Attack`→`Tấn công`, `Spell`→`Niệm phép`,
     `Slam`→`Đập`, `Victory`→`Chiến thắng`, `Dissipate`→`Tan biến`, `Cinematic`→`Điện ảnh`…), BBS/Minecraft (`crouching`→`Ngồi xổm`,
     `sprinting`→`Chạy nước rút`, `swipe`→`Vung tay`, `emote_*`: `emote_dab`→`Biểu cảm: dab`, `emote_crying`→`Biểu cảm: khóc`…), Verity
     (`dying`→`Đang chết`, `dead`→`Đã chết`). Bỏ tiền tố rác (`mixamo.com`, `Armature|`, `Take 001`) trước khi dịch.
   - Tên ghép: tách từ (`_`, `-`, khoảng trắng, camelCase), dịch từng từ theo từ điển, **giữ số thứ tự** (`Attack Slam 1` →
     `Tấn công đập 1`); từ không có trong từ điển giữ nguyên.
2. Thư viện: `ActionMetadata.nameVi?: string` (+ `nameViSource`), ghi khi nhập (`importPack`, `addDraftToCharacter`, sao chép…),
   **sửa tay được** (`setActionMetadata` nhận `nameVi`), tìm kiếm khớp cả tên Việt (có và không dấu).
3. Hiện song ngữ ở App 2 (bảng động tác theo nhân vật, trang `/library`) **chỉ đổi chỗ hiển thị**, không đổi logic; App 3 nhận tên qua
   bridge nếu đã có trường tên (không sửa Animation Studio).
**Đạt khi:** test từ điển (≥ 30 tên thật từ Mixamo/WC3/BBS mẫu trong repo hoặc tổng hợp), tên ghép giữ số, tiền tố rác bị bỏ, không dấu
vẫn tìm được; bản ghi cũ không có `nameVi` vẫn đọc được; test cũ PASS.

## A1b — Sửa #80 sau review (Claude chạy thật FelOrc → Chirity) + đổi tên animation
1. **File bộ xương gốc cho Verity**: `workbench/server.ts` chỉ ghi `anim.original.bbs.bobj` / `anim.original.glb` khi
   `character.rig === 'verity'`; Gỗ Xưa/Tiểu Nhị/Chirity trong thư viện có rig `mixamo65` + `characters/<id>/original/model.bbs.bobj`.
   Coi nhân vật có `original/model.bbs.bobj` (hoặc rig `verity`) là nhân vật bộ xương gốc; sửa cả đường gửi của L2.
2. **Thẻ động tác theo từng dòng**: tự đoán theo tên (attack→`attack`, death/die/dead→`fall`, walk→`walk`, run/sprint→`run`,
   idle/stand→`idle`, jump→`jump`, hit→`hit`…), không đoán được thì để trống, sửa được từng dòng.
3. **Mặc định không tích** animation nào khi mở bảng ("đã chọn 0/N"); nút Chuyển chỉ bật khi đã tích ≥ 1.
4. **Đổi tên animation** (người dùng yêu cầu 2026-10-23):
   - Trong bảng chọn: nhấp đúp vào tên (hoặc nút bút chì) để sửa **tên tiếng Anh** và **tên tiếng Việt** riêng; Enter lưu, Esc huỷ;
     tên rỗng không được; trùng tên trong cùng lần chuyển thì báo và tự thêm hậu tố `_2`.
   - Tên mới dùng cho mọi đầu ra của lần chuyển: tên animation trong GLB, tên `an` trong `.bobj` (Minecraft 20 và `.bobj` gốc Verity;
     chuyển ký tự không hợp lệ thành `_`), tên + `nameVi` trong thư viện (cả bản Nháp và kho dùng chung). Giữ tên gốc của nguồn trong
     metadata (`sourceName`) để truy vết.
   - Thư viện: `setActionMetadata` nhận `name` (ngoài `nameVi`), có test; App 2 (bảng động tác theo nhân vật, trang `/library`) cho
     **đổi tên** animation đã có trong thư viện (tên Anh + Việt), cập nhật cả bản Nháp của nhân vật.
   **Đạt khi:** test: đổi tên 2 animation rồi chuyển → GLB, `.bobj`, thư viện mang tên mới, `sourceName` giữ tên gốc; đổi tên trong
   thư viện được App 2 hiển thị lại đúng.

## Phân chia và nộp
- **A1 và A2 chạy song song** (hai subagent, model **sol 5.6** bản nhẹ). Hợp đồng chung để không chờ nhau: A2 export
  `translateActionName`, `formatBilingual` từ `packages/library/index.ts`; A1 import đúng hai hàm này (khi A2 chưa merge, A1 tạm dùng
  bản trả `{ vi: '', source: 'none' }` trong nhánh của mình, xoá khi rebase).
- Nhánh `ai1/a1-workbench-action-picker`, `ai1/a2-bilingual-action-names`; mỗi việc một PR; build + `pnpm typecheck` + test liên quan,
  **chạy được trên Windows**; ghi kết quả thật vào PR; **không tự merge**.

## Lệnh gửi Codex
> GẤP. Đọc `docs/APP1-ACTION-PICKER-TASKS-2026-10-23.md` trên `main` mới nhất. Agent điều phối giao **A1** (Workbench: bảng chọn
> animation ghim được, chỉ đóng khi bấm X, ô tích từng animation, xem thử khi bấm dòng, nút "Chuyển sang nhân vật đích" chuẩn hoá đúng
> các action đã tích rồi đưa vào thư viện: ☑ bộ của nhân vật và/hoặc ☑ kho dùng chung) và **A2** (tên song ngữ `English | Tiếng Việt`
> bằng từ điển nội bộ, lưu `nameVi` trong thư viện, sửa tay được, hiện ở App 1/App 2) cho **hai subagent model sol 5.6 bản nhẹ chạy song
> song** theo hợp đồng hàm trong đặc tả. Mỗi việc một nhánh `ai1/a1-…`, `ai1/a2-…` và một PR; build, `pnpm typecheck`, test trên Windows;
> **không tự merge**; xong báo mã việc + số PR.
