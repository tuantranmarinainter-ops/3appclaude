# Cài phim BBS (CaiPhimBBS.exe)

Tool nhỏ cho **máy khác** (đối tác) cài gói phim `.zip` xuất từ App 2 vào game Minecraft có BBS FS, không cần Node hay project W01.

## Dùng (đối tác)
1. Chép `CaiPhimBBS.exe` và gói phim `.zip` sang máy. Bấm đúp `CaiPhimBBS.exe` (hoặc kéo file `.zip` thả lên exe).
   Lần đầu Windows có thể hiện "Windows protected your PC" → **More info → Run anyway** (exe chưa ký số).
2. **① Chọn gói** `.zip`. Tool hiện tên phim, dung lượng, có hiệu ứng hay không, mod cần có.
3. **② Chọn thư mục game**: thư mục có `mods`, `saves`, `config` (vd `%APPDATA%\.minecraft` hay thư mục instance của launcher).
   Chọn thư mục con cũng được, tool tự tìm lên thư mục có `mods`. Lần sau tự nhớ.
   Tool đọc mod: cần **BBS FS 2.7**; phim có hiệu ứng cần thêm **AAA Particles** và **bbs-aaaddon** (thiếu thì chặn cài để game không sập).
4. **③ Chọn world** để xem phim. **④ Xem trước** các file sẽ chép, rồi bấm **Cài vào game**.
5. Vào game → mở world đó → BBS → Film.

Tab **Phim đã cài**: liệt kê các lần cài (kể cả lần cài từ App 2), **Gỡ phim đã chọn** xoá đúng file đã chép.

## Luật (giống App 2 `apps/studio/src/bbsInstall.ts`)
- Chỉ chép `assets/**` → `<game>/config/bbs/assets/**` và `films/*.dat` → `<game>/saves/<world>/bbs/films/`.
- **Không ghi đè**: file đã có cùng nội dung → bỏ qua; khác nội dung → giữ bản cũ, báo "khác bản cũ" (muốn bản mới: gỡ lần cài cũ rồi cài lại).
- Chặn ZIP không an toàn (đường dẫn `..`, symlink, trùng tên hoa/thường, tên thiết bị Windows, >128 MB / >256 MB giải nén).
- Chặn khi Minecraft đang mở đúng thư mục game đó (cài lúc game mở có thể làm BBS sập — B33).
- Nhật ký chung `<game>/config/bbs/w01-install-log.json` (version 1): App 2 và tool gỡ được phim của nhau.
- Gỡ: chỉ xoá file còn đúng nội dung đã cài; tài nguyên phim khác (mọi world) còn dùng thì giữ và chuyển quyền sở hữu (B64).

## Phát triển
```powershell
python -m unittest test_installer_core          # trong thư mục này; FI_REAL_ZIP=<gói thật> để thử thêm gói xuất từ App 2
pythonw film_installer.pyw [gói.zip]             # chạy giao diện từ mã nguồn
pip install pyinstaller; python build.py --out <thư mục>   # ra CaiPhimBBS.exe (~10 MB); không commit exe
```
Settings lưu ở `%APPDATA%\CaiPhimBBS\settings.json` (thư mục game, world, thư mục ZIP gần nhất).
