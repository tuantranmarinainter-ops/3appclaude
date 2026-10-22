# NOTICE — nguồn mã App 4 VFX

Thư mục này là bản chép mã nguồn của **effekseer-ai**:

- Repo gốc: https://github.com/laodeng000/effekseer-ai
- Commit: `208922ef192220322c2a79e1243ed51ff7d2b7af` ("Initial open-source release")
- Tác giả: laodeng000
- License: MIT — giữ nguyên tại [LICENSE](LICENSE).
- Ngày chép: 2026-10-22, chép nguyên trạng (không gồm thư mục `.git`). Mọi thay đổi sau đó nằm trong lịch sử git của repo chính.

`.github/workflows/test.yml` giữ để đối chiếu với bản gốc; GitHub Actions không chạy workflow nằm trong thư mục con.

## Không commit
DLL Effekseer, .NET runtime, file `.efk`/`.efkefc` sinh ra, `resources/`, `.venv/` và mọi binary khác
(đã có trong `.gitignore`). Cài ngoài repo, ví dụ:

| Thành phần | Nguồn | Đường dẫn trên máy W01 | SHA-256 |
| --- | --- | --- | --- |
| Effekseer 1.80.6 Windows (`Effekseer1.80.6Win.zip`, 96 564 040 byte) | https://github.com/effekseer/Effekseer/releases/tag/1806 | `C:\w01-samples\effekseer\1.80.6\Effekseer1.80.6Win\` | `faf73b3ed8ddb9775b04902ccae3930cf8476d9be54761dc0f15a2a2092a8c02` (khớp digest GitHub) |
| .NET 9.0.21 Runtime x64, bản zip không cần cài (`dotnet-runtime-9.0.21-win-x64.zip`, 35 986 534 byte) | https://dotnet.microsoft.com/download/dotnet/9.0 | `C:\w01-samples\effekseer\dotnet-9.0.21\` | SHA-512 khớp `releases.json` của Microsoft |

```powershell
$env:EFFEKSEER_AI_BIN_DIR = 'C:\w01-samples\effekseer\1.80.6\Effekseer1.80.6Win\Tool\bin'
$env:DOTNET_ROOT = 'C:\w01-samples\effekseer\dotnet-9.0.21'   # bắt buộc nếu máy không cài .NET 9 hệ thống
```

`tools/` là phần thêm của W01 (không có trong bản gốc): `g0_roundtrip.py` (mở → sửa → lưu → mở lại) và
`render_preview.py` (render PNG theo frame bằng Viewer.dll của Effekseer, không mở GUI).

Tình trạng kiểm chứng trên máy này: xem `docs/VFX-G0-REPORT.md` ở gốc repo chính.
