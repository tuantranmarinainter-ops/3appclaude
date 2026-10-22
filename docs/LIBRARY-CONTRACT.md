# App 5 - Hợp đồng kho thư viện (v1.0.0, mặc định tạm 2026-10-22)

Kho animation/nhân vật dùng chung cho App 1, 2, 3. App 5 (trước đây gọi App 4) = thư mục kho ngoài repo + `packages/library`
(đọc/ghi/tìm) + giao diện duyệt kho + lệnh MCP. Các mục đánh dấu **[CẦN CHỐT]** chờ người dùng duyệt.

## 1. Vị trí
- Mặc định `C:\w01-library`, đổi bằng biến môi trường `W01_LIBRARY`.
- Ngoài repo: chứa được tài sản game (chỉ test nội bộ). Mục có giấy phép mở có thể xuất sang `builtin-assets/`.

## 2. Cấu trúc thư mục
```text
C:\w01-library\
  library.json                 version kho (semver, bắt đầu 1.0.0) + danh sách rig đã đăng ký
  index.json                   sinh lại được từ các meta.json (không phải nguồn sự thật)
  rigs/<rigId>.json            định nghĩa rig: danh sách xương, xương cha, xương phụ
  packs/<packId>/              một lần xuất của App 1 = một pack, KHÔNG sửa sau khi ghi
    anim.glb                   GLB hợp đồng v1.0.0 (nhiều Action)
    anim.manifest.json         manifest App 1 (giữ nguyên)
    anim.bobj                  tuỳ chọn, action Minecraft20 cho BBS FS
    meta.json                  thông tin kho (mục 4)
    covers/<actionUuid>.png    ảnh bìa từng Action
  characters/<charId>/         nhân vật đích (model + rig)
    model.glb | model.bobj (+ textures/)
    meta.json
```

## 3. Đơn vị
- **Pack**: một file GLB (+ manifest) do App 1 xuất. `packId` = 16 ký tự đầu của SHA-256 GLB.
- **Action**: một clip trong pack, định danh bằng `uuid` từ manifest App 1. Mọi app tham chiếu animation
  bằng `actionUuid`, không bằng tên file.
- **Character**: một nhân vật đích. Định danh `charId` (UUID).
- Bất biến: pack đã ghi không sửa. App 3 sửa động tác → pack mới, Action mới có `parentUuid` = UUID gốc.

## 4. meta.json của pack
```json
{
  "kind": "motion-pack",
  "libraryVersion": "1.0.0",
  "packId": "3da9d25f30f72c6c",
  "rig": "mixamo65",
  "createdBy": "app1",
  "createdAt": "2026-10-21T10:00:00Z",
  "license": { "id": "internal-only", "commitable": false, "source": "Female.fbx (CC)" },
  "boundCharacter": "<charId> | null",
  "actions": [
    {
      "uuid": "df7ac5ff-...",
      "name": "Đi bộ vui",
      "durationSeconds": 5.13,
      "fps": 30,
      "category": "locomotion",
      "tags": ["walk", "happy"],
      "loop": true,
      "inPlace": false,
      "parentUuid": null,
      "cover": "covers/df7ac5ff-....png"
    }
  ]
}
```

## 5. Rig
- `mixamo65`: 65 xương Mixamo không prefix (hợp đồng GLB v1.0.0).
- `minecraft20`: 20 xương BBS/Blockbuster V9.12.
- Rig mở rộng: `<rigGốc>+<tên>`, ví dụ `mixamo65+face` (thêm xương miệng), `mixamo65+wings`. File `rigs/*.json` ghi
  `base` và danh sách xương phụ cùng xương cha. Action rig gốc áp được lên rig mở rộng (xương phụ giữ rest);
  ngược lại thì không.

## 6. Truy cập
- Chỉ ghi qua `packages/library` (ghi vào thư mục tạm rồi rename, cập nhật `index.json` có khoá file).
- App 1: ghi pack, character. App 2/App 3: đọc; App 3 ghi pack mới (Action đã sửa).
- MCP: `library.search {rig, category, tags, text}`, `library.get {actionUuid}`, `library.characters`.
- Giao diện App 5: lưới ảnh bìa, lọc rig/category/tag, xem trước Action trên nhân vật chọn, sửa tag/category
  (chỉ sửa meta.json, không đụng GLB).

## 7. Luồng nạp kho (người dùng nêu 2026-10-21)
- Animation luôn đi qua App 1 (chuẩn hoá) trước, rồi mới vào App 5. Người dùng sẽ chuẩn hoá hàng loạt
  để nạp kho → cần lệnh batch: App 1 CLI chạy nhiều nguồn → `packages/library` ghi pack.

## 8. Đã chốt (người dùng duyệt cả 4 điểm 2026-10-22; khi đổi thì tăng `libraryVersion`)
1. **Gắn theo rig**: pack có `rig` (`mixamo65` | `minecraft20` | rig mở rộng) và dùng cho mọi nhân vật cùng rig;
   `boundCharacter` (tuỳ chọn) ghi nhân vật đích App 1 đã retarget theo (fingerprint) để ưu tiên khi lọc.
2. **Danh mục cố định + tag tự do**. Danh mục: `locomotion`, `idle`, `combat`, `emote`, `dance`, `gesture`,
   `interaction`, `hurt-fall`, `sit-lie`, `pose`, `other`.
3. **Ảnh bìa PNG tĩnh** (App 1 đã có `preview.png`; pack không có thì sinh bằng render chạy nền). GIF/WebM làm sau.
4. **Nạp sẵn vào kho cục bộ** (ngoài repo, `commitable: false`):
   - 85 action Minecraft20 V9.12 (`license.id = "GPL-3.0"`, rig `minecraft20`, GLB sinh bằng
     `packages/retarget/cli/minecraftBlockCharacters.ts`);
   - 121 pose Topview (`license.id = "CC-BY-4.0"`, rig `mixamo65`, category `pose`, GLB sinh bằng
     `apps/studio/scripts/topviewPosesToActions.mts`).
