# Ví dụ: Tập 15 · Shot 04 (slide 5 — Hero gõ đầu Gỗ Xưa), 2026-11-06

Bản thử `s4` (cổng 3141), project `2f8b763c…`, script gốc ở `S:\Claude\w01\work\shot04\` (step*.mjs trước khi có skill này).

## Nhịp (300 khung)
| Khung | Nhịp | Hero | Gỗ Xưa | Đen |
|---|---|---|---|---|
| 0–52 | chậm | EmoteTalk (đuôi Shot 03) | BackFlipLoop lơ lửng | Death ping-pong thở |
| 52–82 | nhanh | TakeOffFinishFly ×2 → FlyRun ×1,8, bay vòng cung lên | | |
| 82–98 | khựng | FlyReady1H (tụ năng lượng) | | |
| 98–101 | rất nhanh | FlyAttack1H ×1,5, lao xuống, **chạm đầu khung 101** | | |
| 102–118 | rất nhanh | FlyStand lơ lửng | CombatWound ×2 → Death ×2,2 (skeletal), rơi tới sàn 118 | |
| 118–185 | chậm | | nằm (flat.mjs nghiêng ~17°) | |
| 186–261 | chậm | | Death **phát ngược** [2,35; 3,1] s ×0,3 → ngồi; thoại khung 240 | Death phát ngược [0,48; 1,14] s ×0,35 từ 192 → ngồi |

## Đường bay vòng cung của Hero (khoá vị trí, bezier)
x: 0:−0,6 · 52:−0,6 · 68:0,4 · 82:2,4 · 96:2,8 (linear) · 101/102: căn bằng align-contact · 117:4,5 · 170:3,8 · 300:3,5
y: 0:0 · 52:0 · 68:2,6 · 82:5,6 · 96:5,9 (linear) · 102:3,8 · 117:3,4 · 170:2,8 · 300:2,5

## VFX / âm thanh
- `tap15-vet-gay-cauvong` 100–123, `tap15-chem-nang-cauvong` 100–157, `tap15-trung-don` 101–128 (tóe lửa), toonhit 101–142 (tại đỉnh đầu
  khung 101), `landing_grass_dirt_heavy` 117–228 cỡ 0,55, `barrior01` 0–253 + 230–300.
- SFX: takeoff 49, charge 80, dash 92, swing 97, bonk 100, rên Gỗ Xưa 103, thud 116, stars 135; thoại "Ây ây da… đau quá!" 240.

## Số đo cuối
CONTINUITY 0 cm · SEAM_JUMP PASS (fastFrames 96–120) · FLOOR go 118+ −6…−3 cm · CONTACT 0 cm · mix đỉnh −2,3 dB.
