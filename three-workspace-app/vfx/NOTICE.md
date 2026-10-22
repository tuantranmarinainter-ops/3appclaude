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

| Thành phần | Nguồn | Đường dẫn gợi ý |
| --- | --- | --- |
| Effekseer 1.80.6 Windows (`Effekseer1.80.6Win.zip`, 92.1 MB) | https://github.com/effekseer/Effekseer/releases/tag/1806 | `C:\w01-samples\effekseer\1.80.6\` |
| .NET 9 Runtime x64 (`dotnet-runtime-9.0.21-win-x64.exe`, 28.6 MB) | https://dotnet.microsoft.com/download/dotnet/9.0 | cài hệ thống (`C:\Program Files\dotnet`) |

```powershell
$env:EFFEKSEER_AI_BIN_DIR = 'C:\w01-samples\effekseer\1.80.6\Tool\bin'
```

Tình trạng kiểm chứng trên máy này: xem `docs/VFX-G0-REPORT.md` ở gốc repo chính.
