# AAA VFX — checklist kiểm game thật trên Windows (V5)

Người thực hiện: Claude cùng người dùng. Đích: Minecraft **1.20.1**, **Forge 47.4.10**, **Sinytra Connector 1.0.0-beta.46**, **BBS FS 2.7**. Instance gốc: `S:\Minecraft\Minecraft Forge-1.20.1`. Codex cloud chỉ chuẩn bị tài liệu; **mọi kết quả game dưới đây đều NOT_RUN**. Build/test code hoặc dev Fabric không chứng minh Forge + Connector chạy được.

Căn cứ: [V1–V5](AAA-VFX-TASKS-2026-10-26.md), [quyết định](DECISIONS.md), backlog [B16/B18](BACKLOG-2026-10-25.md), [kế hoạch App 4](VFX-APP4-PLAN.md). Liên kết V1 dùng nhánh PR độc lập, cần ghim SHA thực đã duyệt khi chạy. Chỉ dùng mã V1–V4 sau khi người dùng chọn đúng PR/commit để thử; tài liệu này không tự cài các PR đó.

## 1. Hỏi trước, sao lưu và cô lập

- [ ] **Trước BẤT KỲ thay đổi game nào**, hỏi người dùng và ghi câu trả lời: tạo bản sao instance, đổi jar/đuôi `.off`, sửa cấu hình, cài/gỡ film/tài nguyên, chỉnh replay, vào/lưu world. Nêu chính xác đường dẫn nguồn/đích và thay đổi dự định. Chấp thuận một bước không thay cho chấp thuận thay đổi khác.
- [ ] Đóng game và launcher; kiểm không còn Java giữ instance. Ghi ngày/giờ, launcher, Java, đường dẫn instance thực tế.
- [ ] Sao lưu riêng **`mods/`, world được chọn trong `saves/`, toàn bộ `config/bbs/`** ra thư mục có dấu thời gian ngoài instance; ghi vị trí, dung lượng, danh sách file + SHA-256. Kiểm mở được bản sao, không ghi đè backup cũ.
- [ ] Tạo **instance thử độc lập từ bản sao**, launcher profile/game directory trỏ vào bản sao; xác minh đường dẫn `mods`, `saves`, `config/bbs` không dùng junction/symlink trỏ lại gốc. Chỉ dùng world sao chép, không mở world gốc. Giữ instance gốc nguyên trạng.
- [ ] Ghi danh sách jar đang bật và `.off`/`.disabled`, tên/phiên bản/SHA-256; không bật lại cả bộ Fabric đã biết gây B18. Kiểm jar lồng trong AAA theo [báo cáo runtime V1](https://github.com/tuantranmarinainter-ops/3appclaude/blob/codex/v1-aaa-runtime/docs/AAA-RUNTIME-REPORT.md), không suy tương thích từ tên file.

PowerShell đọc hash (đặt biến thành **đường dẫn bản sao đã được duyệt**):

```powershell
$TestInstance = 'S:\Minecraft\AAA-test-YYYYMMDD'
Get-ChildItem -LiteralPath "$TestInstance\mods" -File |
  ForEach-Object { Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256 }
```

## 2. Chuẩn bị gói thử và bằng chứng

- [ ] Ghi SHA commit App 2/V1/V2/addon/autotest, nguồn/license của mẫu, hash jar/gói; addon production và harness dev là hai đầu vào khác nhau. Không commit jar hay world vào repo.
- [ ] Chọn ứng viên runtime theo V1 sau khi được duyệt. Bản Forge AAA chính thức là **ứng viên**, chưa xác nhận addon Fabric gọi được qua Connector. Không tự thay thư viện hoặc bỏ dependency để “thử tiếp”. Nếu không khởi động, lưu log rồi dừng ứng viên đó.
- [ ] Dùng project/film thử riêng với ba cue **laser, ribbon, ring** có tài nguyên thật `.efkefc` cùng texture/model/material cần thiết. Không đổi đuôi `.efk` thành `.efkefc`. Ghi đường dẫn và hash từng mẫu; thiếu mẫu thì BLOCKED, không thay bằng ảnh preview.
- [ ] Ghi trước bảng kỳ vọng từ project: cue/replay ID, đường dẫn effect, vị trí X/Y/Z (block), yaw, scale, frame đầu/cuối, FPS timeline, tick đầu/cuối thực trong film. Quy đổi frame sang giây bằng FPS thật của project, tick BBS ở 20 Hz; ghi cả cách làm tròn của exporter. Không tự đoán đơn vị hay bù vị trí sau khi xem.
- [ ] Tạo gói **omit** và gói **include** từ cùng snapshot. Kiểm `required-mods.json`, manifest/report và replay trong film; gói omit không chứa replay AAA. Gói include phải đủ dependency, đường dẫn replay khớp file cài dưới `config/bbs/assets/effeks/<namespace>/…`; dùng namespace V4 thực sinh, không mặc định `samples`. Với V4: cấu hình `W01_AAA_ASSETS` trỏ kho nguồn chỉ đọc trước khi chạy Studio; mỗi tên cue phải tìm được duy nhất `<cue.effect>.efkefc` trong cây nguồn. Đọc `aaa-assets.json` để lấy namespace `project-<24 ký tự đầu SHA-256(projectId)>`, ánh xạ cue → path replay và hash file; đối chiếu với file thực cài, không tự dựng path từ tên hiển thị. Kho nguồn có thể có thư mục viết hoa; V4 chuẩn hoá toàn bộ đường dẫn đầu ra của tài liệu effect (thư mục cha và basename) thành chữ thường ASCII, đường dẫn tài liệu nguồn chỉ nhận chữ ASCII/số, dấu phân thư mục và `._-` (không nhận khoảng trắng/Unicode). Byte tài liệu và tham chiếu resource giữ nguyên; dependency được đặt tương đối với thư mục đầu ra đã chuẩn hoá của tài liệu, giữ đúng chữ hoa/thường trong tham chiếu; dependency có thể có khoảng trắng/Unicode nếu tên hợp lệ trên Windows. Đích khác nhau chỉ bởi case/chuẩn hoá Unicode phải bị chặn dù byte giống nhau; chỉ cùng path và cùng byte mới gộp. Kiểm manifest và file thật để phát hiện lệch case; namespace escape hoặc đích trùng/xung đột phải bị chặn.
- [ ] Xem plan cài trước apply; ghi danh sách file sẽ tạo/xung đột, không cho đè file người dùng. Chỉ apply vào bản sao đã được duyệt. Sau cài đối chiếu hash; hai cue dùng chung texture chỉ có một file cùng đích. Ghi install ID để gỡ đúng lượt.
- [ ] Dành thư mục bằng chứng ngoài game: `run-id/` chứa inventory, scan/plan/export JSON, film, hash, video/ảnh, số FPS, `latest.log`, `debug.log` nếu có, `crash-reports/` nếu có. Sao chép log sau **từng lượt** trước khi chạy lại; không ghi đè log lỗi.

## 3. Ma trận chạy (tất cả hiện NOT_RUN)

| ID | Cấu hình/bài thử | Tiêu chí | Trạng thái |
|---|---|---|---|
| G0 | Bản sao baseline, bộ mod hiện tại không AAA; film omit | Khởi động, vào world, film/camera/nhân vật bình thường, thoát world | NOT_RUN |
| G1 | Không addon; yêu cầu include ở App 2 | UI/preflight/API chặn, lý do tiếng Việt, không cài replay AAA vào game | NOT_RUN |
| G2 | Ứng viên V1 + addon V2, film omit | Khởi động/vào world/thoát world không crash | NOT_RUN |
| G3 | Cùng ứng viên, include laser/ribbon/ring | Đúng hình, vị trí, thời điểm; chọn từng replay không crash | NOT_RUN |
| G4 | Có addon V2, replay trỏ resource không tồn tại | Không vẽ effect thiếu, có cảnh báo, chọn replay/đổi camera không crash | NOT_RUN |
| G5 | Dừng/chạy lại/seek/pause/speed, thoát world sau G3/G4 | Không lệch tích luỹ, không crash khi thoát world | NOT_RUN |
| G6 | Gỡ lượt cài và rollback bản sao | Chỉ file do lượt cài tạo bị gỡ; dữ liệu cũ còn nguyên | NOT_RUN |

**Không tái hiện B16 bằng cách chọn replay AAA khi addon vắng mặt.** G1 kiểm chặn ở app; nếu include vẫn xuất/cài được thì FAIL, dừng trước khi mở film đó trong game. Không giả mạo hai cờ xác nhận target để vượt kiểm tra.

### Hợp đồng quét V3 và giới hạn hiện tại

Trong bảng Xuất film, chọn thư mục game rồi bấm **Đọc world**. V3 gọi `GET /api/unified/bbs-install?gameDir=<đường dẫn đã URL-encode>` và trả `{ worlds, installs, capabilities }`. Lưu `capabilities.gameDir`, `corrected`, `bbs`, `aaa`, `addon`, `loader`, `loaderVersion` (nếu có), `issues[]`, `effectsCompatible`; mỗi mod là `{ id, version, file, loader }` hoặc `null`. UI chỉ bật **Kèm hiệu ứng** khi `effectsCompatible` đúng; export preflight/job và install plan/apply quét lại đích.

**V3 hiện chỉ cho hồ sơ Fabric đã nhận diện qua metadata; Forge + Connector vẫn bị chặn dù đủ tên jar.** Vì vậy G3 end-to-end qua App 2 trên Forge là **BLOCKED** khi thực chạy gặp chặn này; không sửa cờ hay API để vượt. Thử runtime V1 bằng fixture riêng được duyệt chỉ chứng minh runtime, không thay thế gate export/install App 2. Nếu cần mở chính sách sau khi có bằng chứng runtime, giao thay đổi code riêng; mọi gate ở đây trước khi thực chạy vẫn NOT_RUN.

## 4. Trình tự trong game

1. Chạy G0 trước. Chụp màn hình phiên bản, log khởi động và danh sách mod; xác minh BBS 2.7 thật đang nạp. Vào world sao chép, phát omit; quay từ trước lúc phát tới khi kết thúc. Thoát về menu và đóng game; ghi exit/crash.
2. G1 thực hiện khi addon không bật trong bản sao: quét thư mục gốc instance và thử đường dẫn con `config\bbs\data\films`; kiểm app báo thư mục hiệu chỉnh và tình trạng mod. `.off`/`.disabled` không được tính là mod đang có. Lưu response và thông báo chặn. Không bật include nếu scan không xác nhận cấu hình đủ điều kiện.
3. Sau khi được duyệt đổi bộ jar, chạy G2. Kiểm startup/world/exit trước khi cài film include. Có duplicate package `net.minecraftforge.fml.config`, missing dependency hay crash: FAIL cho ứng viên; giữ log và dừng.
4. G3: mở film include riêng, chọn **từng replay laser, ribbon, ring** trong film editor, đổi replay và camera orbit. Phát toàn film ở tốc độ 1×; quay video có mốc thời gian/frame. So với bảng kỳ vọng tại trước bắt đầu, lúc bắt đầu, giữa cue, lúc kết thúc và sau kết thúc. Ghi sai lệch thời gian (tick/frame) và vị trí (block), góc nhìn, màu/texture/scale; không chỉ ghi “nhìn ổn”.
5. G4 chỉ với addon V2: tạo **film thử derivative riêng**, thêm một replay AAA dùng cùng loại form/path như replay hoạt động nhưng trỏ một tên `.efkefc` chắc chắn không tồn tại trong namespace thử. Ghi ID/path đó; không xoá tài nguyên người dùng để tạo lỗi. Dùng hướng dẫn/harness V2 đã kiểm, không tự đoán tên lệnh game. Chọn replay thiếu trong editor, đổi sang replay hợp lệ rồi chọn lại, orbit, phát/seek film. Kỳ vọng không vẽ resource thiếu, log cảnh báo có path, các replay hợp lệ còn hoạt động, không NPE `FormUtilsClient.getRenderer`/`RenderFrame.collect`.
6. G5: pause/continue ở giữa mỗi cue, seek trước/giữa/sau cue, restart từ đầu hai lần, thử speed 0.5× và 2× rồi trả 1×. Ghi hành vi thực, frame/tick quan sát và sai lệch; trail còn dư/lặp đôi/lệch vị trí là lỗi. Thoát world sau khi phát và sau khi chọn replay thiếu, về menu rồi đóng game. Chỉ ghi PASS thoát world nếu quan sát hoàn tất và log không có crash/OpenGL từ luồng sai.

### Harness V2 bổ sung (dev Fabric, không thay kiểm Forge thật)

Theo [SAFE_RENDERER.md của addon](https://github.com/tuantranmarinainter-ops/BBS-AAAddon/blob/codex/v2-safe-aaa-renderer/docs/SAFE_RENDERER.md), chỉ chạy trong checkout/dev instance dùng một lần đã được duyệt. Harness tạo world `aaa-missing-effect-<time>`, film trong bộ nhớ `aaa_missing_effect_regression`, path thiếu `effeks/__bbsaaa_missing__/does_not_exist.efkefc`, rồi chọn replay bằng editor thật với orbit teleport. Đây không phải lệnh chat Minecraft.

PowerShell tại checkout addon V2 (sửa đường dẫn jar BBS thật):

```powershell
$PreviousJavaToolOptions = $env:JAVA_TOOL_OPTIONS
try {
  $env:JAVA_TOOL_OPTIONS = (($PreviousJavaToolOptions + ' -Dbbsaaa.autotest=missing-effect').Trim())
  .\gradlew.bat runClient '-Pbbs_dev_jar=C:\path\bbs-2.7-1.20.1.jar'
} finally {
  if ($null -eq $PreviousJavaToolOptions) { Remove-Item Env:JAVA_TOOL_OPTIONS -ErrorAction SilentlyContinue }
  else { $env:JAVA_TOOL_OPTIONS = $PreviousJavaToolOptions }
}
```

Giữ các tuỳ chọn Java sẵn có; nếu đã có `bbsaaa.autotest` khác thì dừng và giải quyết cấu hình trước. Sau chạy đọc `run/aaa-missing-effect-report.txt`, phải bắt đầu bằng `PASS` và đối chiếu timestamp/log của **lượt hiện tại**, không dùng report cũ hay exit code làm bằng chứng. Lưu cả cảnh báo thiếu resource và video. Cloud chưa chạy native harness: **NOT_RUN**; manual G4 trên đúng Forge + Connector vẫn bắt buộc.

Chốt dung sai thời gian/vị trí với người dùng **trước lượt đo** và ghi số vào report. Chưa có dung sai hoặc không đo được thì NOT_RUN/BLOCKED cho kiểm chính xác; không dùng kiểm cấu trúc thay kiểm runtime.

## 5. FPS và phiếu kết quả

Giữ cùng world/camera/render distance/resolution/VSync/FPS cap/shader/resource pack và số actor. Ghi CPU/GPU/RAM/Java, warm-up bao lâu, công cụ đọc FPS, cửa sổ đo (đề nghị 30 giây) và số lần chạy. Đo baseline omit và include riêng, cùng đoạn film. Chỉ báo trung vị/min/max nếu có chuỗi mẫu thật và cách tính; không bịa 1% low từ ảnh F3. Không có số đo thì FPS = NOT_RUN.

| Trường cho mỗi lượt | Giá trị cần điền |
|---|---|
| Run ID / người chạy / thời gian / chấp thuận | NOT_RUN |
| Instance thử / backup / commit / jar SHA-256 | NOT_RUN |
| Film / cue ID / effect path / install ID | NOT_RUN |
| FPS baseline: mẫu, thời gian, min/median/max | NOT_RUN |
| FPS include: mẫu, thời gian, min/median/max | NOT_RUN |
| Sai lệch thời gian / vị trí từng cue + dung sai | NOT_RUN |
| Chọn replay hợp lệ/thiếu / cảnh báo path | NOT_RUN |
| Thoát world / đóng game / exception | NOT_RUN |
| Link video, ảnh, log; kết luận từng gate | NOT_RUN |

Trạng thái: **NOT_RUN** chưa thực hiện; **BLOCKED** thiếu điều kiện (nêu rõ); **FAIL** đã chạy và vi phạm tiêu chí; **PASS** đã chạy đủ bằng chứng. Nếu V1 chỉ chạy được Fabric thuần, ghi kết quả thành profile khác; gate Forge + Connector vẫn NOT_RUN hoặc FAIL theo lượt đã chạy, không chuyển thành PASS.

## 6. Dừng và rollback

Khi crash/đen màn hình/lỗi renderer: ngừng thử, chép log/crash-report trước khi khởi động lại; ghi bước cuối cùng. Không tự sửa world gốc. Hỏi người dùng trước mọi thay đổi khắc phục hoặc rollback game.

Sau khi được duyệt, đóng Java, dùng uninstall của đúng install ID và xem danh sách file gỡ; đối chiếu inventory trước/sau, giữ file người dùng và tài nguyên của lượt khác. Nếu rollback cả instance thử, thay bản sao thử bằng backup đã kiểm vào đường dẫn mới, không chép đè instance gốc; dùng launcher profile đúng đường dẫn. Kiểm hash mods/world/config BBS với backup và chạy lại baseline nếu được duyệt. Lưu bằng chứng lỗi ngay cả khi rollback thành công. Chỉ đề xuất áp dụng vào instance thật sau khi có kết quả thực và người dùng duyệt riêng.
