# F1 — Thư viện animation: yêu thích (sao) và phân loại hành động (2026-10-24)

Người dùng yêu cầu: thư viện animation có **đánh sao yêu thích** và **phân loại** như Mixamo (hành động, cảm xúc, bơi…).

## Hiện trạng
- `packages/library/types.ts`: `ACTION_CATEGORIES` = `locomotion, idle, combat, emote, dance, gesture, interaction, hurt-fall, sit-lie,
  pose, other` (một nhóm mỗi action, mặc định `other`, nhãn tiếng Anh). Chưa có yêu thích.
- Trang `/library` đang được **M2** làm lại thành lưới video (`docs/BATCH-IMPORT-LIBRARY-TASKS-2026-10-24.md`).

## Yêu cầu
### F1a — Dữ liệu (`packages/library`, + test, `mcp.ts`, README)
1. **Phân loại mở rộng**, giữ được giá trị cũ. Nhãn song ngữ:
   | key | Nhãn |
   | --- | --- |
   | `locomotion` | Di chuyển · Locomotion |
   | `idle` | Đứng yên · Idle |
   | `combat` | Hành động / chiến đấu · Action |
   | `emote` | Cảm xúc · Emotion |
   | `dance` | Nhảy múa · Dance |
   | `gesture` | Cử chỉ · Gesture |
   | `interaction` | Tương tác · Interaction |
   | `hurt-fall` | Trúng đòn / ngã · Hurt & fall |
   | `sit-lie` | Ngồi / nằm · Sit & lie |
   | `pose` | Tư thế · Pose |
   | **`swim`** | **Bơi · Swim** |
   | **`climb`** | **Leo trèo · Climb** |
   | **`fly`** | **Bay · Fly** |
   | **`jump`** | **Nhảy lên · Jump** |
   | **`sport`** | **Thể thao · Sport** |
   | **`magic`** | **Phép thuật · Magic** |
   | **`work`** | **Lao động / sinh hoạt · Work & daily** |
   | `other` | Khác · Other |
   - Mỗi action có **một nhóm chính** (`category`) và **nhóm phụ tuỳ chọn** (`categories?: string[]`, ≤ 3) cho animation thuộc nhiều nhóm
     (vd "Sword Swim" → bơi + hành động).
   - `ACTION_CATEGORY_LABELS` xuất ra để UI dùng chung.
2. **Tự đoán nhóm theo tên** (`suggestActionCategory(name, nameVi?)`, từ điển nội bộ, giống A2):
   - swim/swimming/treading water/dive → `swim`;
   - attack/punch/kick/slash/sword/shoot/block/combo → `combat`;
   - happy/sad/angry/cry/laugh/scared/surprised/emote_* → `emote`;
   - dance/samba/hip hop/salsa/floss → `dance`;
   - walk/run/jog/sprint/strafe/turn → `locomotion`;
   - climb/ladder/hang → `climb`;
   - fly/hover/flap → `fly`;
   - jump/hop/leap → `jump`;
   - death/die/fall/hit/knockdown/stun → `hurt-fall`;
   - sit/lie/sleep/kneel → `sit-lie`;
   - wave/point/clap/nod/bow → `gesture`;
   - spell/cast/magic/summon → `magic`;
   - pick/push/pull/open/door/talk → `interaction`;
   - idle/stand/breathe → `idle`;
   - còn lại → `other`.

   Áp khi nhập (`importPack`, bản Nháp, M1); **không ghi đè** nhóm người dùng đã chọn tay (`categorySource: 'auto' | 'manual'`).
3. **Yêu thích:** `favorite: boolean` và **xếp hạng sao 0–5** (`rating?: 0..5`, 0 = chưa chấm). Cả hai sửa qua `setActionMetadata`; có
   `setFavorite(actionUuid, value)` và `setRating(actionUuid, stars)`. Bản Nháp của nhân vật có yêu thích / sao **riêng** (không kéo theo bản chung).
