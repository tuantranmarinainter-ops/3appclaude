# Bàn giao Workspace 1 — Code và progress

Đây là ảnh chụp mã nguồn trên đĩa và hồ sơ tiến độ của Workspace 1 (Universal Rig & Animation Normalization). Giữ nguyên cả phần triển khai dở. Không phải bộ cài, bản production hoặc một ứng dụng đã tách độc lập.

## Đọc theo thứ tự

1. `handoff/PROGRESS.md`: tiến độ tổng hợp và các giới hạn hiện hành.
2. `handoff/CHECKPOINT.json`: mốc bàn giao và danh sách 17 đầu việc có cấu trúc.
3. `docs/three-workspace-app/docs/features/rig-animation-normalization.md`: đặc tả tổng thể.
4. `docs/three-workspace-app/docs/features/workspace01-remaining.md`: đặc tả phần còn thiếu.
5. `docs/three-workspace-app/LISTCODE` và `docs/inventory/workspace01-remaining.yaml` bên trong thư mục tài liệu tương ứng.
6. `docs/three-workspace-app/docs/STATUS.md`, `CHECKPOINTS.md`, `HISTORY.md` và `evidence/workspace01-doc116-validation.yaml`.

## Phạm vi code

Workspace 1 hiện phụ thuộc host và các package của app ba workspace. Vì vậy gói giữ trọn source app và các phụ thuộc nội bộ, bao gồm những phần Scene/Animation liên quan, để không cắt đứt import hoặc pnpm workspace. Đây là bàn giao source có bản đồ phạm vi Workspace 1, chưa thực hiện refactor tách sản phẩm.

| Vị trí | Vai trò |
| --- | --- |
| `three-workspace-app/editor/packages/retarget/src/` | Universal solver, mapping/preset, calibration, sampler, bake/export, skin, Assignment và tương thích V9.12 |
| `three-workspace-app/editor/packages/retarget/test/` | Tests thuật toán, mapping, GLB, skin, Assignment và catalogue 85 |
| `three-workspace-app/editor/apps/studio/app/workbench/components/normalization/` | UI nhập/chọn rig, RigTree, MappingEditor, NormalizationPreview, ModelRebindPanel, AssignmentPanel |
| `three-workspace-app/editor/apps/studio/src/` | API/command broker, project store, rig inspection, normalization plan/job, asset import và history |
| `three-workspace-app/editor/apps/studio/app/api/` | Các route API local |
| `three-workspace-app/editor/apps/studio/test/` | Integration tests, lưu/mở/history, normalization, skin và Assignment |
| `three-workspace-app/editor/packages/shared/` | Hợp đồng project, Asset/Character/Skeleton/Mapping/Motion và validation |
| `three-workspace-app/editor/packages/builder/` | Phụ thuộc Topview: scene, engine, evaluation, playback và giao diện |
| `three-workspace-app/editor/packages/director-cli/` | Hỗ trợ Node renderer/CLI của host |
| `three-workspace-app/agent/` | Python CLI/MCP, tests và các worker đi kèm source app |
| `three-workspace-app/builtin-assets/` | Model canonical, pose, manifest và license/NOTICE |
| `three-workspace-app/editor/apps/studio/public/` | Các artifact trình duyệt được source host sử dụng |
| `docs/three-workspace-app/` | Đặc tả, LISTCODE, inventory, schema, báo cáo, lịch sử và evidence |

## Khôi phục môi trường phát triển

Giải nén và giữ nguyên cấu trúc thư mục tương đối. Cần Node.js, pnpm và Python 3.11 trở lên. Kiểm thử `.ts` trực tiếp bằng `--experimental-strip-types` trong lượt bàn giao sử dụng Node đã cài trên máy; trên máy khác có thể cần Node tương thích hoặc runner TypeScript của project.

Từ `three-workspace-app/editor`:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Theo scripts hiện có, lệnh dev build Builder trước rồi mở Studio local tại `http://127.0.0.1:3002`. Không coi các lệnh này là đã được chạy lại thành công sau giải nén. Cài dependency có thể cần mạng; `node_modules` không nằm trong gói. `.env.example` được giữ; `.env.local` không được mang sang. Built-in assets dùng vị trí mặc định trong source app hoặc cấu hình local trên máy nhận.

Các kiểm tra của source, chạy tuần tự để tránh đụng build output:

```powershell
pnpm typecheck
pnpm lint
pnpm test:evaluate
pnpm build
```

Chỉ chạy offline smoke khi Studio production build thành công. Từ `three-workspace-app`, kiểm Python CLI/MCP bằng:

```powershell
python -m unittest agent.test_unified_cli agent.test_unified_mcp
```

Hướng dẫn CLI nghiệp vụ nằm tại `docs/three-workspace-app/docs/NORMALIZATION_CLI.md`.

## Giới hạn và phần loại khỏi ZIP

- Không chứa `node_modules`, runtime cài sẵn, cache, output build và log.
- Không chứa project/draft dữ liệu người dùng, cấu hình bí mật, `.env.local`, `.npmrc`, thư mục Git hoặc cấu hình agent cá nhân. Root AGENTS của workspace chứa credential nên không đưa vào gói; chỉ giữ các AGENTS của source/tài liệu được kiểm tra.
- Không chứa video quảng bá tại `three-workspace-app/docs/assets` và các ZIP xuất trước đó. Các tài nguyên model/pose, source fixtures và license được giữ.
- Các đường dẫn tuyệt đối hoặc tham chiếu source lịch sử bên ngoài hai cây thư mục đã đóng gói vẫn là thông tin truy nguyên trên máy gốc. Không đóng gói các checkout mod/BBS/Blender, fixture ngoài hoặc toolchain bên ngoài đó.
- Không sửa lỗi, chạy game, publish hay khởi động lại goal code trong lượt bàn giao này. Các hồ sơ cũ giữ nguyên lịch sử; dùng DOC-116 cùng `handoff/PROGRESS.md` để hiểu mốc bàn giao.

`handoff/MANIFEST.json` ghi kích thước và SHA-256 của mọi file được đóng gói trừ chính manifest. Khi tạo ZIP, từng entry được đọc lại và đối chiếu hash; tính toàn vẹn archive được kiểm bằng CRC.
