# Task tổng: camera App 2 chạy đúng trong film BBS FS 2.7 (2026-11-01)

> Người dùng giao 2026-11-01 ("camera chỉnh trong App 2 đưa vào BBS FS vẫn chưa nhận chuyển động camera"). Giao Codex.
> Subagent dùng model **"sol 6.1" bản nhẹ**. Một nhánh + một PR vào `main`, **không tự merge**.
> Backlog liên quan: `docs/BACKLOG-2026-10-25.md` **B59** (task này), B32, B44, B46, B58.

## Vai trò người dùng
Người làm phim Minecraft một mình. Trong App 2 họ đặt camera cho shot (vị trí, hướng, tiêu cự, chuyển động: kéo máy,
lia, zoom, đi theo đường, nhìn theo nhân vật), xem lại bằng "Xem như BBS", rồi bấm **"Xuất và cài vào game"**. Trong
Minecraft họ mở film và phát: **camera phải chạy y như trong App 2**. Hiện nhân vật + hiệu ứng đã đúng (film
`Tap15-Shot01-v5-vfx`, `-v6`), chỉ camera là sai.

## Hiện trạng đo được (Claude, 2026-11-01)
Giải mã `Tap15-Shot01-v6.dat` (world "Thế giới mới (1)", xuất từ bản sao Shot 01) bằng `BbsCodec`
(`agent/film_worker/vendor/bbs-animation-bridge-0.2.0-mc1.20.1.jar`):
- `camera` có **2 clip, cùng `layer: 0`, cùng `tick: 0`**:
  1. `type: bbs:idle`, `title: "MCP timeline"`, `duration 101`, `position.point (0,0,0)`, `fov 70` — clip giữ chỗ đặt ở **gốc
     thế giới**, không theo điểm neo F3+C.
  2. `type: bbs:keyframe`, `title: "shot_01"`, `duration 100`, kênh x/y/z/yaw/pitch/roll/fov 101 key — vị trí đúng chỗ
     (x 107.63, y −58.72, z 210.34, yaw −22.37, pitch 6.65, fov 50) nhưng **mọi key giống nhau** (camera đứng yên).
- Camera đứng yên vì node camera của bản sao đã **mất chuyển động** (B32: key camera nướng khi tách shot bị mất; B44/B58:
  node camera bị xoá rồi Claude khôi phục bản không có key). Cần thử lại với camera **có chuyển động thật**.
- Nghi vấn chính: clip `bbs:idle` ở (0,0,0) **chồng cùng lớp/cùng tick** với clip thật → BBS phát clip idle (camera nhảy về
  gốc thế giới) hoặc trộn sai.

## Yêu cầu
1. **Xác minh ngữ nghĩa camera BBS FS 2.7 từ mã nguồn/bytecode** (như đã làm với `Transform`/pose): thứ tự clip & lớp,
   `bbs:keyframe` (đơn vị và dấu của yaw/pitch/roll, fov dọc hay ngang, nội suy, `additive`, `envelope`), `bbs:idle`.
   Ghi kết quả vào `docs/` (bảng ngắn) và dùng cho các bước sau.
2. **Bỏ hoặc sửa clip giữ chỗ "MCP timeline"**: không để clip nào ở (0,0,0) chồng lên camera shot; nếu cần clip nền thì đặt
   đúng điểm neo, lớp thấp hơn và không che clip shot.
3. **Chuyển động camera đầy đủ**: mọi thứ App 2 làm với camera trong khoảng xuất phải ra keyframe từng tick đúng như
   "Xem như BBS": keyframe transform của camera, camera motion preset (dolly/pan/orbit/zoom), đi theo đường (path),
   nhìn theo/đi theo nhân vật (lookAt/follow), đổi tiêu cự theo thời gian. Áp **điểm neo F3+C** (vị trí + xoay yaw quanh
   pivot) cho camera giống hệt nhân vật.
4. **Nhiều shot / cắt cảnh**: mỗi shot trong khoảng xuất là một clip camera đúng tick bắt đầu/độ dài, không chồng nhau,
   cắt cứng giữa các shot.
5. **Tỉ lệ khung**: FOV xuất phải khớp aspect đã chọn (16:9) theo cách BBS hiểu fov (dọc/ngang) — kiểm bằng số.
6. **Giữ dữ liệu camera trong project** (điều kiện để có gì mà xuất), sửa cùng đợt:
   - **B46** (nặng): thanh tiêu cự làm FOV dao động 120 ↔ 78,83 và tự lưu hơn 1.000 lần (rev 251 → 1344 trong ~25 phút).
   - **B44 / B58**: node camera của shot bị xoá khỏi project khi chỉnh timeline / lái camera bằng WASDQE (người dùng
     không xoá). Bộ ghi **Debug** (nút ở cột trái App 2, log `<projects dir>/.debug-logs/*.jsonl`) hiện chỉ có trên nhánh kiểm của
     Claude, **chưa có trên main**; Claude sẽ gửi log tái hiện nếu bắt được.
   - **B32**: tách shot → key camera nướng bị mất sau vài lần lưu.
7. Preflight báo rõ nếu camera của shot không có chuyển động hoặc bị thiếu ("Camera shot_01 đứng yên — đúng ý bạn?").

## Kiểm (bắt buộc, ghi số trong PR)
- Fixture tổng hợp: shot 0–149 với camera **có chuyển động** (dolly 3 m + pan 45° + zoom 50→35 mm), một shot nhìn theo
  nhân vật, hai shot nối nhau. Xuất film → giải mã `.dat` bằng `BbsCodec` → so từng tick với mẫu camera App 2
  (sau điểm neo): vị trí ≤ 1 cm, góc ≤ 0,1°, fov ≤ 0,1°; không còn clip camera ở (0,0,0) chồng clip shot.
- Test cho B46 (kéo/thả thanh tiêu cự → không có lưu thêm khi đứng yên), B44/B58 (lái camera 30 giây + thao tác timeline
  → node camera và shot còn nguyên), B32.
- `pnpm --filter @topview/3d-builder build`, `pnpm typecheck`, `pnpm lint`, `pnpm test:all` (đủ bộ retarget), Python.
- Trong game BBS thật: **NOT_RUN** (Claude cài film khi game tắt và người dùng xem).

## Ranh giới
Repo https://github.com/tuantranmarinainter-ops/3appclaude — nhánh gợi ý `codex/camera-bbs`, dựa trên `main`.
PR #174/#176 (App 2) chưa merge; tránh đổi lớn `libraryCommands.ts`, `app/library/page.tsx`. Không sửa `packages/retarget`,
không đổi golden, không commit binary/kho thật/project thật. Báo cáo bằng số đo thật; ghi rõ phần NOT_RUN.