4. `searchLibrary` thêm lọc `favorite`, `minRating`, `category` (khớp nhóm chính hoặc phụ), sắp xếp `rating | name | recent`;
   `categoryCounts()` trả số action theo từng nhóm (dùng cho cột lọc). Có MCP tương ứng.
5. **Tương thích:** bản ghi cũ không có trường mới vẫn đọc được. Bản ghi `other` cũ được đoán lại nhóm khi chạy
   `rebuildLibraryIndex({ recategorize: true })`, chỉ với các bản `categorySource !== 'manual'`.

**Đạt khi:**
- test ≥ 40 tên thật (Mixamo/WC3/BBS/Verity) ra đúng nhóm, kể cả tên swim;
- chọn tay rồi nhập lại không bị ghi đè;
- yêu thích và sao lưu được, lọc/sắp xếp đúng;
- `categoryCounts` đúng;
- bản ghi cũ đọc được;
- test cũ PASS.

### F1b — Giao diện thư viện `/library` (làm **trong nhánh M2**, cùng subagent M2, để không xung đột)
- **Cột lọc bên trái kiểu Mixamo:**
  - ★ Yêu thích (số lượng);
  - từng nhóm có biểu tượng + nhãn song ngữ + số lượng;
  - lọc nguồn (Mixamo/khác), nhân vật, trạng thái Nháp/Đã chỉnh/Đã duyệt, In Place.
- **Trên mỗi thẻ video:**
  - **ngôi sao** bấm để bật/tắt yêu thích (lưu ngay, có hiệu ứng);
  - 5 sao nhỏ để chấm điểm khi rê chuột;
  - nhãn nhóm.
- **Sửa nhóm:** bấm nhãn nhóm trên thẻ → chọn nhóm chính / phụ. **Chọn nhiều thẻ** (Shift/Ctrl hoặc ô tích) → "Đổi nhóm", "Yêu thích", "Bỏ yêu thích" hàng loạt.
- **Sắp xếp:** Yêu thích trước · Sao cao nhất · Tên · Mới nhập.
- **App 2:**
  - bảng "Lấy từ kho…" (M3) và bảng động tác theo nhân vật (L3) có thêm lọc nhóm + ★;
  - chỉ thêm bộ lọc, không đổi luồng.

## Phân chia
| Việc | Nhánh | Ghi chú |
| --- | --- | --- |
| F1a | `ai1/f1-library-favorites-categories` | Subagent riêng, **song song** với M1–M3 |
| F1b | gộp vào `ai1/m2-library-video` | Subagent M2 làm sau khi F1a có API (dùng hợp đồng hàm ở trên; F1a chưa merge thì M2 tạm dùng bản giả trong nhánh, xoá khi rebase) |
| Phần lọc App 2 của F1b | gộp vào `ai1/m3-assign-to-character` | Subagent M3 |

Model subagent **sol 5.6** bản nhẹ. Build, `pnpm typecheck`, test **trên Windows**. Ghi kết quả thật vào PR. **Không tự merge.**

## Lệnh gửi Codex
> Thêm việc **F1** theo `docs/LIBRARY-FAVORITES-CATEGORIES-TASK-2026-10-24.md` (`main` mới nhất): thư viện animation có **sao yêu thích +
> chấm 0–5 sao** và **phân loại song ngữ kiểu Mixamo** (hành động, cảm xúc, **bơi**, leo trèo, bay, nhảy, thể thao, phép thuật…), tự đoán nhóm
> theo tên, sửa tay không bị ghi đè. **F1a** (dữ liệu, `packages/library`) giao một subagent mới chạy **song song** với M1–M3, nhánh
> `ai1/f1-library-favorites-categories`. **F1b** (giao diện `/library`) gộp vào việc **M2**, phần lọc ở App 2 gộp vào **M3**, để không
> sửa chung file. Subagent model sol 5.6 bản nhẹ; build, typecheck, test trên Windows; **không tự merge**; xong báo mã việc + số PR.
