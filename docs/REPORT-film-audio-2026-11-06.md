# Báo cáo xuất film có tiếng — 2026-11-06

## A1 — shot đơn (đang làm, chưa nghiệm thu)

- `main` gốc: `6cb10decd90e1aedd488b2de120afd91aee1cbf0`. PR #234 còn mở khi bắt đầu và cùng sửa worker/manifest; cần kiểm tra xung đột và cập nhật sau khi PR đó merge.
- Thêm tùy chọn mặc định bật, mix theo cue và gain, đóng gói WAV BBS và một clip camera. Chỉ lưu `.dat` được từ chối nếu kết quả xuất thực sự kèm audio, vì `.dat` riêng không chứa WAV.
- Không ghi project, thư viện hoặc game thật. Kiểm thử dùng project tổng hợp và thư viện tạm.

| Gate | Trạng thái | Kết quả |
| --- | --- | --- |
| `pnpm --filter @topview/3d-builder build` | PASS | Linux, pnpm 9.15.9 |
| `pnpm typecheck` | PASS | Toàn workspace, Linux |
| `pnpm lint` | PASS | 0 lỗi, 5 cảnh báo |
| `pnpm test:evaluate` | PASS | 804 PASS, 1 SKIP; golden PASS, không regenerate |
| `pnpm build` | PASS | Linux; có cảnh báo CSS/ESLint |
| Test TS audio, manifest, revision | PASS | 29 PASS; lần chạy chung bỏ qua 1 integration vì chưa đặt fixture |
| Integration ZIP tổng hợp | PASS | 1/1: WAV 44.100 Hz, mono, PCM 16-bit, 44.100 mẫu / 20 tick, SHA khớp manifest; không cue thì không có asset audio |
| Worker Java tổng hợp | PASS | `python -m unittest agent.test_film_worker.NativeHeightFormTests`: 4/4, gồm đọc lại `bbs:audio` |
| Toàn bộ `agent.test_film_worker` | FAIL | 4 PASS, 1 FAIL, 3 ERROR do thiếu fixture `bbs-animation-MCP-reference` |
| Chromium bảng xuất | PASS | Sandbox tổng hợp, 1600×900: ô mặc định bật, tắt và bật lại được. Ảnh ngoài repo: `/tmp/film-audio-browser/audio-option.png` |
| `pnpm --filter @topview/3d-studio test:offline` | FAIL | Thiếu Chromium Playwright theo đường dẫn mặc định; script tự mở 3117 ngoài dải 3160–3169, tiến trình đã dừng |
| ZIP Shot 03 bản sao, giải mã `.dat`, 150 tick, đỉnh và link | BLOCKED | Bản sao `s3rod-projects` và `s3rod-lib` trên S: không được gắn vào cloud |
| Hash `.dat` và danh sách ZIP không tiếng so với main | BLOCKED | Chưa có dữ liệu bản sao; test so sánh cấu trúc không chứng minh hash từng byte |
| Windows và nghe trong BBS FS | NOT_RUN | Chưa có môi trường Windows/game trong phiên |

Lệnh chạy lại từ `three-workspace-app/editor` với `W01_LIBRARY` và `BBS_UNIFIED_PROJECTS_DIR` trỏ vào **bản sao**:

```sh
pnpm --filter @topview/3d-builder build
pnpm typecheck
pnpm lint
pnpm test:evaluate
pnpm build
pnpm --filter @topview/3d-builder exec tsx --test ../../apps/studio/test/audioCues.test.ts ../../apps/studio/test/filmManifest.test.ts ../../apps/studio/test/filmExportRevision.test.ts
# Thêm BBS_FILM_E2E_FBX trỏ sample.fbx và JDK 17 trên PATH:
pnpm --filter @topview/3d-builder exec tsx --test ../../apps/studio/test/filmExportJob.integration.test.ts
```

Worker, từ `three-workspace-app`: `python -m unittest agent.test_film_worker` (cần JDK 17 và fixture tham chiếu). Kiểm Shot 03 và âm thanh trong game phải do người dùng chạy trên bản sao và cài thử theo đặc tả.

## A2 — xuất tập (xếp trên A1, chưa nghiệm thu Windows)

- Xuất một film riêng cho mỗi đoạn hiện có của App 2, mỗi clip âm thanh bắt đầu tại tick 0 của film đó; `series.json` lưu vị trí tích lũy trong tập. Dùng cùng hệ số giảm đỉnh cho toàn bộ tập để tránh thay đổi âm lượng ở ranh giới; `film-audio.json` ghi SHA và đỉnh từng WAV.
- `pnpm typecheck`: **PASS** toàn workspace trên Linux. `pnpm --filter @topview/3d-builder build`: **PASS**.
- Test `filmSeries.test.ts`, `audioCues.test.ts`, `splitShots.test.ts`: **PASS 25/25** trước bổ sung test offset; `audioCues.test.ts` sau bổ sung **PASS 8/8**, `splitShots.test.ts` **PASS 6/6**.
- Integration `filmExportJob.integration.test.ts`: **PASS 1/1**, gồm scene series và `episode.export` qua hai project tổng hợp. Giải mã hai `.dat`: mỗi clip tick 0, duration 4, offset 0, link khớp WAV; mốc tích lũy tập 0 và 4; WAV mỗi đoạn 8.820 mẫu tại 44.100 Hz. Tắt tiếng: không clip và không asset audio BBS.
- Shot 03 bản sao / Windows / nghe trong game: **BLOCKED / NOT_RUN** như A1. Hash `.dat` không tiếng so với main: **BLOCKED**, chưa chứng minh được từng byte. Chưa xác nhận trong game BBS phát clip.

Lệnh từ `three-workspace-app/editor`, dùng bản sao riêng cho `W01_LIBRARY` và `BBS_UNIFIED_PROJECTS_DIR`, JDK 17 trên PATH và `BBS_FILM_E2E_FBX` trỏ tới `three-workspace-app/builtin-assets/animation-studio/sample.fbx`:

```sh
pnpm --filter @topview/3d-builder build
pnpm typecheck
pnpm --filter @topview/3d-builder exec tsx --test ../../apps/studio/test/filmSeries.test.ts ../../apps/studio/test/audioCues.test.ts ../../apps/studio/test/splitShots.test.ts
pnpm --filter @topview/3d-builder exec tsx --test ../../apps/studio/test/filmExportJob.integration.test.ts
```
